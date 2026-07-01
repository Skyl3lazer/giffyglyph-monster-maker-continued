import { GMM_5E_ALIGNMENTS } from "../consts/Gmm5eAlignments.js";
import { GMM_5E_CONDITIONS } from "../consts/Gmm5eConditions.js";
import { GMM_5E_DAMAGE_TYPES } from "../consts/Gmm5eDamageTypes.js";
import { GMM_5E_LANGUAGES } from "../consts/Gmm5eLanguages.js";
import { GMM_5E_SIZES } from "../consts/Gmm5eSizes.js";
import { GMM_5E_SKILLS } from "../consts/Gmm5eSkills.js";
import { GMM_5E_UNITS } from "../consts/Gmm5eUnits.js";
import { GMM_MONSTER_BLUEPRINT } from "../consts/GmmMonsterBlueprint.js";
import { GMM_MONSTER_RANKS } from "../consts/GmmMonsterRanks.js";
import { GMM_MONSTER_ROLES } from "../consts/GmmMonsterRoles.js";
import { GMM_5E_XP } from "../consts/Gmm5eXp.js";
import CompatibilityHelpers from "./CompatibilityHelpers.js";

const MonsterBlueprint = (function () {

	// Plain path-to-path bindings used to copy values between the GMM blueprint and the underlying dnd5e Actor schema...
	// Anything that needs a value transform (e.g
	const mappings = [
		{ from: "biography.text", to: "system.details.biography.value" },
		{ from: "condition_immunities.other", to: "system.traits.ci.custom" },
		{ from: "damage_immunities.other", to: "system.traits.di.custom" },
		{ from: "damage_resistances.other", to: "system.traits.dr.custom" },
		{ from: "damage_vulnerabilities.other", to: "system.traits.dv.custom" },
		{ from: "description.image", to: "img" },
		{ from: "description.name", to: "name" },
		{ from: "description.type.category", to: "system.details.type.value" },
		{ from: "description.type.custom", to: "system.details.type.custom" },
		{ from: "description.type.tags", to: "system.details.type.subtype" },
		{ from: "hit_points.current", to: "system.attributes.hp.value" },
		{ from: "hit_points.temporary", to: "system.attributes.hp.temp" },
		{ from: "inventory.encumbrance.powerful_build", to: "flags.dnd5e.powerfulBuild" },
		{ from: "inventory.currency.cp", to: "system.currency.cp" },
		{ from: "inventory.currency.ep", to: "system.currency.ep" },
		{ from: "inventory.currency.gp", to: "system.currency.gp" },
		{ from: "inventory.currency.pp", to: "system.currency.pp" },
		{ from: "inventory.currency.sp", to: "system.currency.sp" },
		{ from: "lair_actions.always_show", to: "system.resources.lair.value" },
		{ from: "lair_actions.initiative", to: "system.resources.lair.initiative" },
		{ from: "languages.other", to: "system.traits.languages.custom" },
		{ from: "legendary_actions.maximum", to: "system.resources.legact.max" },
		{ from: "legendary_resistances.maximum", to: "system.resources.legres.max" },
		{ from: "senses.blindsight", to: "system.attributes.senses.ranges.blindsight" },
		{ from: "senses.darkvision", to: "system.attributes.senses.ranges.darkvision" },
		{ from: "senses.other", to: "system.attributes.senses.special" },
		{ from: "senses.tremorsense", to: "system.attributes.senses.ranges.tremorsense" },
		{ from: "senses.truesight", to: "system.attributes.senses.ranges.truesight" },
		{ from: "speeds.burrow", to: "system.attributes.movement.burrow" },
		{ from: "speeds.can_hover", to: "system.attributes.movement.hover" },
		{ from: "speeds.climb", to: "system.attributes.movement.climb" },
		{ from: "speeds.fly", to: "system.attributes.movement.fly" },
		{ from: "speeds.swim", to: "system.attributes.movement.swim" },			
		{ from: "speeds.walk", to: "system.attributes.movement.walk" },
		{ from: "spellbook.slots.1.current", to: "system.spells.spell1.value" },
		{ from: "spellbook.slots.1.maximum", to: "system.spells.spell1.override" },
		{ from: "spellbook.slots.2.current", to: "system.spells.spell2.value" },
		{ from: "spellbook.slots.2.maximum", to: "system.spells.spell2.override" },
		{ from: "spellbook.slots.3.current", to: "system.spells.spell3.value" },
		{ from: "spellbook.slots.3.maximum", to: "system.spells.spell3.override" },
		{ from: "spellbook.slots.4.current", to: "system.spells.spell4.value" },
		{ from: "spellbook.slots.4.maximum", to: "system.spells.spell4.override" },
		{ from: "spellbook.slots.5.current", to: "system.spells.spell5.value" },
		{ from: "spellbook.slots.5.maximum", to: "system.spells.spell5.override" },
		{ from: "spellbook.slots.6.current", to: "system.spells.spell6.value" },
		{ from: "spellbook.slots.6.maximum", to: "system.spells.spell6.override" },
		{ from: "spellbook.slots.7.current", to: "system.spells.spell7.value" },
		{ from: "spellbook.slots.7.maximum", to: "system.spells.spell7.override" },
		{ from: "spellbook.slots.8.current", to: "system.spells.spell8.value" },
		{ from: "spellbook.slots.8.maximum", to: "system.spells.spell8.override" },
		{ from: "spellbook.slots.9.current", to: "system.spells.spell9.value" },
		{ from: "spellbook.slots.9.maximum", to: "system.spells.spell9.override" },
		{ from: "spellbook.slots.pact.current", to: "system.spells.pact.value" },
		{ from: "spellbook.slots.pact.maximum", to: "system.spells.pact.override" },
		{ from: "spellbook.spellcasting.ability", to: "system.attributes.spellcasting" },
		{ from: "spellbook.spellcasting.level", to: "system.attributes.spell.level" }
	];

	function createFromActor(actor) {
		const blueprint = $.extend(true, {}, GMM_MONSTER_BLUEPRINT, actor.flags.gmm ? _verifyBlueprint(actor.flags.gmm.blueprint) : _getInitialData(actor));
		return _syncActorDataToBlueprint(blueprint, actor);
	}

	function _getInitialData(actor) {
		let actorData = actor.system;
		let resources = actorData.resources;
		let combatType = (resources.lair.value) ? "paragon" : (resources.legact.max || resources.legres.max) ? "elite": "grunt";
		let combatRank = GMM_MONSTER_RANKS[combatType];
		let abilityRankings = Object.entries(actorData.abilities).sort((x, y) => y[1].value - x[1].value).map((x) => x[0]);
		let combatLevel = GMM_5E_XP.filter((x) => x.xp <= (actorData.details.xp?.value ?? 0) / combatRank.xp).pop().level;
		let combatRole = "striker";
		switch (abilityRankings[0]) {
			case "dex":
				combatRole = "skirmisher";
				break;
			case "con":
				combatRole = "defender";
				break;
			case "int":
				combatRole = "controller";
				break;
			case "wis":
				combatRole = "lurker";
				break;
			case "cha":
				combatRole = "supporter";
				break;
		}

		return {
			data: {
				ability_modifiers: {
					ranking: abilityRankings,
				},
				saving_throws: {
					ranking: abilityRankings,
				},
				combat: {
					level: combatLevel,
					rank: {
						type: combatType,
						modifiers: combatRank
					},
					role: {
						type: combatRole,
						modifiers: GMM_MONSTER_ROLES[combatRole]
					}
				}
			}
		}
	}

	function _verifyBlueprint(blueprint) {
		// Direct-leaf writes via `document.update({ "flags.gmm.blueprint.data.<x>":
		// v })` (e.g
		if (blueprint && blueprint.vid === undefined && blueprint.data) {
			blueprint.vid = 1;
			if (!blueprint.type) blueprint.type = "monster";
		}
		switch (blueprint?.vid) {
			case 1:
				// Blueprint is up-to-date and requires no changes.
				return blueprint;
			default:
				console.error(`This monster blueprint has an invalid version id [${blueprint?.vid}] and can't be verified.`, blueprint);
				return null;
		}
	}
	
	function _syncActorDataToBlueprint(blueprint, actor) {
		const blueprintData = blueprint.data;
		const actorData = actor;
		try {
			mappings.forEach((x) => {
				if (CompatibilityHelpers.hasProperty(actor, x.to)) {
					CompatibilityHelpers.setProperty(blueprintData, x.from, CompatibilityHelpers.getProperty(actor, x.to));
				}
			});

			blueprintData.actions.items = [];
			blueprintData.bonus_actions.items = [];
			blueprintData.description.alignment = _getActorAlignment(actor.system.details.alignment);
			blueprintData.description.size = GMM_5E_SIZES.find((x) => x.foundry == actor.system.traits.size)?.name;
			blueprintData.description.type.swarm = GMM_5E_SIZES.find((x) => x.foundry == actor.system.details.type.swarm)?.name;
			// Initiative advantage moved from `flags.dnd5e.initiativeAdv` (boolean) to
			// `system.attributes.init.roll.mode` (number, 1 = advantage, -1 = disadvantage).
			blueprintData.initiative.advantage = actor.system?.attributes?.init?.roll?.mode === 1;
			// `system.resources.legact.value` / `legres.value` are no longer stored fields dnd5e derives them from `max - spen...
			// Recompute the "current remaining" value here so the blueprint shows correct numbers even when this runs during p
			const legact = actor.system?.resources?.legact ?? {};
			blueprintData.legendary_actions.current = (legact.max ?? 0) - (legact.spent ?? 0);
			const legres = actor.system?.resources?.legres ?? {};
			blueprintData.legendary_resistances.current = (legres.max ?? 0) - (legres.spent ?? 0);
			blueprintData.inventory.encumbrance.powerful_build = actor.flags.dnd5e && actor.flags.dnd5e.powerfulBuild;
			blueprintData.inventory.items = [];
			blueprintData.lair_actions.items = [];
			blueprintData.legendary_actions.items = [];
			blueprintData.reactions.items = [];
			blueprintData.senses.units = GMM_5E_UNITS.find((x) => x.foundry == actor.system.attributes.senses.units)?.name;
			blueprintData.speeds.units = GMM_5E_UNITS.find((x) => x.foundry == actor.system.attributes.movement.units)?.name;
			blueprintData.spellbook.spellcasting.ability = (actor.system.attributes.spellcasting == "") ? "int" : actor.system.attributes.spellcasting;
			// First-time conversion: vanilla NPCs with spell items usually have spell.level=0; mirror combat level so casters scale.
			if (!actor.flags?.gmm
				&& !blueprintData.spellbook.spellcasting.level
				&& actor.items?.some?.(i => i.type === "spell")) {
				blueprintData.spellbook.spellcasting.level = blueprintData.combat?.level ?? 1;
			}
			blueprintData.spellbook.spells.other = [];
			blueprintData.spellbook.spells[0] = [];
			blueprintData.spellbook.spells[1] = [];
			blueprintData.spellbook.spells[2] = [];
			blueprintData.spellbook.spells[3] = [];
			blueprintData.spellbook.spells[4] = [];
			blueprintData.spellbook.spells[5] = [];
			blueprintData.spellbook.spells[6] = [];
			blueprintData.spellbook.spells[7] = [];
			blueprintData.spellbook.spells[8] = [];
			blueprintData.spellbook.spells[9] = [];
			blueprintData.traits.items = [];
			
			GMM_5E_SKILLS.forEach((x) => {
				let actorSkill = actorData.system.skills[x.foundry];
				switch (actorSkill.value) {
					case 0.5:
						blueprintData.skills[x.name] = "half-proficient";
						break;
					case 1:
						blueprintData.skills[x.name] = "proficient";
						break;
					case 2:
						blueprintData.skills[x.name] = "expert";
						break;
					default:
						blueprintData.skills[x.name] = "";
						break;
				}
			});

			actor.system.traits.di.value.forEach((x) => blueprintData.damage_immunities[x] = true);
			actor.system.traits.dr.value.forEach((x) => blueprintData.damage_resistances[x] = true);
			actor.system.traits.dv.value.forEach((x) => blueprintData.damage_vulnerabilities[x] = true);
			actor.system.traits.ci.value.forEach((x) => blueprintData.condition_immunities[x] = true);
			actor.system.traits.languages.value.forEach((x) => blueprintData.languages[x] = true);

			if (actor.items) {
				try {
					actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach(x => {
						let item = actor.items.get(x.id)
						switch (item.getSortingCategory()) {
							case "spell":
								let spell_level = x.system.level || 0;
								blueprintData.spellbook.spells[`${spell_level < 10 ? spell_level : "other"}`].push(_getItemDetails(item));
								break;
							case "bonus":
								blueprintData.bonus_actions.items.push(_getItemDetails(item));
								break;
							case "reaction":
								blueprintData.reactions.items.push(_getItemDetails(item));
								break;
							case "lair":
								blueprintData.lair_actions.items.push(_getItemDetails(item));
								break;
							case "legendary":
								blueprintData.legendary_actions.items.push(_getItemDetails(item));
								break;
							case "trait":
								blueprintData.traits.items.push(_getItemDetails(item));
								break;
							case "loot":
								blueprintData.inventory.items.push(_getItemDetails(item, blueprintData.display));
								break;
							default: {
								// dnd5e v5+ moved `system.activation` off the item onto each activity
								// Walk the item's activities and treat any of the 5e-specialized "reaction*" activation types as a reaction so pre
								const activations = item.system?.activities?.contents?.map(a => a.activation?.type).filter(_ => _) ?? [];
								const isSpecialReaction = activations.some(t =>
									t === "reactiondamage" || t === "reactionmanual" || t === "reactionpreattack"
								);
								if (isSpecialReaction) {
									blueprintData.reactions.items.push(_getItemDetails(item));
								} else {
									blueprintData.actions.items.push(_getItemDetails(item));
								}
								break;
							}
						}
					});

					blueprintData.actions.items.sort((a, b) => getSortValue(a, b));
					blueprintData.inventory.items.sort((a, b) => getSortValue(a, b));
					blueprintData.traits.items.sort((a, b) => getSortValue(a, b));
					blueprintData.legendary_actions.items.sort((a, b) => getSortValue(a, b));
					blueprintData.lair_actions.items.sort((a, b) => getSortValue(a, b));
					blueprintData.reactions.items.sort((a, b) => getSortValue(a, b));
					blueprintData.bonus_actions.items.sort((a, b) => getSortValue(a, b));
				} catch (e) {
					console.warn(e);
				}
			}

			return blueprint;
		} catch (error) {
			console.error("Failed to load blueprint data from the current actor", error);
			return blueprint;
		}
	}
	function getSortValue(a, b) {
		let aRarity = 0;
		let bRarity = 0;
		switch (a.rarity) {
			case "common":
				aRarity = 0;
				break;
			case "uncommon":
				aRarity = 1;
				break;
			case "rare":
				aRarity = 2;
				break;
			default:
				aRarity = 3;
				break;
		}
		switch (b.rarity) {
			case "common":
				bRarity = 0;
				break;
			case "uncommon":
				bRarity = 1;
				break;
			case "rare":
				bRarity = 2;
				break;
			default:
				bRarity = 3;
				break;
		}
		//Rarity descending, name ascending
		let sortValue = bRarity - aRarity || a.name.localeCompare(b.name);
		return sortValue;
	}
	function getActorDataFromBlueprint(blueprint) {
		const actorData = {};

		mappings.forEach((x) => {
			if (CompatibilityHelpers.hasProperty(blueprint.data, x.from)) {
				CompatibilityHelpers.setProperty(actorData, x.to, CompatibilityHelpers.getProperty(blueprint.data, x.from));
			}
		});

		if (CompatibilityHelpers.hasProperty(blueprint.data, "description.alignment.category")) {
			const alignment = blueprint.data.description.alignment.category;
			if (alignment) {
				CompatibilityHelpers.setProperty(actorData, "system.details.alignment", game.i18n.format(`gmm.common.alignment.${alignment}`));
			} else {
				const custom = CompatibilityHelpers.getProperty(blueprint.data, "description.alignment.custom");
				CompatibilityHelpers.setProperty(actorData, "system.details.alignment", custom);
			}
		}

		if (CompatibilityHelpers.hasProperty(blueprint.data, "speeds.units")) {
			const unit = GMM_5E_UNITS.find((x) => x.name == blueprint.data.speeds.units);
			CompatibilityHelpers.setProperty(actorData, "system.attributes.movement.units", unit ? unit.foundry : null);
		}

		if (CompatibilityHelpers.hasProperty(blueprint.data, "senses.units")) {
			const unit = GMM_5E_UNITS.find((x) => x.name == blueprint.data.senses.units);
			CompatibilityHelpers.setProperty(actorData, "system.attributes.senses.units", unit ? unit.foundry : null);
		}

		if (CompatibilityHelpers.hasProperty(blueprint.data, "description.size")) {
			const size = GMM_5E_SIZES.find((x) => x.name == blueprint.data.description.size);
			CompatibilityHelpers.setProperty(actorData, "system.traits.size", size ? size.foundry : null);
		}

		if (CompatibilityHelpers.hasProperty(blueprint.data, "description.type.swarm")) {
			const size = GMM_5E_SIZES.find((x) => x.name == blueprint.data.description.type.swarm);
			CompatibilityHelpers.setProperty(actorData, "system.details.type.swarm", size ? size.foundry : "");
		}

		GMM_5E_SKILLS.forEach((x) => {
			if (CompatibilityHelpers.hasProperty(blueprint.data, `skills.${x.name}`)) {
				switch (blueprint.data.skills[x.name]) {
					case "half-proficient":
						CompatibilityHelpers.setProperty(actorData, `system.skills.${x.foundry}.value`, 0.5);
						break;
					case "proficient":
						CompatibilityHelpers.setProperty(actorData, `system.skills.${x.foundry}.value`, 1);
						break;
					case "expert":
						CompatibilityHelpers.setProperty(actorData, `system.skills.${x.foundry}.value`, 2);
						break;
					default:
						CompatibilityHelpers.setProperty(actorData, `system.skills.${x.foundry}.value`, 0);
						break;
				}
			}
		});

		_convertTraits(blueprint, actorData, GMM_5E_DAMAGE_TYPES, "damage_resistances", "dr");
		_convertTraits(blueprint, actorData, GMM_5E_DAMAGE_TYPES, "damage_vulnerabilities", "dv");
		_convertTraits(blueprint, actorData, GMM_5E_DAMAGE_TYPES, "damage_immunities", "di");
		_convertTraits(blueprint, actorData, GMM_5E_CONDITIONS, "condition_immunities", "ci");
		_convertTraits(blueprint, actorData, GMM_5E_LANGUAGES, "languages", "languages");

		// Legendary actions/resistances are now stored as `spent` (used count) rather than `value` (remaining count)
		// Translate the blueprint's "current remaining" into the dnd5e "spent" representation when writing back to the actor
		if (CompatibilityHelpers.hasProperty(blueprint.data, "legendary_actions.current")
			&& CompatibilityHelpers.hasProperty(blueprint.data, "legendary_actions.maximum")) {
			const max = Number(blueprint.data.legendary_actions.maximum) || 0;
			const current = Number(blueprint.data.legendary_actions.current) || 0;
			CompatibilityHelpers.setProperty(actorData, "system.resources.legact.spent", Math.max(0, max - current));
		}
		if (CompatibilityHelpers.hasProperty(blueprint.data, "legendary_resistances.current")
			&& CompatibilityHelpers.hasProperty(blueprint.data, "legendary_resistances.maximum")) {
			const max = Number(blueprint.data.legendary_resistances.maximum) || 0;
			const current = Number(blueprint.data.legendary_resistances.current) || 0;
			CompatibilityHelpers.setProperty(actorData, "system.resources.legres.spent", Math.max(0, max - current));
		}

		// Initiative advantage moved from `flags.dnd5e.initiativeAdv` (boolean) to `system.attributes.init.roll.mode` (num...
		// Mirror the boolean blueprint flag onto the new numeric mode (1 = advantage, 0 = none) when persisting the blueprint
		if (CompatibilityHelpers.hasProperty(blueprint.data, "initiative.advantage")) {
			CompatibilityHelpers.setProperty(
				actorData,
				"system.attributes.init.roll.mode",
				blueprint.data.initiative.advantage ? 1 : 0
			);
		}

		return actorData;
	}

	function _convertTraits(blueprint, actorData, values, blueprintField, foundryField) {
		if (CompatibilityHelpers.hasProperty(blueprint.data, `${blueprintField}.other`)) {
			let traits = [];
			values.forEach((x) => {
				if (blueprint.data[blueprintField][x]) {
					traits.push(x);
				}
			});
			CompatibilityHelpers.setProperty(actorData, `system.traits.${foundryField}.value`, traits);
		}
	}

	function _getActorAlignment(alignment) {
		if (alignment?.trim().length == 0) {
			return {
				category: "",
				custom: null
			}
		} else {
			let actorAlignment = alignment?.replace(/ /g, '_').trim().toLowerCase();
			if (GMM_5E_ALIGNMENTS.includes(actorAlignment)) {
				return {
					category: actorAlignment,
					custom: null
				}
			} else {
				return {
					category: "",
					custom: alignment.trim()
				}
			}
		}
	}

	function _getItemDetails(item, display) {
		let details = {
			id: item.id,
			name: item.name,
			img: item.img,
			weight: item.system.weight ? CompatibilityHelpers.weight(item.system.weight, display ? display.units : "") : 0,
			quantity: item.system.quantity ? item.system.quantity : 0,
			price: item.system.price ? item.system.price : 0,
			requirements: {
				level: {
					min: item.flags.gmm?.blueprint?.data?.requirements?.level?.min,
					max: item.flags.gmm?.blueprint?.data?.requirements?.level?.max
				},
				rank: item.flags.gmm?.blueprint?.data?.requirements?.rank,
				role: item.flags.gmm?.blueprint?.data?.requirements?.role
			},
			rarity: item.flags.gmm?.blueprint?.data?.rarity ? item.flags.gmm?.blueprint?.data?.rarity : ""
		};
		return details;
	}

	return {
		createFromActor: createFromActor,
		getActorDataFromBlueprint: getActorDataFromBlueprint
	};
})();

export default MonsterBlueprint;