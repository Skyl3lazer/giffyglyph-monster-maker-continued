import AutomationHelpers from "./AutomationHelpers.js";
import Durations from "./Durations.js";
import Shortcoder from "./Shortcoder.js";
import { buildSaveDcFormula, buildDurationSaveDcFormula } from "./SaveDc.js";
import { GMM_MODULE_TITLE } from "../consts/GmmModuleTitle.js";
import { GMM_ZONE_TERRAIN } from "../consts/GmmZoneTerrain.js";
import { GMM_ZONE_TRIGGERS } from "../consts/GmmZoneTriggers.js";
import { GMM_ZONE_PAYLOADS } from "../consts/GmmZonePayloads.js";
import { GMM_ZONE_AUDIENCES } from "../consts/GmmZoneAudiences.js";

/* The blueprint is the authored source of truth; every activity here is a generated mirror of it. */
const Activities = (function () {

    /* `staticID` gives the deterministic 16-char form Foundry requires of a fixed id. */
    const GMM_ACTIVITY_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmprimary")
        : "gmmprimary000000";

    /* Carries the payload of a deferred action; the primary only announces it. */
    const GMM_DEFERRED_ACTIVITY_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmdeferred")
        : "gmmdeferred00000";

    /* Carries a Zone's payload, because the primary places the area and stops there. */
    const GMM_ZONE_ACTIVITY_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmzone")
        : "gmmzone000000000";

    const GMM_ACTIVITY_IDS = new Set([GMM_ACTIVITY_ID, GMM_DEFERRED_ACTIVITY_ID, GMM_ZONE_ACTIVITY_ID]);

    /* Fixed, so a re-save finds the forged clock again rather than adding a second one. */
    const GMM_DOOM_CLOCK_EFFECT_ID = (typeof dnd5e !== "undefined" && dnd5e?.utils?.staticID)
        ? dnd5e.utils.staticID("gmmdoomclock")
        : "gmmdoomclock0000";

    const GMM_DOOM_CLOCK_IMG = "icons/magic/death/hand-dirt-undead-zombie.webp";

    /* Rewritten from the blueprint on every save, so nothing may mistake one for an effect the GM attached. */
    const GMM_FORGED_EFFECT_IDS = new Set([GMM_DOOM_CLOCK_EFFECT_ID, Durations.GMM_DURATION_EFFECT_ID]);

    /* Neither `inst` nor a measured span: midi cleans up the templates of both, on timings GMMC does not own. */
    const GMM_PLANT_DURATION_UNITS = "spec";

    /* The book's Charges with a Charge Event: no `limitedUsePeriods` entry expresses it, so it recovers by no rule. */
    const GMM_UNRECOVERED_PERIOD = "charges";

    /* Empty on both GMM activities: the pool they consume is the item's. */
    const GMM_EMPTY_ACTIVITY_USES = { spent: 0, max: "", recovery: [] };

    function isGmmActivityId(id) {
        return typeof id === "string" && GMM_ACTIVITY_IDS.has(id);
    }

    /* The only reader of the legacy `respite` key, and the only place the timer is clamped. */
    function readDeferral(blueprint) {
        const data = blueprint?.data ?? blueprint ?? {};
        const raw = data.deferral;
        if (!raw?.type) return null;
        const timer = Number(raw.timer);
        return {
            type: raw.type,
            timer: Number.isFinite(timer) && timer > 0 ? Math.trunc(timer) : 1,
            cancel: raw.cancel ?? raw.respite ?? ""
        };
    }

    function deferralType(blueprint) {
        return readDeferral(blueprint)?.type ?? null;
    }

    /* Both types build two activities; they differ in which one carries the roll. */
    function isAutomatedDeferral(blueprint) {
        const type = deferralType(blueprint);
        return type === "delayed" || type === "dooming";
    }

    function isDelayedDeferral(blueprint) {
        return deferralType(blueprint) === "delayed";
    }

    function isDoomingDeferral(blueprint) {
        return deferralType(blueprint) === "dooming";
    }

    /* Where the attack roll or save lives: delayed has none until it resolves, dooming rolls up front. */
    function gateActivityId(blueprint) {
        return isDelayedDeferral(blueprint) ? GMM_DEFERRED_ACTIVITY_ID : GMM_ACTIVITY_ID;
    }

    /* Not the same question as "is this ours": on a deferred action the payload is the second activity. */
    function payloadActivityId(blueprint) {
        return isAutomatedDeferral(blueprint) ? GMM_DEFERRED_ACTIVITY_ID : GMM_ACTIVITY_ID;
    }

    /* A form submit expands `zone.terrain.0.category` into a dotted object, not an array. */
    function _normalizeList(raw) {
        if (Array.isArray(raw)) return raw.filter(x => x && typeof x === "object");
        if (raw && typeof raw === "object") {
            return Object.keys(raw)
                .filter(k => /^\d+$/.test(k))
                .sort((a, b) => Number(a) - Number(b))
                .map(k => raw[k])
                .filter(x => x && typeof x === "object");
        }
        return [];
    }

    function isAreaTarget(blueprintData) {
        const type = blueprintData?.target?.type;
        return !!(type && CONFIG?.DND5E?.areaTargetTypes?.[type]);
    }

    /* Ungated on the target type, because the sheet still has to draw what is already authored. */
    function readZoneLists(blueprintData) {
        const raw = blueprintData?.zone ?? {};
        return {
            terrain: _normalizeList(raw.terrain).map(x => ({
                category: x.category ?? "",
                custom: x.custom ?? ""
            })),
            rules: _normalizeList(raw.rules).map(x => ({
                triggers: (Array.isArray(x.triggers) ? x.triggers : Object.values(x.triggers ?? {}))
                    .filter(t => GMM_ZONE_TRIGGERS.includes(t)),
                payload: GMM_ZONE_PAYLOADS.includes(x.payload) ? x.payload : "damage"
            }))
        };
    }

    /* Null unless the action places an area and authors something for it, so callers lead with one check. */
    function readZone(blueprint) {
        const data = blueprint?.data ?? blueprint ?? {};
        if (!isAreaTarget(data) || !data.zone) return null;

        const lists = readZoneLists(data);
        const terrain = lists.terrain.filter(x => x.category in GMM_ZONE_TERRAIN);
        const rules = lists.rules.filter(x => x.triggers.length);
        if (!terrain.length && !rules.length) return null;

        return {
            terrain,
            rules,
            audience: GMM_ZONE_AUDIENCES.includes(data.zone.audience) ? data.zone.audience : "any",
            oncePerTurn: data.zone.once_per_turn !== false
        };
    }

    /* Damaging is a Terrain Modifier whose delivery is a rule, so the author is not asked for it twice. */
    function zoneRules(blueprint) {
        const zone = readZone(blueprint);
        if (!zone) return [];
        const rules = zone.rules.map(r => ({ ...r }));
        if (zone.terrain.some(t => t.category === "damaging")) {
            rules.push({ triggers: ["enter", "turn_start"], payload: "damage" });
        }
        return _claimTriggersOnce(rules);
    }

    /* Two rules that agree fire the payload twice. The authored one is first, so it keeps the trigger. */
    function _claimTriggersOnce(rules) {
        const claimed = new Map();
        const out = [];
        for (const rule of rules) {
            const seen = claimed.get(rule.payload) ?? new Set();
            const triggers = rule.triggers.filter(t => !seen.has(t));
            for (const trigger of triggers) seen.add(trigger);
            claimed.set(rule.payload, seen);
            if (triggers.length) out.push({ ...rule, triggers });
        }
        return out;
    }

    /* An Effects payload points midi straight at the item's own effect, so it needs no activity. */
    function hasZoneActivity(blueprint) {
        return zoneRules(blueprint).some(r => r.payload === "damage" || r.payload === "attack");
    }

    const ATTACK_TYPES = {
        mwak: { value: "melee", classification: "weapon" },
        msak: { value: "melee", classification: "spell" },
        rwak: { value: "ranged", classification: "weapon" },
        rsak: { value: "ranged", classification: "spell" }
    };

    /* `other` maps to `damage`, not `utility`, so its damage parts have somewhere to live. */
    function activityTypeFor(blueprintAttackType) {
        if (blueprintAttackType in ATTACK_TYPES) return "attack";
        if (blueprintAttackType === "save") return "save";
        if (blueprintAttackType === "heal") return "heal";
        if (blueprintAttackType === "other") return "damage";
        return "utility";
    }

    function damagePartFromBlueprint(entry) {
        const formula = entry?.formula ?? "";
        const type = entry?.type ?? "";
        const part = {
            number: null,
            denomination: null,
            bonus: "",
            types: type ? [type] : [],
            // FormulaField builds a Roll from this and rejects `[`.
            custom: { enabled: true, formula: _sanitizeFormulaForActivity(formula) },
            scaling: { mode: "", number: 1, formula: "" }
        };

        // In the structured fields a plain `NdM(+X)` stays editable on dnd5e's own sheet.
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

    /* `0` rather than an empty string, so the result is still a valid formula. */
    function _sanitizeFormulaForActivity(formula) {
        if (typeof formula !== "string" || !formula.includes("[")) return formula ?? "";
        return formula.replace(/\[[^\]]*\]/g, "0");
    }

    /* Mutates in place, because it runs inside the field's own clean and initialize passes. */
    function sanitizeActivitySource(value) {
        if (!value || typeof value !== "object") return value;
        // Other modules' bracketed formulas are legitimate (e.g. `1d6[fire]`) and must not be rewritten.
        if (!isGmmActivityId(value._id)) return value;
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

    /* Pre-validation, because FormulaField rejects a shortcoded string before anything else can see it. */
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

        // Without a base fallback a stale non-attack activity throws during chat render.
        const BaseActivityData = globalThis.dnd5e?.dataModels?.activity?.BaseActivityData;
        if (BaseActivityData && !("getActionLabel" in BaseActivityData.prototype)) {
            BaseActivityData.prototype.getActionLabel = function(_attackMode) { return ""; };
        }

        return true;
    }

    /* Flat paths, not a nested object, so the caller can merge this into any other update. */
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
            if (!isGmmActivityId(aid)) continue;
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

    /* Only an attack roll or a save can gate a doom; anything else lands the clock without a roll. */
    function gateTypeFor(blueprintAttackType) {
        const type = activityTypeFor(blueprintAttackType);
        return (type === "attack" || type === "save") ? type : "utility";
    }

    /* The delivery re-rolls nothing: the book's `Doom:` clause carries no to-hit and no save of its own. */
    function deliveryTypeFor(blueprintData) {
        if (activityTypeFor(blueprintData?.attack?.type) === "heal") return "heal";
        return _collectDamageParts(blueprintData).length ? "damage" : "utility";
    }

    /* What the GM clicks. Delayed leaves it a `utility`; dooming leaves it the roll without the payload. */
    function buildActivityData(blueprint) {
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        const blueprintAttack = blueprintData.attack ?? {};
        const delayed = isDelayedDeferral(blueprint);
        const dooming = isDoomingDeferral(blueprint);
        // A Zone's payload belongs to whoever triggers it, so placing the area must not also roll it.
        const type = (delayed || hasZoneActivity(blueprint)) ? "utility"
            : dooming ? gateTypeFor(blueprintAttack.type)
                : activityTypeFor(blueprintAttack.type);

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
            uses: { ...GMM_EMPTY_ACTIVITY_USES }
        };

        if (delayed) {
            data.duration = _gateDuration(data.duration);
            return data;
        }

        if (dooming) {
            data.duration = _gateDuration(data.duration);
            _applyPayloadFields(data, blueprintData, type, { damage: false });
            return data;
        }

        _applyPayloadFields(data, blueprintData, type);
        return data;
    }

    /* The duration belongs to the payload. Concentration stays here so that breaking it cancels a
     * pending doom. An expiry measured from here would run out mid-countdown. */
    function _gateDuration(duration) {
        return { ...duration, value: null, units: GMM_PLANT_DURATION_UNITS };
    }

    function _midiActive() {
        return !!game.modules?.get?.("midi-qol")?.active;
    }

    function missPercentage(blueprint) {
        const data = blueprint?.data ?? blueprint ?? {};
        const raw = Number(data.attack?.miss?.percentage);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return Math.min(100, Math.trunc(raw));
    }

    /* `full` is not a mistake. midi is handed the whole amount because GMMC scales it per target,
       and `half` here would make every authored share a fraction of a fraction. */
    function onSaveFor(blueprint) {
        const p = missPercentage(blueprint);
        if (p === 0) return "none";
        if (p === 100) return "full";
        if (_midiActive()) return "full";
        // Core applies nothing and only prints the word, so it gets the nearest of the three.
        return p < 25 ? "none" : p < 75 ? "half" : "full";
    }

    /* Shared so the combined, gate and delivery forms cannot disagree about what a type produces. */
    function _applyPayloadFields(data, blueprintData, type, { damage = true } = {}) {
        const blueprintAttack = blueprintData.attack ?? {};
        const damageParts = damage ? _collectDamageParts(blueprintData) : [];

        if (type === "attack") {
            data.attack = {
                ability: blueprintAttack.related_stat || "",
                // FormulaField validates via `new Roll`; store the sanitised form so a shortcoded bonus doesn't fail.
                bonus: _sanitizeFormulaForActivity(blueprintAttack.bonus || ""),
                critical: { threshold: null },
                // `flat` suppresses dnd5e's own mod/prof/actorBonus, which GMM supplies at roll time instead.
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
                    formula: _sanitizeFormulaForActivity(buildSaveDcFormula(blueprintData))
                }
            };
            data.damage = {
                onSave: onSaveFor(blueprintData),
                parts: damageParts
            };
        } else if (type === "heal") {
            // HealActivity carries one `healing` DamageData rather than an array.
            data.healing = damageParts[0] ?? damagePartFromBlueprint({ formula: "", type: "" });
        } else if (type === "damage") {
            data.damage = {
                parts: damageParts
            };
        }
        return data;
    }

    function buildDeferredActivityData(blueprint) {
        if (!isAutomatedDeferral(blueprint)) return null;
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        const type = isDelayedDeferral(blueprint)
            ? activityTypeFor(blueprintData.attack?.type)
            : deliveryTypeFor(blueprintData);

        const data = {
            _id: GMM_DEFERRED_ACTIVITY_ID,
            type,
            name: blueprintData.description?.name || "",
            sort: 1,
            // The primary already charged all of these.
            activation: { type: "", value: null, condition: "", override: false },
            consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false },
            description: { chatFlavor: "" },
            duration: _buildDuration(blueprintData, { concentration: false }),
            range: _buildRange(blueprintData),
            // The primary already placed the template; a second would be planted here.
            target: _buildTarget(blueprintData, { template: false }),
            uses: { ...GMM_EMPTY_ACTIVITY_USES },
            midiProperties: { automationOnly: true }
        };

        _applyPayloadFields(data, blueprintData, type);
        return data;
    }

    /* Not the primary, whose area a region behaviour triggering it would place a second time. */
    function buildZoneActivityData(blueprint) {
        if (!hasZoneActivity(blueprint)) return null;
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        const type = zoneRules(blueprint).some(r => r.payload === "attack")
            ? activityTypeFor(blueprintData.attack?.type)
            : deliveryTypeFor(blueprintData);

        const data = {
            _id: GMM_ZONE_ACTIVITY_ID,
            type,
            name: blueprintData.description?.name || "",
            sort: 2,
            // Placing the area already charged all of these.
            activation: { type: "", value: null, condition: "", override: false },
            consumption: { targets: [], scaling: { allowed: false, max: "" }, spellSlot: false },
            description: { chatFlavor: "" },
            // Concentrating here would end the concentration the placed area depends on, deleting it.
            duration: _buildDuration(blueprintData, { concentration: false }),
            range: _buildRange(blueprintData),
            target: _buildTarget(blueprintData, { template: false }),
            uses: { ...GMM_EMPTY_ACTIVITY_USES },
            midiProperties: { automationOnly: true }
        };

        _applyPayloadFields(data, blueprintData, type);
        return data;
    }

    /* Forged, not authored: the GM never edits it, and the gate references it by that fixed id. */
    function buildDoomClockEffectData(blueprint) {
        const deferral = readDeferral(blueprint);
        if (deferral?.type !== "dooming") return null;
        const blueprintData = blueprint?.data ?? blueprint ?? {};

        return {
            _id: GMM_DOOM_CLOCK_EFFECT_ID,
            name: game.i18n.format("gmm.deferral.clock.doomed", {
                name: blueprintData.description?.name || "",
                rounds: deferral.timer
            }),
            img: blueprintData.description?.image || GMM_DOOM_CLOCK_IMG,
            description: deferral.cancel
                ? `<p>${game.i18n.format("gmm.deferral.clock.dispel", { cancel: deferral.cancel })}</p>`
                : "",
            // The gate applies it to whoever it landed on, so it must not also ride the scaler.
            transfer: false,
            flags: {
                [GMM_MODULE_TITLE]: {
                    deferral: {
                        kind: "dooming",
                        name: blueprintData.description?.name || "",
                        timer: deferral.timer,
                        remaining: deferral.timer,
                        cancel: deferral.cancel ?? ""
                    }
                }
            }
        };
    }

    /* An authored payload names its macro rather than carrying an over-time entry of its own. Two entries
       on the same turn land in whichever order they were applied in, and only one of them is behind the save. */
    function _saveMacros(item) {
        return [...(item?.effects ?? [])]
            .filter(effect => !GMM_FORGED_EFFECT_IDS.has(effect.id))
            .map(effect => effect.flags?.gmm?.saveMacro)
            .filter(macro => typeof macro === "string" && macro);
    }

    function buildDurationEffectData(item, blueprint) {
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        const first = _normalizeBlueprintDamage(blueprintData.attack?.hit?.damage)[0];
        return Durations.buildEffectData(blueprintData, {
            name: blueprintData.description?.name || "",
            img: blueprintData.description?.image,
            saveDc: buildDurationSaveDcFormula(blueprintData),
            damage: first ? { formula: first.formula, type: first.type } : null,
            saveMacros: _saveMacros(item)
        });
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

    function _buildDuration(blueprintData, { concentration = true } = {}) {
        return Durations.buildActivityDuration(
            blueprintData,
            concentration && blueprintData.properties?.concentration?.checked
        );
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

    function _buildTarget(blueprintData, { template = true } = {}) {
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
            if (template) {
                data.template.type = t.type;
                if (t.value != null) data.template.size = String(t.value);
                if (t.width != null) data.template.width = String(t.width);
            }
        } else if (t.type) {
            if (t.value != null) data.affects.count = String(t.value);
            data.affects.type = t.type;
        }
        return data;
    }

    /* The pool is the item's: only `system.uses` reaches `hasLimitedUses`, the vanilla sheet and foreign targets. */
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
        } else if (uses.per && uses.per !== GMM_UNRECOVERED_PERIOD) {
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

    function _chargesOwnPool(blueprintData) {
        const rc = blueprintData.resource_consumption ?? {};
        return (rc.type === "charges") && !rc.target;
    }

    /* A hand-typed maximum of 0 is not a limitation, and a target against it would refuse every use. */
    function _hasPool(blueprintData) {
        const max = _buildUses(blueprintData).max;
        return !!max && (parseInt(max) !== 0);
    }

    /* A cost against a pool that was never authored. Emitting a target for it would refuse the action. */
    function chargesWithoutPool(blueprint) {
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        return _chargesOwnPool(blueprintData) && !_hasPool(blueprintData);
    }

    /* One target for the own pool: a `charges` cost against it as well would spend that pool twice per use. */
    function _buildConsumption(blueprintData) {
        const targets = [];
        const rc = blueprintData.resource_consumption ?? {};
        const ownPool = _chargesOwnPool(blueprintData);

        if (_hasPool(blueprintData)) {
            targets.push({
                type: "itemUses",
                target: "",
                value: String((ownPool ? rc.amount : null) ?? 1),
                scaling: { mode: "", formula: "" }
            });
        }

        const typeMap = {
            attribute: "attribute",
            material: "material",
            charges: "itemUses",
            hitDice: "hitDice"
        };
        // Ammo already decrements through the AttackActivity pipeline; a target here would double it.
        if (rc.type && (rc.type !== "ammo") && !ownPool) {
            targets.push({
                type: typeMap[rc.type] ?? "itemUses",
                target: rc.target ?? "",
                value: String(rc.amount ?? 1),
                scaling: { mode: "", formula: "" }
            });
        }

        return { targets, scaling: { allowed: false, max: "" }, spellSlot: false };
    }

    function _collectDamageParts(blueprintData) {
        // `expandObject` can turn the authored array into an object keyed by numeric strings.
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

    /* Three scopes because a deferral splits them across two activities; exactly one supplies each.
       `authoredType` is the _source duration type, absent on the pre-type shape. */
    function readActivityIntoBlueprintData(activity, blueprintData, { shared = true, gate = true, damage = true, authoredType = null } = {}) {
        if (!activity) return;
        const obj = (typeof activity.toObject === "function") ? activity.toObject() : activity;
        const type = obj.type;

        if (shared && obj.activation) {
            blueprintData.activation ??= {};
            blueprintData.activation.type = obj.activation.type ?? null;
            blueprintData.activation.cost = obj.activation.value ?? null;
            blueprintData.activation.condition = obj.activation.condition ?? null;
        }

        if (shared && obj.duration) {
            blueprintData.duration ??= {};
            /* `fromUnits` cannot express ongoing, save_ends or either end-of-turn, and blanks
               `reapplies`. Run against an authored blueprint it degrades one to timed. */
            if (!authoredType) {
                Object.assign(blueprintData.duration, Durations.fromUnits(obj.duration.units, obj.duration.value));
            } else if (Durations.TYPES[authoredType]?.hasPeriod) {
                blueprintData.duration.value = obj.duration.value ?? "";
                blueprintData.duration.units = obj.duration.units ?? "";
            }
            blueprintData.properties ??= { concentration: { checked: false } };
            blueprintData.properties.concentration ??= { checked: false };
            blueprintData.properties.concentration.checked = !!obj.duration.concentration;
        }

        if (shared && obj.range) {
            blueprintData.range ??= {};
            blueprintData.range.value = obj.range.value ?? null;
            blueprintData.range.units = obj.range.units ?? null;
        }

        if (shared && obj.target) {
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

        if (shared) {
            const foreign = obj.consumption?.targets?.find?.(t => t.type !== "itemUses" || t.target);
            if (foreign) {
                blueprintData.resource_consumption ??= {};
                const reverseTypeMap = {
                    attribute: "attribute",
                    material: "material",
                    itemUses: "charges",
                    hitDice: "hitDice"
                };
                blueprintData.resource_consumption.type = reverseTypeMap[foreign.type] ?? foreign.type ?? null;
                blueprintData.resource_consumption.target = foreign.target ?? null;
                blueprintData.resource_consumption.amount = foreign.value ? Number(foreign.value) : null;
            }
        }

        if (!gate && !damage) return;
        blueprintData.attack ??= {};
        if (!gate) return void _readDamageIntoBlueprintData(obj, type, blueprintData);
        if (type === "attack" && obj.attack) {
            const attackTypeKey = _findAttackTypeKey(obj.attack.type);
            if (attackTypeKey) blueprintData.attack.type = attackTypeKey;
            // The activity holds only the sanitised copy, so an authored shortcode would be lost.
            const existingBonus = blueprintData.attack.bonus;
            if (!(typeof existingBonus === "string" && existingBonus.includes("["))) {
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

        if (damage) _readDamageIntoBlueprintData(obj, type, blueprintData);
    }

    /* Falls back to the activity, where both an unmigrated GMMC item and a vanilla `activityUses` feature keep it. */
    function readItemUsesIntoBlueprintData(item, blueprintData) {
        if (!item || !blueprintData) return;
        let uses = item.system?.uses;
        if (!uses?.max) {
            const activity = item.system?.activities?.get?.(GMM_ACTIVITY_ID) ?? pickPrimaryActivity(item);
            if (activity?.uses?.max) uses = activity.uses;
        }
        if (!uses) return;

        blueprintData.uses ??= {};
        blueprintData.uses.max = uses.max ?? "";
        const max = parseInt(uses.max);
        const spent = parseInt(uses.spent ?? 0);
        blueprintData.uses.value = (Number.isFinite(max) && Number.isFinite(spent)) ? Math.max(0, max - spent) : "";

        blueprintData.recharge ??= { value: null, is_charged: false };
        const recharge = uses.recovery?.find?.(r => r.period === "recharge");
        if (recharge) {
            const v = parseInt(recharge.formula);
            blueprintData.recharge.value = Number.isFinite(v) ? v : null;
            blueprintData.recharge.is_charged = (spent === 0);
            blueprintData.uses.per = "";
            return;
        }
        blueprintData.recharge.value = null;
        // An unrecovered pool writes no recovery rule, so the authored period is all that names it.
        const period = uses.recovery?.[0]?.period ?? "";
        blueprintData.uses.per = period
            || (blueprintData.uses.per === GMM_UNRECOVERED_PERIOD ? GMM_UNRECOVERED_PERIOD : "");
    }

    function _readDamageIntoBlueprintData(obj, type, blueprintData) {
        // The activity holds only `0` placeholders, so the raw blueprint formula is the real one.
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
            blueprintData.attack.hit ??= {};
            const existing = _normalizeBlueprintDamage(blueprintData.attack.hit.damage);
            const bp = damagePartToBlueprint(obj.healing);
            const rawFormula = existing[0]?.formula;
            if (typeof rawFormula === "string" && rawFormula.includes("[")) {
                bp.formula = rawFormula;
            }
            // The activity carries only the first row, so the rest would be lost on a heal round trip.
            const rest = existing.slice(1);
            blueprintData.attack.hit.damage = [bp, ...rest];
            blueprintData.attack.damage = { formula: bp.formula, type: bp.type };
        }
    }

    /* Both shapes occur in stored data, so neither can be assumed. */
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

    /* Fields not listed here belong to dnd5e or another module; ForcedReplacement would reset them.
     * `effects` is owned by `_setEffectMembership` */
    const GMM_OWNED_ACTIVITY_FIELDS = new Set([
        "_id", "type", "name", "sort", "activation", "consumption", "description",
        "duration", "range", "target", "uses", "attack", "damage", "healing", "save", "effects"
    ]);

    /* ForcedReplacement so a type swap leaves no stale sub-fields. */
    function buildActivityUpdate(item, blueprint) {
        const update = { "system.uses": _buildUses(blueprint?.data ?? blueprint ?? {}) };
        const duration = buildDurationEffectData(item, blueprint);

        const primary = _mergeForeignFields(item, GMM_ACTIVITY_ID, buildActivityData(blueprint));
        const deferredData = buildDeferredActivityData(blueprint);
        const deferred = deferredData
            ? _mergeForeignFields(item, GMM_DEFERRED_ACTIVITY_ID, deferredData)
            : null;
        if (deferred) {
            // Declared in the builder they would suppress the preserve step and drop the GM's midi config.
            deferred.midiProperties = {
                ...(deferred.midiProperties ?? {}),
                automationOnly: true,
                // Left true, midi adopts this as the gate's other activity and suspends waiting for its damage.
                otherActivityCompatible: false
            };
        }

        const zoneData = buildZoneActivityData(blueprint);
        const zone = zoneData ? _mergeForeignFields(item, GMM_ZONE_ACTIVITY_ID, zoneData) : null;
        if (zone) {
            zone.midiProperties = {
                ...(zone.midiProperties ?? {}),
                automationOnly: true,
                otherActivityCompatible: false
            };
        }

        _setEffectMembership(item, blueprint, { primary, deferred, zone, duration: !!duration });

        _wrapActivity(update, GMM_ACTIVITY_ID, primary);
        if (deferred) _wrapActivity(update, GMM_DEFERRED_ACTIVITY_ID, deferred);
        else Object.assign(update, _buildActivityDeletion(item, GMM_DEFERRED_ACTIVITY_ID));
        if (zone) _wrapActivity(update, GMM_ZONE_ACTIVITY_ID, zone);
        else Object.assign(update, _buildActivityDeletion(item, GMM_ZONE_ACTIVITY_ID));

        // An embedded-collection array upserts by `_id`. This creates them once and updates them after.
        const effects = [];
        const clock = buildDoomClockEffectData(blueprint);
        if (clock) effects.push(clock);
        if (duration) effects.push(duration);
        if (effects.length) update.effects = effects;

        return update;
    }

    /* Placed, not carried: membership rides the host so nothing applies a turn before its payload, and
     * moving the host cannot strand an entry behind. The only writer of either `effects` array. */
    function _setEffectMembership(item, blueprint, { primary, deferred, zone, duration }) {
        const hostId = payloadActivityId(blueprint);
        const gateId = isDoomingDeferral(blueprint) ? gateActivityId(blueprint) : null;
        const authored = _authoredEffectEntries(item);

        // The zone activity is listed so it is emptied: its Effects payload rides the region behaviour.
        for (const [activityId, data] of [[GMM_ACTIVITY_ID, primary], [GMM_DEFERRED_ACTIVITY_ID, deferred], [GMM_ZONE_ACTIVITY_ID, zone]]) {
            if (!data) continue;
            const entries = [];
            if (activityId === gateId) entries.push({ _id: GMM_DOOM_CLOCK_EFFECT_ID });
            if (activityId === hostId) {
                if (duration) entries.push({ _id: Durations.GMM_DURATION_EFFECT_ID });
                entries.push(...authored);
            }
            data.effects = entries;
        }
    }

    /* Read from the item, not from the objects being built, so an entry on an activity this save is
     * about to delete is still found. Whole entries: `AppliedEffectField` also carries a level range. */
    function _authoredEffectEntries(item) {
        const seen = new Set();
        const entries = [];
        let forged = false;
        for (const activityId of GMM_ACTIVITY_IDS) {
            const existing = AutomationHelpers.activitySource(item, activityId);
            if (existing) forged = true;
            for (const entry of (Array.isArray(existing?.effects) ? existing.effects : [])) {
                const id = entry?._id;
                if (!id || seen.has(id) || GMM_FORGED_EFFECT_IDS.has(id)) continue;
                const effect = item?.effects?.get?.(id)
                    ?? item?._source?.effects?.find?.(e => e?._id === id);
                // Always mode is the GM's choice and carrying the entry anyway would undo it.
                if (effect?.transfer !== false) continue;
                seen.add(id);
                entries.push(entry);
            }
        }
        return forged ? entries : _seedEffectEntries(item);
    }

    /* A pack item carries authored effects but no activity to list them on, so the first forge has no
     * membership to read and would strand every one of them. */
    function _seedEffectEntries(item) {
        const source = Array.isArray(item?._source?.effects) ? item._source.effects : [];
        return source
            .filter(e => e?._id && e.transfer === false && !GMM_FORGED_EFFECT_IDS.has(e._id))
            .map(e => ({ _id: e._id }));
    }

    /* The clock document outlives the deferral that forged it: no builder can delete an embedded
     * document, so the caller does it once the update has landed. */
    function strandedDoomClock(item) {
        if (isDoomingDeferral(item?.flags?.gmm?.blueprint)) return null;
        return item?.effects?.get?.(GMM_DOOM_CLOCK_EFFECT_ID) ?? null;
    }

    /* Keyed to the authored type. With automation off nothing is
     * built and the live carrier is disabled. */
    function strandedDurationCarrier(item) {
        const type = Durations.read(item?.flags?.gmm?.blueprint).type;
        if (Durations.TYPES[type]?.applies) return null;
        return item?.effects?.get?.(Durations.GMM_DURATION_EFFECT_ID) ?? null;
    }

    function _mergeForeignFields(item, activityId, data) {
        return AutomationHelpers.preserveForeignActivityFields(
            item, activityId, data, GMM_OWNED_ACTIVITY_FIELDS
        );
    }

    function _wrapActivity(update, activityId, newData) {
        const ForcedReplacement = foundry.data?.operators?.ForcedReplacement;
        if (ForcedReplacement) {
            update[`system.activities.${activityId}`] = new ForcedReplacement(newData);
        } else {
            // Pre-v14 a plain assign deep-merges, so the legacy "==" key is what replaces the whole activity.
            update[`system.activities.==${activityId}`] = newData;
        }
        return update;
    }

    /* Flat deletion entry for one activity, or empty when the item does not carry it. */
    function _buildActivityDeletion(item, activityId) {
        const present = (item?.system?.activities?.has?.(activityId))
            ?? !!(item?._source?.system?.activities?.[activityId]);
        if (!present) return {};
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        return ForcedDeletion
            ? { [`system.activities.${activityId}`]: new ForcedDeletion() }
            : { [`system.activities.-=${activityId}`]: null };
    }

    function resolveActivityFormulas(item, monsterData) {
        if (!monsterData) return;
        for (const activityId of GMM_ACTIVITY_IDS) {
            _resolveOneActivityFormulas(item, activityId, monsterData);
        }
    }

    function _resolveOneActivityFormulas(item, activityId, monsterData) {
        const activity = item?.system?.activities?.get?.(activityId);
        if (!activity) return;

        const blueprintData = item?.flags?.gmm?.blueprint?.data;

        // The stored value is the sanitised placeholder, so the blueprint is the only real source.
        if (activity.attack) {
            const rawBonus = blueprintData?.attack?.bonus;
            if (typeof rawBonus === "string" && rawBonus.includes("[")) {
                activity.attack.bonus = Shortcoder.replaceShortcodes(rawBonus, monsterData);
            } else if (typeof activity.attack.bonus === "string" && activity.attack.bonus.includes("[")) {
                activity.attack.bonus = Shortcoder.replaceShortcodes(activity.attack.bonus, monsterData);
            }
        }

        if (activity.save?.dc) {
            let formula = activity.save.dc.formula ?? "";
            if (blueprintData) {
                const rebuilt = buildSaveDcFormula(blueprintData);
                if (typeof rebuilt === "string" && rebuilt.includes("[")) {
                    formula = Shortcoder.replaceShortcodes(rebuilt, monsterData);
                }
            } else if (typeof formula === "string" && formula.includes("[")) {
                formula = Shortcoder.replaceShortcodes(formula, monsterData);
            }
            activity.save.dc.formula = formula;
            // dnd5e derives this in `prepareFinalData`, which has already run by now.
            try {
                const dcRoll = new Roll(String(formula || "0"));
                if (dcRoll.isDeterministic) {
                    const total = dcRoll.evaluateSync().total;
                    if (Number.isFinite(total)) activity.save.dc.value = total;
                }
            } catch (e) { /* swallow: keep whatever value the framework already computed */ }
        }

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

    /* Shared by the roll and the sheet, so a new term cannot reach one and miss the other. */
    function buildAttackToHitTerms(activity, blueprint, monsterData, { attackMode = "" } = {}) {
        const parts = [];
        const data = {};
        if (!monsterData) return { parts, data };

        const gmm = {};
        const monsterBonus = monsterData.attack_bonus?.value;
        if (Number.isFinite(monsterBonus)) {
            parts.push("@gmm.monsterBonus");
            gmm.monsterBonus = monsterBonus;
        }

        const relatedStat = blueprint?.attack?.related_stat
            || activity?._source?.attack?.ability
            || activity?.attack?.ability;
        if (relatedStat && monsterData.ability_modifiers?.[relatedStat]) {
            const abilityMod = monsterData.ability_modifiers[relatedStat].value;
            if (Number.isFinite(abilityMod)) {
                parts.push("@gmm.abilityMod");
                gmm.abilityMod = abilityMod;
            }
        }
        if (Object.keys(gmm).length) data.gmm = gmm;

        /* dnd5e skips the actor bonus and exhaustion under `attack.flat`, so GMM supplies both. */
        const actor = activity?.actor;
        const actionType = typeof activity?.getActionType === "function"
            ? activity.getActionType(attackMode)
            : null;
        if (actor && actionType) {
            /* Pushed as a formula, not a simplified number: this field permits dice (Bless is `1d4`). */
            const actorBonus = actor.system?.bonuses?.[actionType]?.attack;
            if (actorBonus && !/^0+$/.test(String(actorBonus).trim())) parts.push(String(actorBonus));
        }
        if (typeof actor?.addRollExhaustion === "function") actor.addRollExhaustion(parts, data);

        return { parts, data };
    }

    function injectAttackBonusParts(rollConfig, activity, monsterData) {
        if (!rollConfig?.rolls?.length || !monsterData) return;
        const roll = rollConfig.rolls[0];
        roll.parts ??= [];
        roll.data ??= {};

        const blueprint = activity?.item?.flags?.gmm?.blueprint?.data;
        const { parts, data } = buildAttackToHitTerms(activity, blueprint, monsterData, {
            attackMode: rollConfig.attackMode ?? ""
        });
        if (!parts.length) return;

        roll.parts.push(...parts);
        roll.data.gmm = { ...(roll.data.gmm ?? {}), ...(data.gmm ?? {}) };
        for (const [key, value] of Object.entries(data)) {
            if (key !== "gmm") roll.data[key] = value;
        }
    }

    /* dnd5e offers ammunition for weapons only, so a scaling action has to supply its own. */
    function injectAmmunition(rollConfig, dialogConfig, activity) {
        const item = activity?.item;
        const actor = activity?.actor;
        if (!item || !actor) return;

        const blueprint = item.flags?.gmm?.blueprint?.data;
        if (blueprint?.resource_consumption?.type !== "ammo") return;

        const targetAmmoId = blueprint.resource_consumption.target;
        if (!targetAmmoId) return;

        // Shaped like `WeaponData#ammunitionOptions` so the stock dialog renders them.
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

        if (!rollConfig.ammunition || !ammoOptions.some(o => o.value === rollConfig.ammunition)) {
            rollConfig.ammunition = targetAmmoId;
        }

        // The post-roll decrement and the Damage button both read it from `rolls[0].options`.
        const roll = rollConfig.rolls?.[0];
        if (roll) {
            roll.options ??= {};
            if (!roll.options.ammunition) roll.options.ammunition = rollConfig.ammunition;
        }
    }

    function ammunitionMagicBonus(ammo, rollData = {}) {
        if (!ammo?.system?.magicAvailable) return 0;
        const formula = ammo.system.magicalBonus;
        if (!formula) return 0;
        const simplify = dnd5e?.utils?.simplifyBonus;
        if (typeof simplify !== "function") return 0;
        return simplify(formula, rollData) || 0;
    }

    function injectAmmoMagicPart(config, ammo) {
        if (!ammo) return;
        config.data ??= {};
        const bonus = ammunitionMagicBonus(ammo, config.data);
        if (!bonus) return;
        config.parts ??= [];
        config.parts.push("@gmm.ammoBonus");
        config.data.gmm = { ...(config.data.gmm ?? {}), ammoBonus: bonus };
    }

    /* Roll time, because a part can arrive as a raw marker or as a sanitised `0`. */
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
                const bpFormula = blueprintDamage[ri]?.formula;
                if (bpFormula && bpFormula.includes("[") && /^0+$/.test(p)) {
                    roll.parts[i] = Shortcoder.replaceShortcodes(bpFormula, monsterData, true);
                }
            }
        }
    }

    function isLegacyGmmActionItem(item) {
        if (!item) return false;
        const sheetClass = item.flags?.core?.sheetClass;
        if (typeof sheetClass !== "string") return false;
        if (!sheetClass.endsWith(".ActionSheet")) return false;
        // An item built by `MonsterSheet#actionAddItem` already has its activity.
        return !!item.flags?.gmm?.blueprint;
    }

    function buildForeignActivityPurge(source) {
        const raw = source?._source?.system?.activities
            ?? source?.system?.activities
            ?? source?.activities
            ?? source;
        const deletes = {};
        if (!raw) return deletes;
        const ForcedDeletion = foundry.data?.operators?.ForcedDeletion;
        const keys = (typeof raw.keys === "function") ? Array.from(raw.keys()) : Object.keys(raw);
        for (const id of keys) {
            if (isGmmActivityId(id)) continue;
            if (typeof id !== "string" || id.startsWith("-=")) continue;
            if (ForcedDeletion) {
                deletes[`system.activities.${id}`] = new ForcedDeletion();
            } else {
                deletes[`system.activities.-=${id}`] = null;
            }
        }
        return deletes;
    }

    /* A plain object rather than a collection, because it is stashed in a flag. */
    function snapshotActivities(item) {
        let raw = null;
        if (typeof item?.toObject === "function") {
            raw = item.toObject()?.system?.activities ?? null;
        }
        raw ??= item?._source?.system?.activities ?? null;
        if (!raw || typeof raw !== "object") return {};
        const snapshot = {};
        for (const [id, data] of Object.entries(raw)) {
            if (typeof id !== "string" || id.startsWith("-=") || isGmmActivityId(id)) continue;
            if (!data || typeof data !== "object") continue;
            snapshot[id] = data;
        }
        return snapshot;
    }

    /* Both the JSON-string and raw-object forms exist in stored data. */
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

    /* The GMM flags are left intact, so the item can be toggled back. */
    function buildRestoreUpdate(item) {
        const update = {};
        const ForcedReplacement = foundry.data?.operators?.ForcedReplacement;

        for (const activityId of GMM_ACTIVITY_IDS) {
            Object.assign(update, _buildActivityDeletion(item, activityId));
        }

        // ForcedReplacement, so each fully replaces any same-id remnant.
        const saved = _readSavedActivities(item);
        for (const [id, data] of Object.entries(saved)) {
            if (typeof id !== "string" || id.startsWith("-=") || isGmmActivityId(id)) continue;
            if (!data || typeof data !== "object") continue;
            update[`system.activities.${id}`] = ForcedReplacement ? new ForcedReplacement(data) : data;
        }
        return update;
    }

    /* An unmigrated item has the pool on the activity, where nothing spends it.
       Idempotent: the rebuild writes the target this looks for. */
    function _poolTargetMismatch(blueprint, primary) {
        const wantsPool = _hasPool(blueprint?.data ?? blueprint ?? {});
        const hasTarget = !!primary?.consumption?.targets?.some?.(t => (t.type === "itemUses") && !t.target);
        return wantsPool !== hasTarget;
    }

    function _sameChanges(a, b) {
        const x = Array.isArray(a) ? a : [];
        const y = Array.isArray(b) ? b : [];
        if (x.length !== y.length) return false;
        return x.every((c, i) => c?.key === y[i]?.key
            && c?.value === y[i]?.value
            && c?.type === y[i]?.type
            && c?.priority === y[i]?.priority);
    }

    /* Read from `_source`, because `Durations.resolveEffectFormulas` substitutes shortcodes into the
       prepared copy in place. Comparing that copy would rebuild the item on every load forever. */
    function _durationEffectStale(item, blueprint) {
        const fresh = buildDurationEffectData(item, blueprint);
        if (!fresh) return false;
        const stored = item?._source?.effects?.find?.(e => e?._id === Durations.GMM_DURATION_EFFECT_ID);
        if (!stored) return true;
        if (!_sameChanges(stored.system?.changes ?? stored.changes, fresh.system.changes)) return true;
        return Object.keys(fresh.duration).some(k => (stored.duration?.[k] ?? null) !== fresh.duration[k]);
    }

    /* True when the item's GMM activities do not match the shape its blueprint asks for. */
    function needsActivityRebuild(item, blueprint) {
        const activities = item?.system?.activities;
        if (!activities?.has?.(GMM_ACTIVITY_ID)) return true;
        const wantsDeferred = isAutomatedDeferral(blueprint);
        if (wantsDeferred !== !!activities.has(GMM_DEFERRED_ACTIVITY_ID)) return true;
        if (hasZoneActivity(blueprint) !== !!activities.has(GMM_ZONE_ACTIVITY_ID)) return true;
        const primary = activities.get(GMM_ACTIVITY_ID);
        if (primary?.type !== _wantedPrimaryType(blueprint)) return true;
        if (_poolTargetMismatch(blueprint, primary)) return true;
        if (_durationEffectStale(item, blueprint)) return true;
        if (_onSaveStale(activities, blueprint)) return true;
        if (activities.get(GMM_ZONE_ACTIVITY_ID)?.duration?.concentration) return true;
        if (activities.get(GMM_DEFERRED_ACTIVITY_ID)?.duration?.concentration) return true;
        if (isDoomingDeferral(blueprint)) {
            if (primary?.damage?.parts?.length) return true;
            if (!primary?.effects?.some?.(e => e?._id === GMM_DOOM_CLOCK_EFFECT_ID)) return true;
            return _deliveryNeedsMidiFlags(activities.get(GMM_DEFERRED_ACTIVITY_ID));
        }
        return wantsDeferred && (primary?.duration?.units !== GMM_PLANT_DURATION_UNITS);
    }

    function _onSaveStale(activities, blueprint) {
        const wanted = onSaveFor(blueprint);
        for (const id of GMM_ACTIVITY_IDS) {
            const activity = activities.get?.(id);
            if (activity?.type === "save" && activity.damage?.onSave !== wanted) return true;
        }
        return false;
    }

    /* Guarded on midi being active: without it the schema drops `midiProperties`, and an unguarded
       check would rebuild the item on every load forever. */
    function _deliveryNeedsMidiFlags(delivery) {
        if (!delivery || !_midiActive()) return false;
        const p = delivery.midiProperties;
        return !p || p.automationOnly !== true || p.otherActivityCompatible !== false;
    }

    function _wantedPrimaryType(blueprint) {
        const blueprintData = blueprint?.data ?? blueprint ?? {};
        if (isDelayedDeferral(blueprint) || hasZoneActivity(blueprint)) return "utility";
        if (isDoomingDeferral(blueprint)) return gateTypeFor(blueprintData.attack?.type);
        return activityTypeFor(blueprintData.attack?.type);
    }

    /* The pre-type shape carried no `type` key at all. Only _source still shows that absence, because
       the prepared blueprint is default-filled. */
    function _buildDurationBlueprintMigration(duration) {
        if (!duration || duration.type) return null;
        return {
            ...duration,
            ...Durations.fromUnits(duration.units, duration.value),
            save: { ability: "" },
            cancel: ""
        };
    }

    function buildMigrationUpdate(item) {
        if (!isLegacyGmmActionItem(item)) return null;
        const purge = buildForeignActivityPurge(item);
        let blueprint = item.flags.gmm.blueprint;

        const duration = _buildDurationBlueprintMigration(item?._source?.flags?.gmm?.blueprint?.data?.duration);
        if (duration) {
            blueprint = foundry.utils.deepClone(blueprint);
            blueprint.data.duration = duration;
        }

        /* Not `|| !!duration`. `Durations.read` default-fills the same values. */
        const rebuild = needsActivityRebuild(item, blueprint);
        const cleanup = buildSourceFormulaCleanup(item);
        if (!rebuild && !duration && foundry.utils.isEmpty(purge) && !cleanup) return null;
        const update = { ...purge };
        if (cleanup) Object.assign(update, cleanup);
        if (duration) update["flags.gmm.blueprint.data.duration"] = duration;
        // `item`, not null, so another module's config on the primary survives the rebuild.
        if (rebuild) Object.assign(update, buildActivityUpdate(item, blueprint));
        return update;
    }

    /* The preCreate form, which sees creation data rather than a prepared document. */
    function buildPreCreateUpdate(data, item) {
        const sheetClass = data?.flags?.core?.sheetClass;
        if (typeof sheetClass !== "string" || !sheetClass.endsWith(".ActionSheet")) return null;
        let blueprint = data?.flags?.gmm?.blueprint;
        if (!blueprint) return null;
        const purge = buildForeignActivityPurge(item ?? data);
        const source = item?._source?.system?.activities ?? data?.system?.activities ?? {};

        const duration = _buildDurationBlueprintMigration(
            item?._source?.flags?.gmm?.blueprint?.data?.duration ?? blueprint.data?.duration
        );
        if (duration) {
            blueprint = foundry.utils.deepClone(blueprint);
            blueprint.data.duration = duration;
        }

        const wantsDeferred = isAutomatedDeferral(blueprint);
        const rebuild = !source[GMM_ACTIVITY_ID]
            || (wantsDeferred !== !!source[GMM_DEFERRED_ACTIVITY_ID])
            || (hasZoneActivity(blueprint) !== !!source[GMM_ZONE_ACTIVITY_ID])
            || !!source[GMM_ZONE_ACTIVITY_ID]?.duration?.concentration
            || (source[GMM_ACTIVITY_ID].type !== _wantedPrimaryType(blueprint))
            || _poolTargetMismatch(blueprint, source[GMM_ACTIVITY_ID]);
        if (!rebuild && !duration && foundry.utils.isEmpty(purge)) return null;
        const update = { ...purge };
        if (duration) update["flags.gmm.blueprint.data.duration"] = duration;
        if (rebuild) Object.assign(update, buildActivityUpdate(item, blueprint));
        return update;
    }

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

    /* A synthetic token actor is in neither `game.actors` nor `game.items`, so its own copy of an item would keep
       stale activities forever. Ordered after the sidebar pass, so a token that never diverged is left untouched. */
    async function _migrateUnlinkedTokens() {
        let total = 0;
        for (const scene of (game.scenes ?? [])) {
            for (const token of (scene.tokens ?? [])) {
                if (token.actorLink) continue;
                const actor = token.actor;
                if (!actor?.isOwner) continue;
                try {
                    total += await migrateActor(actor);
                } catch (e) {
                    console.warn(`GMM | Activity migration failed for token ${token.name} on scene ${scene.name}`, e);
                }
            }
        }
        return total;
    }

    async function migrateWorld() {
        let total = 0;

        for (const actor of (game.actors ?? [])) {
            if (!actor.isOwner) continue;
            try {
                total += await migrateActor(actor);
            } catch (e) {
                console.warn(`GMM | Activity migration failed for actor ${actor.name} (${actor.id})`, e);
            }
        }

        total += await _migrateUnlinkedTokens();

        // Unowned scaling actions in the items sidebar.
        const itemUpdates = [];
        for (const item of (game.items ?? [])) {
            if (!item.isOwner) continue;
            const update = buildMigrationUpdate(item);
            if (update) itemUpdates.push({ ...update, _id: item.id });
        }
        if (itemUpdates.length) {
            try {
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

    /* An empty string means trait. Attack activities need three fallbacks; the rest map directly. */
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

        // `toObject()` is empty for imported monster features, so the range heuristic would mislabel them.
        const type = ((typeof activity.toObject === "function" && activity.attack?.type) || obj.attack?.type) ?? {};

        const direct = _findAttackTypeKey(type);
        if (direct) return direct;

        // Reach counts as melee.
        let value = [type.value, item?.system?.attackType].find(v => v === "melee" || v === "ranged") ?? null;
        if (!value) {
            const units = obj.range?.units || item?.system?.range?.units || "";
            value = ["self", "touch", "reach", "", null, undefined].includes(units) ? "melee" : "ranged";
        }

        // GMMC has no unarmed key, so unarmed becomes weapon.
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

    /* GMM's own activities are excluded, so a stale one cannot be picked over the real data. */
    function pickPrimaryActivity(item) {
        const activities = item?.system?.activities;
        if (!activities) return null;
        const list = (typeof activities.values === "function")
            ? Array.from(activities.values())
            : (Array.isArray(activities) ? activities : Object.values(activities));
        const candidates = list.filter(a => a && !isGmmActivityId(a.id));
        if (!candidates.length) return null;
        const order = ["attack", "save", "heal", "damage", "utility"];
        for (const type of order) {
            const found = candidates.find(a => a.type === type);
            if (found) return found;
        }
        return candidates[0] ?? null;
    }

    /* Only still-empty keys are touched, so an activity-derived value is never overwritten. */
    function applyItemLevelFallbacks(item, blueprintData) {
        if (!item || !blueprintData) return;
        const sys = item.system ?? {};

        // Weapons keep `system.range` on the document.
        const r = sys.range;
        if (r && (r.value || r.units || r.long)) {
            blueprintData.range ??= {};
            if (blueprintData.range.value == null) blueprintData.range.value = r.value ?? null;
            if (blueprintData.range.long == null && r.long != null) blueprintData.range.long = r.long;
            if (!blueprintData.range.units) blueprintData.range.units = r.units ?? "";
        }

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

    /* The deferred activity, so an applied effect does not land a round before its payload. */
    function effectHostActivityId(item) {
        return payloadActivityId(item?.flags?.gmm?.blueprint);
    }

    /* Raw source entries, not prepared documents; null when the activity is absent. */
    function _gmmActivityEffectSource(item) {
        const activity = item?.system?.activities?.get?.(effectHostActivityId(item));
        if (!activity) return null;
        const source = activity.toObject?.() ?? activity._source ?? {};
        return Array.isArray(source.effects) ? source.effects : [];
    }

    /* Membership of that list is what surfaces the Apply Effect button. */
    function isEffectAppliedByGmmActivity(item, effectId) {
        const effects = _gmmActivityEffectSource(item);
        if (!effects) return false;
        return effects.some(e => e?._id === effectId);
    }

    /* The two modes are a pair of settings, not one flag: `transfer` and applied-list membership. */
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
            promises.push(item.updateActivity(effectHostActivityId(item), { effects: nextEffects }));
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
        GMM_DEFERRED_ACTIVITY_ID,
        GMM_ZONE_ACTIVITY_ID,
        GMM_DOOM_CLOCK_EFFECT_ID,
        GMM_FORGED_EFFECT_IDS,
        isGmmActivityId,
        strandedDoomClock,
        strandedDurationCarrier,
        readDeferral,
        isAutomatedDeferral,
        isDelayedDeferral,
        isDoomingDeferral,
        gateActivityId,
        payloadActivityId,
        effectHostActivityId,
        needsActivityRebuild,
        ATTACK_TYPES,
        activityTypeFor,
        missPercentage,
        onSaveFor,
        damagePartFromBlueprint,
        damagePartToBlueprint,
        isAreaTarget,
        readZone,
        readZoneLists,
        zoneRules,
        hasZoneActivity,
        buildActivityData,
        buildDeferredActivityData,
        buildZoneActivityData,
        buildDoomClockEffectData,
        buildActivityUpdate,
        buildDurationEffectData,
        buildSaveDcFormula,
        readActivityIntoBlueprintData,
        readItemUsesIntoBlueprintData,
        chargesWithoutPool,
        resolveActivityFormulas,
        buildAttackToHitTerms,
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
