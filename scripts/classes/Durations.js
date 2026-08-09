import Shortcoder from "./Shortcoder.js";
import AutomationHelpers from "./AutomationHelpers.js";
import { GMM_MODULE_TITLE } from "../consts/GmmModuleTitle.js";

/* GMMC runs none of this itself. An absent module degrades a type to a plain lifetime rather than
 * breaking it. */
const Durations = (function () {

	const GMM_DURATIONS_SETTING = "automateDurations";
	const GMM_DURATION_FLAG = "duration";

	const GMM_DURATION_EFFECT_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
		? dnd5e.utils.staticID("gmmduration")
		: "gmmduration00000";

	const GMM_DURATION_IMG = "icons/magic/time/clock-stopwatch-white-blue.webp";

	const OVERTIME_KEY = "flags.midi-qol.OverTime";
	const MACRO_REPEAT_KEY = "flags.dae.macroRepeat";
	const MACRO_EXECUTE_KEY = "flags.dae.macro.execute";
	const REAPPLY_FUNCTION = "function.gmmc.durations.reapplyOnSourceTurn";

	const TYPES = {
		instant: { applies: false },
		end_of_your_turn: { applies: true, expiry: "sourceEnd", rounds: 1 },
		end_of_target_turn: { applies: true, expiry: "targetEnd", rounds: 1, cancellable: true },
		timed: { applies: true, hasPeriod: true, periodRequired: true, reappliable: true, cancellable: true },
		ongoing: { applies: true, hasPeriod: true, hasSave: true, saveTurn: "start", reappliable: true, cancellable: true },
		save_ends: { applies: true, hasPeriod: true, hasSave: true, saveTurn: "end", reappliable: true, cancellable: true },
		permanent: { applies: true },
		special: { applies: false }
	};

	/* v14 dropped the `{rounds, turns, seconds}` shape for a value/units pair drawn from this list. */
	const EFFECT_UNITS = {
		turn: "turns",
		round: "rounds",
		minute: "minutes",
		hour: "hours",
		day: "days",
		month: "months",
		year: "years"
	};

	function _rules(type) {
		return TYPES[type] ?? TYPES.instant;
	}

	function isEnabled() {
		try {
			return !!game.settings.get(GMM_MODULE_TITLE, GMM_DURATIONS_SETTING);
		} catch (error) {
			return false;
		}
	}

	/* New automation is not shipped to v13. */
	function isSupported() {
		return (game.release?.generation ?? 0) >= 14;
	}

	function read(blueprint) {
		const d = blueprint?.data?.duration ?? blueprint?.duration ?? {};
		return {
			type: TYPES[d.type] ? d.type : "instant",
			units: d.units ?? "",
			value: d.value ?? "",
			saveAbility: d.save?.ability ?? "",
			reapplies: d.reapplies ?? "",
			cancel: d.cancel ?? ""
		};
	}

	/* Reapplication stays off. The pre-type field was a label. Reading it as a behaviour would turn every
	 * timed damage action into a damage-over-time. */
	function fromUnits(units, value) {
		switch (units) {
			case "perm": return { type: "permanent", units: "", value: "", reapplies: "" };
			case "spec": return { type: "special", units: "", value: "", reapplies: "" };
			case "inst":
			case "":
			case null:
			case undefined: return { type: "instant", units: "", value: "", reapplies: "" };
			default: return { type: "timed", units, value: value ?? "", reapplies: "" };
		}
	}

	/* Read by the sheet and never written back. That keeps a blueprint portable into a world with a
	 * different module set. */
	function describe(blueprint) {
		const duration = read(blueprint);
		const rules = _rules(duration.type);
		const needs = [];
		if (rules.hasSave || duration.reapplies === "target") needs.push("midi-qol");
		if (rules.expiry || duration.reapplies === "source") needs.push("dae");
		return {
			duration,
			rows: {
				period: !!rules.hasPeriod,
				periodRequired: !!rules.periodRequired,
				save: !!rules.hasSave,
				reapplies: !!rules.reappliable,
				cancel: !!rules.cancellable,
				concentration: !!rules.hasPeriod
			},
			missing: [...new Set(needs)].filter(id => !game.modules?.get?.(id)?.active)
		};
	}

	/* Also the lifetime dnd5e gives a Concentrating effect. A type without a period deliberately
	 * carries no number. */
	function buildActivityDuration(blueprint, concentration) {
		const duration = read(blueprint);
		const shared = { concentration: !!concentration, special: "", override: false };

		if (_rules(duration.type).hasPeriod && duration.units) {
			return { ...shared, value: duration.value ?? null, units: duration.units };
		}
		switch (duration.type) {
			case "permanent": return { ...shared, value: null, units: "perm" };
			case "special": return { ...shared, value: null, units: "spec" };
			case "end_of_your_turn":
			case "end_of_target_turn": return { ...shared, value: 1, units: "round" };
			default: return { ...shared, value: null, units: "inst" };
		}
	}

	function _effectDuration(duration, rules) {
		const out = {};
		if (rules.expiry) out.expiry = rules.expiry;
		if (rules.rounds) {
			out.value = rules.rounds;
			out.units = "rounds";
			return out;
		}
		const value = Number(duration.value);
		if (!rules.hasPeriod || !EFFECT_UNITS[duration.units] || !Number.isFinite(value) || value <= 0) return out;
		out.value = value;
		out.units = EFFECT_UNITS[duration.units];
		return out;
	}

	/* Separated with `#` because a damage formula may legally contain a comma. The `,` separator applies
	 * only when no `#` is present. */
	function _overTimeChanges(duration, rules, damage) {
		const changes = [];

		if (rules.hasSave) {
			const parts = [
				`turn=${rules.saveTurn}`,
				"rollType=save",
				`saveAbility=${duration.saveAbility}`,
				`saveDC=${damage?.saveDc ?? 10}`,
				"saveCount=1-"
			];
			// Ongoing's damage is the failure branch of its own save, not a separate tick.
			if (rules.saveTurn === "start" && damage?.formula) {
				parts.push(`damageRoll=${damage.formula}`, `damageType=${damage.type ?? ""}`, "saveDamage=nodamage");
			}
			changes.push({ key: OVERTIME_KEY, value: parts.join("#"), type: "override", priority: 20 });
		}

		if (duration.reapplies === "target" && damage?.formula) {
			const parts = [
				"turn=start",
				"rollType=damage",
				`damageRoll=${damage.formula}`,
				`damageType=${damage.type ?? ""}`
			];
			changes.push({ key: `${OVERTIME_KEY}Reapply`, value: parts.join("#"), type: "override", priority: 20 });
		}

		return changes;
	}

	/* Neither midi nor DAE offers a source-keyed repeat. This rides DAE's every-turn loop instead. The
	 * formula travels on the effect flag because DAE tokenises macro arguments on whitespace. */
	function _reapplySourceChanges() {
		return [
			{ key: MACRO_REPEAT_KEY, value: "startEveryTurnAny", type: "override", priority: 20 },
			{ key: MACRO_EXECUTE_KEY, value: REAPPLY_FUNCTION, type: "override", priority: 20 }
		];
	}

	/* Forged even when the action inflicts no condition, because a purely recurring damage effect would
	 * otherwise have no document to hang its flags on. */
	function buildEffectData(blueprint, { name, img, damage } = {}) {
		const duration = read(blueprint);
		const rules = _rules(duration.type);
		if (!rules.applies || !isSupported() || !isEnabled()) return null;

		return {
			_id: GMM_DURATION_EFFECT_ID,
			name: name || "Duration",
			img: img || GMM_DURATION_IMG,
			// v14 moved effect changes off the document and into its type data.
			system: {
				changes: [
					..._overTimeChanges(duration, rules, damage),
					...(duration.reapplies === "source" ? _reapplySourceChanges() : [])
				]
			},
			duration: _effectDuration(duration, rules),
			transfer: false,
			flags: {
				[GMM_MODULE_TITLE]: {
					[GMM_DURATION_FLAG]: {
						type: duration.type,
						reapplies: duration.reapplies || null,
						formula: damage?.formula ?? "",
						damageType: damage?.type ?? ""
					}
				}
			}
		};
	}

	function isDurationEffect(effect) {
		return !!effect?.flags?.[GMM_MODULE_TITLE]?.[GMM_DURATION_FLAG];
	}

	/* The stored change values still carry shortcodes. Only the owning scaler can resolve them. */
	function resolveEffectFormulas(item, monsterData) {
		if (!monsterData) return;
		const effect = item?.effects?.get?.(GMM_DURATION_EFFECT_ID);
		if (!effect) return;
		const flag = effect.flags?.[GMM_MODULE_TITLE]?.[GMM_DURATION_FLAG];
		if (flag && typeof flag.formula === "string" && flag.formula.includes("[")) {
			flag.formula = Shortcoder.replaceShortcodes(flag.formula, monsterData, false, item);
		}
		for (const change of effect.system?.changes ?? effect.changes ?? []) {
			if (typeof change.value === "string" && change.value.includes("[")) {
				change.value = Shortcoder.replaceShortcodes(change.value, monsterData, false, item);
			}
		}
	}

	/* The tray applies `effect.toObject()`, a clone of _source that the resolution above never touched.
	 * This is the last point at which the scaler is still reachable. */
	function _onPreCreateActiveEffect(effect, data) {
		if (!isDurationEffect(effect)) return;
		const item = AutomationHelpers.resolveSourceItem(effect.origin);
		const monsterData = item?.getOwningGmmMonster?.();
		if (!monsterData) return;

		const resolve = (value) => (typeof value === "string" && value.includes("["))
			? Shortcoder.replaceShortcodes(value, monsterData, false, item)
			: value;

		const update = {};
		const changes = data.system?.changes ?? data.changes;
		if (Array.isArray(changes)) {
			const key = Array.isArray(data.system?.changes) ? "system.changes" : "changes";
			update[key] = changes.map(c => ({ ...c, value: resolve(c.value) }));
		}

		const formula = data.flags?.[GMM_MODULE_TITLE]?.[GMM_DURATION_FLAG]?.formula;
		if (formula) update[`flags.${GMM_MODULE_TITLE}.${GMM_DURATION_FLAG}.formula`] = resolve(formula);

		if (!foundry.utils.isEmpty(update)) effect.updateSource(update);
	}

	function _sourceActorOf(effect) {
		const origin = effect?.origin;
		if (!origin) return null;
		const doc = fromUuidSync(origin);
		return doc?.actor ?? doc?.parent?.actor ?? doc?.parent ?? null;
	}

	/* The only record of the tick. The tick is not a workflow and produces no card of its own. */
	async function _applyDamage(actor, formula, damageType, name) {
		const roll = await new Roll(String(formula)).evaluate();
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: [name, damageType, "damage"].filter(x => x).join(" ")
		});
		const parts = [{ value: roll.total, damage: roll.total, type: damageType || "none" }];
		const token = actor.getActiveTokens?.()[0];
		if (globalThis.MidiQOL?.applyTokenDamage && token) {
			return globalThis.MidiQOL.applyTokenDamage(parts, roll.total, new Set([token]), null, new Set());
		}
		return actor.applyDamage?.(parts);
	}

	/* Called by DAE on every combatant's turn, the source's included. */
	async function reapplyOnSourceTurn({ args } = {}) {
		const action = args?.[0];
		if (action !== "each") return;
		if (!game.users.activeGM?.isSelf || !isEnabled() || !isSupported()) return;

		const last = args?.[args.length - 1];
		const effect = last?.effectUuid ? fromUuidSync(last.effectUuid) : null;
		const flag = effect?.flags?.[GMM_MODULE_TITLE]?.[GMM_DURATION_FLAG];
		if (!flag?.formula) return;

		const source = _sourceActorOf(effect);
		const current = game.combat?.combatant?.actor;
		if (!source || !current || source.uuid !== current.uuid) return;

		const target = effect.parent;
		if (!target) return;
		return _applyDamage(target, flag.formula, flag.damageType, effect.name);
	}

	function _concentrationFor(source, itemId) {
		if (!source || !itemId) return null;
		return [...(source.concentration?.effects ?? [])]
			.find(e => e.getFlag("dnd5e", "item")?.id === itemId) ?? null;
	}

	/* An authored effect carries whatever lifetime the GM gave it in the native config. The blueprint's
	 * own duration then contradicts it. Provisional until a duration is per-effect. */
	async function _slaveSiblingDurations(effect) {
		const parent = effect?.parent;
		if (!parent?.effects || !effect.origin) return;
		const carrier = [...parent.effects].find(e => isDurationEffect(e) && e.origin === effect.origin);
		if (!carrier) return;
		const duration = carrier.toObject().duration;
		const updates = [...parent.effects]
			.filter(e => e.origin === carrier.origin
				&& e.id !== carrier.id
				&& !e.flags?.[GMM_MODULE_TITLE]?.deferral
				&& !foundry.utils.objectsEqual(e.toObject().duration, duration))
			.map(e => ({ _id: e.id, duration }));
		if (updates.length) await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}

	/* dnd5e deletes an effect's dependents with it. That is what cancels a pending doom when the players
	 * break concentration. The link waits until here because the two live on different actors. */
	async function _onCreateActiveEffect(effect) {
		if (!game.users.activeGM?.isSelf || !isSupported()) return;
		await _slaveSiblingDurations(effect);

		const deferral = effect?.flags?.[GMM_MODULE_TITLE]?.deferral;
		if (!isDurationEffect(effect) && !deferral) return;
		const source = _sourceActorOf(effect);
		const itemId = AutomationHelpers.resolveSourceItem(effect.origin)?.id ?? null;
		await _concentrationFor(source, itemId)?.addDependent(effect);
	}

	/* Only a deferred feature's concentration lacks an expiry. Only it needs ending by hand. The
	 * dependents check keeps a multi-target feature concentrating until the last carrier is gone. */
	async function _onDeleteActiveEffect(effect) {
		if (!game.users.activeGM?.isSelf || !isDurationEffect(effect)) return;
		const source = _sourceActorOf(effect);
		const itemId = AutomationHelpers.resolveSourceItem(effect.origin)?.id ?? null;
		const concentration = _concentrationFor(source, itemId);
		if (!concentration || concentration.duration?.units) return;
		if (concentration.getDependents().some(d => d.id !== effect.id)) return;
		await concentration.delete();
	}

	function registerApi() {
		globalThis.gmmc ??= {};
		globalThis.gmmc.durations = { reapplyOnSourceTurn };
		Hooks.on("preCreateActiveEffect", _onPreCreateActiveEffect);
		Hooks.on("createActiveEffect", _onCreateActiveEffect);
		Hooks.on("deleteActiveEffect", _onDeleteActiveEffect);
	}

	return {
		GMM_DURATIONS_SETTING,
		GMM_DURATION_EFFECT_ID,
		TYPES,
		isEnabled,
		isSupported,
		read,
		fromUnits,
		describe,
		isDurationEffect,
		buildActivityDuration,
		buildEffectData,
		resolveEffectFormulas,
		reapplyOnSourceTurn,
		registerApi
	};
})();

export default Durations;
