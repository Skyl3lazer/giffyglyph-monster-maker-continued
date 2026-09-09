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
	function weight(w, display) {
		if (isNaN(parseFloat(w)) && dnd5e.version.localeCompare(3.2, undefined, { numeric: true, sensitivity: 'base' }) >= 0) {
			let d = display ? display == "imperial" ? "lb" : "kg" : w.units;
			return dnd5e.utils.convertWeight(w.value, w.units, d);
		}
		return w;
		
	}
	function getEncumbranceMultiplier(system) {
		if (dnd5e.version.localeCompare(3, undefined, { numeric: true, sensitivity: 'base' }) >= 0) {
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
		mergeObject: mergeObject,
		replaceFormulaData: replaceFormulaData,
		weight: weight,
		getEncumbranceMultiplier: getEncumbranceMultiplier,
		readInputs: readInputs,
		rollMessageOptions: rollMessageOptions
	};
})();
export default CompatibilityHelpers;