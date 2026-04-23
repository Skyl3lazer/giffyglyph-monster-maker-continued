import { GMM_GUI_COLORS } from "../consts/GmmGuiColors.js";
import { GMM_GUI_SKINS } from "../consts/GmmGuiSkins.js";
import { GMM_GUI_LAYOUTS } from "../consts/GmmGuiLayouts.js";
import { GMM_ACTION_ACTIVATION_TYPES } from "../consts/GmmActionActivationTypes.js";
import { GMM_ACTION_CONSUMPTION_TYPES } from "../consts/GmmActionConsumptionTypes.js";
import { GMM_ACTION_TIME_PERIODS } from "../consts/GmmActionTimePeriods.js";
import { GMM_ACTION_USE_PERIODS } from "../consts/GmmActionUsePeriods.js";
import { GMM_ACTION_RANGE_TYPES } from "../consts/GmmActionRangeTypes.js";
import { GMM_ACTION_RARITIES } from "../consts/GmmActionRarities.js";
import { GMM_ACTION_TARGET_TYPES } from "../consts/GmmActionTargetTypes.js";
import { GMM_ACTION_ATTACK_TYPES } from "../consts/GmmActionAttackTypes.js";
import { GMM_DEFERRAL_TYPES } from "../consts/GmmDeferralTypes.js";
import { GMM_ACTION_ATTACK_DAMAGE_TYPES } from "../consts/GmmActionAttackDamageTypes.js";
import { GMM_MONSTER_RANKS } from "../consts/GmmMonsterRanks.js";
import { GMM_MONSTER_ROLES } from "../consts/GmmMonsterRoles.js";
import { GMM_MODULE_TITLE } from "../consts/GmmModuleTitle.js";
import { GMM_5E_ABILITIES } from "../consts/Gmm5eAbilities.js";
import Gui from "./Gui.js";
import ActionBlueprint from "./ActionBlueprint.js";
import ActionForge from "./ActionForge.js";
import Templates from "./Templates.js";
import CompatibilityHelpers from "./CompatibilityHelpers.js";
import Activities from "./Activities.js";

/* GMM scaling-action item sheet, rebuilt on the dnd5e v5.x ApplicationV2 ItemSheet5e base The custom "Forge" UI li...
 * Form submission is intercepted in {@link _processFormData} so that edits to the `gmm.blueprint.*` fields are tra */
export default class ActionSheet extends dnd5e.applications.item.ItemSheet5e {

    constructor(options = {}) {
        super(options);
        this._gui = new Gui();
    }

    /** @inheritDoc */
    static DEFAULT_OPTIONS = {
        classes: ["gmm-window", "window--action"],
        position: { width: 500, height: 600 },
        window: { resizable: true },
        actions: {
            "add-damage": ActionSheet.#actionAddDamage,
            "remove-damage": ActionSheet.#actionRemoveDamage,
            "create-effect": ActionSheet.#actionCreateEffect,
            "edit-image": ActionSheet.#actionEditImage
        }
    };

    /* Replace the inherited ItemSheet5e PARTS (header, tabs, activities, advancement, description, details, effects) w...
 * Static class fields are not merged across the inheritance chain, so this fully supplants the parent @inheritDoc */
    static PARTS = {
        forge: {
            template: "modules/giffyglyph-monster-maker-continued/templates/action/forge.html",
            scrollable: [".forge__blueprint", ".forge__artifact"]
        }
    };

    /* The dnd5e ItemSheet5e inherits `static TABS` for its tab strip
 * clear it so the framework doesn't try to render a tab navigation for parts we never declare @inheritDoc */
    static TABS = [];

