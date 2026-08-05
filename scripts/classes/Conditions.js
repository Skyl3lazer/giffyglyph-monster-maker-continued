import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

/* Function macros for the conditions midi drives; reached by name as `function.gmmc.conditions.*`. */
const Conditions = (function () {

	/* Only an actor that carries the condition is eligible, so a bad guess is a no-op rather than the
	 * wrong creature paying. `candidates` is ordered by which source midi makes authoritative. */
	function _getBearer(condition, candidates) {
		for (const candidate of candidates) {
			const actor = candidate?.actor ?? candidate;
			if (actor?.appliedEffects?.some((x) => x.flags?.gmm?.condition === condition)) return actor;
		}
		return null;
	}

	function _getSpendableClass(actor) {
		return actor.system?.attributes?.hd?.classes?.find?.((x) => x.system?.hd?.value > 0) ?? null;
	}

	/* Bleeding: at the end of your turn, you lose 1 unspent hit die.
	 * OverTime builds its synthetic item under the effect's *origin* actor, so the target leads. */
	async function bleeding(macroData = {}) {
		const actor = _getBearer("bleeding", [
			...(macroData?.workflow?.targets ?? []),
			macroData?.token,
			macroData?.actor
		]);
		if (!actor) return;

		// Characters hold hit dice on their class items; everything else holds a single actor-level pool.
		const cls = _getSpendableClass(actor);
		if (cls) {
			await cls.update({ "system.hd.spent": cls.system.hd.spent + 1 });
		} else {
			const hd = actor.system?.attributes?.hd;
			if (!(hd?.value > 0)) return;
			await actor.update({ "system.attributes.hd.spent": (hd.spent ?? 0) + 1 });
		}

		ui.notifications?.info(game.i18n.format("gmm.condition.bleeding.spent", { name: actor.name }));
	}

	/* Cursed: if you are reduced to 0 hit points, you die.
	 * midi fires isDamaged once per target, so reading the target set would act on the wrong one
	 * when two targets are both Cursed. */
	async function cursed(macroData = {}) {
		const actor = _getBearer("cursed", [macroData?.token, macroData?.actor]);
		if (!actor || (Number(actor.system?.attributes?.hp?.value) || 0) > 0) return;
		if (actor.statuses?.has("dead")) return;

		await actor.toggleStatusEffect("dead", { active: true, overlay: true });
		ui.notifications?.info(game.i18n.format("gmm.condition.cursed.died", { name: actor.name }));
	}

	function registerApi() {
		const api = { bleeding: bleeding, cursed: cursed };
		// midi resolves `function.<path>` as a bare dotted global, so the short alias is the callable one.
		globalThis.gmmc ??= {};
		globalThis.gmmc.conditions = api;

		const moduleRef = game.modules.get(GMM_MODULE_TITLE);
		if (moduleRef) {
			moduleRef.api ??= {};
			moduleRef.api.conditions = api;
		}
	}

	return {
		registerApi: registerApi,
		bleeding: bleeding,
		cursed: cursed
	};
})();

export default Conditions;
