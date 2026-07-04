const CompatibilityHelpers = (function () {
	//fv14 - Property management moved to foundry.utils
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
	//v14 - clamped becomes clamp
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

	/* Build a FormData object from the named form controls inside a container, for callers that no
	 * longer receive a FormData automatically under Foundry V14's ApplicationV2. */
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
	/* Roll#toMessage visibility options differ by generation: v13 reads the legacy `rollMode`
	 * (publicroll/gmroll/blindroll/selfroll/roll); v14+ reads `messageMode` (CONFIG.ChatMessage.modes:
	 * public/gm/blind/self). GMM's modal mode-select emits the legacy values, so return the right option. */
	function rollMessageOptions(mode) {
		const generation = game.release?.generation ?? (Number.parseInt(game.version, 10) || 0);
		if (generation < 14) return { rollMode: mode };
		// A literal "roll"/unknown is left unset so toMessage falls back to the world default; passing
		// "roll" as a messageMode would fail applyMode's CONFIG.ChatMessage.modes lookup.
		const messageMode = { publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self" }[mode];
		return messageMode ? { messageMode } : {};
	}
	return {
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