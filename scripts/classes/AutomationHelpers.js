/* Interop with the third-party automation stack (midi-qol, DAE); each function no-ops without them. */
const AutomationHelpers = (function () {

	/* v14 splits effect application into initial/final phases; v13 has one pass, always pre-derived. */
	function _changePhasesSupported() {
		return !!CONFIG.ActiveEffect?.documentClass?.CHANGE_PHASES;
	}

	/* Mirror DAE's resolution or we re-apply changes DAE itself runs later in the final phase. */
	function _effectiveChangePhase(change, effect) {
		if (!_changePhasesSupported()) return "initial";
		const stored = change.phase ?? "initial";
		if (stored !== "initial" || effect?.flags?.dae?.phaseStamped) return stored;
		return globalThis.DAE?.ValidSpec?.actorSpecs?.union?.allSpecsObj?.[change.key]?.phase ?? stored;
	}

	function _applyEffectChange(actor, change, replacementData) {
		const ActiveEffectClass = CONFIG.ActiveEffect.documentClass;
		return typeof ActiveEffectClass.applyChange === "function"
			? ActiveEffectClass.applyChange(actor, change, { replacementData })
			: change.effect.apply(actor, change);
	}

	/* `earlyKeys` have to land before the rest of the derived pass reads them.
	 * `unsupportedPrefixes` are reported, not collected - the caller decides what to say. */
	function collectOverwrittenEffects(actor, keys, earlyKeys, unsupportedPrefixes) {
		const early = [];
		const late = [];
		const unsupported = [];
		if (typeof actor.allApplicableEffects === "function") {
			for (const effect of actor.allApplicableEffects()) {
				if (!effect.active) continue;
				for (const change of (effect.system?.changes ?? effect.changes ?? [])) {
					if (!change?.key) continue;
					if (unsupportedPrefixes?.some((x) => change.key.startsWith(x))) {
						unsupported.push({ key: change.key, effect: effect });
					}
					if (!keys.has(change.key)) continue;
					if (_effectiveChangePhase(change, effect) !== "initial") continue;
					const copy = foundry.utils.deepClone(change);
					copy.effect = effect;
					copy.priority ??= (copy.mode ?? 0) * 10;
					(earlyKeys?.has(change.key) ? early : late).push(copy);
				}
			}
		}

		const byPriority = (a, b) => a.priority - b.priority;
		early.sort(byPriority);
		late.sort(byPriority);
		return { early: early, late: late, unsupported: unsupported };
	}

	/* Replaying the change, not the stored override, keeps ADD/MULTIPLY relative to the new base. */
	function applyOverwrittenEffects(actor, changes) {
		if (!changes?.length) return;

		// A late bucket must resolve against what an earlier one already produced.
		const replacementData = actor.getRollData();
		const overrides = {};
		for (const change of changes) {
			try {
				const result = _applyEffectChange(actor, change, replacementData);
				if (result && typeof result === "object") Object.assign(overrides, result);
			} catch (error) {
				console.warn(`GMM | could not re-apply effect change "${change.key}"`, error);
			}
		}
		actor.overrides = foundry.utils.mergeObject(actor.overrides ?? {}, foundry.utils.expandObject(overrides));
	}

	/* Anything outside `ownedFields` was written by another module and a forced replacement would reset it. */
	function preserveForeignActivityFields(item, activityId, newData, ownedFields) {
		const activity = item?.system?.activities?.get?.(activityId);
		const existing = activity
			? (activity.toObject?.() ?? activity._source)
			: item?._source?.system?.activities?.[activityId];
		if (!existing || typeof existing !== "object") return newData;

		const merged = { ...newData };
		for (const [key, value] of Object.entries(existing)) {
			if (ownedFields.has(key) || key in merged) continue;
			merged[key] = value;
		}
		return merged;
	}

	/* Core stamps the source effect's uuid, midi the activity's, and dnd5e's tray the concentration
	 * effect's whenever the action concentrates. None of the three can be assumed. */
	function resolveSourceItem(origin) {
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
		if (doc?.documentName === "Item") return doc;
		// A concentration effect rides the actor, so cutting its uuid lands on the actor and not the item.
		const carrier = fromUuidSync(origin);
		const itemId = carrier?.getFlag?.("dnd5e", "item")?.id;
		return itemId ? (carrier.parent?.items?.get?.(itemId) ?? null) : null;
	}

	return {
		collectOverwrittenEffects: collectOverwrittenEffects,
		applyOverwrittenEffects: applyOverwrittenEffects,
		preserveForeignActivityFields: preserveForeignActivityFields,
		resolveSourceItem: resolveSourceItem
	};
})();

export default AutomationHelpers;
