import ActionBlueprint from './ActionBlueprint.js';
import Activities from './Activities.js';
import Shortcoder from './Shortcoder.js';
import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';
import CompatibilityHelpers from "./CompatibilityHelpers.js";
import { formatTargetLabel, formatRangeLabel } from "./Labels.js";


const GmmItem = (function () {
    function simplifyRollFormula(...args) {
        return dnd5e.dice.simplifyRollFormula(...args);
    }

    function _safeWrap(target, fn, type) {
        try {
            libWrapper.register('giffyglyph-monster-maker-continued', target, fn, type);
            return true;
        } catch (error) {
            console[game.modules.get('lib-wrapper')?.active ? "error" : "warn"](`GMM | libWrapper hook for "${target}" was not registered: ${error.message}`);
            return false;
        }
    }

    /* Patch the Foundry Item5e entity to track GMM scaling-action state and wire the activity-aware roll hooks. */
    function patchItem5e() {
        // Maintain the runtime `flags.gmm.blueprint` snapshot whenever the item prepares its data.
        // The blueprint is rebuilt from the item document so it always matches the current item state.
        _safeWrap('game.dnd5e.documents.Item5e.prototype.prepareData', function (wrapped, ...args) {
            wrapped(...args);
            if (this.getSheetId() == `${GMM_MODULE_TITLE}.ActionSheet`) {
                try {
                    const itemData = this.flags;
                    const actionBlueprint = ActionBlueprint.createFromItem(this);
                    itemData.gmm = {
                        blueprint: actionBlueprint
                    };
                } catch (error) {
                    console.error(error);
                }
            }
        }, 'WRAPPER');

        // Cache references to the original prototype methods only when they actually exist;
        // several were removed when their behaviour migrated to Activity classes.
        const Item5eProto = game.dnd5e.documents.Item5e.prototype;
        if (typeof Item5eProto.prepareData === "function") Item5eProto.prepare5eData = Item5eProto.prepareData;

        // GMM-specific helpers exposed on every Item5e instance.
        Item5eProto.prepareShortcodes = _prepareShortcodes;
        Item5eProto.getSheetId = _getItemSheetId;
        Item5eProto.getGmmActionBlueprint = _getGmmActionBlueprint;
        Item5eProto.isOwnedByGmmMonster = _isOwnedByGmmMonster;
        Item5eProto.getOwningGmmMonster = _getOwningGmmMonster;
        Item5eProto.getSortingCategory = _getSortingCategory;
        Item5eProto.getGmmLabels = _getGmmLabels;

        // Activity-aware roll hooks. These are persistent listeners (not libWrapper
        // wraps) and replace the old prototype hooks on `Item5e.{getAttackToHit,...}`.
        Hooks.on("dnd5e.preRollAttackV2", _onPreRollAttack);
        Hooks.on("dnd5e.preRollDamageV2", _onPreRollDamage);
        Hooks.on("dnd5e.preUseActivity", _onPreUseActivity);

        // postBuild hooks fire after the per-roll configuration object has been produced.
        // We use them to add the GMM-namespaced ammunition magical bonus, since GMM activities run with `attack.flat = true`.
        Hooks.on("dnd5e.postBuildAttackRollConfig", _onPostBuildAttackConfig);
        Hooks.on("dnd5e.postBuildDamageRollConfig", _onPostBuildDamageConfig);
    }

    function _isOwnedByGmmMonster() {
        return this.actor && this.actor.type == "npc" && (this.actor.getSheetId?.() == `${GMM_MODULE_TITLE}.MonsterSheet`);
    }

    function _getGmmActionBlueprint() {
        return this.flags.gmm?.blueprint?.data;
    }

    function _getOwningGmmMonster() {
        return this.actor?.flags?.gmm?.monster?.data;
    }

    function _getItemSheetId() {
        try {
            return this.getFlag("core", "sheetClass") || game.settings.get("core", "sheetClasses").Item[this.type];
        } catch (error) {
            return "";
        }
    }

    function _isGmmActionItem(item) {
        return item?.getSheetId?.() === `${GMM_MODULE_TITLE}.ActionSheet`;
    }

    function _prepareShortcodes() {
        if (!_isGmmActionItem(this)) return;
        const gmmMonster = this.getOwningGmmMonster();
        if (!gmmMonster) return;
        if (this.system?.description?.value) {
            // Pass `this` so item-scoped shortcodes (e.g. `[target]`) can resolve from the
            // owning blueprint's target/range/etc. — monster-only shortcodes are unaffected.
            this.system.description.value = Shortcoder.replaceShortcodes(this.system.description.value, gmmMonster, false, this);
        }
        Activities.resolveActivityFormulas(this, gmmMonster);
    }

    function _onPreRollAttack(rollConfig, dialogConfig, _messageConfig) {
        const activity = rollConfig?.subject;
        const monsterData = _gmmMonsterForActivity(activity);
        if (!monsterData) return;
        Activities.injectAttackBonusParts(rollConfig, activity, monsterData);
        Activities.injectAmmunition(rollConfig, dialogConfig, activity);
    }

    function _onPreRollDamage(rollConfig, _dialogConfig, _messageConfig) {
        const activity = rollConfig?.subject;
        const monsterData = _gmmMonsterForActivity(activity);
        if (!monsterData) return;

        // Save activities build their chat save buttons from `activity.save.dc.value`.
        // Ensure DC is resolved before the usage/chat message is created.
        if (activity?.type === "save") {
            _computeAndApplySaveDc(activity, monsterData, rollConfig);
        }

        Activities.resolveDamageRollFormulas(rollConfig, monsterData);
    }


    /* `dnd5e.preUseActivity` listener
 * Ensure save chat cards are built with a resolved non-zero DC before button datasets are generated. */
    function _onPreUseActivity(activity, _usageConfig, _dialogConfig, _messageConfig) {
        try {
            if (activity?.id !== Activities.GMM_ACTIVITY_ID) return;
            if (activity?.type !== "save") return;
            const item = activity.item;
            if (!_isGmmActionItem(item)) return;
            const monsterData = item.getOwningGmmMonster?.();
            if (!monsterData) return;
            _computeAndApplySaveDc(activity, monsterData, null);
        } catch (e) {
            console.warn("GMM | preUseActivity save DC normalize failed", e);
        }
    }

    function _gmmMonsterForActivity(activity) {
        if (!activity || activity.id !== Activities.GMM_ACTIVITY_ID) return null;
        const item = activity.item;
        if (!_isGmmActionItem(item)) return null;
        return item.getOwningGmmMonster?.() ?? null;
    }

    function _computeAndApplySaveDc(activity, monsterData, rollConfig = null) {
        if (!activity?.save?.dc || !monsterData) return null;

        const item = activity.item;

        // Refresh runtime values from blueprint first.
        try {
            Activities.resolveActivityFormulas(item, monsterData);
        } catch (e) { /* swallow */ }

        let finalDc = Number(activity.save.dc.value);

        // Fallback: derive DC directly from blueprint shortcodes.
        if (!Number.isFinite(finalDc) || finalDc <= 0) {
            const bp = item?.flags?.gmm?.blueprint?.data;
            const a = bp?.attack ?? {};
            const parts = ["[dcPrimaryBonus]"];
            if (a.bonus) parts.push(String(a.bonus));
            if (a.related_stat) parts.push(`[${a.related_stat}Mod]`);
            const resolved = Shortcoder.replaceShortcodes(parts.join(" + "), monsterData);
            try {
                const dcRoll = new Roll(String(resolved || "0"));
                if (dcRoll.isDeterministic) {
                    const total = dcRoll.evaluateSync().total;
                    if (Number.isFinite(total) && total > 0) finalDc = total;
                }
            } catch (e) { /* swallow */ }
        }

        if (!Number.isFinite(finalDc) || finalDc <= 0) return null;

        activity.save.dc.value = finalDc;
        if (!activity.save.dc.formula || activity.save.dc.formula === "0") {
            activity.save.dc.formula = String(finalDc);
        }

        // No _source write: resolveActivityFormulas() rebuilds save.dc from the blueprint on every
        // data prep, so persisting the resolved formula onto the in-memory source here is redundant.

        // For target save roll prompts, force the live roll target/options.
        if (rollConfig) {
            rollConfig.target = finalDc;
            if (Array.isArray(rollConfig.rolls)) {
                for (const r of rollConfig.rolls) {
                    r.options ??= {};
                    r.options.target = finalDc;
                }
            }
        }

        return finalDc;
    }
    function _isGmmAttackActivity(activity) {
        if (activity?.id !== Activities.GMM_ACTIVITY_ID) return false;
        if (activity?.type !== "attack") return false;
        return _isGmmActionItem(activity.item);
    }

    /* `dnd5e.postBuildAttackRollConfig` listener.
     * The per-roll `config.options.ammunition` carries whichever ammo the user picked in the attack-roll dialog. */
    function _onPostBuildAttackConfig(process, config, index, _options = {}) {
        if (index !== 0) return;
        const activity = process?.subject;
        if (!_isGmmAttackActivity(activity)) return;
        const ammoId = config?.options?.ammunition;
        if (!ammoId) return;
        const ammo = activity.actor?.items.get(ammoId);
        Activities.injectAmmoMagicPart(config, ammo);
    }

    /* `dnd5e.postBuildDamageRollConfig` listener.
     * The damage roll passes the chosen ammunition as an `Item5e` instance through `process.ammunition`. */
    function _onPostBuildDamageConfig(process, config, index, _options = {}) {
        if (index !== 0) return;
        const activity = process?.subject;
        if (!_isGmmAttackActivity(activity)) return;
        const ammo = process?.ammunition;
        Activities.injectAmmoMagicPart(config, ammo);
    }

    function _getSortingCategory() {
        if (this.getSheetId() == `${GMM_MODULE_TITLE}.ActionSheet`) {
            const gmmActionBlueprint = this.getGmmActionBlueprint();
            if (gmmActionBlueprint) {
                switch (gmmActionBlueprint.activation?.type) {
                    case "action":
                    case "crew":
                    case "minute":
                    case "hour":
                    case "day":
                    case "special":
                        return "action";
                    case "bonus":
                    case "reaction":
                    case "lair":
                    case "legendary":
                        return gmmActionBlueprint.activation.type;
                    default:
                        return "trait";
                }
            } else {
                return "trait";
            }
        } else {
            switch (this.type) {
                case "spell":
                    return "spell";
                case "weapon":
                case "feat": {
                    // dnd5e v5+ no longer carries `system.activation` on the item itself for most types
                    // the activation lives on each activity
                    const activations = this.system?.activities?.contents?.map(a => a.activation?.type).filter(_ => _) ?? [];
                    const primaryActivation = activations[0];
                    if (primaryActivation) {
                        switch (primaryActivation) {
                            case "bonus": return "bonus";
                            case "reaction": return "reaction";
                            case "lair": return "lair";
                            case "legendary": return "legendary";
                            default: return "action";
                        }
                    } else if (this.type == "weapon") {
                        return "loot";
                    } else {
                        return "trait";
                    }
                }
                case "class":
                    return "trait";
                default:
                    return "loot";
            }
        }
    }

    /* Build the label bag used by the GMM monster sheet's action/trait partials.
     * Fields derive from the item's GMM activity, plus the GMM blueprint flag for GMM-only concepts like rarity. */
    async function _getGmmLabels() {
        const labels = {};
        const blueprint = this.flags?.gmm?.blueprint?.data;
        const gmmMonster = this.getOwningGmmMonster();
        const activity = this.system?.activities?.get?.(Activities.GMM_ACTIVITY_ID);

        labels.icon = (this.getSheetId() == `${GMM_MODULE_TITLE}.ActionSheet`)
            ? "fas fa-arrow-alt-circle-right"
            : "far fa-arrow-alt-circle-right";

        // Roll data is shared across the to-hit, save DC, and damage formula lookups.
        const rollData = this.getRollData();

        // --- Damage / healing parts (resolved up-front so we can detect healing & build the line) ---
        // HealActivity stores a single `healing` DamageData instead of `damage.parts`.
        const damageParts = activity?.damage?.parts ?? [];
        const healingPart = activity?.healing ?? null;
        const blueprintAttackType = blueprint?.attack?.type ?? "";
        const isHealingAction = (blueprintAttackType === "heal") || !!healingPart || _hasHealingPart(damageParts);

        // --- Attack / Save line ---
        if (activity?.type === "attack") {
            labels.attack = game.i18n.format(`gmm.action.labels.attack.${blueprintAttackType || "mwak"}`);
            const toHit = _computeAttackToHit(activity, blueprint, gmmMonster, rollData);
            if (toHit !== null) {
                labels.to_hit = game.i18n.format(`gmm.action.labels.attack.to_hit`, { bonus: _formatSignedBonus(toHit) });
            }
        } else if (activity?.type === "save") {
            labels.attack = _formatSaveLabel(activity);
            const dc = activity.save?.dc?.value;
            if (dc) {
                labels.to_hit = game.i18n.format(`gmm.action.labels.attack.dc`, { bonus: dc });
            }
        } else if (blueprintAttackType) {
            labels.attack = game.i18n.format(`gmm.common.attack_type.${blueprintAttackType}`);
        }

        // Damage / healing line
        // HealActivity uses `activity.healing` (single DamageData), others use `activity.damage.parts[]`.
        const blueprintDamageRaw = blueprint?.attack?.hit?.damage;
        const blueprintDamage = Array.isArray(blueprintDamageRaw)
            ? blueprintDamageRaw
            : (blueprintDamageRaw && typeof blueprintDamageRaw === "object")
                ? Object.keys(blueprintDamageRaw)
                    .filter(k => /^\d+$/.test(k))
                    .sort((a, b) => Number(a) - Number(b))
                    .map(k => blueprintDamageRaw[k])
                : [];

        if (healingPart) {
            const label = _formatDamagePart(healingPart, gmmMonster, rollData, blueprintDamage[0]?.formula);
            if (label) labels.damage_hit = label;
        } else if (damageParts.length) {
            labels.damage_hit = damageParts
                .map((part, idx) => _formatDamagePart(part, gmmMonster, rollData, blueprintDamage[idx]?.formula))
                .filter(_ => _)
                .join(" plus ");
        }

        // --- Activation condition ---
        const condition = activity?.activation?.condition ?? blueprint?.activation?.condition ?? "";
        labels.condition = gmmMonster ? Shortcoder.replaceShortcodes(condition, gmmMonster, false, this) : condition;

        // --- Duration / concentration / healing ---
        labels.duration = activity?.labels?.duration ?? this.labels?.duration ?? "";
        labels.isHealing = isHealingAction || !!this.isHealing;
        labels.isConcentration = !!activity?.duration?.concentration;

        // Versatile / miss damage (GMM-only blueprint fields preserved across the migration)
        if (blueprint?.attack?.versatile?.damage) {
            const v = blueprint.attack.versatile.damage;
            labels.damage_versatile = `${gmmMonster ? Shortcoder.replaceShortcodes(v, gmmMonster, true, this) : v} damage`;
        }
        if (blueprint?.attack?.miss?.damage) {
            const m = blueprint.attack.miss.damage;
            labels.damage_miss = `${gmmMonster ? Shortcoder.replaceShortcodes(m, gmmMonster, true, this) : m} damage`;
        }

        // --- Rarity ---
        labels.bpRarity = blueprint?.rarity ?? "";
        switch (blueprint?.rarity) {
            case "default":
            case "common":
                labels.rarity = game.i18n.format(`gmm.common.rarity.common`);
                break;
            case "uncommon":
                labels.rarity = game.i18n.format(`gmm.common.rarity.uncommon`);
                break;
            case "rare":
                labels.rarity = game.i18n.format(`gmm.common.rarity.rare`);
                break;
        }

        // --- Range ---
        const range = blueprint?.range ?? activity?.range ?? {};
        labels.range = formatRangeLabel(range, blueprintAttackType);

        // --- Target (read from blueprint, since the GMM target i18n catalog is richer
        // than dnd5e's; the blueprint stays in sync with activity.target via ActionBlueprint).
        const target = blueprint?.target ?? {};
        labels.target = formatTargetLabel(target, range);

        // --- Description ---
        try {
            const desc = await this.getChatData({ secrets: this.actor?.isOwner });
            const descValue = (typeof desc?.description === "string")
                ? desc.description
                : (desc?.description?.value ?? this.system?.description?.value ?? blueprint?.description?.text ?? "");
            labels.description = gmmMonster ? Shortcoder.replaceShortcodes(descValue, gmmMonster, false, this) : descValue;
        } catch (e) {
            labels.description = "";
        }

        // --- Uses / recharge ---
        const uses = activity?.uses ?? this.system?.uses;
        if (uses && (uses.max || uses.spent !== undefined)) {
            const max = parseInt(uses.max);
            const spent = parseInt(uses.spent ?? 0);
            const value = (Number.isFinite(max) && Number.isFinite(spent)) ? Math.max(0, max - spent) : null;
            const recovery = uses.recovery?.find?.(r => r.period && r.period !== "recharge");
            if (max && recovery) {
                labels.uses = { current: value, maximum: max, per: recovery.period };
            }
        }

        // --- Deferral (GMM-only) ---
        const gmmDeferral = blueprint?.deferral;
        if (gmmDeferral?.type) {
            labels.deferral = {
                type: game.i18n.format(`gmm.common.deferral_type.${gmmDeferral.type}`),
                timer: gmmDeferral.timer,
                respite: gmmDeferral.respite
            };
        }

        // --- Recharge ---
        const recharge = uses?.recovery?.find?.(r => r.period === "recharge");
        if (recharge) {
            const v = parseInt(recharge.formula);
            labels.recharge = {
                value: Number.isFinite(v) && v < 6 ? `${v}-6` : (Number.isFinite(v) ? `${v}` : recharge.formula),
                charged: (parseInt(uses.spent ?? 0) === 0)
            };
        } else {
            labels.recharge = null;
        }

        // --- Activation / legendary cost ---
        const activation = activity?.activation;
        if (activation?.type) {
            labels.activation = activity?.labels?.activation ?? this.labels?.activation ?? "";
            if (activation.type === "legendary" && activation.value > 1) {
                labels.legendary_cost = activation.value;
            }
        }

        return labels;
    }

    /* Compute the GMM-displayed to-hit bonus from the monster's attack bonus, the related-stat ability mod,
     * and the activity's attack.bonus formula. Mirrors what Activities.injectAttackBonusParts contributes at roll time. */
    function _computeAttackToHit(activity, blueprint, monsterData, rollData = {}) {
        if (!monsterData) return null;
        let total = monsterData.attack_bonus?.value ?? 0;

        const relatedStat = blueprint?.attack?.related_stat || activity?.attack?.ability;
        if (relatedStat && monsterData.ability_modifiers?.[relatedStat]) {
            total += monsterData.ability_modifiers[relatedStat].value ?? 0;
        }

        const bonusFormula = activity?.attack?.bonus;
        if (bonusFormula) {
            // Use dnd5e.utils.simplifyBonus when available — it builds a Roll with the full rollData so `@gmm.foo`-style
            // references resolve. Falls back to bare numeric coercion otherwise.
            const simplifyBonus = dnd5e?.utils?.simplifyBonus;
            try {
                const resolved = (typeof simplifyBonus === "function")
                    ? simplifyBonus(bonusFormula, rollData)
                    : Number(simplifyRollFormula(String(bonusFormula)));
                if (Number.isFinite(resolved)) total += resolved;
            } catch (e) { /* ignore simplification failures */ }
        }

        return total;
    }

    /* Build the "<Ability> Saving Throw" label for a SaveActivity, handling the single-ability, multi-ability, and no-ability cases.
     * Multi-ability uses the locale's disjunction list formatter (e.g., "Strength or Dexterity Saving Throw"). */
    function _formatSaveLabel(activity) {
        const raw = activity.save?.ability;
        const abilities = raw instanceof Set ? Array.from(raw)
            : Array.isArray(raw) ? Array.from(raw)
                : (raw ? [raw] : []);
        if (abilities.length === 1) {
            return game.i18n.format(`gmm.action.labels.attack.${abilities[0]}`);
        }
        if (abilities.length > 1) {
            const formatter = game.i18n.getListFormatter({ style: "short", type: "disjunction" });
            const names = abilities.map(a => CONFIG.DND5E?.abilities?.[a]?.label ?? a);
            return `${formatter.format(names)} ${game.i18n.localize("DND5E.SavingThrow")}`;
        }
        return game.i18n.localize("DND5E.SavingThrow");
    }

    /* Format a single damage part as a label string
 * Healing parts read "1d6 healing" damage parts read "1d6 + 2 fire damage" */
    function _formatDamagePart(part, monsterData, rollData, rawBlueprintFormula) {
        const formula = _resolvePartFormula(part, monsterData, rollData, rawBlueprintFormula);
        if (!formula) return "";
        const types = part.types instanceof Set ? Array.from(part.types)
            : Array.isArray(part.types) ? part.types : [];
        const type = types[0];
        if (!type) return `${formula} damage`;
        const typeLabel = _localizeDamageType(type);
        return _isHealingType(type)
            ? `${formula} ${typeLabel.toLowerCase()}`
            : `${formula} ${typeLabel.toLowerCase()} damage`;
    }

    function _localizeDamageType(type) {
        const dnd = CONFIG.DND5E?.damageTypes?.[type]?.label
            ?? CONFIG.DND5E?.healingTypes?.[type]?.label;
        if (dnd) return game.i18n.localize(dnd);
        // Legacy GMM-only types (e.g., "physical") and any custom types.
        return game.i18n.localize(`gmm.common.damage.${type}`);
    }

    function _isHealingType(type) {
        return !!(type && CONFIG.DND5E?.healingTypes?.[type]);
    }

    function _hasHealingPart(damageParts) {
        if (!damageParts?.length) return false;
        return damageParts.some(part => {
            const types = part.types instanceof Set ? Array.from(part.types)
                : Array.isArray(part.types) ? part.types : [];
            return types.some(_isHealingType);
        });
    }

    /* Resolve a single damage part to a display formula, preferring the authored shortcoded blueprint
     * formula, then the part's own formula, then its custom formula, then number/denomination + bonus. */
    function _resolvePartFormula(part, monsterData, rollData, rawBlueprintFormula) {
        let formula = "";
        try {
            // Prefer the authored shortcoded formula from the blueprint flag when it still carries `[shortcode]` markers
            // (e.g. the standalone action-sheet preview, where `resolveActivityFormulas` hasn't run yet).
            if (typeof rawBlueprintFormula === "string" && rawBlueprintFormula.includes("[")) {
                formula = rawBlueprintFormula;
            } else if (typeof part?.formula === "string" && part.formula) {
                formula = part.formula;
            } else if (part?.custom?.enabled) {
                formula = part.custom.formula ?? "";
            } else if (part?.number && part?.denomination) {
                formula = `${part.number}d${part.denomination}`;
                if (part.bonus) {
                    const bonus = String(part.bonus).trim();
                    formula += bonus.startsWith("-") ? ` - ${bonus.slice(1)}` : ` + ${bonus}`;
                }
            } else if (part?.bonus) {
                formula = String(part.bonus);
            }
        } catch (e) { /* fall through to empty */ }
        if (!formula) return "";

        if (formula.includes("[") && monsterData) {
            formula = Shortcoder.replaceShortcodes(formula, monsterData, true);
        }
        try {
            const replaced = CompatibilityHelpers.replaceFormulaData(formula, rollData);
            return simplifyRollFormula(replaced).trim() || formula;
        } catch (e) {
            return formula;
        }
    }

    function _formatSignedBonus(n) {
        const r = Math.round(n);
        // Return a plain signed string rather than dnd5e's `utils.formatModifier`, which returns a
        // `Handlebars.SafeString` containing `<span class="sign">+</span>` markup that renders wrong here.
        return (r >= 0) ? `+${r}` : `${r}`;
    }

    return {
        patchItem5e: patchItem5e
    };
})();

export default GmmItem;
