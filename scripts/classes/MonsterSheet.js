import { GMM_5E_ABILITIES } from "../consts/Gmm5eAbilities.js";
import { GMM_5E_ALIGNMENTS } from "../consts/Gmm5eAlignments.js";
import { GMM_5E_CATEGORIES } from "../consts/Gmm5eCategories.js";
import { GMM_5E_CONDITIONS } from "../consts/Gmm5eConditions.js";
import { GMM_5E_DAMAGE_TYPES } from "../consts/Gmm5eDamageTypes.js";
import { GMM_5E_LANGUAGES } from "../consts/Gmm5eLanguages.js";
import { GMM_5E_SIZES } from "../consts/Gmm5eSizes.js";
import { GMM_5E_SKILLS } from "../consts/Gmm5eSkills.js";
import { GMM_5E_UNITS } from "../consts/Gmm5eUnits.js";
import { GMM_GUI_COLORS } from "../consts/GmmGuiColors.js";
import { GMM_GUI_LAYOUTS } from "../consts/GmmGuiLayouts.js";
import { GMM_GUI_SKINS } from "../consts/GmmGuiSkins.js";
import { GMM_MONSTER_RANKS } from "../consts/GmmMonsterRanks.js";
import { GMM_MONSTER_ROLES } from "../consts/GmmMonsterRoles.js";
import { GMM_MODULE_TITLE } from "../consts/GmmModuleTitle.js";
import Gui from "./Gui.js";
import ModalAbilityCheck from "../modals/ModalAbilityCheck.js";
import ModalBasicAttackAc from "../modals/ModalBasicAttackAc.js";
import ModalBasicAttackSave from "../modals/ModalBasicAttackSave.js";
import ModalBasicDamage from "../modals/ModalBasicDamage.js";
import ModalSavingThrow from "../modals/ModalSavingThrow.js";
import MonsterBlueprint from "./MonsterBlueprint.js";
import Templates from "./Templates.js";
import CompatibilityHelpers from "./CompatibilityHelpers.js";
import Activities from "./Activities.js";

/* GMM monster sheet, built on the dnd5e v5.x ApplicationV2 NPC sheet. The custom "Forge" UI replaces the
 * stock parts, and _processFormData translates edits to the `gmm.blueprint.*` fields back into the blueprint flag. */
export default class MonsterSheet extends dnd5e.applications.actor.NPCActorSheet {

    constructor(options = {}) {
        // Have to handle this a little differently so that aspect ratios don't get bonked
        options.position = { ...MonsterSheet.DEFAULT_OPTIONS.position, ...(options.position ?? {}) };
        super(options);
        this._gui = new Gui();
        this._saveSheetPosition = () => {};
    }

    /** @inheritDoc */
    static DEFAULT_OPTIONS = {
        classes: ["gmm-window", "window--monster"],
        position: { width: 540, height: 900 },
        window: { resizable: true },
        actions: {
            "add-item": MonsterSheet.#actionAddItem,
            "edit-item": MonsterSheet.#actionEditItem,
            "delete-item": MonsterSheet.#actionDeleteItem,
            "roll-item": MonsterSheet.#actionRollItem,
            "display-item": MonsterSheet.#actionDisplayItem,
            "recharge-item": MonsterSheet.#actionRechargeItem,
            "create-effect": MonsterSheet.#actionCreateEffect,
            "toggle-effect-mode": MonsterSheet.#actionToggleEffectMode,
            "roll-hp": MonsterSheet.#actionRollHp,
            "edit-image": MonsterSheet.#actionEditImage
        }
    };

    /* Replace the inherited NPC PARTS with a single custom `forge` part. PARTS is not merged across the
     * inheritance chain, so this fully supplants the parent definition. @inheritDoc */
    static PARTS = {
        forge: {
            template: "modules/giffyglyph-monster-maker-continued/templates/monster/forge.html",
            scrollable: [".forge__blueprint", ".forge__artifact"]
        }
    };

    /* Clear the inherited `static TABS` so the framework doesn't try to render a `tabs` part we never declare. @inheritDoc */
    static TABS = [];

