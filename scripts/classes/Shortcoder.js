import CompatibilityHelpers from "./CompatibilityHelpers.js";
import { formatTargetLabel } from "./Labels.js";
const Shortcoder = (function () {
    /* Each entry is `{ code, data?, type?, resolver? }`.
     * - `data` (string)            – dotted path on `monsterData` to read a numeric / string value from.
     * - `resolver` (fn)            – takes (monsterData, itemContext) and returns the substitution. When
     *                                provided this takes precedence over `data`. Returning `undefined`
     *                                signals "skip" so the literal token survives unchanged.
     * - `type: "string"`           – if set, after substitution the surrounding `[]` brackets are stripped
     *                                so the value renders as plain text rather than an evaluable token. */
    const SHORTCODES = [
        { code: "level", data: "level.value" },
        { code: "attackBonus", data: "attack_bonus.value" },
        { code: "damage", data: "damage_per_action.value" },
        { code: "dcPrimaryBonus", data: "attack_dcs.primary.value" },
        { code: "strMod", data: "ability_modifiers.str.value" },
        { code: "dexMod", data: "ability_modifiers.dex.value" },
        { code: "conMod", data: "ability_modifiers.con.value" },
        { code: "intMod", data: "ability_modifiers.int.value" },
        { code: "wisMod", data: "ability_modifiers.wis.value" },
        { code: "chaMod", data: "ability_modifiers.cha.value" },
        { code: "maxMod", data: "ability_modifiers.max.value" },
        { code: "strSave", data: "saving_throws.str.value" },
        { code: "dexSave", data: "saving_throws.dex.value" },
        { code: "conSave", data: "saving_throws.con.value" },
        { code: "intSave", data: "saving_throws.int.value" },
        { code: "wisSave", data: "saving_throws.wis.value" },
        { code: "chaSave", data: "saving_throws.cha.value" },
        { code: "proficiency", data: "proficiency_bonus.value" },
        { code: "xp", data: "xp.value" },
        { code: "cr", data: "challenge_rating.value" },
        { code: "ac", data: "armor_class.value" },
        { code: "hpMax", data: "hit_points.maximum.value" },
        { code: "damageDie", data: "damage_per_action.die_size" },
        { code: "name", data: "name", type: "string" },
        {
            code: "target",
            type: "string",
            // Item-scoped: resolves to the formatted target label of the GMMC blueprint that owns
            // this description. Returns `undefined` (token preserved) when no item context is
            // supplied, so callers that don't pass an item don't accidentally erase the marker.
            resolver: (_monsterData, itemContext) => {
                if (!itemContext) return undefined;
                const target = itemContext?.flags?.gmm?.blueprint?.data?.target;
                return formatTargetLabel(target);
            }
        }
    ];

    function _resolveShortcodeValue(entry, monsterData, itemContext) {
        if (typeof entry.resolver === "function") {
            try { return entry.resolver(monsterData, itemContext); }
            catch (e) { console.error("GMM | shortcode resolver failed", entry.code, e); return undefined; }
        }
        if (entry.data && CompatibilityHelpers.hasProperty(monsterData, entry.data)) {
            return CompatibilityHelpers.getProperty(monsterData, entry.data);
        }
        return undefined;
    }

    function replaceShortcodes(text, monsterData, isDamage = false, itemContext = null) {
        if (!text) return "";
        if (!monsterData && !itemContext) return text;
        return text.replace(/\[.*?\]/g, (token) => {
            SHORTCODES.forEach((x) => {
                const value = _resolveShortcodeValue(x, monsterData, itemContext);
                if (value === undefined) return;
                try {
                    let regex = new RegExp(`\\b${x.code}\\b`, 'gi');
                    if (regex.test(token)) {
                        token = token.replace(regex, value);
                        if (x.type && x.type === "string") {
                            token = token.replace(/\[(.*?)\]/g, (token, t1) => t1);
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            try {
                token = token.replace(/\[(.*?)(, *?d(\d+))?\]/g, (token, t1, t2, t3) => _numberToRandom(token, t1, t3, monsterData?.damage_per_action?.maximum_dice));
            } catch (e) {
                if(e.message.startsWith("Undefined symbol") || e.message.startsWith("Value expected") || e.name === "SyntaxError") return token;
                console.error(e);
            }
            //Indicates a problem with a damage shortcode, which needs to fail
            if (isDamage && token.includes("["))
                return "";
            return token;
        });
    }

    function replaceShortcodesAndAddDamageType(text, monsterData, damageType, isDamage = false, itemContext = null) {
        let replaceText = replaceShortcodes(text, monsterData, isDamage, itemContext);
        return replaceText.replace(/(\d[^\+\- ]*)[\+\- ]?/g, (token) => token.trim() + (damageType ? `[${damageType}]` : ""));
    }

    function replaceShortcodesAndAddDamageTypeDamageObject(text, monsterData, damageType, isDamage = false, itemContext = null) {
        let replaceText = replaceShortcodes(text, monsterData, isDamage, itemContext);
        return [replaceText, damageType];
    }


    function _numberToRandom(token, value, die, maximumDice) {
        try {
            let valueMath = math.evaluate(value);
            if (die != undefined) {
                let scale = (Number(die) + 1) / 2;
                let dice = (maximumDice) ? Math.min(Math.floor(valueMath / scale), maximumDice) : Math.floor(valueMath / scale);
                let modifier = valueMath - Math.floor(dice * scale);

                if (dice > 0) {
                    return dice + "d" + die + ((modifier != 0) ? (" " + ((modifier > 0) ? "+ " : "− ") + Math.abs(modifier)) : "");
                } else {
                    return valueMath;
                }
            } else {
                return valueMath;
            }
        } catch (e) {
            if (e.message.startsWith("Undefined symbol") || e.message.startsWith("Value expected") || e.name === "SyntaxError")
                return token;
            console.error(e);
        }
    }

    return {
        replaceShortcodes: replaceShortcodes,
        replaceShortcodesAndAddDamageType: replaceShortcodesAndAddDamageType,
        replaceShortcodesAndAddDamageTypeDamageObject: replaceShortcodesAndAddDamageTypeDamageObject
    };
})();

export default Shortcoder;