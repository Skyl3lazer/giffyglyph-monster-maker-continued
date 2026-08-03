import AutomationHelpers from './AutomationHelpers.js';
import MonsterBlueprint from './MonsterBlueprint.js';
import MonsterForge from './MonsterForge.js';
import { GMM_5E_ABILITIES } from "../consts/Gmm5eAbilities.js";
import { GMM_5E_SKILLS } from '../consts/Gmm5eSkills.js';
import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';

/* A patcher which controls actor data based on the selected sheet */
const GmmActor = (function () {
	//import Proficiency from '../../../../systems/dnd5e/module/actor/proficiency.js';
	function Proficiency(...args) {
		return new dnd5e.documents.Proficiency(...args);
	}
	/* Wrap libWrapper.register so a registration failure (e.g. against a method dnd5e has since
	 * removed) emits a console warning instead of throwing and aborting the rest of the patching. */
	function _safeWrap(target, fn, type) {
		try {
			libWrapper.register('giffyglyph-monster-maker-continued', target, fn, type);
			return true;
		} catch (error) {
			// Missing lib-wrapper is expected (the ready hook warns the user); any other failure means
			// a wrap target changed in this dnd5e version — surface that loudly rather than silently.
			console[game.modules.get('lib-wrapper')?.active ? "error" : "warn"](`GMM | libWrapper hook for "${target}" was not registered: ${error.message}`);
			return false;
		}
	}

	/* Patch the Foundry Actor5e entity to control how data is prepared based on the active sheet. */
	function patchActor5e() {
		_safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareBaseData', function (wrapped, ...args) {
			if (this.type == "npc" && this.getSheetId() == `${GMM_MODULE_TITLE}.MonsterSheet`) {
				wrapped(...args);
				_prepareMonsterBaseData(this);
			} else {
				wrapped(...args);
			}
		}, 'WRAPPER');
		_safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareDerivedData', function (wrapped, ...args) {
			if (this.type == "npc" && this.getSheetId() == `${GMM_MODULE_TITLE}.MonsterSheet`) {
				wrapped(...args);
				_prepareMonsterDerivedData(this);
				_postProcessData(this);
			} else {
				wrapped(...args);
			}
		}, 'WRAPPER');

		// Cache references to the original prototype methods only when they actually exist.
		const Actor5eProto = game.dnd5e.documents.Actor5e.prototype;
		if (typeof Actor5eProto.prepareBaseData === "function") Actor5eProto.prepare5eBaseData = Actor5eProto.prepareBaseData;
		if (typeof Actor5eProto.prepareDerivedData === "function") Actor5eProto.prepare5eDerivedData = Actor5eProto.prepareDerivedData;
		Actor5eProto.getSheetId = _getActorSheetId;
		Actor5eProto.isGmmMonster = _isGmmMonster;
	}

	/* Prepare actor-specific base data that does not depend on Items or Active Effects. */
	function _prepareMonsterBaseData(actor) {
		const actorData = actor.system;
		const monsterBlueprint = MonsterBlueprint.createFromActor(actor);
		const monsterArtifact = MonsterForge.createArtifact(monsterBlueprint);
		const monsterData = monsterArtifact.data;
		actorData.attributes.ac.calc = "natural";
		actorData.attributes.ac.flat = monsterData.armor_class.value;
		actorData.attributes.ac.base = monsterData.armor_class.value;
		if (!monsterData.hit_points.use_formula) {
			actorData.attributes.hp.max = monsterData.hit_points.maximum.value;
		}
		
	}
	function _postProcessData(actor) {
		const actorData = actor.system;
		const monsterBlueprint = actor.flags.gmm.blueprint;
		const monsterArtifact = actor.flags.gmm.monster;
		const monsterData = monsterArtifact.data;
		GMM_5E_SKILLS.forEach((x) => {
			let monsterSkill = monsterData.skills.find((y) => y.code == x.name);
			if(monsterSkill)
				monsterSkill.add(Number(actorData.skills[x.foundry].bonuses.check) ?? 0, "bonus");
			if (x.name === "perception" && actorData.skills[x.foundry].bonuses.passive)
				monsterData.passive_perception.add(Number(actorData.skills[x.foundry].bonuses.passive) ?? 0, "passive bonus");
				
		});
		const rollData = actor.getRollData({ deterministic: true });
		const globalSaveBonus = dnd5e.utils.simplifyBonus(actorData.bonuses?.abilities?.save, rollData);
		GMM_5E_ABILITIES.forEach((x) => {
			const ability = actorData.abilities[x];
			const abilitySaveBonus = dnd5e.utils.simplifyBonus(ability.bonuses.save, rollData);
			monsterData.saving_throws[x].add(abilitySaveBonus + globalSaveBonus, "bonus");

			// The roll never sees the artifact, so the forge's excess over mod + saveProf goes through bonuses.save.
			const proficiency = monsterBlueprint.data.trained_saves[x].trained ? monsterData.proficiency_bonus.value : 0;
			const derived = monsterData.ability_modifiers[x].value + proficiency + abilitySaveBonus + globalSaveBonus;
			const delta = monsterData.saving_throws[x].value - derived;
			if (delta) {
				const existing = String(ability.bonuses.save ?? "").trim();
				ability.bonuses.save = existing ? `${existing} ${delta < 0 ? "-" : "+"} ${Math.abs(delta)}` : String(delta);
			}

			// prepareAbilities ran before the derived pass replaced mod and saveProf, so its output is stale.
			const cover = x === "dex" ? (actorData.attributes.ac?.cover ?? 0) : 0;
			ability.saveBonus = abilitySaveBonus + delta + globalSaveBonus + cover;
			ability.save.value = ability.mod + ability.saveBonus
				+ (Number.isNumeric(ability.saveProf.term) ? ability.saveProf.flat : 0);
			//TODO: Deprecated, split in to ability + check mod
			//monsterData.ability_modifiers[x].setValue(actorData.abilities[x].mod, "bonus");
		});
		monsterData.initiative.applyModifier(actorData.attributes.init.bonus, false);
	}
	// `attack` and `save.value` are absent: dnd5e re-derives both from `mod` every prepare cycle.
	const GMM_DERIVED_ABILITY_FIELDS = ["value", "mod", "proficient", "saveProf", "checkProf", "dc"];
	const GMM_DERIVED_SKILL_FIELDS = ["value", "bonus", "mod", "prof", "total", "passive"];

	/* Effects apply before prepareDerivedData, so anything the pass below assigns would discard them. */
	const GMM_DERIVED_KEYS = new Set([
		...GMM_5E_ABILITIES.flatMap((x) => GMM_DERIVED_ABILITY_FIELDS.map((f) => `system.abilities.${x}.${f}`)),
		...GMM_5E_SKILLS.flatMap((x) => GMM_DERIVED_SKILL_FIELDS.map((f) => `system.skills.${x.foundry}.${f}`)),
		"system.details.cr",
		"system.details.xp.value",
		"system.attributes.prof",
		"system.attributes.init.prof",
		"system.attributes.init.ability",
		"system.attributes.init.mod",
		"system.attributes.hp.effectiveMax",
		"system.attributes.hp.formula",
		"system.attributes.encumbrance",
		"system.attributes.encumbrance.value",
		"system.attributes.encumbrance.max",
		"system.attributes.encumbrance.pct",
		"system.attributes.encumbrance.encumbered",
		"system.attributes.encumbrance.thresholds.encumbered",
		"system.attributes.encumbrance.thresholds.heavilyEncumbered",
		"system.attributes.encumbrance.thresholds.maximum",
		"system.attributes.encumbrance.stops.encumbered",
		"system.attributes.encumbrance.stops.heavilyEncumbered",
		"system.attributes.spellcasting",
		"system.attributes.spell.level",
		"system.attributes.spell.dc"
	]);

	/* Prepare actor-specific derived data (abilities, skills, CR, HP, initiative, encumbrance, spellcasting). */
	function _prepareMonsterDerivedData(actor) {
		try {
			const actorData = actor.system;
			const monsterBlueprint = MonsterBlueprint.createFromActor(actor);
			const monsterArtifact = MonsterForge.createArtifact(monsterBlueprint);
			const monsterData = monsterArtifact.data;
			actor.flags.gmm = {
				blueprint: monsterBlueprint,
				monster: monsterArtifact
			};

			GMM_5E_ABILITIES.forEach((x) => {
                actorData.abilities[x].value = monsterData.ability_modifiers[x].score;
                actorData.abilities[x].mod = monsterData.ability_modifiers[x].value;
                actorData.abilities[x].proficient = false;
                //actorData.abilities[x].prof = 0;
				actorData.abilities[x].saveProf = new Proficiency(monsterData.proficiency_bonus.value, monsterBlueprint.data.trained_saves[x].trained ? 1 : 0);
				actorData.abilities[x].checkProf = new Proficiency(0, 1);
				// Replace only save.value - the save object carries the .mode and .roll #rollD20Test needs.
				if (monsterBlueprint.data.trained_saves[x].trained) {
					actorData.abilities[x].proficient = true;
				}
                actorData.abilities[x].dc = 8 + monsterData.ability_modifiers[x].value;
                actorData.abilities[x].attack = monsterData.ability_modifiers[x].value + monsterData.proficiency_bonus.value;
            });

			GMM_5E_SKILLS.forEach((x) => {
				let monsterSkill = monsterData.skills.find((y) => y.code == x.name);
				actorData.skills[x.foundry].value = 0;
				actorData.skills[x.foundry].bonus = 0;
				actorData.skills[x.foundry].mod = monsterData.ability_modifiers[actorData.skills[x.foundry].ability].value;
				actorData.skills[x.foundry].prof = new Proficiency(monsterSkill ? monsterSkill.value : 0, 1);
				actorData.skills[x.foundry].total = actorData.skills[x.foundry].mod + actorData.skills[x.foundry].prof;
				if (x.name == "perception") {
					actorData.skills[x.foundry].passive = monsterData.passive_perception.value;
				} else {
					actorData.skills[x.foundry].passive = 10 + actorData.skills[x.foundry].total;
				}
			});

			actorData.details.cr = monsterData.challenge_rating.value;
			actorData.details.xp.value = monsterData.xp.value;
			actorData.attributes.prof = monsterData.proficiency_bonus.value;
			monsterData.armor_class.display = actorData.attributes.ac.value;

			

			actorData.attributes.hp.effectiveMax = monsterData.hit_points.maximum.value;

			// Mutate fields on the existing init RollConfigField object instead of replacing it wholesale;
			// replacing it would clobber `init.roll` (which carries advantage/disadvantage state) and other dnd5e v5+ fields.
			actorData.attributes.init.prof = new Proficiency(0, 1);
			actorData.attributes.init.ability = monsterData.initiative.ability;
			actorData.attributes.init.mod = monsterData.initiative.value;
			actorData.attributes.hp.formula = monsterData.hit_points.formula ? monsterData.hit_points.formula : '';
			
			actorData.attributes.encumbrance = {
				value: monsterData.inventory.weight.value,
				max: monsterData.inventory.capacity.value,
				pct: monsterData.inventory.encumbrance,
				encumbered: monsterData.inventory.encumbrance > (2 / 3),
				thresholds: {
					encumbered: monsterData.inventory.capacity.value * (1 / 3),
					heavilyEncumbered: monsterData.inventory.capacity.value * (2 / 3),
					maximum: monsterData.inventory.capacity.value
				},
				stops: {
					encumbered: (1 / 3),
					heavilyEncumbered: (2 / 3)
				}
			};
			actorData.attributes.spellcasting = monsterData.spellbook.spellcasting.ability;
			// This already ran, before the scaled spellcasting ability and attack bonus existed.
			dnd5e.dataModels?.actor?.AttributesFields?.prepareSpellcastingAbility?.call(actorData);
			// `system.details.spellLevel` was migrated to `system.attributes.spell.level`
			// and `system.attributes.spelldc` to `system.attributes.spell.dc` in dnd5e v5.x.
			actorData.attributes.spell ??= {};
			actorData.attributes.spell.level = monsterData.spellbook.spellcasting.level;
			actorData.attributes.spell.dc = monsterData.spellbook.spellcasting.dc.value;

			AutomationHelpers.reapplyOverwrittenEffects(actor, GMM_DERIVED_KEYS);

			// Compute owned item attributes which depend on prepared Actor data
			// The V1 `getSaveDC` / `getAttackToHit` calls were replaced by Activity-driven roll hooks (see GmmItem.patchItem5e)
			actor.items.contents.forEach((item) => {
				try {
					item.prepareShortcodes?.();
				} catch (e) {
					console.warn(`GMM | prepareShortcodes failed for item ${item.id}`, e);
				}
			});
		} catch (error) {
			console.error(error);
		}
	}

	/* Get the active sheet id for this actor, falling back to the core default NPC sheet. */
	function _getActorSheetId() {
		try {
			return this.getFlag("core", "sheetClass") || game.settings.get("core", "sheetClasses").Actor.npc;
		} catch (error) {
			return "";
		}
	}

	function _isGmmMonster() {
		return this.type === "npc" && this.getSheetId() === `${GMM_MODULE_TITLE}.MonsterSheet`;
	}

	return {
		patchActor5e: patchActor5e
	};
})();

export default GmmActor;
