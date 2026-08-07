import Activities from './Activities.js';
import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

const GMM_DEFERRALS_SETTING = "automateDeferrals";
const GMM_CLOCK_FLAG = "deferral";
const GMM_MESSAGE_FLAG = "deferralResolution";

/* GMMC counts the turns itself: an effect's duration measures elapsed rounds, not turns its bearer has taken. */
const Deferrals = (function () {

	/* Templates placed before their clock exists, keyed by the activity uuid stamped on them. */
	const _pendingTemplates = new Map();

	function init() {
		Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
		Hooks.on("createActiveEffect", _onCreateActiveEffect);
		Hooks.on("deleteActiveEffect", _onDeleteActiveEffect);
		Hooks.on("combatTurnChange", _onCombatTurnChange);
		Hooks.on("deleteCombat", _onDeleteCombat);
		Hooks.on("preDeleteToken", _onPreDeleteToken);
		Hooks.on("preDeleteActor", _onPreDeleteActor);
		Hooks.on("dnd5e.renderChatMessage", _onRenderChatMessage);
		Hooks.on("createRegion", _onCreateRegionTemplate);
	}

	function _isEnabled() {
		try {
			return !!game.settings.get(GMM_MODULE_TITLE, GMM_DEFERRALS_SETTING);
		} catch (error) {
			return false;
		}
	}

	/* Nothing here needs v14 yet, but new automation is not shipped to v13. */
	function _isSupported() {
		return (game.release?.generation ?? 0) >= 14;
	}

	function _combatantFor(actor) {
		const combat = game.combat;
		if (!combat?.started) return null;
		const combatant = combat.getCombatantsByActor(actor)[0] ?? null;
		return combatant ? { combat, combatant } : null;
	}

	/* The card, the uses and the template are all already done when this fires, under midi too. */
	async function _onPostUseActivity(activity, _usageConfig, results) {
		try {
			if (activity?.id !== Activities.GMM_ACTIVITY_ID) return;
			const captured = _drainTemplates(activity.uuid);

			const item = activity.item;
			const deferral = Activities.readDeferral(item?.flags?.gmm?.blueprint);
			if (deferral?.type !== "delayed") return;

			const deferredId = Activities.GMM_DEFERRED_ACTIVITY_ID;
			if (!item.system?.activities?.has?.(deferredId)) return;

			// A countdown in the scaler's turns is meaningless without turns, so resolve rather than plant one.
			const inCombat = _combatantFor(item.actor);
			if (!_isEnabled() || !_isSupported() || !inCombat) {
				return void await _useDeferredActivity(item);
			}

			const placed = (results?.templates ?? []).flat().map(_regionUuid).filter(_ => _);
			await _plantClock(item, deferral, Array.from(new Set([...placed, ...captured])), inCombat);
		} catch (error) {
			console.error("GMM | Deferral activation failed", error);
		}
	}

	/* dnd5e hands back the deprecated MeasuredTemplate facade. The document that exists is the Region. */
	function _regionUuid(template) {
		if (!template?.id) return null;
		return template.parent?.regions?.get(template.id)?.uuid ?? template.uuid ?? null;
	}

	function _drainTemplates(origin) {
		const uuids = _pendingTemplates.get(origin) ?? [];
		_pendingTemplates.delete(origin);
		return uuids;
	}

	/* The gate applied the clock, so this is where GMMC first sees it and the only place its source is resolvable. */
	async function _onCreateActiveEffect(effect, _options, _userId) {
		// Not the creating user: DAE applies to an owned target on that player's client, so only the GM can act.
		if (!game.users.activeGM?.isSelf) return;
		const clock = _readClock(effect);
		if (_clockKind(clock) !== "dooming") return;

		try {
			const item = _resolveSourceItem(effect.origin);
			if (item) await effect.setFlag(GMM_MODULE_TITLE, GMM_CLOCK_FLAG, { ...clock, sourceUuid: item.uuid });

			// A countdown in the bearer's turns is meaningless without turns, so resolve rather than leave it sitting.
			if (_isEnabled() && _isSupported() && _combatantFor(effect.parent)) return;
			await effect.delete();
			if (item) await _useDeferredActivity(item, { targets: _bearerTokens(effect) });
		} catch (error) {
			console.error("GMM | Doom clock setup failed", error);
		}
	}

	/* Core stamps the source effect's uuid and midi the activity's, so neither shape can be assumed. */
	function _resolveSourceItem(origin) {
		if (typeof origin !== "string" || !origin) return null;
		const viaMidi = globalThis.MidiQOL?.getItemFromEffectOrigin;
		if (viaMidi) {
			try {
				const found = viaMidi(origin);
				if (found) return found;
			} catch (error) {
				console.warn("GMM | midi origin resolution failed; cutting the uuid instead", error);
			}
		}
		const doc = fromUuidSync(origin.split(".Activity.")[0].split(".ActiveEffect.")[0]);
		return (doc instanceof Item) ? doc : null;
	}

	/* A delayed clock rides the item's own actor; a doom clock rides someone else's. */
	function _sourceItem(effect, clock) {
		if (clock?.sourceUuid) return fromUuidSync(clock.sourceUuid) ?? null;
		return effect?.parent?.items?.get?.(clock?.itemId) ?? null;
	}

	function _clockKind(clock) {
		return clock?.kind ?? (clock ? "delayed" : null);
	}

	function _bearerTokens(effect) {
		return effect?.parent?.getActiveTokens?.(false, true) ?? [];
	}

	async function _plantClock(item, deferral, templateUuids, { combat, combatant }) {
		const effectData = {
			name: game.i18n.format("gmm.deferral.clock.name", { name: item.name }),
			img: item.img,
			origin: item.uuid,
			// Cosmetic; the flag's count is authoritative.
			duration: { value: deferral.timer, units: "rounds", expiry: "turnStart" },
			// getEffectStart would record whoever's turn it currently is, which is wrong for a reaction.
			start: {
				time: game.time.worldTime,
				combat: combat.id,
				combatant: combatant.id,
				initiative: combatant.initiative ?? null,
				round: combat.round ?? null,
				turn: combat.turn ?? null
			},
			// Creation data is not expanded, so a dotted flag key would be stored as one literal key.
			flags: {
				[GMM_MODULE_TITLE]: {
					[GMM_CLOCK_FLAG]: {
						kind: "delayed",
						name: item.name,
						itemId: item.id,
						timer: deferral.timer,
						remaining: deferral.timer,
						cancel: deferral.cancel ?? "",
						templateUuids,
						// The planting turn is not one of its ticks.
						lastTick: `${combat.id}:${combat.round}`
					}
				}
			}
		};

		await item.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
	}

	/* A template can land before its clock or after it. midi auto-places inside `use()`. A GM draws one later. */
	function _onCreateRegionTemplate(region, _options, userId) {
		if (!_isEnabled()) return;
		const origin = region.getFlag("dnd5e", "origin");
		if (typeof origin !== "string" || !origin.endsWith(`.Activity.${Activities.GMM_ACTIVITY_ID}`)) return;

		const effect = _clockFor(origin);
		if (!effect) {
			// Whoever placed it is whoever will drain it: `postUseActivity` fires only on that client.
			if (userId === game.user.id) {
				_pendingTemplates.set(origin, [...(_pendingTemplates.get(origin) ?? []), region.uuid]);
			}
			return;
		}

		if (!game.users.activeGM?.isSelf) return;
		const clock = _readClock(effect);
		if (clock.templateUuids?.includes(region.uuid)) return;
		effect.setFlag(GMM_MODULE_TITLE, GMM_CLOCK_FLAG, {
			...clock,
			templateUuids: [...(clock.templateUuids ?? []), region.uuid]
		}).catch(e => console.warn("GMM | Attaching a late template to a deferral clock failed", e));
	}

	function _clockFor(origin) {
		const item = fromUuidSync(origin)?.item;
		const actor = item?.actor;
		if (!actor) return null;
		return _clockEffects(actor).find(e => _readClock(e)?.itemId === item.id) ?? null;
	}

	/* `lastTick` guards against `combatTurnChange` firing more than once for one turn. */
	async function _onCombatTurnChange(combat, _prior, _current) {
		if (!game.users.activeGM?.isSelf || !_isEnabled()) return;
		const actor = combat?.combatant?.actor;
		if (!actor) return;

		for (const effect of _clockEffects(actor)) {
			try {
				const clock = _readClock(effect);
				const current = Number(clock.remaining ?? clock.timer ?? 1);
				// The card is already out; ticking again would re-post it every turn.
				if (!(current > 0)) continue;

				const tick = `${combat.id}:${combat.round}`;
				if (clock.lastTick === tick) continue;

				const remaining = current - 1;
				const update = { flags: { [GMM_MODULE_TITLE]: { [GMM_CLOCK_FLAG]: { ...clock, remaining, lastTick: tick } } } };
				// The doom clock's own name is the only number a player can trust, so it moves in the same write.
				if (_clockKind(clock) === "dooming") update.name = _doomClockName(effect, clock, remaining);
				await effect.update(update);

				if (remaining > 0) _postCountdown(actor, effect, clock, remaining);
				else await _postResolutionCard(effect);
			} catch (error) {
				console.error("GMM | Deferral countdown failed", error);
			}
		}
	}

	/* Not `effect.name`: a renamed clock already carries its count, so reusing it would nest one qualifier in another. */
	function _featureName(effect, clock) {
		return clock?.name || _sourceItem(effect, clock)?.name || effect.name;
	}

	function _doomClockName(effect, clock, remaining) {
		return game.i18n.format("gmm.deferral.clock.doomed", {
			name: _featureName(effect, clock),
			rounds: remaining
		});
	}

	function _postCountdown(actor, effect, clock, remaining) {
		const key = _clockKind(clock) === "dooming" ? "gmm.deferral.doom_countdown" : "gmm.deferral.countdown";
		return ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content: `<p><em>${game.i18n.format(key, {
				name: _featureName(effect, clock),
				target: actor.name,
				rounds: remaining
			})}</em></p>`
		});
	}

	async function _postResolutionCard(effect) {
		const actor = effect.parent;
		const clock = _readClock(effect);
		const item = _sourceItem(effect, clock);
		if (!item) return void await _cancel(effect, { silent: true });

		const dooming = _clockKind(clock) === "dooming";
		const area = dooming ? { tokens: [], unread: 0, hasArea: false } : await _templateTargets(clock);
		const targetNames = dooming ? [actor.name] : area.tokens.map(t => t.name);

		const content = await foundry.applications.handlebars.renderTemplate(
			`modules/${GMM_MODULE_TITLE}/templates/chat/deferral-resolution.html`,
			{
				name: item.name,
				cancel: clock.cancel,
				targets: targetNames,
				hasTargets: !!targetNames.length,
				unread: area.unread > 0,
				hasArea: area.hasArea,
				dooming: dooming,
				effectUuid: effect.uuid
			}
		);

		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content,
			whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
			flags: { [GMM_MODULE_TITLE]: { [GMM_MESSAGE_FLAG]: { effectUuid: effect.uuid } } }
		});
	}

	function _onRenderChatMessage(message, html) {
		const flag = message.getFlag(GMM_MODULE_TITLE, GMM_MESSAGE_FLAG);
		if (!flag?.effectUuid) return;

		for (const button of html.querySelectorAll("[data-gmm-deferral]")) {
			button.addEventListener("click", async () => {
				const effect = await fromUuid(flag.effectUuid);
				// The clock is gone, so the card has already been answered.
				if (!effect) return void ui.notifications?.warn(game.i18n.localize("gmm.deferral.already_resolved"));
				for (const b of html.querySelectorAll("[data-gmm-deferral]")) b.disabled = true;
				if (button.dataset.gmmDeferral === "resolve") await _resolve(effect);
				else await _cancel(effect);
			});
		}
	}

	async function _resolve(effect) {
		const clock = _readClock(effect);
		const item = _sourceItem(effect, clock);
		if (!item) return void await _cancel(effect, { silent: true });

		// Targets first: deleting the clock takes the template with it.
		const targets = _clockKind(clock) === "dooming"
			? _bearerTokens(effect)
			: (await _templateTargets(clock)).tokens;
		await _cancel(effect, { silent: true });
		await _useDeferredActivity(item, { targets });
	}

	/* midi drives its whole workflow from `completeActivityUse`; core dnd5e has no equivalent entry point. */
	async function _useDeferredActivity(item, { targets = null } = {}) {
		const activity = item.system?.activities?.get?.(Activities.GMM_DEFERRED_ACTIVITY_ID);
		if (!activity) return;

		// Occupants as of now, not activation: leaving the area before zero is meant to save you.
		if (targets?.length) {
			for (const token of Array.from(game.user.targets)) token.setTarget(false, { releaseOthers: false });
			for (const token of targets) token.object?.setTarget(true, { releaseOthers: false });
		}

		const midi = game.modules.get("midi-qol");
		const message = { data: { flags: { [GMM_MODULE_TITLE]: { deferredFrom: item.name } } } };
		if (midi?.active && globalThis.MidiQOL?.completeActivityUse) {
			await MidiQOL.completeActivityUse(activity, {}, {}, message);
		} else {
			await activity.use({}, {}, message);
		}
	}

	async function _cancel(effect, { silent = false } = {}) {
		const clock = _readClock(effect);
		const actor = effect.parent;
		if (!silent) {
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor }),
				content: `<p><em>${game.i18n.format("gmm.deferral.cancelled", {
					name: _featureName(effect, clock)
				})}</em></p>`
			});
		}
		await effect.delete();
	}

	/* An effect destroyed with its parent fires no delete hook, and `pre` is where its flags are still readable. */
	function _onPreDeleteToken(token) {
		// A linked token leaves the actor and its clock behind, so that clock has to go explicitly.
		_releasePending(token?.actor, { andEffects: !!token?.actorLink });
	}

	function _onPreDeleteActor(actor) {
		_releasePending(actor, { andEffects: false });
	}

	function _releasePending(actor, { andEffects }) {
		if (!game.users.activeGM?.isSelf || !actor) return;
		for (const effect of _clockEffects(actor)) {
			const clock = _readClock(effect);
			if (clock?.templateUuids?.length) {
				_deleteTemplates(clock.templateUuids).catch(e => console.warn("GMM | Deferral template cleanup failed", e));
			}
			if (andEffects) effect.delete().catch(e => console.warn("GMM | Deferral clock cleanup failed", e));
		}
	}

	/* The canvas marker goes whenever the clock does, however it ended. */
	function _onDeleteActiveEffect(effect, _options, _userId) {
		if (!game.users.activeGM?.isSelf) return;
		const clock = _readClock(effect);
		if (!clock?.templateUuids?.length) return;
		_deleteTemplates(clock.templateUuids).catch(e => console.warn("GMM | Deferral template cleanup failed", e));
	}

	/* An unresolved deferral is a fizzled one. */
	function _onDeleteCombat(combat, _options, _userId) {
		if (!game.users.activeGM?.isSelf) return;
		const seen = new Set();
		for (const combatant of combat?.combatants ?? []) {
			const actor = combatant.actor;
			if (!actor || seen.has(actor.uuid)) continue;
			seen.add(actor.uuid);
			for (const effect of _clockEffects(actor)) {
				effect.delete().catch(e => console.warn("GMM | Deferral cleanup on combat end failed", e));
			}
		}
	}

	function _readClock(effect) {
		return effect?.getFlag?.(GMM_MODULE_TITLE, "deferral") ?? null;
	}

	function _clockEffects(actor) {
		return Array.from(actor?.effects ?? []).filter(e => _readClock(e));
	}

	/* No area, an area that has gone, and an area that cannot be measured are three different answers to the GM. */
	async function _templateTargets(clock) {
		const uuids = clock?.templateUuids ?? [];
		if (!uuids.length) return { tokens: [], unread: 0, hasArea: false };

		// Resolved up front because both tiers below return no tokens for a template that has gone.
		const found = [];
		let unread = 0;
		for (const uuid of uuids) {
			const template = await fromUuid(uuid);
			if (_isMeasurableHere(template)) found.push({ uuid, template });
			else unread += 1;
		}
		if (!found.length) return { tokens: [], unread, hasArea: true };

		// Preferred, so the card cannot list a token midi will then refuse to target.
		const viaMidi = globalThis.MidiQOL?.computeTargetsFromTemplates;
		if (viaMidi) {
			try {
				// The stored strings, so midi is handed what GMMC recorded rather than a re-derived uuid.
				const surviving = found.map(f => f.uuid);
				return { tokens: (viaMidi(surviving) ?? []).map(t => t.document ?? t), unread, hasArea: true };
			} catch (error) {
				console.warn("GMM | midi template targeting failed; measuring the template directly", error);
			}
		}

		const tokens = [];
		for (const { template } of found) {
			for (const token of template.parent?.tokens ?? []) {
				if (template.testPoint(token.getCenterPoint())) tokens.push(token);
			}
		}
		return { tokens, unread, hasArea: true };
	}

	/* Both tiers measure the viewed scene's tokens. A template on another scene would be measured against the
	   wrong ones. A facade uuid, stored by a clock planted before this shape changed, has no `testPoint`. */
	function _isMeasurableHere(template) {
		return typeof template?.testPoint === "function" && template.parent?.id === canvas.scene?.id;
	}

	async function _deleteTemplates(uuids) {
		for (const uuid of uuids ?? []) {
			const template = await fromUuid(uuid);
			if (template) await template.delete();
		}
	}

	return {
		init: init
	};
})();

export default Deferrals;
