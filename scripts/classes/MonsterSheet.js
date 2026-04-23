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

/* GMM monster sheet, rebuilt on the dnd5e v5.x ApplicationV2 NPC sheet base The custom "Forge" UI lives entirely i...
 * Form submission is intercepted in {@link _processFormData} so that edits to the `gmm.blueprint.*` fields are tra */
export default class MonsterSheet extends dnd5e.applications.actor.NPCActorSheet {

    constructor(options = {}) {
        super(options);
        this._gui = new Gui();
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
            "roll-hp": MonsterSheet.#actionRollHp,
            "edit-image": MonsterSheet.#actionEditImage
        }
    };

    /* Replace the inherited NPC PARTS (header, sidebar, features, inventory, spells, effects, biography, specialTraits...
 * not merged across the inheritance chain, so this fully supplants the parent definition @inheritDoc */
    static PARTS = {
        forge: {
            template: "modules/giffyglyph-monster-maker-continued/templates/monster/forge.html",
            scrollable: [".forge__blueprint", ".forge__artifact"]
        }
    };

    /* The dnd5e NPC sheet inherits `static TABS` for its tab strip
 * clear it so the framework doesn't try to render a `tabs` part we never declare @inheritDoc */
    static TABS = [];

    /* Class names inherited from the dnd5e v5.x ApplicationV2 NPC sheet chain that apply heavy visual styling (parchme...
 * The GMM forge entirely replaces the dnd5e NPC PARTS markup, so none of these styles are wanted */
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
        return name ? `${name} - GMMC Scalar Monster` : "GMMC Scalar Monster";
    }

    /* -------------------------------------------- */
    /*  Rendering                                   */
    /* -------------------------------------------- */

    /** @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actorData = this.actor.flags;

        // Templates rendered via the V1 sheet expected `cssClass` to be supplied by the framework
        // ApplicationV2 doesn't populate it automatically, so provide an equivalent so the existing `forge--monster
        context.cssClass = this.isEditable ? "editable" : "locked";
        context.editable = this.isEditable;

        context.gmm = {
            blueprint: actorData.gmm?.blueprint ? actorData.gmm.blueprint.data : null,
            monster: actorData.gmm?.monster ? actorData.gmm.monster.data : null,
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
        } catch (e) {
            console.warn("GMM | MonsterSheet: _prepareEffectsContext failed", e);
        }

        return context;
    }

    /* -------------------------------------------- */

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

    /* -------------------------------------------- */
    /*  Inherited dnd5e helpers we deliberately disable                                */
    /* -------------------------------------------- */

    /* The dnd5e NPC sheet's `_onRender` invokes three helpers that decorate the stock `inventory`, `attunement`, and `...
 * Our {@link MonsterSheet.PARTS} replaces all of those with the single custom `forge` part, so the helpers' `this */
    _renderCreateInventory() {}
    _renderAttunement() {}
    _renderSpellbook() {}

    /* Suppress the dnd5e "mode slider" (`<slide-toggle class="mode-slider">`) that `PrimarySheet5e#_renderModeToggle`...
 * GMM's Forge UI is always editable and exposes its own controls */
    _renderModeToggle() {
        const toggle = this.element?.querySelector(".window-header .mode-slider");
        if (toggle) toggle.remove();
    }

    /* Suppress the dnd5e "create child" footer button (gold "+" appended to `.window-content` by `PrimarySheet5e#_onFi...
 * The Forge UI provides its own per-section "Add" buttons, and dnd5e's button has no meaning here: */
    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this.element?.querySelector(".window-content > .create-child")?.remove();
    }

    /* -------------------------------------------- */
    /*  Event Listeners                             */
    /* -------------------------------------------- */

    /** @inheritDoc */
    async _onRender(context, options) {
        await super._onRender(context, options);

        // Rich text editors are `<prose-mirror>` web components in the templates; they self-initialize.

        // Bridge the GMM Gui controller and modal helpers (which still use jQuery) to the V2 root element
        // `this.element` is the form created by DocumentSheetV2 (`tag:
        const $el = $(this.element);
        try {
            this._gui.activateListeners($el);
            this._gui.applyTo($el);
        } catch (e) {
            console.warn("GMM | MonsterSheet: Gui.activateListeners failed", e);
        }

        try {
            $el.find('.ability-ranking .move-up, .ability-ranking .move-down').click(this._updateAbilityRanking.bind(this));
            $el.find('.save-ranking .move-up, .save-ranking .move-down').click(this._updateSaveRanking.bind(this));
            $el.find('.monster__panels .accordion-section__title').click((e) => e.stopPropagation());
            $el.find('.item .item__recharge button').click((e) => e.stopPropagation());
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

    /* -------------------------------------------- */
    /*  Form Submission                             */
    /* -------------------------------------------- */

    /* @inheritDoc Skip the auto-submit when an input inside a `.gmm-modal` changes
 * modal forms commit their own state via their roll buttons and should never trigger a sheet update by themselves */
    _onChangeForm(formConfig, event) {
        if (event?.target?.closest?.(".gmm-modal")) return;
        return super._onChangeForm(formConfig, event);
    }

    /* @inheritDoc Replaces the V1 `_updateObject`
 * The form fields use dotted names like `gmm.blueprint.combat.rank.type` */
    _processFormData(event, form, formData) {
        // V14 ApplicationV2 puts the application root in a `<form>` element, and the forge template embeds GMM modals (abi...
        // Their named radios/selects (`ability`, `mode`, `bonus`, …) would otherwise be picked up by FormDataExtended on e
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

            $.extend(true, expanded, MonsterBlueprint.getActorDataFromBlueprint(expanded.flags.gmm.blueprint));

            const nextName = expanded.name;
            const currentActorName = this.actor.name ?? "";
            const currentPrototypeName = this.actor.prototypeToken?.name ?? this.actor._source?.prototypeToken?.name ?? "";
            const tokenNameIsSynced = currentPrototypeName === currentActorName;
            if ((typeof nextName === "string") && nextName.trim() && (nextName !== currentActorName) && tokenNameIsSynced) {
                expanded["prototypeToken.name"] = nextName;
            }
        }

        return expanded;
    }

    /* -------------------------------------------- */
    /*  Drag & Drop                                 */
    /* -------------------------------------------- */

    /* @inheritDoc Extend the dnd5e default reset (which already strips `attuned`, `equipped`, `prepared`, `crew.value`...
 * already strips `attuned`, `equipped`, `prepared`, `crew.value`) with the GMM-specific fields the V1 sheet stripped */
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

    /* -------------------------------------------- */
    /*  Action Handlers                             */
    /* -------------------------------------------- */

    /* Handle adding a new item (loot, spell, or scaling action) to the monster Three paths:
 * **loot** → vanilla dnd5e loot item **spell** → vanilla dnd5e spell item using the standard dnd5e spell sheet (no */
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
            // Spells use the standard dnd5e spell sheet
            // they represent the monster having access to non-scaling spells from dnd5e and aren't part of the GMM scaling-act
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
            // Nest the bound sheet under `flags.core.sheetClass`:
            // a literal `"core.sheetClass"` key would never resolve because Foundry reads the bound sheet at `document.flags.c
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

    /* Recharge an item @this {MonsterSheet} */
    static #actionRechargeItem(event, target) {
        const li = target.closest(".item");
        const item = this.actor.items.get(li.dataset.itemId);
        if (!item) return;
        // GMM scaling-action items put their recharge on the GMM-managed activity, not at the item level, so try the activ...
        // Fall back to item-level uses (for items that scope recharge at the item level), and finally to the legacy `Item5
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
                // If we're writing into the GMM blueprint flag, also stamp the envelope's `vid` / `type` so a fresh actor that has...
                // Without this, `_verifyBlueprint` sees a missing `vid` on the next render
                if (field.startsWith("flags.gmm.blueprint.")) {
                    update["flags.gmm.blueprint.vid"] = 1;
                    update["flags.gmm.blueprint.type"] = "monster";
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

    /* -------------------------------------------- */
    /*  Helpers (instance methods bound from _onRender) */
    /* -------------------------------------------- */

    _toggleItemDetails(event) {
        const item = event.currentTarget.closest(".item");
        item.classList.toggle("expanded");
    }

    _updateItem(event) {
        const input = event.currentTarget.closest("input");
        const field = input.dataset.field;
        const target = input.dataset.target;
        const value = event.currentTarget.value;
        return this.actor.updateEmbeddedDocuments("Item", [{ _id: target, [field]: value }]);
    }

    /* Sync the ability ranking inputs back to the blueprint flag after the user reorders them via the `.move-up` / `.m...
 * Bypasses {@link _processFormData} because Gui's reorder doesn't dispatch a `change` event and the rankings only */
    _updateAbilityRanking(event) {
        const rankings = [];
        event.currentTarget.closest(".accordion-section__body")
            .querySelectorAll("[name='gmm.blueprint.ability_modifiers.ranking']")
            .forEach(x => rankings.push(x.value));
        return this.document.update({
            "flags.gmm.blueprint.data.ability_modifiers.ranking": rankings
        });
    }

    _updateSaveRanking(event) {
        const rankings = [];
        event.currentTarget.closest(".accordion-section__body")
            .querySelectorAll("[name='gmm.blueprint.saving_throws.ranking']")
            .forEach(x => rankings.push(x.value));
        return this.document.update({
            "flags.gmm.blueprint.data.saving_throws.ranking": rankings
        });
    }
}
