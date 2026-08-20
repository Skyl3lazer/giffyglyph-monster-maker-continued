import Activities from './Activities.js';

/* A Miss percentage has no home in a dnd5e activity, so GMMC scales midi's own per-target result
   rather than asking `onSave` to carry a value it cannot express. */
const MissDamage = (function () {

	function init() {
		Hooks.on("midi-qol.preTargetDamageApplication", _onPreTargetDamageApplication);
	}

	function _onPreTargetDamageApplication(_token, { item, workflow, damageItem } = {}) {
		if (!damageItem?.saved) return;
		const percentage = _scalablePercentage(item, workflow);
		if (percentage === null) return;
		_scale(damageItem, percentage / 100);
	}

	/* Null wherever `onSave` already delivered the right amount on its own. */
	function _scalablePercentage(item, workflow) {
		const activity = workflow?.activity;
		if (!Activities.isGmmActivityId(activity?.id)) return null;
		if (activity.type !== "save" || activity.damage?.onSave !== "full") return null;
		const percentage = Activities.missPercentage(item?.flags?.gmm?.blueprint);
		return (percentage > 0 && percentage < 100) ? percentage : null;
	}

	/* Scales what midi already computed rather than the raw roll, so resistance, immunity and a
	   Super Saver's own zero all survive untouched. */
	function _scale(damageItem, factor) {
		const total = damageItem.healingAdjustedTotalDamage ?? damageItem.totalDamage ?? 0;
		if (total <= 0) return;
		// Granted temp HP is not a fraction of anything, and rebuilding it here would be a guess.
		if (damageItem.damageDetail?.some?.(d => d?.type === "temphp")) return;

		const scaledTotal = Math.floor(total * factor);
		const oldHP = damageItem.oldHP ?? 0;
		const oldTempHP = damageItem.oldTempHP ?? 0;
		const absorbedByTemp = Math.min(oldTempHP, scaledTotal);
		const hpDamage = Math.min(scaledTotal - absorbedByTemp, oldHP);

		for (const detail of damageItem.damageDetail ?? []) {
			if (typeof detail?.value === "number") detail.value = Math.floor(detail.value * factor);
			if (typeof detail?.damage === "number") detail.damage = Math.floor(detail.damage * factor);
		}
		damageItem.totalDamage = scaledTotal;
		damageItem.healingAdjustedTotalDamage = scaledTotal;
		damageItem.hpDamage = hpDamage;
		damageItem.newHP = oldHP - hpDamage;
		damageItem.newTempHP = oldTempHP - absorbedByTemp;
		damageItem.tempDamage = absorbedByTemp;
	}

	return {
		init: init
	};
})();

export default MissDamage;