    /* Class names inherited from the dnd5e NPC sheet chain that apply heavy visual styling. The GMM forge
     * entirely replaces the dnd5e NPC PARTS markup, so none of these styles are wanted. */
    static #STRIPPED_CLASSES = new Set([
        "dnd5e2",
        "actor",
        "npc",
        "vertical-tabs",
        "standard-form"
    ]);

    /** @inheritDoc */
    _initializeApplicationOptions(options) {
        const opts = super._initializeApplicationOptions(options);
        opts.classes = (opts.classes ?? []).filter(c => !MonsterSheet.#STRIPPED_CLASSES.has(c));
        return opts;
    }

    /** @inheritDoc */
    get title() {
        const name = this.actor?.name ?? this.document?.name ?? "";
        return name ? `${name} - GMMC Scaling Monster` : "GMMC Scaling Monster";
    }

    /** @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actorData = this.actor.flags;
        const moduleVersion = game.modules.get(GMM_MODULE_TITLE)?.version ?? "";

        // The V1 sheet framework supplied `cssClass`; ApplicationV2 does not, so provide an equivalent for the templates.
        context.cssClass = this.isEditable ? "editable" : "locked";
        context.editable = this.isEditable;

        context.gmm = {
            blueprint: actorData.gmm?.blueprint ? actorData.gmm.blueprint.data : null,
            monster: actorData.gmm?.monster ? actorData.gmm.monster.data : null,
            version: moduleVersion,
            forge: {
                layout: actorData.gmm?.blueprint?.data?.display?.layout ? actorData.gmm.blueprint.data.display.layout : game.settings.get(GMM_MODULE_TITLE, "monsterLayout"),
                colors: {
                    primary: actorData.gmm?.blueprint?.data?.display?.color?.primary ? actorData.gmm.blueprint.data.display.color.primary : game.settings.get(GMM_MODULE_TITLE, "monsterPrimaryColor"),
                    secondary: actorData.gmm?.blueprint?.data?.display?.color?.secondary ? actorData.gmm.blueprint.data.display.color.secondary : game.settings.get(GMM_MODULE_TITLE, "monsterSecondaryColor")
                },
                skins: {
                    artifact: actorData.gmm?.blueprint?.data?.display?.skin?.artifact ? actorData.gmm.blueprint.data.display.skin.artifact : game.settings.get(GMM_MODULE_TITLE, "monsterArtifactSkin"),
                    blueprint: actorData.gmm?.blueprint?.data?.display?.skin?.blueprint ? actorData.gmm.blueprint.data.display.skin.blueprint : game.settings.get(GMM_MODULE_TITLE, "monsterBlueprintSkin")
                }
            },
            gui: this._gui,
            enums: {
                abilities: GMM_5E_ABILITIES,
                alignments: GMM_5E_ALIGNMENTS,
                categories: GMM_5E_CATEGORIES,
                conditions: GMM_5E_CONDITIONS,
                damage_types: GMM_5E_DAMAGE_TYPES,
                colors: GMM_GUI_COLORS,
                skins: GMM_GUI_SKINS,
                languages: GMM_5E_LANGUAGES,
                sizes: GMM_5E_SIZES.map((x) => x.name),
                skills: GMM_5E_SKILLS.map((x) => x.name),
                ranks: Object.keys(GMM_MONSTER_RANKS),
                roles: Object.keys(GMM_MONSTER_ROLES),
                units: GMM_5E_UNITS.map((x) => x.name),
                layouts: GMM_GUI_LAYOUTS
            }
        };

        if (context.gmm.blueprint) {
            // Set total number of spells.
            if (context.gmm.blueprint.spellbook?.spells) {
                context.gmm.blueprint.spellbook.total = Object.entries(context.gmm.blueprint.spellbook.spells).reduce((a, b) => a + b[1].length, 0);
            }
        }

        if (context.gmm.monster) {
            // Beautify monster item data.
            const actionTypes = ["bonus_actions.items", "actions.items", "reactions.items", "lair_actions.items", "legendary_actions.items", "traits.items", "inventory.items", "spellbook.spells.0", "spellbook.spells.1", "spellbook.spells.2", "spellbook.spells.3", "spellbook.spells.4", "spellbook.spells.5", "spellbook.spells.6", "spellbook.spells.7", "spellbook.spells.8", "spellbook.spells.9", "spellbook.spells.other"];

            for (const type of actionTypes) {
                let promises = this._getItemMapping(type, context.gmm.monster);
                if (promises) {
                    await Promise.all(promises).then(function (results) {
                        CompatibilityHelpers.setProperty(context.gmm.monster, type, results);
                    });
                }
            }

            // Set maximum active spell level
            let maximum_spell_level = 0;
            for (let i = 1; i < 10; i++) {
                if (context.gmm.monster.spellbook.spells[i].length > 0 || context.gmm.monster.spellbook.slots[i].maximum > 0) {
                    maximum_spell_level = i;
                }
            }
            if (context.gmm.monster.spellbook.slots.pact.maximum > 0) {
                maximum_spell_level = Math.max(maximum_spell_level, context.gmm.monster.spellbook.slots.pact.level);
            }
            context.gmm.monster.spellbook.maximum_visible_spell_level = maximum_spell_level;

            // Show/hide features panel
            ["bonus_actions", "actions", "reactions", "traits", "paragon_actions", "legendary_actions", "lair_actions", "legendary_resistances"].forEach((x) => {
                if (context.gmm.monster[x].visible) {
                    if (context.gmm.monster.features) {
                        context.gmm.monster.features.visible = true;
                    } else {
                        context.gmm.monster.features = {
                            visible: true
                        };
                    }
                }
            });
        }

        // Populate `effects` (categorized) so the blueprint template's <dnd5e-effects> block can render.
        // dnd5e only does this from _preparePartContext("effects"); we have a single "forge" part.
        try {
            await this._prepareEffectsContext(context, options);
            this._gmmEnrichEffectModes(context);
        } catch (e) {
            console.warn("GMM | MonsterSheet: _prepareEffectsContext failed", e);
        }

        return context;
    }

    /* For each prepared effect entry that lives on a GMMC scaling-action item the actor carries,
     * stamp the always/onUse flags consumed by `blueprint_effect.html`. Effects directly on the
     * actor (no parentId) are skipped — they have no activity to attach to. */
    _gmmEnrichEffectModes(context) {
        const categories = context?.effects;
        if (!categories) return;
        for (const category of Object.values(categories)) {
            if (!Array.isArray(category?.effects)) continue;
            for (const entry of category.effects) {
                if (!entry?.parentId) continue;
                const item = this.actor.items.get(entry.parentId);
                if (!item) continue;
                if (!item.system?.activities?.has?.(Activities.GMM_ACTIVITY_ID)) continue;
                entry.gmmCanToggleMode = true;
                entry.gmmAlwaysMode = !Activities.isEffectAppliedByGmmActivity(item, entry.id);
            }
        }
    }

    _getItemMapping(type, monster) {
        let items = CompatibilityHelpers.getProperty(monster, type);
        let mappedItems;
        if (items) {
            mappedItems = items.map(async (y) => {
                let item = this.actor.items.get(y.id);
                item.gmmLabels = await item.getGmmLabels();
                return item;
            });
        }
        return mappedItems;
    }

    /* The dnd5e NPC sheet's `_onRender` invokes these helpers to decorate the stock inventory, attunement, and spellbook
     * parts. Our PARTS replaces all of those with the single custom `forge` part, so disable them to avoid errors. */
    _renderCreateInventory() {}
    _renderAttunement() {}
    _renderSpellbook() {}

    /* Suppress the dnd5e "mode slider" (`.mode-slider`): GMM's Forge UI is always editable and exposes its own controls. */
    _renderModeToggle() {
        const toggle = this.element?.querySelector(".window-header .mode-slider");
        if (toggle) toggle.remove();
    }

    /* Remove the dnd5e "create child" footer button (`.create-child`): the Forge UI provides its own per-section
     * "Add" buttons, so dnd5e's button has no meaning here. */
    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this.element?.querySelector(".window-content > .create-child")?.remove();
    }

    /** @inheritDoc */
    async _onRender(context, options) {
        await super._onRender(context, options);

        // Our forge omits the `dnd5e2` class (its styles would fight the forge), but rendering still fires
        // `renderNPCActorSheet`. Pre-v14 `this.element` is native DOM with no jQuery API
        const generation = game.release?.generation ?? (Number.parseInt(game.version, 10) || 0);
        if (generation < 14 && this.element && typeof this.element.hasClass !== "function") {
            this.element.hasClass = (cls) => cls === "dnd5e2" || this.element.classList.contains(cls);
        }

        this.element?.querySelector(".header-elements .cr-xp")?.remove();

        // Rich text editors are `<prose-mirror>` web components in the templates; they self-initialize.

        // Bridge the GMM Gui controller and modal helpers (which still use jQuery) to the V2 root element.
        const $el = $(this.element);
        try {
            this._gui.activateListeners($el);
            this._gui.applyTo($el);
        } catch (e) {
            console.warn("GMM | MonsterSheet: Gui.activateListeners failed", e);
        }

        try {
            $el.find('.ability-ranking .move-up, .ability-ranking .move-down').click(this._updateAbilityRanking.bind(this));
            $el.find('.monster__panels .accordion-section__title').click((e) => e.stopPropagation());
            $el.find('.item .item__title input').click((e) => e.stopPropagation());
            $el.find('.item .item__title').click(this._toggleItemDetails.bind(this));
            // `update-item` inputs intentionally have no `name` attribute, so the V2 form
            // auto-submit ignores them. Their value changes update the embedded item directly.
            $el.find('[data-action="update-item"]').change((e) => this._updateItem(e));

            [ModalAbilityCheck, ModalBasicAttackAc, ModalBasicAttackSave, ModalBasicDamage, ModalSavingThrow].forEach((x) => {
                x.activateListeners($el, this.actor, this.id);
            });
        } catch (e) {
            console.warn("GMM | MonsterSheet: listener attachment failed", e);
        }
    }

    /* Skip the auto-submit when an input inside a `.gmm-modal` changes: modal forms commit their own state via
     * their roll buttons and should never trigger a sheet update by themselves. @inheritDoc */
    _onChangeForm(formConfig, event) {
        if (event?.target?.closest?.(".gmm-modal")) return;
        return super._onChangeForm(formConfig, event);
    }

    /* @inheritDoc Replaces the V1 `_updateObject`
 * The form fields use dotted names like `gmm.blueprint.combat.rank.type` */
    _processFormData(event, form, formData) {
        // The forge template embeds GMM modals inside the sheet's root form. Drop their named radios/selects
        // (`ability`, `mode`, `bonus`, …) so FormDataExtended doesn't submit them as actor updates.
        for (const name of Object.keys(formData.object)) {
            const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
            if (input?.closest(".gmm-modal")) delete formData.object[name];
        }
        // Call super so dnd5e's base handling runs (wildcard-token guard, flag `-=` cleanup, CR coercion).
        const expanded = super._processFormData(event, form, formData);
        const target = event?.target;

        if (target) {
            const window = target.closest(".gmm-window") ?? this.element;
            try {
                this._gui.updateFrom(window);
            } catch (e) {
                console.warn("GMM | MonsterSheet: Gui.updateFrom failed", e);
            }
        }

        if (CompatibilityHelpers.hasProperty(expanded, "gmm.blueprint")) {
            // `{{editor}}` writes to the target path under `flags.*`; mirror biography
            // text back onto `gmm.blueprint` so the blueprint envelope captures it.
            const bioText = expanded.flags?.gmm?.blueprint?.data?.biography?.text;
            if (bioText !== undefined) {
                CompatibilityHelpers.setProperty(expanded, "gmm.blueprint.biography.text", bioText);
            }

            CompatibilityHelpers.setProperty(expanded, "flags.gmm.blueprint", {
                vid: 1,
                type: "monster",
                data: CompatibilityHelpers.getProperty(expanded, "gmm.blueprint")
            });
            delete expanded.gmm;

            if (target?.name === "gmm.blueprint.combat.rank.type") {
                expanded.flags.gmm.blueprint.data.combat.rank.custom_name = null;
                expanded.flags.gmm.blueprint.data.combat.rank.modifiers = GMM_MONSTER_RANKS[target.value];
            } else if (target?.name === "gmm.blueprint.combat.role.type") {
                expanded.flags.gmm.blueprint.data.combat.role.custom_name = null;
                expanded.flags.gmm.blueprint.data.combat.role.modifiers = GMM_MONSTER_ROLES[target.value];
            }

            $.extend(true, expanded, MonsterBlueprint.getActorDataFromBlueprint(expanded.flags.gmm.blueprint, this.actor));
        }

        return expanded;
    }

    /* Extend the dnd5e default drop reset with the GMM-specific fields (`proficient`, `attunement`) the V1 sheet stripped. @inheritDoc */
    _onDropResetData(event, itemData) {
        super._onDropResetData(event, itemData);
        if (!itemData.system) return;
        ["proficient", "attunement"].forEach(k => foundry.utils.deleteProperty(itemData.system, k));
    }

    /* @inheritDoc GMM groups items by `getSortingCategory()` rather than by inventory section, so a sort within e.g
 * "actions" should never reorder a "trait" relative to it */
    _onSortItem(event, item) {
        if (this.actor.isToken) return;
        const source = item;
        const siblings = this.actor.items.contents.filter((i) => {
            return (i.getSortingCategory() === source.getSortingCategory()) && (i.id !== source.id);
        });
        const dropTarget = event.target.closest(".item");
        const targetId = dropTarget ? dropTarget.dataset?.itemId : null;
        const target = siblings.find(s => s.id === targetId);
        if (target && (target.getSortingCategory() !== source.getSortingCategory())) return;

        const sortUpdates = foundry.utils.SortingHelpers.performIntegerSort(source, { target: target, siblings });
        const updateData = sortUpdates.map(u => {
            const update = u.update;
            update._id = u.target.id;
            return update;
        });

        return this.actor.updateEmbeddedDocuments("Item", updateData);
    }

    /* Add a new item to the monster: loot and spell paths create vanilla dnd5e items, while any other type
     * builds a GMM scaling-action item with a blueprint flag and the GMM activity. */
    static async #actionAddItem(event, target) {
        const type = target.dataset.type;

        if (type === "loot") {
            // Loot items are not GMM scaling actions; create a vanilla loot item.
            const itemData = {
                name: game.i18n.format("DND5E.ItemNew", { type: game.i18n.localize(CONFIG.Item.typeLabels[type]) }),
                type
            };
            return this.actor.createEmbeddedDocuments("Item", [itemData]);
        }

        if (type === "spell") {
            // Spells use the standard dnd5e spell sheet; they are non-scaling and not part of the GMM scaling-action system.
            const level = Number(target.dataset.level ?? 0) || 0;
            const preparationMode = target.dataset["preparation.mode"] || "prepared";
            let method = "spell";
            let prepared = 1;
            if (preparationMode === "always") {
                method = "spell";
                prepared = 2;
            } else if (preparationMode && preparationMode !== "prepared") {
                method = preparationMode;
                prepared = 0;
            }

            const itemData = {
                name: game.i18n.format("DND5E.ItemNew", { type: game.i18n.localize(CONFIG.Item.typeLabels.spell) }),
                type: "spell",
                system: { level, method, prepared }
            };
            return this.actor.createEmbeddedDocuments("Item", [itemData]);
        }

        const activationType = target.dataset["activation.type"] || "trait";

        // Build a minimal blueprint for the new item; the rest of the blueprint defaults
        // come from GMM_ACTION_BLUEPRINT during ActionBlueprint.createFromItem on prepare.
        const blueprint = {
            vid: 1,
            type: "action",
            data: {
                activation: {
                    cost: null,
                    // "trait" actions have no activation type; everything else uses the dataset value.
                    type: activationType === "trait" ? null : activationType,
                    condition: null
                },
                attack: {
                    type: null,
                    defense: "str",
                    bonus: null,
                    related_stat: "str"
                }
            }
        };

        const activityData = Activities.buildActivityData(blueprint);
        const itemData = {
            name: game.i18n.format(`gmm.monster.artifact.add.${activationType}`),
            type,
            img: "icons/svg/clockwork.svg",
            system: {
                activities: { [Activities.GMM_ACTIVITY_ID]: activityData }
            },
            // Nest the bound sheet under `flags.core.sheetClass`; a flat `"core.sheetClass"` key would not
            // resolve, because Foundry reads the bound sheet from `document.flags.core.sheetClass`.
            flags: {
                core: { sheetClass: `${GMM_MODULE_TITLE}.ActionSheet` },
                gmm: { blueprint }
            }
        };

        return this.actor.createEmbeddedDocuments("Item", [itemData]);
    }

    /** @this {MonsterSheet} */
    static #actionEditItem(event, target) {
        const li = target.closest(".item");
        const item = this.actor.items.get(li.dataset.itemId);
        item.sheet.render(true);
    }

    /** @this {MonsterSheet} */
    static #actionDeleteItem(event, target) {
        const li = target.closest(".item");
        return this.actor.deleteEmbeddedDocuments("Item", [li.dataset.itemId]);
    }

    /** @this {MonsterSheet} */
    static #actionRollItem(event, target) {
        const li = target.closest(".item");
        const item = this.actor.items.get(li.dataset.itemId);
        return item.use();
    }

    /** @this {MonsterSheet} */
    static async #actionDisplayItem(event, target) {
        const li = target.closest(".item");
        const item = this.actor.items.get(li.dataset.itemId);
        const msg = await item.displayCard({ createMessage: false });
        const DIV = document.createElement("DIV");
        DIV.innerHTML = msg.content;
        DIV.querySelector("div.card-buttons")?.remove();
        return ChatMessage.create({ content: DIV.innerHTML });
    }

    /** @this {MonsterSheet} */
    static #actionRechargeItem(event, target) {
        const li = target.closest(".item");
        const item = this.actor.items.get(li.dataset.itemId);
        if (!item) return;
        // GMM scaling-action items put recharge on the GMM activity; fall back to item-level uses, then to the legacy Item method.
        const activity = item.system?.activities?.get?.(Activities.GMM_ACTIVITY_ID);
        if (activity?.uses?.rollRecharge) return activity.uses.rollRecharge();
        if (item.system?.uses?.rollRecharge) return item.system.uses.rollRecharge();
        return item.rollRecharge?.();
    }

    /** @this {MonsterSheet} */
    static #actionCreateEffect(event, target) {
        const li = target.closest(".effect-section");
        const isEnchantment = li.dataset.effectType.startsWith("enchantment");
        return this.document.createEmbeddedDocuments("ActiveEffect", [{
            name: game.i18n.localize("DND5E.EffectNew"),
            img: "icons/svg/aura.svg",
            origin: isEnchantment ? undefined : this.document.uuid,
            "duration.rounds": li.dataset.effectType === "temporary" ? 1 : undefined,
            disabled: ["inactive", "enchantmentInactive"].includes(li.dataset.effectType),
            "flags.dnd5e.type": isEnchantment ? "enchantment" : undefined
        }]);
    }

    /* Toggle an item-effect between GMM "always" (transfers passively) and "onUse" (offered as
     * an Apply Effect button on the GMM activity's chat card). Resolves the effect's parent item
     * via the row's `data-parent-id` and delegates the storage update to Activities.setEffectMode.
     * @this {MonsterSheet} */
    static async #actionToggleEffectMode(event, target) {
        event?.preventDefault?.();
        const row = target.closest(".effect[data-effect-id]");
        const effectId = row?.dataset?.effectId;
        const parentId = row?.dataset?.parentId;
        if (!effectId || !parentId) return;
        const item = this.actor.items.get(parentId);
        const effect = item?.effects?.get?.(effectId);
        if (!item || !effect) return;
        const currentlyApplied = Activities.isEffectAppliedByGmmActivity(item, effectId);
        try {
            await Activities.setEffectMode(item, effect, currentlyApplied);
        } catch (e) {
            console.warn("GMM | MonsterSheet: setEffectMode failed", e);
        }
    }

    /* Open a Foundry FilePicker to choose an image for the field named in `target.dataset.editImage`, then write
     * the chosen path back to the document. Replaces the V1 sheet's inline `<img data-edit>` handling. */
    static #actionEditImage(event, target) {
        const field = target.dataset.editImage;
        if (!field) return;
        const current = foundry.utils.getProperty(this.document, field) ?? "";
        return new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current,
            callback: path => {
                const update = { [field]: path };
                // When writing into the GMM blueprint flag, also stamp the envelope's `vid` / `type`; without this
                // a fresh actor's `_verifyBlueprint` would see a missing `vid` on the next render.
                if (field.startsWith("flags.gmm.blueprint.")) {
                    update["flags.gmm.blueprint.vid"] = 1;
                    update["flags.gmm.blueprint.type"] = "monster";
                }

                if (field === "flags.gmm.blueprint.data.description.image") {
                    const currentActorImg = this.document.img ?? "";
                    const currentTokenImg = this.document.prototypeToken?.texture?.src
                        ?? this.document._source?.prototypeToken?.texture?.src
                        ?? "";
                    const tokenImageIsSynced = currentTokenImg === currentActorImg;
                    update.img = path;
                    if (tokenImageIsSynced) {
                        update["prototypeToken.texture.src"] = path;
                    }
                }
                return this.document.update(update);
            },
            top: this.position?.top ? this.position.top + 40 : null,
            left: this.position?.left ? this.position.left + 10 : null
        }).render({ force: true });
    }

    /** @this {MonsterSheet} */
    static async #actionRollHp(event, target) {
        const button = target.closest("button");
        const roll = new Roll(button.dataset.formula);
        await roll.roll();
        foundry.audio.AudioHelper.play({ src: CONFIG.sounds.dice });
        return this.actor.update({
            [`system.attributes.hp.value`]: Math.max(1, roll.total),
            [`system.attributes.hp.max`]: Math.max(1, roll.total),
            [`system.attributes.hp.effectiveMax`]: Math.max(1, roll.total),
            [`flags.gmm.blueprint.data.hit_points.rolled_max`]: Math.max(1, roll.total),
        });
    }

    _toggleItemDetails(event) {
        if (event.target.closest("button, input, a")) return;
        const item = event.currentTarget.closest(".item");
        item.classList.toggle("expanded");
    }

    _updateItem(event) {
        const input = event.currentTarget.closest("input");
        const field = input.dataset.field;
        const target = input.dataset.target;
        const value = event.currentTarget.value;
        const item = this.actor.items.get(target);
        if (!item) return;

        // `system.uses.value` is derived in dnd5e 5.x (max - spent); translate the entered "remaining"
        // count into the stored `spent`, on the GMM activity for actions or item-level uses for loot.
        if (field === "system.uses.value") {
            const activity = item.system?.activities?.get?.(Activities.GMM_ACTIVITY_ID);
            const uses = activity?.uses ?? item.system?.uses;
            const max = parseInt(uses?.max);
            const remaining = Math.max(0, parseInt(value) || 0);
            const spent = Number.isFinite(max) ? Math.max(0, max - remaining) : 0;
            const path = activity
                ? `system.activities.${Activities.GMM_ACTIVITY_ID}.uses.spent`
                : "system.uses.spent";
            return item.update({ [path]: spent });
        }

        return item.update({ [field]: value });
    }

    /* Sync the ability ranking inputs back to the blueprint flag after a `.move-up` / `.move-down` reorder.
     * Updates directly because Gui's reorder doesn't dispatch a `change` event to trigger the normal form submit. */
    _updateAbilityRanking(event) {
        const rankings = [];
        event.currentTarget.closest(".accordion-section__body")
            .querySelectorAll("[name='gmm.blueprint.ability_modifiers.ranking']")
            .forEach(x => rankings.push(x.value));
        return this.document.update({
            "flags.gmm.blueprint.data.ability_modifiers.ranking": rankings
        });
    }
}
