/* Shared formatting helpers used by both runtime label generation (GmmItem) and the
 * Shortcoder text substitution pipeline. Kept dependency-free so it can be imported
 * from either side without inducing a module cycle. */

/* Format a GMM blueprint target into a localised label string. Mirrors the legacy private
 * implementation that lived in GmmItem and is now also consumed by the `[target]` shortcode
 * resolver in Shortcoder. Accepts the blueprint's `target` object shape:
 *   { type, value, width, units }
 * and returns "" for unsupported / empty configurations. */
export function formatTargetLabel(target) {
	if (!target?.type) return "";
	switch (target.type) {
		case "":
		case "none":
			switch (target.units) {
				case "self":
					return game.i18n.format(`gmm.action.labels.target.self`);
				case "touch":
				case "ft":
				case "mi":
					if (target.units === "any") return game.i18n.format(`gmm.action.labels.target.any.all`);
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
