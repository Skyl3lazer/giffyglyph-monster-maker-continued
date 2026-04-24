/* Replacements applied once during vanilla -> GMMC conversion (see ActionBlueprint.deriveFromVanillaItem).
 * `{ pattern, replacement, note? }`; `replacement` accepts a string or `(match, ...captures) => string`.
 * Applied in order — earlier rules can shape input for later ones. */
export const GMM_DESCRIPTION_REPLACEMENTS = [
	{
		// `[[lookup @name lowercase]]{monster}` -> `[name]`
		pattern: /\[\[lookup\s+@name\s+lowercase\]\]\{monster\}/gi,
		replacement: "[name]"
	},
	{
		// `[[lookup @save.dc.value [activity=<id>]]]` -> save DC formula
		pattern: /\[\[lookup\s+@save\.dc\.value(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[dcPrimaryBonus+maxMod]"
	},
	{
		// `[[lookup @target.template.size [activity=<id>]]]` -> `[target]`
		pattern: /\[\[lookup\s+@target\.template\.size(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[target]"
	},
	{
		// `[[lookup @range.value [activity=<id>]]]` -> `[range]`
		pattern: /\[\[lookup\s+@range\.value(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "[range]"
	},
	{
		// `[[lookup @target.affects.special [activity=<id>]]]` -> literal "target" (not a shortcode)
		pattern: /\[\[lookup\s+@target\.affects\.special(?:\s+activity=[^\s\]]+)?\]\]/gi,
		replacement: "target"
	},
	{
		// strip `[[/attack extended]]` inline button
		pattern: /\[\[\/attack\s+extended\]\]/gi,
		replacement: ""
	},
	{
		// strip bare `[[/damage average|extended ...]]` (no formula). Must run before the general
		// damage rule so its formula capture can't grab `average`/`extended` as a fake formula.
		pattern: /\[\[\/damage(?:\s+(?:average|extended))+\s*\]\]/gi,
		replacement: ""
	},
	{
		// `[[/damage <formula> [average] [extended] [type=<type>]]]` -> `[[<formula>]] <type>`
		// Lookahead excludes bare-modifier formulas (belt-and-braces with the strip rule above).
		pattern: /\[\[\/damage\s+(?!(?:average|extended)\b)([^\s\]]+)((?:\s+(?:average|extended|type=[^\s\]]+))*)\]\]/gi,
		replacement: (_match, formula, modifiers) => {
			const typeMatch = modifiers?.match(/type=([^\s\]]+)/i);
			const type = typeMatch?.[1] ?? "";
			return type ? `[[${formula}]] ${type}` : `[[${formula}]]`;
		}
	}
];

/* True when only whitespace, HTML scaffolding, or punctuation remains — used to clear the
 * description instead of leaving an empty `<p></p>` shell post-replacement. */
export function isDescriptionEffectivelyEmpty(text) {
	if (typeof text !== "string" || !text.length) return true;
	const stripped = text
		.replace(/<[^>]*>/g, " ")
		.replace(/&[a-z#0-9]+;/gi, " ")
		.replace(/[\s\.,;:!\?\-\u2013\u2014\(\)\[\]\{\}"'`*_~]+/g, "");
	return stripped.length === 0;
}
