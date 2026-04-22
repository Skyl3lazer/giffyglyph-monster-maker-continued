import Shortcoder from "./Shortcoder.js";

/**
 * Helpers for translating between GMM scaling-action blueprints and the dnd5e v5.x
 * Activity data model.
 *
 * Each GMM scaling action item owns at most ONE Activity, identified by the stable id
 * {@link GMM_ACTIVITY_ID}. The blueprint (stored in `flags.gmm.blueprint.data`) remains
 * the user-authored source of truth; this module mirrors the blueprint's relevant fields
 * onto the activity at form-submission time, and substitutes monster-derived shortcodes
 * into the runtime activity formulas during the owning monster's prepareDerivedData step
 * so that dnd5e's native roll pipeline sees fully-resolved formulas.
 */
const Activities = (function () {

    /**
     * Stable id for the GMM-managed Activity on a scaling action item. Built via
     * {@link dnd5e.utils.staticID} when available so it matches the deterministic
     * 16-character format dnd5e uses for known IDs ("gmmprimary000000").
     * @type {string}
     */
    const GMM_ACTIVITY_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmprimary")
        : "gmmprimary000000";

    /**
     * Map from the GMM blueprint `attack.type` ↔ the dnd5e attack-activity attack.type pair.
     * @type {Object<string, {value: "melee"|"ranged", classification: "weapon"|"spell"}>}
     */
    const ATTACK_TYPES = {
        mwak: { value: "melee", classification: "weapon" },
        msak: { value: "melee", classification: "spell" },
        rwak: { value: "ranged", classification: "weapon" },
        rsak: { value: "ranged", classification: "spell" }
    };

    /* -------------------------------------------- */
    /*  Type Resolution                             */
    /* -------------------------------------------- */

    /**
     * Resolve which dnd5e activity type best represents a blueprint `attack.type` value.
     * @param {string|null|undefined} blueprintAttackType
     * @returns {"attack"|"save"|"damage"|"utility"}
     */
    function activityTypeFor(blueprintAttackType) {
        if (blueprintAttackType in ATTACK_TYPES) return "attack";
        if (blueprintAttackType === "save") return "save";
        if (blueprintAttackType === "other") return "damage";
        return "utility";
    }

    /**
     * @param {object} blueprintAttack  The blueprint's `attack` subtree.
     * @returns {string}
     */
    function actionTypeForBlueprint(blueprintAttack) {
        return blueprintAttack?.type ?? "";
    }

    /* -------------------------------------------- */
    /*  Damage Part Translation                     */
    /* -------------------------------------------- */

    /**
     * Translate a single GMM blueprint damage entry to a dnd5e DamageData payload.
     *
     * Blueprint damage entries are `{formula, type}` where `formula` may contain GMM
     * shortcodes (e.g. `[strMod + 2, d6]`). Those shortcodes are valid only after
     * {@link Shortcoder.replaceShortcodes} runs against an owning monster, so we always
     * persist the raw formula in `custom.formula` and let {@link resolveActivityFormulas}
     * substitute at prepareDerivedData time.
     *
     * @param {{formula: string, type: string}} entry
     * @returns {object}  Activity damage part data suitable for `system.activities.<id>.damage.parts`.
     */
    function damagePartFromBlueprint(entry) {
        const formula = entry?.formula ?? "";
        const type = entry?.type ?? "";
        const part = {
            number: null,
            denomination: null,
            bonus: "",
            types: type ? [type] : [],
            custom: { enabled: true, formula },
            scaling: { mode: "", number: 1, formula: "" }
        };

        // If the formula is a plain `NdM(+X)` literal with no shortcodes, store it in the
        // structured fields so dnd5e's UI can edit it natively if the user ever opens the
        // stock item sheet.
        const parsed = formula.match(/^\s*(\d+)d(\d+)(?:\s*([+\-])\s*(\d+))?\s*$/i);
        if (parsed && CONFIG?.DND5E?.dieSteps?.includes?.(Number(parsed[2]))) {
            part.number = Number(parsed[1]);
            part.denomination = Number(parsed[2]);
            part.bonus = parsed[4] ? (parsed[3] === "-" ? `-${parsed[4]}` : parsed[4]) : "";
            part.custom.enabled = false;
            part.custom.formula = "";
        }

        return part;
    }

    /**
     * Translate a dnd5e DamageData (or its raw object form) back into a GMM blueprint entry.
     * @param {object} part
     * @returns {{formula: string, type: string}}
     */
    function damagePartToBlueprint(part) {
        if (!part) return { formula: "", type: "" };

        let formula = "";
        if (part.custom?.enabled && part.custom.formula) {
            formula = part.custom.formula;
        } else if (part.number && part.denomination) {
            formula = `${part.number}d${part.denomination}`;
            if (part.bonus) {
                const bonus = String(part.bonus).trim();
                if (bonus.startsWith("-")) formula += ` - ${bonus.slice(1)}`;
                else if (bonus.startsWith("+")) formula += ` + ${bonus.slice(1)}`;
                else formula += ` + ${bonus}`;
            }
        } else if (part.bonus) {
            formula = String(part.bonus);
        }

        const types = part.types instanceof Set ? Array.from(part.types) : (Array.isArray(part.types) ? part.types : []);
        return { formula, type: types[0] ?? "" };
    }

    /* -------------------------------------------- */
    /*  Build Activity Payload                      */
    /* -------------------------------------------- */

    /**
     * Build the dnd5e activity payload for the GMM-managed activity on a scaling action item.
     * The result is suitable for direct use as the value of `system.activities.<GMM_ACTIVITY_ID>`
     * inside an `Item5e#update` call (or as data passed to `Item5e#createActivity`).
     *
     * Formulas keep their GMM shortcode markers; runtime substitution happens in
     * {@link resolveActivityFormulas}.
     *
     * @param {object} blueprint  The full blueprint object (`{vid, type, data}`) or just its `data`.
     * @returns {object}  Activity creation payload including `_id`, `type`, etc.
     */
    function buildActivityData(blueprint) {
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        const blueprintAttack = blueprintData.attack ?? {};
        const type = activityTypeFor(blueprintAttack.type);

        const data = {
            _id: GMM_ACTIVITY_ID,
            type,
            name: blueprintData.description?.name || "",
            sort: 0,
            activation: _buildActivation(blueprintData),
            consumption: _buildConsumption(blueprintData),
            description: { chatFlavor: "" },
            duration: _buildDuration(blueprintData),
            range: _buildRange(blueprintData),
            target: _buildTarget(blueprintData),
            uses: _buildUses(blueprintData)
        };

        const damageParts = _collectDamageParts(blueprintData);

        if (type === "attack") {
            data.attack = {
                ability: blueprintAttack.related_stat || "",
                bonus: blueprintAttack.bonus || "",
                critical: { threshold: null },
                // Suppress dnd5e's automatic mod/prof/actorBonus injection; the GMM monster
                // bonus (already monster-level-derived) is added by the preRollAttackV2 hook.
                flat: true,
                type: ATTACK_TYPES[blueprintAttack.type]
            };
            data.damage = {
                critical: { bonus: "" },
                includeBase: false,
                parts: damageParts
            };
        } else if (type === "save") {
            data.save = {
                ability: [blueprintAttack.defense || "str"],
                dc: {
                    calculation: "",
                    formula: _buildSaveDcFormula(blueprintData)
                }
            };
            data.damage = {
                onSave: "half",
                parts: damageParts
            };
        } else if (type === "damage") {
            data.damage = {
                parts: damageParts
            };
        }
        // utility activities carry no extra fields

        return data;
    }

    /* -------------------------------------------- */

    function _buildActivation(blueprintData) {
        const a = blueprintData.activation ?? {};
        return {
            type: a.type ?? "",
            value: a.cost ?? null,
            condition: a.condition ?? "",
            override: false
        };
    }

    function _buildDuration(blueprintData) {
        const d = blueprintData.duration ?? {};
        const concentration = !!blueprintData.properties?.concentration?.checked;
        return {
            value: d.value ?? null,
            units: d.units || "inst",
            concentration,
            special: "",
            override: false
        };
    }

    function _buildRange(blueprintData) {
        const r = blueprintData.range ?? {};
        return {
            value: r.value ?? null,
            units: r.units ?? "",
            special: "",
            override: false
        };
    }

    function _buildTarget(blueprintData) {
        const t = blueprintData.target ?? {};
        const data = {
            template: {
                count: "",
                contiguous: false,
                stationary: false,
                type: "",
                size: "",
                width: "",
                height: "",
                units: t.units || "ft"
            },
            affects: {
                count: "",
                type: "",
                choice: false,
                special: ""
            },
            prompt: true,
            override: false
        };
        if (t.type && CONFIG?.DND5E?.areaTargetTypes?.[t.type]) {
            data.template.type = t.type;
            if (t.value != null) data.template.size = String(t.value);
            if (t.width != null) data.template.width = String(t.width);
        } else if (t.type) {
            if (t.value != null) data.affects.count = String(t.value);
            data.affects.type = t.type;
        }
        return data;
    }

    function _buildUses(blueprintData) {
        const recovery = [];
        const recharge = blueprintData.recharge ?? {};
        const uses = blueprintData.uses ?? {};
        if (recharge.value) {
            recovery.push({
                period: "recharge",
                type: "recoverAll",
                formula: String(recharge.value)
            });
        } else if (uses.per) {
            recovery.push({
                period: uses.per,
                type: "recoverAll",
                formula: ""
            });
        }

        let max = "";
        if (uses.max != null && uses.max !== "") max = String(uses.max);
        else if (uses.maximum != null && uses.maximum !== "") max = String(uses.maximum);
        else if (recharge.value) max = "1";

        let spent = 0;
        if (recharge.value) {
            spent = recharge.is_charged ? 0 : 1;
        } else if (max && uses.value != null && uses.value !== "") {
            const m = parseInt(max);
            const v = parseInt(uses.value);
            if (Number.isFinite(m) && Number.isFinite(v)) spent = Math.max(0, m - v);
        }

        return { spent, max, recovery };
    }

    function _buildConsumption(blueprintData) {
        const rc = blueprintData.resource_consumption ?? {};
        const empty = { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false };
        if (!rc.type) return empty;
        // GMM "ammo" consumption is wired through the dnd5e v5 AttackActivity ammunition
        // pipeline (see {@link injectAmmunition} called from the `dnd5e.preRollAttackV2`
        // hook), not through the activity's `consumption.targets[]`. Including it here
        // would double-decrement the ammo: once at activity-use time via the standard
        // material consumption flow, and again at attack-roll time via dnd5e's own
        // ammo-quantity decrement after the d20 is rolled.
        if (rc.type === "ammo") return empty;
        const typeMap = {
            attribute: "attribute",
            material: "material",
            charges: "itemUses",
            hitDice: "hitDice"
        };
        return {
            targets: [{
                type: typeMap[rc.type] ?? "itemUses",
                target: rc.target ?? "",
                value: String(rc.amount ?? 1),
                scaling: { mode: "", formula: "" }
            }],
            scaling: { allowed: false, max: "" },
            spellSlot: false
        };
    }

    function _buildSaveDcFormula(blueprintData) {
        const a = blueprintData.attack ?? {};
        const parts = ["[dcPrimaryBonus]"];
        if (a.bonus) parts.push(String(a.bonus));
        if (a.related_stat) parts.push(`[${a.related_stat}Mod]`);
        return parts.join(" + ");
    }

    function _collectDamageParts(blueprintData) {
        const arr = blueprintData.attack?.hit?.damage;
        if (!arr || !arr.length) return [];
        return arr.map(damagePartFromBlueprint);
    }

    /* -------------------------------------------- */
    /*  Read Direction                              */
    /* -------------------------------------------- */

    /**
     * Mirror the values from a dnd5e Activity onto a GMM blueprint object. Mutates
     * `blueprintData` in place. Callers are expected to invoke this *after* loading the
     * stored blueprint flag, so user-authored fields the activity doesn't carry (rarity,
     * deferral, requirements, display, …) are preserved.
     *
     * @param {object} activity       The Activity instance (or its `.toObject()` equivalent).
     * @param {object} blueprintData  The blueprint's `data` subtree to mutate.
     */
    function readActivityIntoBlueprintData(activity, blueprintData) {
        if (!activity) return;
        const obj = (typeof activity.toObject === "function") ? activity.toObject() : activity;
        const type = obj.type;

        // Activation
        if (obj.activation) {
            blueprintData.activation ??= {};
            blueprintData.activation.type = obj.activation.type ?? null;
            blueprintData.activation.cost = obj.activation.value ?? null;
            blueprintData.activation.condition = obj.activation.condition ?? null;
        }

        // Duration
        if (obj.duration) {
            blueprintData.duration ??= {};
            blueprintData.duration.value = obj.duration.value ?? "";
            blueprintData.duration.units = obj.duration.units ?? "";
            blueprintData.properties ??= { concentration: { checked: false } };
            blueprintData.properties.concentration ??= { checked: false };
            blueprintData.properties.concentration.checked = !!obj.duration.concentration;
        }

        // Range
        if (obj.range) {
            blueprintData.range ??= {};
            blueprintData.range.value = obj.range.value ?? null;
            blueprintData.range.units = obj.range.units ?? null;
        }

        // Target
        if (obj.target) {
            blueprintData.target ??= {};
            const tpl = obj.target.template ?? {};
            const aff = obj.target.affects ?? {};
            if (tpl.type) {
                blueprintData.target.type = tpl.type;
                blueprintData.target.value = tpl.size ? Number(tpl.size) : null;
                blueprintData.target.width = tpl.width ? Number(tpl.width) : null;
                blueprintData.target.units = tpl.units ?? null;
            } else {
                blueprintData.target.type = aff.type ?? null;
                blueprintData.target.value = aff.count ? Number(aff.count) : null;
                blueprintData.target.units = tpl.units ?? null;
                blueprintData.target.width = null;
            }
        }

        // Uses
        if (obj.uses) {
            blueprintData.uses ??= {};
            blueprintData.uses.max = obj.uses.max ?? "";
            const max = parseInt(obj.uses.max);
            const spent = parseInt(obj.uses.spent ?? 0);
            blueprintData.uses.value = (Number.isFinite(max) && Number.isFinite(spent)) ? Math.max(0, max - spent) : "";
            const rechargeRecovery = obj.uses.recovery?.find?.(r => r.period === "recharge");
            if (rechargeRecovery) {
                blueprintData.recharge ??= { value: null, is_charged: false };
                const v = parseInt(rechargeRecovery.formula);
                blueprintData.recharge.value = Number.isFinite(v) ? v : null;
                blueprintData.recharge.is_charged = (spent === 0);
                blueprintData.uses.per = "";
            } else {
                blueprintData.recharge ??= { value: null, is_charged: false };
                blueprintData.recharge.value = null;
                const otherRecovery = obj.uses.recovery?.[0];
                blueprintData.uses.per = otherRecovery?.period ?? "";
            }
        }

        // Consumption
        if (obj.consumption?.targets?.length) {
            const tgt = obj.consumption.targets[0];
            blueprintData.resource_consumption ??= {};
            const reverseTypeMap = {
                attribute: "attribute",
                material: "material",
                itemUses: "charges",
                hitDice: "hitDice"
            };
            blueprintData.resource_consumption.type = reverseTypeMap[tgt.type] ?? tgt.type ?? null;
            blueprintData.resource_consumption.target = tgt.target ?? null;
            blueprintData.resource_consumption.amount = tgt.value ? Number(tgt.value) : null;
        }

        // Type-specific
        blueprintData.attack ??= {};
        if (type === "attack" && obj.attack) {
            const attackTypeKey = _findAttackTypeKey(obj.attack.type);
            if (attackTypeKey) blueprintData.attack.type = attackTypeKey;
            blueprintData.attack.bonus = obj.attack.bonus ?? null;
            blueprintData.attack.related_stat = obj.attack.ability ?? "str";
        } else if (type === "save" && obj.save) {
            blueprintData.attack.type = "save";
            const ability = obj.save.ability instanceof Set ? obj.save.ability.first()
                : Array.isArray(obj.save.ability) ? obj.save.ability[0]
                    : obj.save.ability;
            blueprintData.attack.defense = ability ?? "str";
        } else if (type === "damage") {
            blueprintData.attack.type = "other";
        }

        // Damage parts
        if (obj.damage?.parts?.length) {
            blueprintData.attack.hit ??= {};
            blueprintData.attack.hit.damage = obj.damage.parts.map(damagePartToBlueprint);
            const first = blueprintData.attack.hit.damage[0];
            if (first) {
                blueprintData.attack.damage = { formula: first.formula, type: first.type };
            }
        }
    }

    function _findAttackTypeKey({ value, classification } = {}) {
        for (const [key, cfg] of Object.entries(ATTACK_TYPES)) {
            if (cfg.value === value && cfg.classification === classification) return key;
        }
        return null;
    }

    /* -------------------------------------------- */
    /*  Update Payload Helpers                      */
    /* -------------------------------------------- */

    /**
     * Build a flat path update payload for the GMM activity, suitable for merging directly
     * into an `Item5e#update` call. If the existing activity on the item has a different
     * type than the one we want to write, we additionally include a `-=<id>` deletion key
     * so dnd5e drops the prior activity before installing the new one (the `type` field is
     * `readOnly: true` on the activity schema, so types can't be swapped in place).
     *
     * The returned payload uses dotted-path keys so it can be merged with form data via
     * `foundry.utils.mergeObject`/`$.extend` without colliding with nested `system.*`
     * structures from the form.
     *
     * @param {Item5e|null} item  The item being updated, or null if we're creating fresh.
     * @param {object} blueprint  The full blueprint object the activity should mirror.
     * @returns {object}          Flat update payload like `{ "system.activities.<id>": {...} }`.
     */
    function buildActivityUpdate(item, blueprint) {
        const newData = buildActivityData(blueprint);
        const existing = item?.system?.activities?.get?.(GMM_ACTIVITY_ID);
        const update = {};
        if (existing && existing.type !== newData.type) {
            // Drop the prior activity in the same update so the type swap is atomic.
            update[`system.activities.-=${GMM_ACTIVITY_ID}`] = null;
        }
        update[`system.activities.${GMM_ACTIVITY_ID}`] = newData;
        return update;
    }

    /* -------------------------------------------- */
    /*  Runtime Shortcoder Substitution             */
    /* -------------------------------------------- */

    /**
     * Substitute GMM shortcodes (e.g. `[strMod + 2, d6]`) into the runtime values of the
     * GMM-managed activity on an item, using the supplied monster artifact. Mutates the
     * activity's prepared data in memory only; the underlying `_source` retains the
     * symbolic shortcoded formulas so subsequent prepareData cycles re-resolve against
     * fresh monster numbers.
     *
     * Also recomputes `save.dc.value` from the resolved DC formula. The activity's own
     * `prepareFinalData` already ran during the earlier item-level `prepareData`, but at
     * that point the formula still contained `[dcPrimaryBonus]` literals which
     * `simplifyBonus` silently treats as zero, so we need to update the value here once
     * the formula is numeric.
     *
     * @param {Item5e} item                The owning item.
     * @param {object} monsterData         The monster artifact's `.data` (from `actor.flags.gmm.monster.data`).
     */
    function resolveActivityFormulas(item, monsterData) {
        if (!monsterData) return;
        const activity = item?.system?.activities?.get?.(GMM_ACTIVITY_ID);
        if (!activity) return;

        // Attack bonus
        if (activity.attack && typeof activity.attack.bonus === "string" && activity.attack.bonus.includes("[")) {
            activity.attack.bonus = Shortcoder.replaceShortcodes(activity.attack.bonus, monsterData);
        }

        // Save DC formula + value
        if (activity.save?.dc) {
            if (typeof activity.save.dc.formula === "string" && activity.save.dc.formula.includes("[")) {
                activity.save.dc.formula = Shortcoder.replaceShortcodes(activity.save.dc.formula, monsterData);
            }
            // Re-derive save.dc.value now that the formula is numeric. Using a fresh
            // Roll keeps us consistent with how dnd5e itself simplifies the formula
            // during prepareFinalData (`simplifyBonus`), but lets us run after the
            // monster artifact is available rather than before it.
            try {
                const formula = activity.save.dc.formula || "0";
                const dcRoll = new Roll(String(formula));
                if (dcRoll.isDeterministic) {
                    const total = dcRoll.evaluateSync().total;
                    if (Number.isFinite(total)) activity.save.dc.value = total;
                }
            } catch (e) { /* swallow: keep whatever value the framework already computed */ }
        }

        // Damage parts
        if (activity.damage?.parts?.length) {
            for (const part of activity.damage.parts) {
                if (part.custom?.enabled && typeof part.custom.formula === "string" && part.custom.formula.includes("[")) {
                    part.custom.formula = Shortcoder.replaceShortcodes(part.custom.formula, monsterData, true);
                }
            }
        }
    }

    /* -------------------------------------------- */
    /*  Roll Hook Helpers                           */
    /* -------------------------------------------- */

    /**
     * Inject the GMM monster's standard attack bonus and (optional) ability mod into the
     * roll configuration for a pending attack roll. Called from the `dnd5e.preRollAttackV2`
     * hook listener registered in {@link GmmItem.patchItem5e}.
     *
     * The activity is configured with `attack.flat = true` so that dnd5e contributes only
     * the per-action `attack.bonus`; this helper supplies the monster-derived `@gmm.*`
     * pieces the V1 implementation used to bake in via libWrapper.
     *
     * @param {object} rollConfig          The pre-roll configuration object passed to the hook.
     * @param {Activity} activity          The activity whose attack is being rolled.
     * @param {object} monsterData         The owning monster's artifact data.
     */
    function injectAttackBonusParts(rollConfig, activity, monsterData) {
        if (!rollConfig?.rolls?.length || !monsterData) return;
        const roll = rollConfig.rolls[0];
        roll.parts ??= [];
        roll.data ??= {};
        const monsterBonus = monsterData.attack_bonus?.value;
        if (Number.isFinite(monsterBonus)) {
            roll.parts.push("@gmm.monsterBonus");
            roll.data.gmm = { ...(roll.data.gmm ?? {}), monsterBonus };
        }
        const relatedStat = activity?._source?.attack?.ability || activity?.attack?.ability;
        if (relatedStat && monsterData.ability_modifiers?.[relatedStat]) {
            const abilityMod = monsterData.ability_modifiers[relatedStat].value;
            if (Number.isFinite(abilityMod)) {
                roll.parts.push("@gmm.abilityMod");
                roll.data.gmm = { ...(roll.data.gmm ?? {}), abilityMod };
            }
        }
    }

    /**
     * Wire a GMM scaling action's blueprint-configured ammunition into the dnd5e v5
     * AttackActivity flow at attack-roll time.
     *
     * Why a hook rather than `activity.consumption.targets[]`: dnd5e v5 only exposes
     * ammunition mechanics for **weapon** items via `WeaponData#ammunitionOptions`.
     * GMM scaling actions are `feat`-type items, so the standard ammunition picker is
     * never populated and no quantity decrement happens. We patch around that here:
     *
     *   - We populate `dialogConfig.options.ammunitionOptions` with every ammo-type
     *     consumable on the actor, mirroring the format `WeaponData#ammunitionOptions`
     *     would produce. This makes the dialog show a working ammo picker.
     *   - We seed `rollConfig.ammunition` with the GMM-configured target (the user's
     *     pick from the GMM Forge consumption picker). `_buildAttackConfig` will
     *     forward whichever value the user selects in the dialog (or the default we
     *     just set if they don't override) into the roll's options.
     *   - dnd5e's existing post-roll ammunition logic in `AttackActivity#rollAttack`
     *     then decrements the ammo's quantity and stamps the chosen ammo id onto the
     *     attack chat message, so the follow-up damage button automatically picks it
     *     up via `lastAttack.getFlag("dnd5e", "roll.ammunition")`.
     *   - The chosen ammo's magical bonus is added to both the attack and damage
     *     rolls separately by the `dnd5e.postBuildAttackRollConfig` and
     *     `dnd5e.postBuildDamageRollConfig` listeners (which call
     *     {@link injectAmmoMagicPart}). dnd5e's own ammo-magic injection in
     *     `AttackActivityData#getAttackData` and `_processDamagePart` is gated on
     *     `attack.flat = false` and `item.type === "weapon"` respectively, neither
     *     of which is true for GMM scaling actions.
     *
     * @param {object} rollConfig    The rollConfig the `dnd5e.preRollAttackV2` hook is mutating.
     * @param {object} dialogConfig  The dialogConfig the same hook is mutating.
     * @param {Activity} activity    The activity whose attack is being rolled (rollConfig.subject).
     */
    function injectAmmunition(rollConfig, dialogConfig, activity) {
        const item = activity?.item;
        const actor = activity?.actor;
        if (!item || !actor) return;

        const blueprint = item.flags?.gmm?.blueprint?.data;
        if (blueprint?.resource_consumption?.type !== "ammo") return;

        const targetAmmoId = blueprint.resource_consumption.target;
        if (!targetAmmoId) return;

        // Build the picker options from every ammo-type consumable on the actor.
        // Same shape WeaponData#ammunitionOptions emits (item / value / label /
        // disabled), so AttackRollConfigurationDialog renders it natively.
        const ammoOptions = (actor.itemTypes?.consumable ?? [])
            .filter(i => i.system?.type?.value === "ammo")
            .map(i => ({
                item: i,
                value: i.id,
                label: `${i.name} (${i.system.quantity ?? 0})`,
                disabled: !i.system.quantity
            }))
            .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

        if (!ammoOptions.length) return;

        dialogConfig.options ??= {};
        dialogConfig.options.ammunitionOptions = [{ value: "", label: "" }, ...ammoOptions];

        // Default to the GMM-configured ammo unless dnd5e already cached a different
        // pick on the item via `setFlag("dnd5e", "last.<id>.ammunition")` and that
        // value is still a valid option, in which case the AttackActivity already
        // selected it before we got here.
        if (!rollConfig.ammunition || !ammoOptions.some(o => o.value === rollConfig.ammunition)) {
            rollConfig.ammunition = targetAmmoId;
        }

        // Mirror onto rolls[0].options.ammunition so the post-roll quantity decrement
        // and the chat-card "Damage" button (which reads
        // `lastAttack.getFlag("dnd5e", "roll.ammunition")`) both pick it up.
        // `_buildAttackConfig` will overwrite this if the user picks a different ammo
        // in the dialog, which is exactly what we want.
        const roll = rollConfig.rolls?.[0];
        if (roll) {
            roll.options ??= {};
            if (!roll.options.ammunition) roll.options.ammunition = rollConfig.ammunition;
        }
    }

    /**
     * Compute the resolved magical bonus the chosen ammunition contributes to attack
     * and damage rolls, mirroring dnd5e's `weapon.magicAvailable` gating.
     *
     * @param {Item5e|null} ammo
     * @param {object} [rollData={}]
     * @returns {number}  Resolved numeric bonus, or 0 if the ammo isn't magic-available
     *                    or has no magical bonus.
     */
    function ammunitionMagicBonus(ammo, rollData = {}) {
        if (!ammo?.system?.magicAvailable) return 0;
        const formula = ammo.system.magicalBonus;
        if (!formula) return 0;
        const simplify = dnd5e?.utils?.simplifyBonus;
        if (typeof simplify !== "function") return 0;
        return simplify(formula, rollData) || 0;
    }

    /**
     * Inject the chosen ammunition's `magicalBonus` into a per-roll config under a
     * GMM-namespaced data key (`@gmm.ammoBonus`). Used from both the
     * `dnd5e.postBuildAttackRollConfig` and `dnd5e.postBuildDamageRollConfig` hooks
     * because GMM activities run with `attack.flat = true`, which causes
     * `AttackActivityData#getAttackData` and the weapon-only branch of
     * `_processDamagePart` to skip dnd5e's own `@ammoBonus` injection.
     *
     * @param {object} config             The per-roll config from the postBuild hook.
     * @param {Item5e|null} ammo          The chosen ammunition item, if any.
     */
    function injectAmmoMagicPart(config, ammo) {
        if (!ammo) return;
        config.data ??= {};
        const bonus = ammunitionMagicBonus(ammo, config.data);
        if (!bonus) return;
        config.parts ??= [];
        config.parts.push("@gmm.ammoBonus");
        config.data.gmm = { ...(config.data.gmm ?? {}), ammoBonus: bonus };
    }

    /**
     * Defensive shortcoder pass for damage rolls. The activity formulas have already been
     * resolved during prepareDerivedData, but a roll triggered before the owning monster
     * has been fully prepared (or against a stale runtime mutation) might still carry
     * `[shortcode]` markers. This catches those edge cases right before the dice are built.
     *
     * @param {object} rollConfig
     * @param {object} monsterData
     */
    function resolveDamageRollFormulas(rollConfig, monsterData) {
        if (!rollConfig?.rolls?.length || !monsterData) return;
        for (const roll of rollConfig.rolls) {
            if (!Array.isArray(roll.parts)) continue;
            for (let i = 0; i < roll.parts.length; i++) {
                const p = roll.parts[i];
                if (typeof p === "string" && p.includes("[")) {
                    roll.parts[i] = Shortcoder.replaceShortcodes(p, monsterData, true);
                }
            }
        }
    }

    /* -------------------------------------------- */

    /* -------------------------------------------- */
    /*  Migration                                   */
    /* -------------------------------------------- */

    /**
     * Determine whether an item is a GMM scaling-action item that needs the
     * GMM-managed activity to be (re)created.
     * @param {Item5e} item
     * @returns {boolean}
     */
    function isLegacyGmmActionItem(item) {
        if (!item) return false;
        // Items the user explicitly opted into the GMM ActionSheet.
        const sheetClass = item.flags?.core?.sheetClass;
        if (typeof sheetClass !== "string") return false;
        if (!sheetClass.endsWith(".ActionSheet")) return false;
        // Only items that already have a GMM blueprint flag are candidates; items added
        // via the new MonsterSheet#actionAddItem path already include the activity in
        // their initial creation payload.
        return !!item.flags?.gmm?.blueprint;
    }

    /**
     * Build the migration update payload for a single GMM scaling-action item, returning
     * `null` if no migration is needed (the activity already exists).
     *
     * @param {Item5e} item
     * @returns {object|null}  An update payload suitable for `Item5e#update`, or null.
     */
    function buildMigrationUpdate(item) {
        if (!isLegacyGmmActionItem(item)) return null;
        if (item.system?.activities?.has?.(GMM_ACTIVITY_ID)) return null;
        const blueprint = item.flags.gmm.blueprint;
        return buildActivityUpdate(null, blueprint);
    }

    /**
     * Migrate every GMM scaling-action item on a single actor that lacks the
     * GMM-managed activity. Returns the count of items migrated.
     *
     * @param {Actor5e} actor
     * @returns {Promise<number>}
     */
    async function migrateActor(actor) {
        if (!actor?.items?.size) return 0;
        const updates = [];
        for (const item of actor.items) {
            const update = buildMigrationUpdate(item);
            if (update) updates.push({ _id: item.id, ...update });
        }
        if (!updates.length) return 0;
        await actor.updateEmbeddedDocuments("Item", updates);
        return updates.length;
    }

    /**
     * Walk every world actor + every world item the current user is permitted to
     * modify and migrate any GMM scaling-action item that lacks the GMM-managed
     * activity. Should be called once during the `ready` hook on the GM client.
     *
     * @returns {Promise<number>}  Total items migrated across the world.
     */
    async function migrateWorld() {
        let total = 0;

        // World actors
        for (const actor of (game.actors ?? [])) {
            if (!actor.isOwner) continue;
            try {
                total += await migrateActor(actor);
            } catch (e) {
                console.warn(`GMM | Activity migration failed for actor ${actor.name} (${actor.id})`, e);
            }
        }

        // World items (unowned scaling actions in the items sidebar)
        const itemUpdates = [];
        for (const item of (game.items ?? [])) {
            if (!item.isOwner) continue;
            const update = buildMigrationUpdate(item);
            if (update) itemUpdates.push({ ...update, _id: item.id });
        }
        if (itemUpdates.length) {
            try {
                // World Items collection accepts updates via Item.updateDocuments
                await Item.updateDocuments(itemUpdates);
                total += itemUpdates.length;
            } catch (e) {
                console.warn(`GMM | Activity migration failed for unowned items`, e);
            }
        }

        if (total > 0) {
            console.log(`GMM | Migrated ${total} scaling-action item(s) onto the dnd5e v5.x activity model.`);
        }
        return total;
    }

    /* -------------------------------------------- */

    return {
        GMM_ACTIVITY_ID,
        ATTACK_TYPES,
        activityTypeFor,
        actionTypeForBlueprint,
        damagePartFromBlueprint,
        damagePartToBlueprint,
        buildActivityData,
        buildActivityUpdate,
        readActivityIntoBlueprintData,
        resolveActivityFormulas,
        injectAttackBonusParts,
        injectAmmunition,
        ammunitionMagicBonus,
        injectAmmoMagicPart,
        resolveDamageRollFormulas,
        isLegacyGmmActionItem,
        buildMigrationUpdate,
        migrateActor,
        migrateWorld
    };
})();

export default Activities;
