import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

/* Function macros for the pack effects midi drives; reached by name as `function.gmmc.conditions.*`. */
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

	async function _spendHitDie(actor, source) {
		// Characters hold hit dice on their class items; everything else holds a single actor-level pool.
		const cls = _getSpendableClass(actor);
		if (cls) {
			await cls.update({ "system.hd.spent": cls.system.hd.spent + 1 });
		} else {
			const hd = actor.system?.attributes?.hd;
			if (!(hd?.value > 0)) return;
			await actor.update({ "system.attributes.hd.spent": (hd.spent ?? 0) + 1 });
		}

		ui.notifications?.info(game.i18n.format("gmm.condition.bleeding.spent", { name: actor.name, source: source }));
	}

	/* Bleeding: at the end of your turn, you lose 1 unspent hit die. */
	async function bleeding(...args) {
		const passed = Array.isArray(args[0]?.args) ? args[0].args : args;
		if (typeof passed[0] === "string") return _bleedOnce(passed);

		// OverTime builds its synthetic item under the effect's *origin* actor, so the target leads.
		const macroData = args[0] ?? {};
		const actor = _getBearer("bleeding", [
			...(macroData?.workflow?.targets ?? []),
			macroData?.token,
			macroData?.actor
		]);
		if (!actor) return;

		const carrier = actor.appliedEffects.find((x) => x.flags?.gmm?.condition === "bleeding");
		await _spendHitDie(actor, carrier?.name ?? "");
	}

	/* DAE runs the macro for the effect's own bearer, so there is nothing to guess. */
	async function _bleedOnce(args) {
		if (args[0] !== "on") return;

		const context = args[args.length - 1];
		const effect = fromUuidSync(context?.effectUuid);
		const actor = fromUuidSync(context?.actorUuid);
		if (actor) await _spendHitDie(actor, effect?.name ?? "");

		// A one-shot rider carries nothing once the die is spent.
		await effect?.delete();
	}

	/* Cursed: if you are reduced to 0 hit points, you die.
	 * midi fires isDamaged once per target, so the target set would name the wrong one of two Cursed victims. */
	async function cursed(macroData = {}) {
		const actor = _getBearer("cursed", [macroData?.token, macroData?.actor]);
		if (!actor) return;

		/* midi's isDamaged pass runs before the damage is written. */
		const pending = macroData?.damageItem ?? macroData?.workflow?.damageItem;
		const hp = pending?.actorUuid === actor.uuid ? pending.newHP : actor.system?.attributes?.hp?.value;
		if (!(Number(hp) <= 0)) return;
		if (actor.statuses?.has("dead")) return;

		await actor.toggleStatusEffect("dead", { active: true, overlay: true });
		ui.notifications?.info(game.i18n.format("gmm.condition.cursed.died", { name: actor.name }));
	}

	/* Unstable terrain: when a creature ends their turn within the area, they fall prone.
	 * The book gives no save, and a plain OverTime string can only apply a status behind one. */
	async function unstable(macroData = {}) {
		const actor = _getBearer("unstable", [
			...(macroData?.workflow?.targets ?? []),
			macroData?.token,
			macroData?.actor
		]);
		if (!actor) return;
		if (actor.statuses?.has("prone")) return;

		await actor.toggleStatusEffect("prone", { active: true });
		ui.notifications?.info(game.i18n.format("gmm.terrain.unstable.prone", { name: actor.name }));
	}

	function registerApi() {
		const api = { bleeding: bleeding, cursed: cursed, unstable: unstable };
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
		cursed: cursed,
		unstable: unstable
	};
})();

export default Conditions;
