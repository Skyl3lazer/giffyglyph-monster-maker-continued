import Shortcoder from "./Shortcoder.js";

/* Helpers for translating between GMM scaling-action blueprints and the dnd5e v5.x Activity data model.
 * The blueprint (stored in `flags.gmm.blueprint.data`) remains the user-authored source of truth. */
const Activities = (function () {

    /* Stable id for the GMM-managed activity; uses dnd5e.utils.staticID for the deterministic 16-char format. */
    const GMM_ACTIVITY_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmprimary")
        : "gmmprimary000000";

    /* Map from GMM blueprint `attack.type` to the dnd5e attack-activity `attack.type` pair ({value, classification}). */
    const ATTACK_TYPES = {
        mwak: { value: "melee", classification: "weapon" },
        msak: { value: "melee", classification: "spell" },
        rwak: { value: "ranged", classification: "weapon" },
        rsak: { value: "ranged", classification: "spell" }
    };

    /* Map a blueprint `attack.type` to a dnd5e activity type. `other` -> `damage` (not `utility`) so damage parts have a home. */
    function activityTypeFor(blueprintAttackType) {
        if (blueprintAttackType in ATTACK_TYPES) return "attack";
        if (blueprintAttackType === "save") return "save";
        if (blueprintAttackType === "heal") return "heal";
        if (blueprintAttackType === "other") return "damage";
        return "utility";
    }

    /* Translate a GMM blueprint damage entry (`{formula, type}`) to a dnd5e DamageData payload. */
    function damagePartFromBlueprint(entry) {
        const formula = entry?.formula ?? "";
        const type = entry?.type ?? "";
        const part = {
            number: null,
            denomination: null,
            bonus: "",
            types: type ? [type] : [],
            // FormulaField builds a Roll from this and rejects `[`, so sanitise shortcodes before storage.
            custom: { enabled: true, formula: _sanitizeFormulaForActivity(formula) },
            scaling: { mode: "", number: 1, formula: "" }
        };

        // Plain `NdM(+X)` literals go in the structured fields so dnd5e's stock sheet can edit them natively.
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

    /* Strip GMM shortcodes (`[…]`) to `0` so a formula passes dnd5e's FormulaField validation. */
    function _sanitizeFormulaForActivity(formula) {
        if (typeof formula !== "string" || !formula.includes("[")) return formula ?? "";
        return formula.replace(/\[[^\]]*\]/g, "0");
    }

    /* Replace shortcode-bearing FormulaField strings on the GMM activity source with `0` placeholders (mutates in place). */
    function sanitizeActivitySource(value) {
        if (!value || typeof value !== "object") return value;
        // Only touch GMM's own activity — the swap would corrupt other modules' bracketed formulas (e.g. `1d6[fire]`).
        if (value._id !== GMM_ACTIVITY_ID) return value;
        const replace = _sanitizeFormulaForActivity;

        if (value.attack && typeof value.attack === "object") {
            value.attack.bonus = replace(value.attack.bonus);
        }
        if (value.save?.dc && typeof value.save.dc === "object") {
            value.save.dc.formula = replace(value.save.dc.formula);
        }
        if (value.healing && typeof value.healing === "object") {
            if (value.healing.custom && typeof value.healing.custom === "object") {
                value.healing.custom.formula = replace(value.healing.custom.formula);
            }
            value.healing.bonus = replace(value.healing.bonus);
        }
        if (value.damage && typeof value.damage === "object") {
            if (value.damage.critical && typeof value.damage.critical === "object") {
                value.damage.critical.bonus = replace(value.damage.critical.bonus);
            }
            if (Array.isArray(value.damage.parts)) {
                for (const p of value.damage.parts) {
                    if (!p || typeof p !== "object") continue;
                    if (p.custom && typeof p.custom === "object") {
                        p.custom.formula = replace(p.custom.formula);
                    }
                    p.bonus = replace(p.bonus);
                }
            }
        }
        if (value.consumption && typeof value.consumption === "object") {
            if (value.consumption.scaling && typeof value.consumption.scaling === "object") {
                value.consumption.scaling.formula = replace(value.consumption.scaling.formula);
            }
            if (Array.isArray(value.consumption.targets)) {
                for (const t of value.consumption.targets) {
                    if (!t || typeof t !== "object") continue;
                    t.value = replace(t.value);
                }
            }
        }
        if (value.range && typeof value.range === "object") {
            value.range.value = replace(value.range.value);
            value.range.long = replace(value.range.long);
            value.range.special = replace(value.range.special);
        }
        if (value.duration && typeof value.duration === "object") {
            value.duration.value = replace(value.duration.value);
        }
        if (value.target?.template && typeof value.target.template === "object") {
            const tpl = value.target.template;
            tpl.size = replace(tpl.size);
            tpl.width = replace(tpl.width);
            tpl.height = replace(tpl.height);
        }
        if (value.uses && typeof value.uses === "object") {
            value.uses.max = replace(value.uses.max);
            if (Array.isArray(value.uses.recovery)) {
                for (const r of value.uses.recovery) {
                    if (!r || typeof r !== "object") continue;
                    r.formula = replace(r.formula);
                }
            }
        }
        return value;
    }

    /* Patch dnd5e ActivityField to sanitise formulas pre-validation. Idempotent; false if ActivityField is unavailable. */
    function patchActivityField() {
        const ActivityField = globalThis.dnd5e?.dataModels?.fields?.ActivityField;
        if (!ActivityField) return false;
        if (ActivityField.prototype.__gmmPatched) return true;

        const origCleanType = ActivityField.prototype._cleanType;
        ActivityField.prototype._cleanType = function(value, options, _state) {
            sanitizeActivitySource(value);
            return origCleanType.call(this, value, options, _state);
        };

        const origInitialize = ActivityField.prototype.initialize;
        ActivityField.prototype.initialize = function(value, model, options = {}) {
            sanitizeActivitySource(value);
            return origInitialize.call(this, value, model, options);
        };

        Object.defineProperty(ActivityField.prototype, "__gmmPatched", {
            value: true, writable: false, configurable: false, enumerable: false
        });

        // Base getActionLabel() fallback so stale non-attack activities don't throw during chat render.
        const BaseActivityData = globalThis.dnd5e?.dataModels?.activity?.BaseActivityData;
        if (BaseActivityData && !("getActionLabel" in BaseActivityData.prototype)) {
            BaseActivityData.prototype.getActionLabel = function(_attackMode) { return ""; };
        }

        return true;
    }

    /* Build flat updates to sanitise bad persisted activity formulas; null when no cleanup is needed. */
    function buildSourceFormulaCleanup(item) {
        const activities = item?._source?.system?.activities;
        if (!activities || typeof activities !== "object") return null;
        const update = {};
        const replace = _sanitizeFormulaForActivity;

        const set = (path, oldVal, newVal) => {
            if (oldVal === newVal) return;
            update[path] = newVal;
        };

        for (const [aid, raw] of Object.entries(activities)) {
            if (!raw || typeof raw !== "object" || aid.startsWith("-=")) continue;
            const base = `system.activities.${aid}`;

            if (raw.attack && typeof raw.attack.bonus === "string") {
                set(`${base}.attack.bonus`, raw.attack.bonus, replace(raw.attack.bonus));
            }
            if (raw.save?.dc && typeof raw.save.dc.formula === "string") {
                set(`${base}.save.dc.formula`, raw.save.dc.formula, replace(raw.save.dc.formula));
            }
            if (raw.healing) {
                if (raw.healing.custom && typeof raw.healing.custom.formula === "string") {
                    set(`${base}.healing.custom.formula`, raw.healing.custom.formula, replace(raw.healing.custom.formula));
                }
                if (typeof raw.healing.bonus === "string") {
                    set(`${base}.healing.bonus`, raw.healing.bonus, replace(raw.healing.bonus));
                }
            }
            if (raw.damage) {
                if (raw.damage.critical && typeof raw.damage.critical.bonus === "string") {
                    set(`${base}.damage.critical.bonus`, raw.damage.critical.bonus, replace(raw.damage.critical.bonus));
                }
                if (Array.isArray(raw.damage.parts)) {
                    for (let i = 0; i < raw.damage.parts.length; i++) {
                        const p = raw.damage.parts[i];
                        if (!p) continue;
                        if (p.custom && typeof p.custom.formula === "string") {
                            set(`${base}.damage.parts.${i}.custom.formula`, p.custom.formula, replace(p.custom.formula));
                        }
                        if (typeof p.bonus === "string") {
                            set(`${base}.damage.parts.${i}.bonus`, p.bonus, replace(p.bonus));
                        }
                    }
                }
            }
            if (raw.consumption) {
                if (raw.consumption.scaling && typeof raw.consumption.scaling.formula === "string") {
                    set(`${base}.consumption.scaling.formula`, raw.consumption.scaling.formula, replace(raw.consumption.scaling.formula));
                }
                if (Array.isArray(raw.consumption.targets)) {
                    for (let i = 0; i < raw.consumption.targets.length; i++) {
                        const t = raw.consumption.targets[i];
                        if (t && typeof t.value === "string") {
                            set(`${base}.consumption.targets.${i}.value`, t.value, replace(t.value));
                        }
                    }
                }
            }
            if (raw.range) {
                if (typeof raw.range.value === "string") set(`${base}.range.value`, raw.range.value, replace(raw.range.value));
                if (typeof raw.range.long === "string") set(`${base}.range.long`, raw.range.long, replace(raw.range.long));
                if (typeof raw.range.special === "string") set(`${base}.range.special`, raw.range.special, replace(raw.range.special));
            }
            if (raw.duration && typeof raw.duration.value === "string") {
                set(`${base}.duration.value`, raw.duration.value, replace(raw.duration.value));
            }
            if (raw.target?.template) {
                const tpl = raw.target.template;
                if (typeof tpl.size === "string") set(`${base}.target.template.size`, tpl.size, replace(tpl.size));
                if (typeof tpl.width === "string") set(`${base}.target.template.width`, tpl.width, replace(tpl.width));
                if (typeof tpl.height === "string") set(`${base}.target.template.height`, tpl.height, replace(tpl.height));
            }
            if (raw.uses) {
                if (typeof raw.uses.max === "string") set(`${base}.uses.max`, raw.uses.max, replace(raw.uses.max));
                if (Array.isArray(raw.uses.recovery)) {
                    for (let i = 0; i < raw.uses.recovery.length; i++) {
                        const r = raw.uses.recovery[i];
                        if (r && typeof r.formula === "string") {
                            set(`${base}.uses.recovery.${i}.formula`, r.formula, replace(r.formula));
                        }
                    }
                }
            }
        }

        return foundry.utils.isEmpty(update) ? null : update;
    }

    /* Translate a dnd5e DamageData (or its raw object form) back into a GMM blueprint `{formula, type}` entry. */
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

    /* Build the dnd5e activity payload for a scaling action. Formulas stored sanitised; runtime substitution in resolveActivityFormulas. */
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
                // FormulaField validates via `new Roll`; store the sanitised form so a shortcoded bonus doesn't fail.
                bonus: _sanitizeFormulaForActivity(blueprintAttack.bonus || ""),
                critical: { threshold: null },
                // flat: suppress dnd5e's auto mod/prof/actorBonus; GMM adds its monster bonus via preRollAttackV2.
                flat: true,
                type: ATTACK_TYPES[blueprintAttack.type]
            };
            data.damage = {
                critical: { bonus: "" },
                includeBase: false,
                parts: damageParts
            };
        } else if (type === "save") {
            // _buildSaveDcFormula yields a shortcoded string, so sanitise it or FormulaField rejects it.
            data.save = {
                ability: [blueprintAttack.defense || "str"],
                dc: {
                    calculation: "",
                    formula: _sanitizeFormulaForActivity(_buildSaveDcFormula(blueprintData))
                }
            };
            data.damage = {
                onSave: "half",
                parts: damageParts
            };
        } else if (type === "heal") {
            // HealActivity carries a single `healing` DamageData, not an array; fold in the first damage row.
            data.healing = damageParts[0] ?? damagePartFromBlueprint({ formula: "", type: "" });
        } else if (type === "damage") {
            data.damage = {
                parts: damageParts
            };
        }
        // utility activities carry no extra fields

        return data;
    }

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
        // Ammo runs through the AttackActivity ammunition pipeline (injectAmmunition); adding it here double-decrements.
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
        // After expandObject this can arrive as an object keyed by numeric strings, not an array.
        const raw = blueprintData.attack?.hit?.damage;
        if (!raw) return [];
        const entries = Array.isArray(raw)
            ? raw
            : Object.keys(raw)
                .filter(k => /^\d+$/.test(k))
                .sort((a, b) => Number(a) - Number(b))
                .map(k => raw[k]);
        if (!entries.length) return [];
        return entries.map(damagePartFromBlueprint);
    }

    /* Mirror a dnd5e Activity's values onto a GMM blueprint object (mutates `blueprintData` in place). */
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
            // Keep a shortcoded bonus already on the blueprint; the activity only holds the sanitised copy.
            const existingBonus = blueprintData.attack.bonus;
            if (typeof existingBonus === "string" && existingBonus.includes("[")) {
                // keep as-is
            } else {
                blueprintData.attack.bonus = obj.attack.bonus ?? null;
            }
            blueprintData.attack.related_stat = obj.attack.ability ?? "str";
        } else if (type === "save" && obj.save) {
            blueprintData.attack.type = "save";
            const ability = obj.save.ability instanceof Set ? obj.save.ability.first()
                : Array.isArray(obj.save.ability) ? obj.save.ability[0]
                    : obj.save.ability;
            blueprintData.attack.defense = ability ?? "str";
        } else if (type === "heal") {
            blueprintData.attack.type = "heal";
        } else if (type === "damage") {
            blueprintData.attack.type = "other";
        }

        // Damage parts: the activity holds only `0` placeholders, so keep the raw blueprint formula.
        if (obj.damage?.parts?.length) {
            blueprintData.attack.hit ??= {};
            const existing = _normalizeBlueprintDamage(blueprintData.attack.hit.damage);
            blueprintData.attack.hit.damage = obj.damage.parts.map((part, idx) => {
                const bp = damagePartToBlueprint(part);
                const rawFormula = existing[idx]?.formula;
                if (typeof rawFormula === "string" && rawFormula.includes("[")) {
                    bp.formula = rawFormula;
                }
                return bp;
            });
            const first = blueprintData.attack.hit.damage[0];
            if (first) {
                blueprintData.attack.damage = { formula: first.formula, type: first.type };
            }
        } else if (type === "heal" && obj.healing) {
            // HealActivity stores a single `healing` DamageData; mirror it into the first damage row, keeping raw formula.
            blueprintData.attack.hit ??= {};
            const existing = _normalizeBlueprintDamage(blueprintData.attack.hit.damage);
            const bp = damagePartToBlueprint(obj.healing);
            const rawFormula = existing[0]?.formula;
            if (typeof rawFormula === "string" && rawFormula.includes("[")) {
                bp.formula = rawFormula;
            }
            // Keep extra authored rows (the activity carries only the first) so heal round-trips don't lose them.
            const rest = existing.slice(1);
            blueprintData.attack.hit.damage = [bp, ...rest];
            blueprintData.attack.damage = { formula: bp.formula, type: bp.type };
        }
    }

    /* Normalise a stored blueprint damage list (array or numeric-keyed object) into an ordered `{formula, type}` array. */
    function _normalizeBlueprintDamage(raw) {
        if (Array.isArray(raw)) {
            return raw.map(e => ({ formula: e?.formula ?? "", type: e?.type ?? "" }));
        }
        if (raw && typeof raw === "object") {
            return Object.keys(raw)
                .filter(k => /^\d+$/.test(k))
                .sort((a, b) => Number(a) - Number(b))
                .map(k => ({ formula: raw[k]?.formula ?? "", type: raw[k]?.type ?? "" }));
        }
        return [];
    }

    function _findAttackTypeKey({ value, classification } = {}) {
        for (const [key, cfg] of Object.entries(ATTACK_TYPES)) {
            if (cfg.value === value && cfg.classification === classification) return key;
        }
        return null;
    }

    /* Build an Item5e#update payload for the GMM activity. ForcedReplacement so a type swap leaves no stale sub-fields. */
    function buildActivityUpdate(item, blueprint) { // eslint-disable-line no-unused-vars
        const newData = buildActivityData(blueprint);
        const ForcedReplacement = foundry.data?.operators?.ForcedReplacement;
        const update = {};
        if (ForcedReplacement) {
            update[`system.activities.${GMM_ACTIVITY_ID}`] = new ForcedReplacement(newData);
        } else {
            // Pre-v14 has no ForcedReplacement; a plain assign deep-merges and drops sub-field edits on 5.3.x.
            // The legacy "==" force-replace key replaces the whole activity, matching v14.
            update[`system.activities.==${GMM_ACTIVITY_ID}`] = newData;
        }
        return update;
    }

    /* Substitute GMM shortcodes into the runtime values of the item's GMM activity, using the monster data. */
    function resolveActivityFormulas(item, monsterData) {
        if (!monsterData) return;
        const activity = item?.system?.activities?.get?.(GMM_ACTIVITY_ID);
        if (!activity) return;

        const blueprintData = item?.flags?.gmm?.blueprint?.data;

        // Attack bonus: the stored value is the sanitised placeholder, so re-derive from the raw blueprint bonus.
        if (activity.attack) {
            const rawBonus = blueprintData?.attack?.bonus;
            if (typeof rawBonus === "string" && rawBonus.includes("[")) {
                activity.attack.bonus = Shortcoder.replaceShortcodes(rawBonus, monsterData);
            } else if (typeof activity.attack.bonus === "string" && activity.attack.bonus.includes("[")) {
                // Fallback for legacy sources still carrying raw shortcoded text.
                activity.attack.bonus = Shortcoder.replaceShortcodes(activity.attack.bonus, monsterData);
            }
        }

        // Save DC: the stored formula is the sanitised placeholder, so re-derive from the blueprint.
        if (activity.save?.dc) {
            let formula = activity.save.dc.formula ?? "";
            if (blueprintData) {
                const rebuilt = _buildSaveDcFormula(blueprintData);
                if (typeof rebuilt === "string" && rebuilt.includes("[")) {
                    formula = Shortcoder.replaceShortcodes(rebuilt, monsterData);
                }
            } else if (typeof formula === "string" && formula.includes("[")) {
                // Defensive fallback for legacy sources still carrying shortcoded text.
                formula = Shortcoder.replaceShortcodes(formula, monsterData);
            }
            activity.save.dc.formula = formula;
            // Re-derive save.dc.value from the now-numeric formula, matching dnd5e's prepareFinalData.
            try {
                const dcRoll = new Roll(String(formula || "0"));
                if (dcRoll.isDeterministic) {
                    const total = dcRoll.evaluateSync().total;
                    if (Number.isFinite(total)) activity.save.dc.value = total;
                }
            } catch (e) { /* swallow: keep whatever value the framework already computed */ }
        }

        // Damage parts: custom.formula is the sanitised placeholder, so re-derive each from the raw blueprint formula.
        if (activity.damage?.parts?.length) {
            const blueprintDamage = _normalizeBlueprintDamage(
                foundry.utils.getProperty(item.flags ?? {}, "gmm.blueprint.data.attack.hit.damage")
            );
            for (let i = 0; i < activity.damage.parts.length; i++) {
                const part = activity.damage.parts[i];
                if (!part.custom?.enabled) continue;
                const rawFormula = blueprintDamage[i]?.formula;
                if (typeof rawFormula === "string" && rawFormula.includes("[")) {
                    part.custom.formula = Shortcoder.replaceShortcodes(rawFormula, monsterData, true);
                }
            }
        }

        // Healing part: single DamageData, not a `parts` array; re-derive from the blueprint's first damage row.
        if (activity.healing?.custom?.enabled) {
            const blueprintDamage = _normalizeBlueprintDamage(
                foundry.utils.getProperty(item.flags ?? {}, "gmm.blueprint.data.attack.hit.damage")
            );
            const rawFormula = blueprintDamage[0]?.formula;
            if (typeof rawFormula === "string" && rawFormula.includes("[")) {
                activity.healing.custom.formula = Shortcoder.replaceShortcodes(rawFormula, monsterData, true);
            }
        }
    }

    /* Inject the monster's attack bonus and optional ability mod into a pending attack roll (from preRollAttackV2). */
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

    /* Wire a scaling action's configured ammunition into the AttackActivity roll flow (dnd5e exposes ammo for weapons only). */
    function injectAmmunition(rollConfig, dialogConfig, activity) {
        const item = activity?.item;
        const actor = activity?.actor;
        if (!item || !actor) return;

        const blueprint = item.flags?.gmm?.blueprint?.data;
        if (blueprint?.resource_consumption?.type !== "ammo") return;

        const targetAmmoId = blueprint.resource_consumption.target;
        if (!targetAmmoId) return;

        // Picker options matching WeaponData#ammunitionOptions' shape so the dialog renders them natively.
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

        // Default to the configured ammo unless a valid option was already selected.
        if (!rollConfig.ammunition || !ammoOptions.some(o => o.value === rollConfig.ammunition)) {
            rollConfig.ammunition = targetAmmoId;
        }

        // Mirror onto rolls[0].options.ammunition for the post-roll decrement and Damage button, without overriding a user pick.
        const roll = rollConfig.rolls?.[0];
        if (roll) {
            roll.options ??= {};
            if (!roll.options.ammunition) roll.options.ammunition = rollConfig.ammunition;
        }
    }

    /* Resolve the ammunition's magical bonus to attack/damage rolls; 0 if not magic-available or none. */
    function ammunitionMagicBonus(ammo, rollData = {}) {
        if (!ammo?.system?.magicAvailable) return 0;
        const formula = ammo.system.magicalBonus;
        if (!formula) return 0;
        const simplify = dnd5e?.utils?.simplifyBonus;
        if (typeof simplify !== "function") return 0;
        return simplify(formula, rollData) || 0;
    }

    /* Inject the ammunition's magicalBonus into a per-roll config as `@gmm.ammoBonus`. */
    function injectAmmoMagicPart(config, ammo) {
        if (!ammo) return;
        config.data ??= {};
        const bonus = ammunitionMagicBonus(ammo, config.data);
        if (!bonus) return;
        config.parts ??= [];
        config.parts.push("@gmm.ammoBonus");
        config.data.gmm = { ...(config.data.gmm ?? {}), ammoBonus: bonus };
    }

    /* Resolve shortcodes in damage/heal roll parts at roll time (raw `[…]` markers and `"0"` placeholders). */
    function resolveDamageRollFormulas(rollConfig, monsterData) {
        if (!rollConfig?.rolls?.length || !monsterData) return;
        const activity = rollConfig.subject;
        const item = activity?.item;
        const blueprintDamage = item
            ? _normalizeBlueprintDamage(
                foundry.utils.getProperty(item.flags ?? {}, "gmm.blueprint.data.attack.hit.damage"))
            : [];

        for (let ri = 0; ri < rollConfig.rolls.length; ri++) {
            const roll = rollConfig.rolls[ri];
            if (!Array.isArray(roll.parts)) continue;
            for (let i = 0; i < roll.parts.length; i++) {
                const p = roll.parts[i];
                if (typeof p !== "string") continue;
                if (p.includes("[")) {
                    roll.parts[i] = Shortcoder.replaceShortcodes(p, monsterData, true);
                    continue;
                }
                // Re-derive the real value from the blueprint where the stored part is the `0` placeholder.
                const bpFormula = blueprintDamage[ri]?.formula;
                if (bpFormula && bpFormula.includes("[") && /^0+$/.test(p)) {
                    roll.parts[i] = Shortcoder.replaceShortcodes(bpFormula, monsterData, true);
                }
            }
        }
    }

    /* Determine whether an item is a legacy GMM scaling-action item that needs the GMM-managed activity (re)created. */
    function isLegacyGmmActionItem(item) {
        if (!item) return false;
        // Items the user explicitly opted into the GMM ActionSheet.
        const sheetClass = item.flags?.core?.sheetClass;
        if (typeof sheetClass !== "string") return false;
        if (!sheetClass.endsWith(".ActionSheet")) return false;
        // Only items with a blueprint flag are candidates; MonsterSheet#actionAddItem items already have the activity.
        return !!item.flags?.gmm?.blueprint;
    }

    /* Collect flat `system.activities.<id>` deletion entries for every activity on the item that isn't the GMM activity. */
    function buildForeignActivityPurge(source) {
        const raw = source?._source?.system?.activities
            ?? source?.system?.activities
            ?? source?.activities
            ?? source;
        const deletes = {};
        if (!raw) return deletes;
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        // ActivityCollection / Map: iterate its keys. Plain objects: use own keys.
        const keys = (typeof raw.keys === "function") ? Array.from(raw.keys()) : Object.keys(raw);
        for (const id of keys) {
            if (id === GMM_ACTIVITY_ID) continue;
            if (typeof id !== "string" || id.startsWith("-=")) continue;
            if (ForcedDeletion) {
                deletes[`system.activities.${id}`] = new ForcedDeletion();
            } else {
                // Pre-v14 fallback: legacy dotted deletion syntax.
                deletes[`system.activities.-=${id}`] = null;
            }
        }
        return deletes;
    }

    /* Snapshot the item's activities as a plain id-keyed object (excluding the GMM activity) for stashing in a flag. */
    function snapshotActivities(item) {
        let raw = null;
        if (typeof item?.toObject === "function") {
            raw = item.toObject()?.system?.activities ?? null;
        }
        raw ??= item?._source?.system?.activities ?? null;
        if (!raw || typeof raw !== "object") return {};
        const snapshot = {};
        for (const [id, data] of Object.entries(raw)) {
            if (typeof id !== "string" || id.startsWith("-=") || id === GMM_ACTIVITY_ID) continue;
            if (!data || typeof data !== "object") continue;
            snapshot[id] = data;
        }
        return snapshot;
    }

    /* Read the saved snapshot from `flags.gmm.savedActivities`, tolerating both the JSON-string and raw-object forms. */
    function _readSavedActivities(item) {
        const raw = item?.flags?.gmm?.savedActivities;
        if (!raw) return {};
        if (typeof raw === "string") {
            try {
                const parsed = JSON.parse(raw);
                return (parsed && typeof parsed === "object") ? parsed : {};
            } catch (e) {
                console.warn("GMM | savedActivities snapshot is not valid JSON", e);
                return {};
            }
        }
        return (typeof raw === "object") ? raw : {};
    }

    /* Build the update that reverts a scaling action to vanilla: delete the GMM activity and re-create the
     * originals from `flags.gmm.savedActivities`. The GMM flags are left intact so the item can toggle back. */
    function buildRestoreUpdate(item) {
        const update = {};
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        const ForcedReplacement = foundry.data?.operators?.ForcedReplacement;

        // Remove the GMM-managed activity.
        const hasGmm = (item?.system?.activities?.has?.(GMM_ACTIVITY_ID))
            ?? !!(item?._source?.system?.activities?.[GMM_ACTIVITY_ID]);
        if (hasGmm) {
            if (ForcedDeletion) update[`system.activities.${GMM_ACTIVITY_ID}`] = new ForcedDeletion();
            // Pre-v14 fallback: legacy dotted deletion syntax.
            else update[`system.activities.-=${GMM_ACTIVITY_ID}`] = null;
        }

        // Restore the saved activities; ForcedReplacement so each fully replaces any same-id remnant.
        const saved = _readSavedActivities(item);
        for (const [id, data] of Object.entries(saved)) {
            if (typeof id !== "string" || id.startsWith("-=") || id === GMM_ACTIVITY_ID) continue;
            if (!data || typeof data !== "object") continue;
            update[`system.activities.${id}`] = ForcedReplacement ? new ForcedReplacement(data) : data;
        }
        return update;
    }

    /* Build the migration update payload for a single GMM scaling-action item, or `null` if no migration is needed. */
    function buildMigrationUpdate(item) {
        if (!isLegacyGmmActionItem(item)) return null;
        const purge = buildForeignActivityPurge(item);
        const hasGmm = item.system?.activities?.has?.(GMM_ACTIVITY_ID) ?? false;
        // Also heal legacy persisted shortcode formulas by writing corrected source data.
        const cleanup = buildSourceFormulaCleanup(item);
        if (hasGmm && foundry.utils.isEmpty(purge) && !cleanup) return null;
        const update = { ...purge };
        if (cleanup) Object.assign(update, cleanup);
        if (!hasGmm) {
            const blueprint = item.flags.gmm.blueprint;
            Object.assign(update, buildActivityUpdate(null, blueprint));
        }
        return update;
    }

    /* Like buildMigrationUpdate but for the preCreate hook; seeds the GMM activity onto legacy compendium imports. */
    function buildPreCreateUpdate(data, item) {
        const sheetClass = data?.flags?.core?.sheetClass;
        if (typeof sheetClass !== "string" || !sheetClass.endsWith(".ActionSheet")) return null;
        const blueprint = data?.flags?.gmm?.blueprint;
        if (!blueprint) return null;
        const purge = buildForeignActivityPurge(item ?? data);
        const hasGmm = !!(
            item?._source?.system?.activities?.[GMM_ACTIVITY_ID]
            ?? data?.system?.activities?.[GMM_ACTIVITY_ID]
        );
        if (hasGmm && foundry.utils.isEmpty(purge)) return null;
        const update = { ...purge };
        if (!hasGmm) Object.assign(update, buildActivityUpdate(null, blueprint));
        return update;
    }

    /* Migrate an actor's GMM scaling-action items that lack the GMM activity; returns the count migrated. */
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

    /* Migrate all owned world actors/items on the `ready` hook (GM only); returns the total count migrated. */
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

    /* Map a vanilla dnd5e activity to a GMMC `attack.type` ("" = trait). save/heal/damage map directly;
     * attack activities use their own `attack.type`, falling back to range (melee/ranged) and item type (weapon/spell). */
    function inferAttackType(item, activity) {
        if (!activity) return "";
        const obj = (typeof activity.toObject === "function") ? activity.toObject() : activity;
        switch (obj?.type) {
            case "save":   return "save";
            case "heal":   return "heal";
            case "damage": return "other";
            case "attack": break;
            default:       return "";
        }

        // Prefer the PREPARED attack.type toObject() is empty for imported monster features, 
        // so range heuristic below would mislabel melee attacks as ranged.
        const type = ((typeof activity.toObject === "function" && activity.attack?.type) || obj.attack?.type) ?? {};

        // 1. Direct map when both fields are recognised (true for any prepared attack activity).
        const direct = _findAttackTypeKey(type);
        if (direct) return direct;

        // 2. Resolve melee/ranged: explicit type/item value first, then range units (reach counts as melee).
        let value = [type.value, item?.system?.attackType].find(v => v === "melee" || v === "ranged") ?? null;
        if (!value) {
            const units = obj.range?.units || item?.system?.range?.units || "";
            value = ["self", "touch", "reach", "", null, undefined].includes(units) ? "melee" : "ranged";
        }

        // 3. Resolve weapon/spell. Treat "unarmed" as "weapon" (GMMC has no unarmed key).
        let classification = type.classification || item?.system?.attackClassification;
        if (classification === "unarmed") classification = "weapon";
        if (classification !== "weapon" && classification !== "spell") {
            switch (item?.type) {
                case "weapon": classification = "weapon"; break;
                case "spell":  classification = "spell"; break;
                case "feat":   classification = "spell"; break;
                default:       classification = "weapon"; break;
            }
        }

        return _findAttackTypeKey({ value, classification }) ?? "";
    }

    /* Pick the activity to seed a new blueprint from, by priority attack > save > heal > damage > utility
     * (then any). Excludes the GMM activity so a stale one isn't picked over the real data. */
    function pickPrimaryActivity(item) {
        const activities = item?.system?.activities;
        if (!activities) return null;
        const list = (typeof activities.values === "function")
            ? Array.from(activities.values())
            : (Array.isArray(activities) ? activities : Object.values(activities));
        const candidates = list.filter(a => a && a.id !== GMM_ACTIVITY_ID);
        if (!candidates.length) return null;
        const order = ["attack", "save", "heal", "damage", "utility"];
        for (const type of order) {
            const found = candidates.find(a => a.type === type);
            if (found) return found;
        }
        return candidates[0] ?? null;
    }

    /* Fill blueprint fields the activity didn't populate from item-level data (range, weapon base damage).
     * Only touches still-empty keys so activity-derived values are never overwritten. */
    function applyItemLevelFallbacks(item, blueprintData) {
        if (!item || !blueprintData) return;
        const sys = item.system ?? {};

        // Range (weapons keep `system.range = {value, long, reach, units}`).
        const r = sys.range;
        if (r && (r.value || r.units || r.long)) {
            blueprintData.range ??= {};
            if (blueprintData.range.value == null) blueprintData.range.value = r.value ?? null;
            if (blueprintData.range.long == null && r.long != null) blueprintData.range.long = r.long;
            if (!blueprintData.range.units) blueprintData.range.units = r.units ?? "";
        }

        // Weapon base damage (`system.damage.base` is a DamageField).
        const base = sys.damage?.base;
        const hasDamageRow = Array.isArray(blueprintData.attack?.hit?.damage)
            ? blueprintData.attack.hit.damage.some(p => p?.formula)
            : false;
        if (base && !hasDamageRow) {
            const number = Number(base.number ?? 0);
            const denomination = Number(base.denomination ?? 0);
            const bonus = String(base.bonus ?? "").trim();
            let formula = "";
            if (Number.isFinite(number) && number > 0 && Number.isFinite(denomination) && denomination > 0) {
                formula = `${number}d${denomination}`;
                if (bonus) formula += bonus.startsWith("-") ? ` - ${bonus.slice(1)}` : ` + ${bonus}`;
            } else if (bonus) {
                formula = bonus;
            } else if (base.custom?.enabled && base.custom.formula) {
                formula = String(base.custom.formula);
            }
            if (formula) {
                const types = base.types instanceof Set ? Array.from(base.types)
                    : (Array.isArray(base.types) ? base.types : []);
                blueprintData.attack ??= {};
                blueprintData.attack.hit ??= {};
                blueprintData.attack.hit.damage = [{ formula, type: types[0] ?? "" }];
                blueprintData.attack.damage = { formula, type: types[0] ?? "" };
            }
        }
    }

    /* Read the GMM activity's applied-effects array as raw source entries; null when there's no GMM activity. */
    function _gmmActivityEffectSource(item) {
        const activity = item?.system?.activities?.get?.(GMM_ACTIVITY_ID);
        if (!activity) return null;
        const source = activity.toObject?.() ?? activity._source ?? {};
        return Array.isArray(source.effects) ? source.effects : [];
    }

    /* True when `effectId` is in the GMM activity's applied-effects list (offered as an Apply Effect button). */
    function isEffectAppliedByGmmActivity(item, effectId) {
        const effects = _gmmActivityEffectSource(item);
        if (!effects) return false;
        return effects.some(e => e?._id === effectId);
    }

    /* Toggle an ActiveEffect between "always" (transfer=true, off the applied list) and "onUse" (transfer=false,
     * on the applied list, offered via the chat card). No-op without a GMM activity; true if anything changed. */
    async function setEffectMode(item, effect, alwaysMode) {
        if (!item || !effect) return false;
        const effects = _gmmActivityEffectSource(item);
        if (effects === null) return false;

        const has = effects.some(e => e?._id === effect.id);
        let nextEffects = effects;
        if (alwaysMode && has) {
            nextEffects = effects.filter(e => e?._id !== effect.id);
        } else if (!alwaysMode && !has) {
            nextEffects = [...effects, { _id: effect.id }];
        }

        const promises = [];
        if (nextEffects !== effects) {
            promises.push(item.updateActivity(GMM_ACTIVITY_ID, { effects: nextEffects }));
        }
        const desiredTransfer = !!alwaysMode;
        if (effect.transfer !== desiredTransfer) {
            promises.push(effect.update({ transfer: desiredTransfer }));
        }
        if (!promises.length) return false;
        await Promise.all(promises);
        return true;
    }

    return {
        GMM_ACTIVITY_ID,
        ATTACK_TYPES,
        activityTypeFor,
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
        buildForeignActivityPurge,
        snapshotActivities,
        buildRestoreUpdate,
        buildMigrationUpdate,
        buildPreCreateUpdate,
        buildSourceFormulaCleanup,
        sanitizeActivitySource,
        patchActivityField,
        migrateActor,
        migrateWorld,
        isEffectAppliedByGmmActivity,
        setEffectMode,
        pickPrimaryActivity,
        applyItemLevelFallbacks,
        inferAttackType
    };
})();

export default Activities;
