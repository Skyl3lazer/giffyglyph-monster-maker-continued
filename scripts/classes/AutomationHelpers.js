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

	/* Replaying the change, not the stored override, keeps ADD/MULTIPLY relative to the new base. */
	function reapplyOverwrittenEffects(actor, keyPatterns) {
		if (typeof actor.allApplicableEffects !== "function") return;

		const changes = [];
		for (const effect of actor.allApplicableEffects()) {
			if (!effect.active) continue;
			for (const change of (effect.system?.changes ?? effect.changes ?? [])) {
				if (!change?.key || !keyPatterns.some((pattern) => pattern.test(change.key))) continue;
				if (_effectiveChangePhase(change, effect) !== "initial") continue;
				const copy = foundry.utils.deepClone(change);
				copy.effect = effect;
				copy.priority ??= (copy.mode ?? 0) * 10;
				changes.push(copy);
			}
		}
		if (!changes.length) return;

		changes.sort((a, b) => a.priority - b.priority);
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

	return {
		reapplyOverwrittenEffects: reapplyOverwrittenEffects,
		preserveForeignActivityFields: preserveForeignActivityFields
	};
})();

export default AutomationHelpers;
