import { GMM_ACTION_BLUEPRINT } from "../consts/GmmActionBlueprint.js";
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

    return {
        createFromItem,
        getItemDataFromBlueprint
    };
})();

export default ActionBlueprint;
