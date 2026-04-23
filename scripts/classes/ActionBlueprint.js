import { GMM_ACTION_BLUEPRINT } from "../consts/GmmActionBlueprint.js";
import Activities from "./Activities.js";
import CompatibilityHelpers from "./CompatibilityHelpers.js";

/**
 * Translates between the user-authored GMM blueprint stored in `flags.gmm.blueprint.data`
 * and the underlying dnd5e v5.x item document. In v5.x the per-use fields (action type,
 * attack bonus, save DC, damage parts, target/range/duration/uses/recharge/consumption)
 * all moved off `item.system.*` and onto per-Activity classes. This module keeps the
 * blueprint as the single source of truth and mirrors it onto the GMM-managed activity
 * (via {@link Activities}) and onto the small set of fields that still live at the
 * item level (img, name, description text).
 */
const ActionBlueprint = (function () {

    /**
     * Item-level fields that still live on the document (rather than on the activity) and
     * therefore need direct path-to-path bindings.
     */
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
        // Direct-leaf writes via `document.update({ "flags.gmm.blueprint.data.<x>": v })`
        // (e.g. the file picker callback in ActionSheet#actionEditImage) only persist
        // the leaf, leaving the parent envelope's `vid` / `type` undefined. `vid: 1`
        // is the only recognised schema, so a missing `vid` on a blueprint that still
        // carries `data` is treated as legacy v1 rather than triggering a console
        // error every render. The repaired envelope is returned so the rest of the
        // pipeline (which assumes `vid`/`type` exist) keeps working.
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

            // Pull activity-driven fields (attack/save/damage/range/target/duration/
            // uses/consumption/concentration). Activities are the source of truth post
            // dnd5e v3.x; the legacy `system.actionType`, `system.attack.bonus`, etc.
            // paths no longer exist.
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

    /**
     * Build the partial item update derived from a saved blueprint. The result is a flat
     * mix of nested item-level fields (img, name, system.description.value) and dotted
     * path keys for the GMM activity (`system.activities.<id>`, optionally with a paired
     * `-=<id>` deletion when the activity type swaps).
     *
     * @param {object} blueprint   The full blueprint object (`{vid, type, data}`).
     * @param {Item5e|null} [item] The owning item, used to detect activity type swaps so
     *                             the prior activity can be dropped atomically. Optional
     *                             so the helper still works during migrations / item
     *                             creation when no item handle is available yet.
     * @returns {object}           Partial update payload to merge into `item.update(...)`.
     */
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

        // Mirror the blueprint onto the GMM-managed activity. `buildActivityUpdate`
        // handles the type-swap deletion case when the activity's type changes; if no
        // item is supplied we fall back to a plain create-shaped payload.
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
