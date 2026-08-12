const AURA_MODULE_ID = "auraeffects";
const AURA_TYPE = "auraeffects.aura";

/* An unregistered ActiveEffect subtype still applies its changes, so an aura in a world without Aura Effects would land its payload on the monster itself. */
const Auras = (function () {

	const reported = new Set();
	const bannered = new Set();
	let afterReady = false;

	function _inertModel() {
		return class InertAuraData extends foundry.data.ActiveEffectTypeDataModel {
			/* Aura fields this shim knows nothing about survive, so installing the module later finds them intact. */
			static cleanData(data, options = {}, state) {
				return super.cleanData(data, { ...options, prune: false }, state);
			}

			get isSuppressed() {
				return true;
			}

			prepareDerivedData() {
				super.prepareDerivedData?.();
				_report(this.parent);
			}
		};
	}

	function _report(effect) {
		if (!effect || !game.user?.isGM || effect.inCompendium) return;
		const uuid = effect.uuid;
		if (!uuid || reported.has(uuid)) return;
		reported.add(uuid);
		console.warn(`GMM | Aura effect "${effect.name}" on ${effect.parent?.documentName} "${effect.parent?.name}" is switched off: the ${AURA_MODULE_ID} module is not active.`);
		if (afterReady) _banner("gmm.aura.suppressed", reported.size);
	}

	function _actors() {
		const seen = new Map();
		game.actors?.forEach((actor) => seen.set(actor.uuid, actor));
		game.scenes?.forEach((scene) => scene.tokens?.forEach((token) => {
			if (token.actor) seen.set(token.actor.uuid, token.actor);
		}));
		return seen.values();
	}

	/* Children Aura Effects created before it was removed. Nothing is left to delete them, so they apply forever. */
	function _countStranded() {
		let count = 0;
		for (const actor of _actors()) {
			for (const effect of actor.effects ?? []) {
				if (effect.getFlag?.(AURA_MODULE_ID, "fromAura")) count += 1;
			}
		}
		return count;
	}

	function _banner(key, count) {
		if (!count || bannered.has(key)) return;
		bannered.add(key);
		ui.notifications?.warn(game.i18n.format(key, { count: count }));
	}

	function init() {
		if (game.modules.get(AURA_MODULE_ID)?.active) return;
		CONFIG.ActiveEffect.dataModels[AURA_TYPE] = _inertModel();
		Hooks.once("ready", () => {
			if (!game.user?.isGM) return;
			afterReady = true;
			_banner("gmm.aura.suppressed", reported.size);
			_banner("gmm.aura.stranded", _countStranded());
		});
	}

	return {
		init: init
	};
})();

export default Auras;
