import {
	GMM_EFFECT_POINT_BUDGET,
	GMM_EFFECT_POINT_LADDER,
	GMM_CONDITION_RARITIES,
	GMM_TERRAIN_RARITIES,
	GMM_HEALING_BOONS,
	GMM_DEAL_DAMAGE
} from "../consts/GmmEffectPoints.js";
import Activities from "./Activities.js";
import Durations from "./Durations.js";
import Shortcoder from "./Shortcoder.js";

const Pricing = (function() {

	const RARITIES = ["rare", "uncommon", "common"];
	const ROLLED = new Set(["mwak", "msak", "rwak", "rsak", "save"]);
	const DAMAGING = new Set([...ROLLED, "other"]);
	const BUDGET_PENALTIES = new Set(["bonus", "reaction"]);
	const REAPPLIABLE = new Set(["timed", "ongoing", "save_ends"]);
	const LASTING = new Set(["timed", "ongoing", "save_ends", "permanent"]);
	// A round() inside a formula cannot move a slope read this far above any real DMG.
	const PROBE = 1e6;

	function price(item) {
		const blueprint = item?.flags?.gmm?.blueprint;
		const data = blueprint?.data;
		if (!data) return null;

		const damage = _readDamage(data, item.getOwningGmmMonster?.() ?? null);
		if (Math.round(damage.share * 100) > GMM_DEAL_DAMAGE.overkillAbove) return { overkill: true };

		const rules = Activities.zoneRules(blueprint);
		const budget = _budgetLines(blueprint, data);
		const spend = [
			..._dealDamageLines(blueprint, data, rules, damage),
			..._effectLines(item, blueprint, data, rules),
			..._terrainLines(blueprint, data, rules)
		];
		const budgetTotal = _total(budget);
		const spendTotal = _total(spend);
		return {
			overkill: false,
			budget: budgetTotal,
			spend: spendTotal,
			overspent: spendTotal > budgetTotal,
			lines: { budget, spend }
		};
	}

	function _budgetLines(blueprint, data) {
		const rarity = RARITIES.includes(data.rarity) ? data.rarity : "common";
		const lines = [_line(_localize(`gmm.common.rarity.${rarity}`), GMM_EFFECT_POINT_BUDGET[rarity])];
		if (`${data.activation?.condition ?? ""}`.trim()) {
			lines.push(_line(_localize("gmm.pricing.requirement"), 1, true));
		}
		const deferral = Activities.readDeferral(blueprint)?.type;
		if (deferral) {
			lines.push(_line(_localize(`gmm.common.deferral_type.${deferral}`), 1, true));
		}
		if (BUDGET_PENALTIES.has(data.activation?.type)) {
			lines.push(_line(_localize(`gmm.common.activation_type.${data.activation.type}`), -1, true));
		}
		return lines;
	}

	function _readDamage(data, scaler) {
		const reading = { share: 0, fixed: false };
		if (!DAMAGING.has(data.attack?.type)) return reading;
		const dmg = Number(scaler?.damage_per_action?.value);
		for (const row of Activities.readDamageRows(data)) {
			if (!row.formula || row.type in GMM_HEALING_BOONS) continue;
			const { share, fixed } = _readFormula(row.formula, scaler);
			reading.share += share;
			// Only a Scaler's DMG turns Fixed Damage into a share.
			if (fixed && dmg > 0) {
				reading.share += fixed / dmg;
				reading.fixed = true;
			}
		}
		return reading;
	}

	function _readFormula(formula, scaler) {
		let share = 0;
		let fixed = 0;
		const remainder = formula.replace(/\[[^[\]]*\]/g, (token) => {
			const expression = token.slice(1, -1).replace(/,\s*(d\d+|damageDie)\s*$/i, "");
			const [zero, probe] = [0, PROBE].map(dmg => _evaluate(expression, scaler, dmg));
			// A bracket that names no shortcode and is not a number is a damage type tag.
			if (zero === null || probe === null) return Shortcoder.findShortcodes(token).length ? "0" : "";
			share += (probe - zero) / PROBE;
			fixed += zero;
			return "0";
		});
		return { share, fixed: fixed + (_average(remainder) ?? 0) };
	}

	function _evaluate(expression, scaler, dmg) {
		const monster = { ...(scaler ?? {}), damage_per_action: { ...(scaler?.damage_per_action ?? {}), value: dmg } };
		const value = Number(Shortcoder.replaceShortcodes(`[${expression}]`, monster));
		return Number.isFinite(value) ? value : null;
	}

	function _average(formula) {
		const text = formula.replace(/(\d*)d(\d+)/gi, (_match, count, faces) => `(${count || 1}*${(Number(faces) + 1) / 2})`).trim();
		if (!text) return null;
		try {
			const value = math.evaluate(text);
			return Number.isFinite(value) ? value : null;
		} catch (e) {
			return null;
		}
	}

	function _dealDamageLines(blueprint, data, rules, damage) {
		if (damage.share <= 0) return [];
		const attackPart = ROLLED.has(data.attack?.type) && rules.some(rule => rule.payload === "attack");
		// Placing a Zone rolls nothing. Only an Attack part lands its damage as a hit.
		if (Activities.hasZoneActivity(blueprint) && !attackPart) return [];

		const area = Activities.isAreaTarget(data);
		const targets = area ? 1 : _targetCount(data);
		const miss = Activities.missPercentage(blueprint);
		const percentage = damage.share * 100;
		const { step, aimedBase, areaBase, missStep } = GMM_DEAL_DAMAGE;
		const points = Math.round(percentage * targets) - (area ? areaBase : aimedBase) + (miss * step / missStep);
		const qualifiers = [
			area ? _localize("gmm.pricing.qualifier.area") : null,
			targets > 1 ? _format("gmm.pricing.targets", { count: targets }) : null,
			miss ? _format("gmm.pricing.qualifier.miss", { percentage: miss }) : null,
			damage.fixed ? _localize("gmm.pricing.qualifier.fixed") : null
		].filter(x => x);
		const lines = [_line(
			[_format("gmm.pricing.deal_damage", { percentage: Math.round(percentage) }), ...qualifiers].join(", "),
			Math.max(1, Math.ceil(points / step))
		)];

		const duration = Durations.read(blueprint);
		const repeat = (duration.type === "ongoing") ? "gmm.common.duration_type.ongoing"
			: (duration.reapplies && REAPPLIABLE.has(duration.type)) ? "gmm.pricing.reapplied"
				: attackPart ? "gmm.pricing.zone_rule" : null;
		if (repeat) lines.push(_line(_localize(repeat), 1, true));
		return lines;
	}

	function _effectLines(item, blueprint, data, rules) {
		const conditions = new Map();
		const boons = new Map();
		for (const effect of _deliveredEffects(item, rules)) {
			if (effect.flags?.gmm?.terrain) continue;
			const statuses = [...(effect.statuses ?? [])].filter(status => status in GMM_CONDITION_RARITIES);
			const stamp = effect.flags?.gmm?.rarity;
			// A stamped boon can carry a core status of its own, as Cloaker carries invisible.
			if (RARITIES.includes(stamp) && !statuses.some(status => status.startsWith("gmm."))) {
				boons.set(effect.name, { label: effect.name, rarity: stamp });
				continue;
			}
			for (const status of statuses) {
				conditions.set(status, { label: _statusLabel(status, effect), rarity: GMM_CONDITION_RARITIES[status] });
			}
		}
		if (data.attack?.type === "heal") {
			for (const row of Activities.readDamageRows(data)) {
				const healing = GMM_HEALING_BOONS[row.type || "healing"];
				if (row.formula && healing) {
					boons.set(healing.boon, { label: _localize(`gmm.pricing.boon.${healing.boon}`), rarity: healing.rarity });
				}
			}
		}

		const reach = _reach(data);
		const duration = Durations.read(blueprint).type;
		const lasting = LASTING.has(duration) ? _localize(`gmm.common.duration_type.${duration}`) : null;
		return [..._ladderLines(conditions, reach, lasting), ..._ladderLines(boons, reach)];
	}

	/* dnd5e applies an on-use effect whatever its disabled state on the item. */
	function _deliveredEffects(item, rules) {
		const zone = rules.some(rule => rule.payload === "effects");
		return [...(item.effects ?? [])].filter(effect => {
			if (Activities.GMM_FORGED_EFFECT_IDS.has(effect.id)) return false;
			if (effect.transfer) return !effect.disabled;
			return zone || Activities.isEffectAppliedByGmmActivity(item, effect.id);
		});
	}

	function _terrainLines(blueprint, data, rules) {
		const terrain = new Map();
		for (const entry of Activities.readZone(blueprint)?.terrain ?? []) {
			const rarity = GMM_TERRAIN_RARITIES[entry.category];
			if (rarity) terrain.set(entry.category, { label: _localize(`gmm.common.zone_terrain.${entry.category}`), rarity });
		}
		const type = data.attack?.type;
		const automatic = (type !== "heal")
			&& Activities.readDamageRows(data).some(row => row.formula)
			&& rules.some(rule => rule.payload === "damage" || (rule.payload === "attack" && type === "other"));
		if (automatic && !terrain.has("damaging")) {
			terrain.set("damaging", { label: _localize("gmm.pricing.zone_damage"), rarity: GMM_TERRAIN_RARITIES.damaging });
		}
		return _ladderLines(terrain);
	}

	function _ladderLines(entries, reach = null, lasting = null) {
		const [first, ...others] = [...entries.values()]
			.sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity));
		if (!first) return [];
		return [
			_line(first.label, GMM_EFFECT_POINT_LADDER[first.rarity]),
			...others.map(other => _line(other.label, 1, true)),
			...(reach ? [_line(reach, 1, true)] : []),
			...(lasting ? [_line(lasting, 1, true)] : [])
		];
	}

	function _reach(data) {
		if (Activities.isAreaTarget(data)) return _localize("gmm.pricing.reach.area");
		const count = _targetCount(data);
		return (count > 1) ? _format("gmm.pricing.targets", { count }) : null;
	}

	function _targetCount(data) {
		return Math.max(1, Math.trunc(Number(data.target?.value) || 1));
	}

	function _statusLabel(status, effect) {
		const entry = CONFIG.statusEffects?.find?.(x => x.id === status);
		return entry?.name ? game.i18n.localize(entry.name) : effect.name;
	}

	function _line(label, value, adjustment = false) {
		return { label, value, adjustment };
	}

	function _total(lines) {
		return lines.reduce((sum, line) => sum + line.value, 0);
	}

	function _localize(key) {
		return game.i18n.localize(key);
	}

	function _format(key, data) {
		return game.i18n.format(key, data);
	}

	return {
		price: price
	};
})();

export default Pricing;
