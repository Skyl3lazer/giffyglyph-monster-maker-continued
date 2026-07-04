/* Shared label formatters for GmmItem and the Shortcoder pipeline. Kept dependency-free
 * to avoid a module cycle between those callers. */

/* Format `{ type, value, width, units }` blueprint target as a localised label; "" if unsupported. */
export function formatTargetLabel(target) {
	if (!target) return "";
	// Normalise a null/undefined type to "" so an empty-type target still reaches the case below
	// (a bare `!target.type` guard used to drop it, losing the "one target" label entirely).
	switch (target.type ?? "") {
		case "":
		case "none":
			switch (target.units) {
				case "self":
					return game.i18n.format(`gmm.action.labels.target.self`);
				case "any":
					return game.i18n.format(`gmm.action.labels.target.any.all`);
				case "touch":
				case "ft":
				case "mi":
					return game.i18n.format(`gmm.action.labels.target.any.${target.value > 1 ? "multiple" : "single"}`,
						{ quantity: Math.max(1, target.value) });
			}
			return "";
		case "self":
			return game.i18n.format(`gmm.action.labels.target.self`);
		case "ally":
		case "enemy":
		case "creature":
		case "object":
			if (target.units === "any") return game.i18n.format(`gmm.action.labels.target.${target.type}.all`);
			return game.i18n.format(`gmm.action.labels.target.${target.type}.${target.value > 1 ? "multiple" : "single"}`,
				{ quantity: Math.max(1, target.value) });
		case "line":
		case "wall":
			if (["ft", "mi"].includes(target.units)) {
				const area = game.i18n.format(`gmm.action.labels.target.size.${target.units}.double`,
					{ x: Math.max(1, target.value), y: Math.max(1, target.width) });
				return game.i18n.format(`gmm.action.labels.target.${target.type}`, { area });
			}
			return "";
		default:
			if (target.units && ["ft", "mi"].includes(target.units)) {
				const size = game.i18n.format(`gmm.action.labels.target.size.${target.units}.single`,
					{ x: Math.max(1, target.value) });
				return game.i18n.format(`gmm.action.labels.target.${target.type}`, { size });
			}
			return "";
	}
}

/* Format `{ value, long, units }` blueprint range; `attackType` of mwak/msak triggers reach wording. */
export function formatRangeLabel(range, attackType) {
	if (!range?.units) return "";
	switch (range.units) {
		case "any":
		case "self":
		case "touch":
			return game.i18n.format(`gmm.action.labels.range.${range.units}`);
		case "ft":
		case "mi": {
			if (!range.value) return "";
			const composed = `${range.value}${range.long ? `/${range.long}` : ""}`;
			if (["mwak", "msak"].includes(attackType)) {
				return game.i18n.format(`gmm.action.labels.range.reach.${range.units}`, { range: composed });
			}
			return game.i18n.format(`gmm.action.labels.range.${range.units}`, { range: composed });
		}
		default:
			return "";
	}
}
