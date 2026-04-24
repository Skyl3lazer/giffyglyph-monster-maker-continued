/* Description text replacements applied once during the vanilla -> GMMC conversion pass
 * (see ActionBlueprint.deriveFromVanillaItem). Each entry is `{ pattern, replacement, note? }`
 * where `pattern` is a RegExp (typically with the global flag) and `replacement` is either a
 * string (with the usual `$1`/`$2` backreferences) or a function `(match, ...captures) => string`.
 * Entries are applied sequentially in declaration order, so earlier rules can shape the input
 * for later ones if needed.
 *
 * The goal is to normalise vanilla dnd5e compendium conventions into GMMC shortcodes so the
 * converted blueprint renders correctly against its owning scaling monster.
 *
 * Add new entries below as needed. */
export const GMM_DESCRIPTION_REPLACEMENTS = [
	{
		// dnd5e compendium markup uses `[[lookup @name lowercase]]{monster}` to insert the
		// owning actor's lower-cased name (with "monster" as the fallback literal). GMMC's
		// equivalent is the `[name]` shortcode resolved by Shortcoder at render time.
		pattern: /\[\[lookup\s+@name\s+lowercase\]\]\{monster\}/gi,
		replacement: "[name]",
		note: "dnd5e @name lowercase lookup -> GMMC [name] shortcode"
	},
	{
		// dnd5e compendium markup uses `[[lookup @save.dc.value activity=<random-id>]]` to inline
		// the target activity's save DC. The `activity=` argument is optional and its id is random,
		// so we accept any non-`]` token for it. Maps to the GMMC save-DC shortcode.
		pattern: /\[\[lookup\s+@save\.dc\.value(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[dcPrimaryBonus+maxMod]",
		note: "dnd5e @save.dc.value lookup -> GMMC [dcPrimaryBonus+maxMod] shortcode"
	},
	{
		// `[[lookup @target.template.size activity=<random-id>]]` inlines the activity's template
		// size. 
		pattern: /\[\[lookup\s+@target\.template\.size(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[target]",
		note: "dnd5e @target.template.size lookup -> GMMC [target] shortcode"
	},
	{
		// `[[lookup @range.value activity=<random-id>]]` inlines the activity's numeric range
		// (e.g. 30). Map it to the GMMC `[range]` shortcode, which renders the blueprint's full
		// localised range label (units, long range, and reach wording for melee attacks).
		pattern: /\[\[lookup\s+@range\.value(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[range]",
		note: "dnd5e @range.value lookup -> GMMC [range] shortcode"
	},
	{
		// `[[lookup @target.affects.special activity=<random-id>]]` inlines free-form target text
		// (e.g. "any creature within 30 feet"). GMMC has no equivalent dynamic substitution, so we
		// collapse the marker to the plain word "target" — the surrounding sentence usually reads
		// naturally with that fallback. NOT the `[target]` shortcode.
		pattern: /\[\[lookup\s+@target\.affects\.special(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "target",
		note: "dnd5e @target.affects.special lookup -> literal 'target' word"
	},
	{
		// dnd5e renders an item's primary attack-roll button inline with `[[/attack extended]]`.
		// GMMC handles attacks via the activity, so the inline marker has no purpose post-conversion.
		pattern: /\[\[\/attack\s+extended\]\]/gi,
		replacement: "",
		note: "strip dnd5e [[/attack extended]] inline button"
	},
	{
		// Same idea as above for damage roll buttons.
		pattern: /\[\[\/damage\s+average\s+extended\]\]/gi,
		replacement: "",
		note: "strip dnd5e [[/damage average extended]] inline button"
	},
	{
		// dnd5e damage enrichers carry a real formula and optional flags:
		//   `[[/damage 1d10 average type=force]]`        -> `[1d10] force`
		//   `[[/damage 2d6 type=fire extended]]`         -> `[2d6] fire`
		//   `[[/damage 4d8]]`                            -> `[4d8]`
		// Group 1 captures the formula (any non-whitespace, non-`]` token).
		// Group 2 swallows the trailing modifier list (average / extended / type=… in any order)
		// so we can pull the type out of it without caring about ordering. The earlier
		// "[[/damage average extended]]" rule (no formula) runs first and strips bare buttons,
		// so it never collides with this rule.
		pattern: /\[\[\/damage\s+([^\s\]]+)((?:\s+(?:average|extended|type=[^\s\]]+))*)\]\]/gi,
		replacement: (_match, formula, modifiers) => {
			const typeMatch = modifiers?.match(/type=([^\s\]]+)/i);
			const type = typeMatch?.[1] ?? "";
			return type ? `[${formula}] ${type}` : `[${formula}]`;
		},
		note: "dnd5e [[/damage <formula> [average] [extended] [type=<type>]]] -> `[<formula>] <type>`"
	}
];

/* Returns true when the post-replacement description is effectively empty: only whitespace,
 * HTML tag/entity scaffolding, punctuation, or stray special characters remain. Used by the
 * conversion pipeline to clear the field instead of leaving behind orphaned `<p></p>` shells
 * or trailing punctuation that the dnd5e button enrichers used to anchor. */
export function isDescriptionEffectivelyEmpty(text) {
	if (typeof text !== "string" || !text.length) return true;
	const stripped = text
		.replace(/<[^>]*>/g, " ")        // strip HTML tags
		.replace(/&[a-z#0-9]+;/gi, " ")  // strip HTML entities
		.replace(/[\s\.,;:!\?\-\u2013\u2014\(\)\[\]\{\}"'`*_~]+/g, ""); // strip whitespace + punctuation
	return stripped.length === 0;
}
