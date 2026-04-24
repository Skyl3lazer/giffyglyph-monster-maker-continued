import { GMM_ACTION_BLUEPRINT } from "../consts/GmmActionBlueprint.js";
import { GMM_DESCRIPTION_REPLACEMENTS, isDescriptionEffectivelyEmpty } from "../consts/GmmDescriptionReplacements.js";
import Activities from "./Activities.js";
import CompatibilityHelpers from "./CompatibilityHelpers.js";

/* Translates between the user-authored GMM blueprint stored in `flags.gmm.blueprint.data` and the underlying dnd5e...
 * In v5.x the per-use fields (action type, attack bonus, save DC, damage parts, target/range/duration/uses/recharg */
const ActionBlueprint = (function () {

    /* Item-level fields that still live on the document (rather than on the activity) and therefore need direct path-t...
 * on the document (rather than on the activity) and therefore need direct path-to-path bindings */
    const itemMappings = [
        { from: "description.image", to: "img" },
        { from: "description.name", to: "name" },
        { from: "description.text", to: "system.description.value" }
    ];

    /* -------------------------------------------- */
    /*  Read direction (item -> blueprint)          */
    /* -------------------------------------------- */

    function createFromItem(item) {
        const blueprint = $.extend(true, {}, GMM_ACTION_BLUEPRINT, item.flags.gmm ? _verifyBlueprint(item.flags.gmm.blueprint) : null);
        return _syncItemDataToBlueprint(blueprint, item);
    }

    function _verifyBlueprint(blueprint) {
        // Direct-leaf writes via `document.update({ "flags.gmm.blueprint.data.<x>":
        // v })` (e.g
        if (blueprint && blueprint.vid === undefined && blueprint.data) {
            blueprint.vid = 1;
            if (!blueprint.type) blueprint.type = "action";
        }
        switch (blueprint?.vid) {
            case 1:
                return blueprint;
            default:
                console.error(`This action blueprint has an invalid version id [${blueprint?.vid}] and can't be verified.`, blueprint);
                return null;
        }
    }

    function _syncItemDataToBlueprint(blueprint, item) {
        const blueprintData = blueprint.data;
        try {
            // Pull item-level fields (img, name, description.value).
            itemMappings.forEach((x) => {
                if (CompatibilityHelpers.hasProperty(item, x.to)) {
                    CompatibilityHelpers.setProperty(blueprintData, x.from, CompatibilityHelpers.getProperty(item, x.to));
                }
            });

            // Pull activity-driven fields (attack/save/damage/range/target/duration/ uses/consumption/concentration)
            // Activities are the source of truth post dnd5e v3.x
            const gmmActivity = item.system?.activities?.get?.(Activities.GMM_ACTIVITY_ID);
            if (gmmActivity) {
                Activities.readActivityIntoBlueprintData(gmmActivity, blueprintData);
            }

            return blueprint;
        } catch (error) {
            console.error("Failed to load blueprint data from the current item", error);
            return blueprint;
        }
    }

    /* -------------------------------------------- */
    /*  Write direction (blueprint -> item)         */
    /* -------------------------------------------- */

    /* Build the partial item update derived from a saved blueprint
 * The result is a flat mix of nested item-level fields (img, name, system.description.value) and dotted path keys */
    function getItemDataFromBlueprint(blueprint, item = null) {
        const itemData = {};

        itemMappings.forEach((x) => {
            if (CompatibilityHelpers.hasProperty(blueprint.data, x.from)) {
                CompatibilityHelpers.setProperty(itemData, x.to, CompatibilityHelpers.getProperty(blueprint.data, x.from));
            }
        });

        // Blank descriptions
        if (!CompatibilityHelpers.hasProperty(blueprint.data, "description.text")) {
            CompatibilityHelpers.setProperty(itemData, "system.description.value", "");
        }

        // Mirror the blueprint onto the GMM-managed activity
        // `buildActivityUpdate` handles the type-swap deletion case when the activity's type changes
        const activityUpdate = item
            ? Activities.buildActivityUpdate(item, blueprint)
            : { [`system.activities.${Activities.GMM_ACTIVITY_ID}`]: Activities.buildActivityData(blueprint) };
        Object.assign(itemData, activityUpdate);

        return itemData;
    }

    /* -------------------------------------------- */
    /*  Vanilla -> GMM derivation                   */
    /* -------------------------------------------- */

    /* Build a fresh GMM blueprint from a vanilla weapon/feat that has never been a GMM scaling
     * action. Reads the item's primary dnd5e activity (chosen via {@link Activities.pickPrimaryActivity})
     * and patches anything still missing from the item-level fields dnd5e v5 keeps on the document
     * itself. Returns a `{vid:1, type:"action", data:{...}}` envelope ready for `flags.gmm.blueprint`. */
    function deriveFromVanillaItem(item) {
        const blueprint = $.extend(true, {}, GMM_ACTION_BLUEPRINT, { vid: 1, type: "action" });
        const blueprintData = blueprint.data;

        // Item-level fields (img/name/description.value) via the same mappings used at sheet render.
        itemMappings.forEach((x) => {
            if (CompatibilityHelpers.hasProperty(item, x.to)) {
                CompatibilityHelpers.setProperty(blueprintData, x.from, CompatibilityHelpers.getProperty(item, x.to));
            }
        });

        // One-time rewrite pass over the imported description so vanilla dnd5e conventions like
        // `[[lookup @name lowercase]]{monster}` are translated into GMMC shortcodes (`[name]`, …).
        // See {@link GMM_DESCRIPTION_REPLACEMENTS} for the active rule set.
        try {
            _applyDescriptionReplacements(blueprintData);
        } catch (e) {
            console.warn("GMM | deriveFromVanillaItem: description replacement pass failed", e);
        }

        // Per-activity fields (attack/save/heal/damage/range/target/uses/duration/consumption).
        const primary = Activities.pickPrimaryActivity(item);
        if (primary) {
            try {
                Activities.readActivityIntoBlueprintData(primary, blueprintData);
            } catch (e) {
                console.warn("GMM | deriveFromVanillaItem: readActivityIntoBlueprintData failed", e);
            }
        }

        // Document-level leftovers (range, weapon base damage) the activity didn't already cover.
        try {
            Activities.applyItemLevelFallbacks(item, blueprintData);
        } catch (e) {
            console.warn("GMM | deriveFromVanillaItem: applyItemLevelFallbacks failed", e);
        }

        // Final pass: ensure the GMMC `attack.type` row is populated when the activity-read step
        // left it blank (e.g. dnd5e attack activity missing `attack.type.classification`, or an
        // unmapped value like "unarmed"). Inference reads range and item type as fallbacks.
        // For every attack-typed conversion (mwak/msak/rwak/rsak), force `related_stat = "max"`
        // so the converted action scales off the monster's highest ability modifier by default,
        // matching the typical authoring intent for GMMC scaling actions.
        try {
            blueprintData.attack ??= {};
            const current = blueprintData.attack.type;
            if (current === undefined || current === null || current === "") {
                const inferred = Activities.inferAttackType(item, primary);
                if (inferred) blueprintData.attack.type = inferred;
            }
            if (["mwak", "msak", "rwak", "rsak"].includes(blueprintData.attack.type)) {
                blueprintData.attack.related_stat = "max";
            }
        } catch (e) {
            console.warn("GMM | deriveFromVanillaItem: attack-type inference failed", e);
        }

        return blueprint;
    }

    /* Apply the {@link GMM_DESCRIPTION_REPLACEMENTS} rule set in order to the blueprint's
     * description text. After substitutions, if the remaining content is just whitespace,
     * HTML scaffolding, or stray punctuation, clear the description entirely so the converted
     * action doesn't render an empty `<p></p>` shell where vanilla button enrichers used to live. */
    function _applyDescriptionReplacements(blueprintData) {
        const text = blueprintData?.description?.text;
        if (typeof text !== "string" || !text.length) return;
        let next = text;
        for (const rule of GMM_DESCRIPTION_REPLACEMENTS) {
            if (!rule?.pattern) continue;
            next = next.replace(rule.pattern, rule.replacement ?? "");
        }
        if (isDescriptionEffectivelyEmpty(next)) next = "";
        if (next !== text) {
            blueprintData.description ??= {};
            blueprintData.description.text = next;
        }
    }

    return {
        createFromItem,
        getItemDataFromBlueprint,
        deriveFromVanillaItem
    };
})();

export default ActionBlueprint;