    /* Class names inherited from the dnd5e v5.x ApplicationV2 item-sheet chain that apply heavy visual styling (gold b...
 * 0 12px 8px` on `.window-content`, generic input/button chrome, etc.) */
    static #STRIPPED_CLASSES = new Set([
        "dnd5e2",
        "item",
        "vertical-tabs",
        "standard-form"
    ]);

    /** @inheritDoc */
    _initializeApplicationOptions(options) {
        const opts = super._initializeApplicationOptions(options);
        opts.classes = (opts.classes ?? []).filter(c => !ActionSheet.#STRIPPED_CLASSES.has(c));
        return opts;
    }

    /** @inheritDoc */
    get title() {
        const name = this.item?.name ?? this.document?.name ?? "";
        return name ? `${name} - GMMC Scalar Ability` : "GMMC Scalar Ability";
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /** @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const itemData = this.item.flags;

        // Templates rendered via the V1 sheet expected `cssClass` to be supplied by the framework
        // ApplicationV2 doesn't populate it automatically, so provide an equivalent so the existing `forge--action
        context.cssClass = this.isEditable ? "editable" : "locked";
        context.editable = this.isEditable;

        context.gmm = {
            blueprint: itemData.gmm?.blueprint ? itemData.gmm.blueprint.data : null,
            action: itemData.gmm?.blueprint ? ActionForge.createArtifact(itemData.gmm.blueprint).data : null,
            forge: {
                layout: itemData.gmm?.blueprint?.data?.display?.layout ? itemData.gmm.blueprint.data.display.layout : game.settings.get(GMM_MODULE_TITLE, "actionLayout"),
                colors: {
                    primary: itemData.gmm?.blueprint?.data?.display?.color?.primary ? itemData.gmm.blueprint.data.display.color.primary : game.settings.get(GMM_MODULE_TITLE, "actionPrimaryColor"),
                    secondary: itemData.gmm?.blueprint?.data?.display?.color?.secondary ? itemData.gmm.blueprint.data.display.color.secondary : game.settings.get(GMM_MODULE_TITLE, "actionSecondaryColor")
                },
                skins: {
                    artifact: itemData.gmm?.blueprint?.data?.display?.skin?.artifact ? itemData.gmm.blueprint.data.display.skin.artifact : game.settings.get(GMM_MODULE_TITLE, "actionArtifactSkin"),
                    blueprint: itemData.gmm?.blueprint?.data?.display?.skin?.blueprint ? itemData.gmm.blueprint.data.display.skin.blueprint : game.settings.get(GMM_MODULE_TITLE, "actionBlueprintSkin")
                }
            },
            gui: this._gui,
            enums: {
                colors: GMM_GUI_COLORS,
                skins: GMM_GUI_SKINS,
                activation_types: GMM_ACTION_ACTIVATION_TYPES,
                consumption_types: GMM_ACTION_CONSUMPTION_TYPES,
                time_periods: GMM_ACTION_TIME_PERIODS,
                use_periods: GMM_ACTION_USE_PERIODS,
                range_types: GMM_ACTION_RANGE_TYPES,
                rarities: GMM_ACTION_RARITIES,
                target_types: GMM_ACTION_TARGET_TYPES,
                consumption_targets: this._getActionConsumptionTargets(this.item),
                ranks: Object.keys(GMM_MONSTER_RANKS).filter((x) => x != "custom"),
                roles: Object.keys(GMM_MONSTER_ROLES).filter((x) => x != "custom"),
                layouts: GMM_GUI_LAYOUTS,
                attack_types: GMM_ACTION_ATTACK_TYPES,
                attack_damage_types: GMM_ACTION_ATTACK_DAMAGE_TYPES,
                deferral_types: GMM_DEFERRAL_TYPES,
                abilities: GMM_5E_ABILITIES
            }
        };

        if (context.gmm.action) {
            try {
                context.gmm.action.gmmLabels = await this.item.getGmmLabels();
            } catch (e) {
                console.warn("GMM | ActionSheet: getGmmLabels failed", e);
            }
        }

        // Populate `effects` (categorized) so the blueprint template's <dnd5e-effects> block can render.
        // dnd5e only does this from _preparePartContext("effects"); we have a single "forge" part.
        try {
            await this._prepareEffectsContext(context, options);
        } catch (e) {
            console.warn("GMM | ActionSheet: _prepareEffectsContext failed", e);
        }

        return context;
    }

    /* -------------------------------------------- */

    /* Build the dropdown options for the consumption-target picker The picker is driven by the GMM blueprint, which ca...
 * dnd5e v5.x dropped the legacy `item.system.consume.{type,target,amount}` schema in favour of per-activity `consu */
    _getActionConsumptionTargets(item) {
        try {
            const blueprintType = item?.flags?.gmm?.blueprint?.data?.resource_consumption?.type;
            if (!blueprintType) return {};
            const actor = item?.actor;
            if (!actor) return {};

            switch (blueprintType) {
                case "ammo":      return this._gmmAmmoTargets(actor, item);
                case "attribute": return this._gmmAttributeTargets(actor);
                case "material":  return this._gmmMaterialTargets(actor, item);
                case "charges":   return this._gmmChargesTargets(actor, item);
                default:          return {};
            }
        } catch (e) {
            console.warn("GMM | ActionSheet: _getActionConsumptionTargets failed", e);
            return {};
        }
    }

    /* -------------------------------------------- */

    /* Ammo consumption:
 * list every consumable item on the actor whose `system.type.value === "ammo"`, plus the item itself when the acti */
    _gmmAmmoTargets(actor, currentItem) {
        const targets = {};
        const isAmmo = (i) => (i.type === "consumable") && (i.system?.type?.value === "ammo");
        if (isAmmo(currentItem)) {
            targets[currentItem.id] = `${currentItem.name} (${currentItem.system.quantity ?? 0})`;
        }
        for (const i of actor.itemTypes?.consumable ?? []) {
            if (i === currentItem) continue;
            if (isAmmo(i)) targets[i.id] = `${i.name} (${i.system.quantity ?? 0})`;
        }
        return targets;
    }

    /* Attribute consumption:
 * surface the actor-data attribute paths dnd5e considers consumable */
    _gmmAttributeTargets(actor) {
        const targets = {};
        let attrs;
        try {
            attrs = TokenDocument.implementation?.getConsumedAttributes?.(actor.type) ?? null;
        } catch (e) { /* fall through */ }
        attrs ??= CONFIG?.DND5E?.consumableResources ?? [];
        for (const attr of attrs) targets[attr] = attr;
        return targets;
    }

    /* Material consumption:
 * list `consumable` and `loot` items on the actor */
    _gmmMaterialTargets(actor, currentItem) {
        const targets = {};
        for (const i of actor.items ?? []) {
            if (i === currentItem) continue;
            if (!["consumable", "loot"].includes(i.type)) continue;
            targets[i.id] = `${i.name} (${i.system?.quantity ?? 0})`;
        }
        return targets;
    }

    /* Charges consumption:
 * any actor-side item with a `uses.max` */
    _gmmChargesTargets(actor, currentItem) {
        const targets = {};
        const fmt = (name, uses) => {
            if (!uses?.max) return name;
            const recovery = uses.recovery?.[0];
            // Periodic recoverAll (lr/sr/day/etc., excluding recharge) → "max per period".
            if (recovery && (recovery.type === "recoverAll") && (recovery.period !== "recharge")
                && (uses.recovery.length === 1)) {
                const per = CONFIG.DND5E.limitedUsePeriods?.[recovery.period]?.abbreviation ?? recovery.period;
                return `${name} (${game.i18n.format("DND5E.AbilityUseConsumableLabel", { max: uses.max, per })})`;
            }
            // Recharge → "(Recharge)".
            if (recovery?.period === "recharge") {
                return `${name} (${game.i18n.localize("DND5E.Recharge")})`;
            }
            // Plain charges → "(value charges)".
            return `${name} (${game.i18n.format("DND5E.AbilityUseChargesLabel", { value: uses.value ?? uses.max })})`;
        };

        if (currentItem.system?.uses?.max) {
            targets[""] = fmt(game.i18n.localize("DND5E.CONSUMPTION.Target.ThisItem") || currentItem.name, currentItem.system.uses);
        }
        for (const i of actor.items ?? []) {
            if (i === currentItem) continue;
            if (!i.system?.uses?.max) continue;
            targets[i.id] = fmt(i.name, i.system.uses);
        }
        return targets;
    }

    /* -------------------------------------------- */
    /*  Inherited dnd5e helpers we deliberately disable                                */
    /* -------------------------------------------- */

    /* Suppress the dnd5e "mode slider" (`<slide-toggle class="mode-slider">`) that `PrimarySheet5e#_renderModeToggle`...
 * GMM's Forge UI is always editable and exposes its own controls */
    _renderModeToggle() {
        const toggle = this.element?.querySelector(".window-header .mode-slider");
        if (toggle) toggle.remove();
    }

    /* Suppress the dnd5e "create child" footer button (gold "+" appended to `.window-content` by `PrimarySheet5e#_onFi...
 * The Forge UI provides its own controls, and dnd5e's button has no meaning here */
    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this.element?.querySelector(".window-content > .create-child")?.remove();
    }

    /* No-op: rich text editors are now `<prose-mirror>` web components in the templates,
 * which self-initialize. Override the V1 activator dnd5e still calls so it doesn't crash. */
    _activateEditor(_div) {}

    /* Force the dnd5e PLAY/EDIT mode to EDIT on every render
 * The Forge UI does not use the dnd5e read-only / editing dichotomy (it has no inline labels to swap, no tray rows */
    _configureRenderOptions(options) {
        super._configureRenderOptions(options);
        this._mode = this.constructor.MODES.EDIT;
    }

    /* -------------------------------------------- */
    /*  Event Listeners                             */
    /* -------------------------------------------- */

    /** @inheritDoc */
    async _onRender(context, options) {
        await super._onRender(context, options);

        // Bridge the GMM Gui controller (still jQuery-based) to the V2 root element.
        // `this.element` is the form created by DocumentSheetV2 (`tag: "form"`).
        const $el = $(this.element);
        try {
            this._gui.activateListeners($el);
            this._gui.applyTo($el);
        } catch (e) {
            console.warn("GMM | ActionSheet: Gui.activateListeners failed", e);
        }
    }

    /* -------------------------------------------- */
    /*  Form Submission                             */
    /* -------------------------------------------- */

    /* @inheritDoc @see MonsterSheet#_onChangeForm */
    _onChangeForm(formConfig, event) {
        if (event?.target?.closest?.(".gmm-modal")) return;
        return super._onChangeForm(formConfig, event);
    }

    /* @inheritDoc Replaces the V1 `_updateObject`
 * Translates the `gmm.blueprint.*` form fields into a `flags.gmm.blueprint` payload and merges the item-side mirro */
    _processFormData(event, form, formData) {
        // V14 ApplicationV2 puts the application root in a `<form>` element
        // The forge template embeds GMM modals as siblings of the blueprint inputs their named radios/selects would otherw
        const filtered = {};
        for (const [name, value] of Object.entries(formData.object)) {
            const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
            if (input?.closest(".gmm-modal")) continue;
            filtered[name] = value;
        }
        const expanded = foundry.utils.expandObject(filtered);
        const target = event?.target;

        if (target) {
            const window = target.closest(".gmm-window") ?? this.element;
            try {
                this._gui.updateFrom(window);
            } catch (e) {
                console.warn("GMM | ActionSheet: Gui.updateFrom failed", e);
            }
        }

        // Messy but new validation makes this weird with dropdowns.
        if (expanded.gmm?.blueprint?.duration?.value === null) {
            expanded.gmm.blueprint.duration.value = "";
        } else if (expanded.gmm?.blueprint?.duration?.value !== undefined) {
            expanded.gmm.blueprint.duration.value = `${expanded.gmm.blueprint.duration.value}`;
        }
        if (expanded.gmm?.blueprint?.uses?.max === null) {
            expanded.gmm.blueprint.uses.max = "";
        }

        // Description text submitted via the new editor is nested under `flags.gmm.blueprint.data.description.text`
        // mirror it onto the blueprint form path so the gmm.blueprint -> flags.gmm.blueprint translation below captures it
        if (expanded.flags?.gmm?.blueprint?.data?.description?.text) {
            CompatibilityHelpers.setProperty(expanded, "gmm.blueprint.description.text", expanded.flags.gmm.blueprint.data.description.text);
        }

        if (CompatibilityHelpers.hasProperty(expanded, "gmm.blueprint")) {
            CompatibilityHelpers.setProperty(expanded, "flags.gmm.blueprint", {
                vid: 1,
                type: "action",
                data: CompatibilityHelpers.getProperty(expanded, "gmm.blueprint")
            });
            delete expanded.gmm;

            // Pass `this.item` so ActionBlueprint can emit a paired `-=<id>` activity
            // deletion when the user changes attack.type (and the activity type swaps).
            $.extend(true, expanded, ActionBlueprint.getItemDataFromBlueprint(expanded.flags.gmm.blueprint, this.item));
        }

        return expanded;
    }

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    /* @this {ActionSheet} Append an empty damage part to the action's blueprint and rebuild the activity from the upda...
 * See {@link #mutateBlueprintDamage} for the rationale behind driving off the flag rather than the activity */
    static async #actionAddDamage(event, target) {
        event.preventDefault();
        return ActionSheet.#mutateBlueprintDamage.call(this, entries => {
            entries.push({ formula: "", type: "" });
        });
    }

    /** @this {ActionSheet} */
    static async #actionRemoveDamage(event, target) {
        event.preventDefault();
        const li = target.closest(".form-group--damage");
        const index = Number(li?.dataset?.index);
        return ActionSheet.#mutateBlueprintDamage.call(this, entries => {
            if (Number.isInteger(index) && index >= 0 && index < entries.length) {
                entries.splice(index, 1);
            }
        });
    }

    /* Apply a mutation to the action's `blueprint.attack.hit.damage` list and persist both the updated flag and the re...
 * The blueprint flag is the UI source of truth */
    static async #mutateBlueprintDamage(mutate) {
        const stored = this.item.flags?.gmm?.blueprint;
        const blueprint = foundry.utils.deepClone(stored ?? { vid: 1, type: "action", data: {} });
        blueprint.vid = 1;
        blueprint.type = "action";
        blueprint.data ??= {};

        // Normalise the existing damage list into a plain array of `{formula, type}` entries regardless of whether the fla...
        // {...}, "1":
        const raw = foundry.utils.getProperty(blueprint.data, "attack.hit.damage");
        let entries;
        if (Array.isArray(raw)) {
            entries = raw.map(e => ({ formula: e?.formula ?? "", type: e?.type ?? "" }));
        } else if (raw && typeof raw === "object") {
            entries = Object.keys(raw)
                .filter(k => /^\d+$/.test(k))
                .sort((a, b) => Number(a) - Number(b))
                .map(k => ({ formula: raw[k]?.formula ?? "", type: raw[k]?.type ?? "" }));
        } else {
            entries = [];
        }

        mutate(entries);
        foundry.utils.setProperty(blueprint.data, "attack.hit.damage", entries);

        // Mirror onto the activity via the same pipeline as the form-submit path, so the flag and `system.activities.<id>`...
        // We also overwrite the flag wholesale to flatten any legacy dotted-object shape into the clean array form
        const update = ActionBlueprint.getItemDataFromBlueprint(blueprint, this.item);
        update["flags.gmm.blueprint"] = blueprint;
        return this.item.update(update);
    }

    /** @this {ActionSheet} */
    static #actionCreateEffect(event, target) {
        const li = target.closest(".effect-section");
        const isEnchantment = li.dataset.effectType.startsWith("enchantment");
        return this.document.createEmbeddedDocuments("ActiveEffect", [{
            name: game.i18n.localize("DND5E.EffectNew"),
            img: this.document.img,
            origin: isEnchantment ? undefined : this.document.uuid,
            "duration.rounds": li.dataset.effectType === "temporary" ? 1 : undefined,
            disabled: ["inactive", "enchantmentInactive"].includes(li.dataset.effectType),
            "flags.dnd5e.type": isEnchantment ? "enchantment" : undefined
        }]);
    }

    /* Open a Foundry FilePicker to choose an image for the field named in `target.dataset.editImage`, then write the p...
 * The V1 sheet wired the inline `<img data-edit="…">` pattern through Foundry's ImageHelper popup, but Application */
    static #actionEditImage(event, target) {
        const field = target.dataset.editImage;
        if (!field) return;
        const current = foundry.utils.getProperty(this.document, field) ?? "";
        return new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current,
            callback: path => {
                const update = { [field]: path };
                // If we're writing into the GMM blueprint flag, also stamp the envelope's `vid` / `type` so a fresh item that has...
                // Without this, `_verifyBlueprint` sees a missing `vid` on the next render
                if (field.startsWith("flags.gmm.blueprint.")) {
                    update["flags.gmm.blueprint.vid"] = 1;
                    update["flags.gmm.blueprint.type"] = "action";
                }

                if (field === "flags.gmm.blueprint.data.description.image") {
                    update.img = path;
                }
                return this.document.update(update);
            },
            top: this.position?.top ? this.position.top + 40 : null,
            left: this.position?.left ? this.position.left + 10 : null
        }).render({ force: true });
    }
}
