import Activities from './Activities.js';
import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

const GMM_DEFERRALS_SETTING = "automateDeferrals";
const GMM_CLOCK_FLAG = "deferral";
const GMM_MESSAGE_FLAG = "deferralResolution";

/* GMMC counts the turns itself: an effect's duration measures elapsed rounds, not turns its bearer has taken. */
const Deferrals = (function () {

	function init() {
		Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
		Hooks.on("deleteActiveEffect", _onDeleteActiveEffect);
		Hooks.on("combatTurnChange", _onCombatTurnChange);
		Hooks.on("deleteCombat", _onDeleteCombat);
		Hooks.on("dnd5e.renderChatMessage", _onRenderChatMessage);
		Hooks.on("createMeasuredTemplate", _onCreateMeasuredTemplate);
	}

	function _isEnabled() {
		try {
			return !!game.settings.get(GMM_MODULE_TITLE, GMM_DEFERRALS_SETTING);
		} catch (error) {
			return false;
		}
	}

	/* Policy, not capability: nothing here needs v14, but new automation is not shipped to v13. */
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

			const templateUuids = (results?.templates ?? []).flat().map(t => t?.uuid).filter(_ => _);
			await _plantClock(item, deferral, templateUuids, inCombat);
		} catch (error) {
			console.error("GMM | Deferral activation failed", error);
		}
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

	/* midi's auto-create-template places its template after the clock already exists. */
	function _onCreateMeasuredTemplate(template, _options, _userId) {
		if (!game.users.activeGM?.isSelf || !_isEnabled()) return;
		const origin = template.getFlag("dnd5e", "origin");
		if (typeof origin !== "string" || !origin.endsWith(`.Activity.${Activities.GMM_ACTIVITY_ID}`)) return;

		const item = fromUuidSync(origin)?.item;
		const actor = item?.actor;
		if (!actor) return;

		const effect = _clockEffects(actor).find(e => _readClock(e)?.itemId === item.id);
		if (!effect) return;
		const clock = _readClock(effect);
		if (clock.templateUuids?.includes(template.uuid)) return;
		effect.setFlag(GMM_MODULE_TITLE, GMM_CLOCK_FLAG, {
			...clock,
			templateUuids: [...(clock.templateUuids ?? []), template.uuid]
		}).catch(e => console.warn("GMM | Attaching a late template to a deferral clock failed", e));
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
				await effect.setFlag(GMM_MODULE_TITLE, GMM_CLOCK_FLAG, { ...clock, remaining, lastTick: tick });

				if (remaining > 0) _postCountdown(actor, effect, clock.itemId, remaining);
				else await _postResolutionCard(effect);
			} catch (error) {
				console.error("GMM | Deferral countdown failed", error);
			}
		}
	}

	function _postCountdown(actor, effect, itemId, remaining) {
		const item = actor.items.get(itemId);
		return ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			content: `<p><em>${game.i18n.format("gmm.deferral.countdown", {
				name: item?.name ?? effect.name,
				rounds: remaining
			})}</em></p>`
		});
	}

	async function _postResolutionCard(effect) {
		const actor = effect.parent;
		const clock = _readClock(effect);
		const item = actor?.items?.get(clock?.itemId);
		if (!item) return void await _cancel(effect, { silent: true });

		const targets = await _templateTargets(clock);
		const targetNames = targets.map(t => t.name);

		const content = await foundry.applications.handlebars.renderTemplate(
			`modules/${GMM_MODULE_TITLE}/templates/chat/deferral-resolution.html`,
			{
				name: item.name,
				cancel: clock.cancel,
				targets: targetNames,
				hasTargets: !!targetNames.length,
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
		const actor = effect.parent;
		const clock = _readClock(effect);
		const item = actor?.items?.get(clock?.itemId);
		if (!item) return void await _cancel(effect, { silent: true });

		// Targets first: deleting the clock takes the template with it.
		const targets = await _templateTargets(clock);
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
			const item = actor?.items?.get(clock?.itemId);
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor }),
				content: `<p><em>${game.i18n.format("gmm.deferral.cancelled", {
					name: item?.name ?? effect.name
				})}</em></p>`
			});
		}
		await effect.delete();
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

	/* A template can be deleted between activation and zero, so a dangling uuid yields no targets. */
	async function _templateTargets(clock) {
		const found = [];
		for (const uuid of clock?.templateUuids ?? []) {
			const template = await fromUuid(uuid);
			if (!template?.object) continue;
			for (const token of template.parent?.tokens ?? []) {
				const object = token.object;
				if (!object) continue;
				if (template.object.testPoint?.(object.center) ?? false) found.push(token);
			}
		}
		return found;
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
