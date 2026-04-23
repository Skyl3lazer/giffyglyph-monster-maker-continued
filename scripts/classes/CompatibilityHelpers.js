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
	function gmmDuplicate(...args) {
		if (game.version >= 12) {
			return foundry.utils.duplicate(...args);
		}
		return duplicate(...args);
	}
	function gmmExpandObject(...args) {
		if (game.version >= 12) {
			return foundry.utils.expandObject(...args);
		}
		return expandObject(...args);
	}

	/**
	 * Build a FormData-like object from the named form controls inside a container.
	 *
	 * Foundry V14's ApplicationV2 sets the application root element itself to a
	 * `<form>` (`tag: "form"`). HTML forbids nested `<form>` elements, but the parent
	 * sheet templates need to scope GMM modals (which collect their own ad-hoc roll
	 * inputs) so they can't share the application form. We render those modals with a
	 * `<div class="modal__form">` instead. Since `new FormData(div)` requires an
	 * `HTMLFormElement`, this helper walks the container, picks up every named control
	 * (radios/checkboxes only when checked), and returns a plain `FormData` wrapping
	 * those name/value pairs so existing modal code that calls `.get(name)` keeps
	 * working without modification.
	 *
	 * @param {HTMLElement} container - Element wrapping the inputs to collect.
	 * @returns {FormData} A FormData instance populated with the container's controls.
	 */
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
	return {
		hasProperty: hasProperty,
		setProperty: setProperty,
		getProperty: getProperty,
		clamped: clamped,
		mergeObject: mergeObject,
		replaceFormulaData: replaceFormulaData,
		weight: weight,
		getEncumbranceMultiplier: getEncumbranceMultiplier,
		gmmDuplicate: gmmDuplicate,
		gmmExpandObject: gmmExpandObject,
		readInputs: readInputs
	};
})();
export default CompatibilityHelpers;