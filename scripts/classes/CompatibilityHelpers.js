import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

const CompatibilityHelpers = (function () {
	/* Wrap libWrapper.register so a registration failure (e.g. against a method dnd5e has since
	 * removed) emits a console warning instead of throwing and aborting the rest of the patching. */
	function safeWrap(target, fn, type) {
		try {
			libWrapper.register(GMM_MODULE_TITLE, target, fn, type);
			return true;
		} catch (error) {
			// Missing lib-wrapper is expected (the ready hook warns the user). Any other failure means
			// a wrap target changed in this dnd5e version, which has to surface loudly.
			console[game.modules.get('lib-wrapper')?.active ? "error" : "warn"](`GMM | libWrapper hook for "${target}" was not registered: ${error.message}`);
			return false;
		}
	}
	function hasProperty(...args) {
		if (game.version >= 12) {
			return foundry.utils.hasProperty(...args);
		}
		return globalThis.hasProperty(...args);
	}
	function setProperty(...args) {
		if (game.version >= 12) {
			return foundry.utils.setProperty(...args);
		}
		return globalThis.setProperty(...args);
	}
	function getProperty(...args) {
		if (game.version >= 12) {
			return foundry.utils.getProperty(...args);
		}
		return globalThis.getProperty(...args);
	}
	function clamped(...args) {
		if (game.version >= 12) {
			return Math.clamp(...args);
		}
		return Math.clamped(...args);
	}

	function mergeObject(...args) {
		if (game.version >= 12) {
			return foundry.utils.mergeObject(...args);
		}
		return globalThis.mergeObject(...args);
	}
	function replaceFormulaData(...args) {
		if (game.version >= 12) {
			return foundry.dice.Roll.replaceFormulaData(...args);
		}
		return Roll.replaceFormulaData(...args);
		
	}
	function dnd5eAtLeast(version) {
		const current = globalThis.dnd5e?.version ?? game.system?.version ?? "";
		return String(current).localeCompare(String(version), undefined, { numeric: true, sensitivity: 'base' }) >= 0;
	}
	function weight(w, display) {
		if (isNaN(parseFloat(w)) && dnd5eAtLeast(3.2)) {
			let d = display ? display == "imperial" ? "lb" : "kg" : w.units;
			return dnd5e.utils.convertWeight(w.value, w.units, d);
		}
		return w;
		
	}
	function getEncumbranceMultiplier(system) {
		if (dnd5eAtLeast(3)) {
			if (system === "imperial") {
				return CONFIG.DND5E.encumbrance.threshold.maximum.imperial;
			} else if (system === "metric") {
				return CONFIG.DND5E.encumbrance.threshold.maximum.metric;
			}
		} else {
			if (system === "imperial") {
				return CONFIG.DND5E.encumbrance.strMultiplier.imperial;
			} else if (system === "metric") {
				return CONFIG.DND5E.encumbrance.strMultiplier.metric;
			}
		}
	}

	/* dnd5e 6.0 moved every bonus formula from `system.bonuses.*` onto `system.rolls.*`. */
	function globalAbilityBonus(actorData, kind) {
		return actorData?.rolls?.ability?.[kind]?.bonus ?? actorData?.bonuses?.abilities?.[kind];
	}
	function globalAttackBonus(actorData, actionType) {
		return actorData?.rolls?.attack?.[actionType]?.bonus ?? actorData?.bonuses?.[actionType]?.attack;
	}
	function abilitySaveBonus(ability) {
		return ability?.save?.roll?.bonus ?? ability?.bonuses?.save;
	}
	function setAbilitySaveBonus(ability, formula) {
		if (ability?.save?.roll && ("bonus" in ability.save.roll)) ability.save.roll.bonus = formula;
		else ability.bonuses.save = formula;
	}

	/* dnd5e 6.0 moved the prepared ability totals onto `check` and `save`, leaving getter-only shims behind. */
	function preparedCheckBonus(ability) {
		return ability?.check?.bonus ?? ability?.checkBonus;
	}
	function preparedSaveBonus(ability) {
		return ability?.save?.bonus ?? ability?.saveBonus;
	}
	function setPreparedSaveBonus(ability, value) {
		if ("bonus" in ability.save) ability.save.bonus = value;
		else ability.saveBonus = value;
	}
	function preparedSaveProf(ability) {
		return ability?.save?.prof ?? ability?.saveProf;
	}
	function setPreparedSaveProf(ability, proficiency) {
		if ("prof" in ability.save) ability.save.prof = proficiency;
		else ability.saveProf = proficiency;
	}

	/* dnd5e 6.0 made `attack` a roll-configuration object. Its total carries two terms the old number did not. */
	function setPreparedAttack(ability, proficiency, actor) {
		if (typeof ability.attack !== "object") ability.attack = ability.mod + proficiency;
		else ability.attack.value = ability.mod + proficiency + (ability.attack.bonus ?? 0)
			+ (actor?.conditionRollReduction ?? 0);
	}

	/* ApplicationV2 hands no FormData to callers outside its own submit path. */
	function readInputs(container) {
		const fd = new FormData();
		if (!container) return fd;
		const controls = container.querySelectorAll(
			"input[name], select[name], textarea[name]"
		);
		controls.forEach((el) => {
			if ((el.type === "radio" || el.type === "checkbox") && !el.checked) return;
			fd.append(el.name, el.value);
		});
		return fd;
	}
	/* GMM's modal mode-select emits v13's `rollMode` values, which v14's `messageMode` does not accept. */
	function rollMessageOptions(mode) {
		const generation = game.release?.generation ?? (Number.parseInt(game.version, 10) || 0);
		if (generation < 14) return { rollMode: mode };
		// A literal "roll"/unknown is left unset so toMessage falls back to the world default. Passing
		// "roll" as a messageMode would fail applyMode's CONFIG.ChatMessage.modes lookup.
		const messageMode = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[mode];
		return messageMode ? { messageMode } : {};
	}
	return {
		safeWrap: safeWrap,
		hasProperty: hasProperty,
		setProperty: setProperty,
		getProperty: getProperty,
		clamped: clamped,
		dnd5eAtLeast: dnd5eAtLeast,
		mergeObject: mergeObject,
		replaceFormulaData: replaceFormulaData,
		weight: weight,
		getEncumbranceMultiplier: getEncumbranceMultiplier,
		globalAbilityBonus: globalAbilityBonus,
		globalAttackBonus: globalAttackBonus,
		abilitySaveBonus: abilitySaveBonus,
		setAbilitySaveBonus: setAbilitySaveBonus,
		preparedCheckBonus: preparedCheckBonus,
		preparedSaveBonus: preparedSaveBonus,
		setPreparedSaveBonus: setPreparedSaveBonus,
		preparedSaveProf: preparedSaveProf,
		setPreparedSaveProf: setPreparedSaveProf,
		setPreparedAttack: setPreparedAttack,
		readInputs: readInputs,
		rollMessageOptions: rollMessageOptions
	};
})();
export default CompatibilityHelpers;