import AutomationHelpers from './AutomationHelpers.js';
import ParagonDefenses from './ParagonDefenses.js';
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
		const monsterBlueprint = MonsterBlueprint.createBaseFromActor(actor);
		const baseAttributes = MonsterForge.createBaseAttributes(monsterBlueprint);
		actorData.attributes.ac.calc = "natural";
		actorData.attributes.ac.flat = baseAttributes.armor_class.value;
		actorData.attributes.ac.base = baseAttributes.armor_class.value;
		if (!baseAttributes.hit_points.use_formula) {
			actorData.attributes.hp.max = baseAttributes.hit_points.maximum.value;
		}
	}
	function _postProcessData(actor) {
		const actorData = actor.system;
		const monsterBlueprint = actor.flags.gmm.blueprint;
		const monsterArtifact = actor.flags.gmm.monster;
		const monsterData = monsterArtifact.data;
		const rollData = actor.getRollData({ deterministic: true });
		const globalSkillBonus = dnd5e.utils.simplifyBonus(actorData.bonuses?.abilities?.skill, rollData);
		GMM_5E_SKILLS.forEach((x) => {
			const skill = actorData.skills[x.foundry];
			const monsterSkill = monsterData.skills.find((y) => y.code == x.name);
			if (monsterSkill) {
				// The ability and global check bonuses reach every check, so they live on check_modifiers instead.
				monsterSkill.add(dnd5e.utils.simplifyBonus(skill.bonuses.check, rollData), game.i18n.format('gmm.common.derived_source.check_bonus'));
				monsterSkill.add(globalSkillBonus, game.i18n.format('gmm.common.derived_source.skill_bonus'));
			}
			if (x.name === "perception") {
				// dnd5e counts every check bonus toward a passive score; the forge only had the ability modifier.
				monsterData.passive_perception.add(skill.bonus ?? 0, game.i18n.format('gmm.common.derived_source.check_bonus'));
				monsterData.passive_perception.add(dnd5e.utils.simplifyBonus(skill.bonuses.passive, rollData), game.i18n.format('gmm.common.derived_source.passive_bonus'));
			}
		});
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
		});

		// init.mod was copied out before this, so folding the bonuses in here cannot double-count the roll.
		const init = actorData.attributes.init;
		const initBonus = dnd5e.utils.simplifyBonus(init.bonus, rollData);
		const initCheckBonus = actorData.abilities[monsterData.initiative.ability]?.checkBonus ?? 0;
		monsterData.initiative.add(initBonus, game.i18n.format('gmm.common.derived_source.relative_modifier'));
		monsterData.initiative.add(initCheckBonus, game.i18n.format('gmm.common.derived_source.check_bonus'));

		// prepareInitiative derived these from the pre-scaling ability modifier, before init.mod replaced it.
		const alert = actor.flags?.dnd5e?.initiativeAlert && (dnd5e.settings?.rulesVersion === "legacy") ? 5 : 0;
		init.total = init.mod + initBonus + initCheckBonus + (actorData.attributes.quality?.value ?? 0) + alert
			+ (Number.isNumeric(init.prof.term) ? init.prof.flat : 0);
		init.score = (CONFIG.DND5E.skillPassive?.base ?? 10) + init.total
			+ ((init.roll?.mode ?? 0) * (CONFIG.DND5E.skillPassive?.modifier ?? 5));

		// Display-only: the roll gets these per action type from Activities.buildAttackToHitTerms.
		monsterData.attack_bonus.display = monsterData.attack_bonus.value + _getGlobalAttackBonus(actorData, rollData);
	}

	/* A block that reads "to Attacks/Spells" can only show what every action type gets, so an
	 * action-type-specific bonus (`bonuses.weapon.attack`, which DAE writes to mwak/rwak alone) is excluded. */
	function _getGlobalAttackBonus(actorData, rollData) {
		const bonuses = GMM_5E_ATTACK_ACTION_TYPES.map((x) => dnd5e.utils.simplifyBonus(actorData.bonuses?.[x]?.attack, rollData));
		return Math.min(...bonuses);
	}

	/* dnd5e keys every global attack bonus per action type; DAE's `system.bonuses.All-Attacks` writes all four. */
	const GMM_5E_ATTACK_ACTION_TYPES = ["mwak", "rwak", "msak", "rsak"];

	// Absent by design, along with resources.legres.value - dnd5e re-derives these from spent/max
	const GMM_DERIVED_ABILITY_FIELDS = ["value", "mod", "proficient", "saveProf", "checkProf", "dc"];
	const GMM_DERIVED_SKILL_FIELDS = ["value", "mod", "prof", "total", "passive"];

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
		"system.attributes.hp.max",
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

	/* The forge derives too much from an ability modifier to replay these with the rest of the list. */
	const GMM_EFFECT_ABILITY_KEYS = new Set(
		GMM_5E_ABILITIES.flatMap((x) => ["value", "mod"].map((f) => `system.abilities.${x}.${f}`))
	);

	/* The Forge sheet reads these off the artifact, so a replayed change is invisible until it is folded back.
	 * Absent by design: a skill's mod is the ability's, and value/prof target a Proficiency object. */
	const GMM_RECONCILED_NODES = new Map([
		["system.attributes.init.mod", (x) => x.initiative],
		["system.attributes.prof", (x) => x.proficiency_bonus],
		["system.details.cr", (x) => x.challenge_rating],
		["system.details.xp.value", (x) => x.xp],
		["system.attributes.hp.max", (x) => x.hit_points.maximum],
		["system.attributes.spell.dc", (x) => x.spellbook.spellcasting.dc],
		["system.attributes.encumbrance.max", (x) => x.inventory.capacity],
		["system.attributes.encumbrance.value", (x) => x.inventory.weight],
		[`system.skills.${GMM_5E_SKILLS.find((x) => x.name == "perception").foundry}.passive`, (x) => x.passive_perception],
		...GMM_5E_SKILLS.map((x) => [`system.skills.${x.foundry}.total`, (y) => y.skills.find((z) => z.code == x.name)])
	]);

	/* Targets a scaling which a monster cannot honor, each with the reason the console reports. */
	const GMM_UNSUPPORTED_EFFECT_TARGETS = new Map([
		["flags.gmm.blueprint", "The blueprint is read before effects apply, so this will reach the sheet inconsistently or not at all."],
		["system.attributes.hp.effectiveMax", "It is re-derived from system.attributes.hp.max and system.attributes.hp.tempmax after effects apply; target one of those instead."]
	]);
	const GMM_UNSUPPORTED_EFFECT_PREFIXES = [...GMM_UNSUPPORTED_EFFECT_TARGETS.keys()];
	const _reportedUnsupportedTargets = new Set();

	function _warnUnsupportedEffectTargets(actor, unsupported) {
		for (const entry of unsupported) {
			const id = `${actor.id}:${entry.effect?.id}:${entry.key}`;
			if (_reportedUnsupportedTargets.has(id)) continue;
			_reportedUnsupportedTargets.add(id);
			const reason = GMM_UNSUPPORTED_EFFECT_PREFIXES.filter((x) => entry.key.startsWith(x)).map((x) => GMM_UNSUPPORTED_EFFECT_TARGETS.get(x)).join(" ");
			console.warn(`GMM | Active effect "${entry.effect?.name}" on "${actor.name}" targets "${entry.key}", which is not a supported effect target on a scaling monster. ${reason}`);
		}
	}

	function _abilitiesTargetedByScore(changes) {
		return new Set(GMM_5E_ABILITIES.filter((x) => changes.some((y) => y.key === `system.abilities.${x}.value`)));
	}

	function _effectSourceLabel(changes) {
		const names = [...new Set(changes.map((x) => x.effect?.name).filter(Boolean))];
		return names.length === 1
			? names[0]
			: game.i18n.format('gmm.common.derived_source.active_effects', { count: names.length });
	}

	/* dnd5e resolves these from the bonus formulas before the derived pass, so they are already final. */
	function _collectCheckBonuses(actorData) {
		return Object.fromEntries(GMM_5E_ABILITIES.map((x) => [x, actorData.abilities[x].checkBonus ?? 0]));
	}

	/* The forge reads only the blueprint, so a modifier an effect moved is invisible to it. */
	function _reforgeWithAbilityEffects(actor, blueprint, artifact, changes, checkBonuses) {
		if (!changes.length) return artifact;

		const abilityDeltas = {};
		GMM_5E_ABILITIES.forEach((x) => {
			const ability = actor.system.abilities[x];
			const scaled = artifact.data.ability_modifiers[x].value;
			// A score-targeting effect is the 5e convention, so convert it the way dnd5e reads a score.
			const delta = (ability.mod - scaled) || (Math.floor((ability.value - 10) / 2) - scaled);
			if (!delta) return;
			const keys = [`system.abilities.${x}.value`, `system.abilities.${x}.mod`];
			abilityDeltas[x] = { value: delta, source: _effectSourceLabel(changes.filter((y) => keys.includes(y.key))) };
		});

		return Object.keys(abilityDeltas).length
			? MonsterForge.createArtifact(blueprint, { abilityDeltas: abilityDeltas, checkBonuses: checkBonuses })
			: artifact;
	}

	/* Taken before the replay so the delta measures what it moved, not how the schema and artifact differ. */
	function _snapshotReconciledNodes(actor, changes) {
		const snapshot = new Map();
		for (const change of changes) {
			if (!GMM_RECONCILED_NODES.has(change.key)) continue;
			const entry = snapshot.get(change.key);
			if (entry) entry.changes.push(change);
			else snapshot.set(change.key, { before: Number(foundry.utils.getProperty(actor, change.key)), changes: [change] });
		}
		return snapshot;
	}

	/* The forge's floors are deliberately not re-asserted: the sheet has to show the number the die uses. */
	function _reconcileArtifactWithEffects(actor, monsterData, snapshot) {
		for (const [key, entry] of snapshot) {
			const node = GMM_RECONCILED_NODES.get(key)(monsterData);
			const delta = Number(foundry.utils.getProperty(actor, key)) - entry.before;
			if (!node || !Number.isFinite(delta)) continue;
			node.add(delta, _effectSourceLabel(entry.changes));
		}
	}

	/* A rolled total is the creature's own maximum once it exists; until then the scaled average stands in for it. */
	function _resolveMaximumHitPoints(blueprint, monsterData) {
		const rolled = Number(blueprint.data.hit_points.rolled_max) || 0;
		return (monsterData.hit_points.use_formula && rolled) ? rolled : monsterData.hit_points.maximum.value;
	}

	/* Prepare actor-specific derived data (abilities, skills, CR, HP, initiative, encumbrance, spellcasting). */
	function _prepareMonsterDerivedData(actor) {
		try {
			const actorData = actor.system;
			const monsterBlueprint = MonsterBlueprint.createFromActor(actor);
			const effectChanges = AutomationHelpers.collectOverwrittenEffects(actor, GMM_DERIVED_KEYS, GMM_EFFECT_ABILITY_KEYS, GMM_UNSUPPORTED_EFFECT_PREFIXES);
			if (effectChanges.unsupported.length) _warnUnsupportedEffectTargets(actor, effectChanges.unsupported);
			const checkBonuses = _collectCheckBonuses(actorData);
			let monsterArtifact = MonsterForge.createArtifact(monsterBlueprint, { checkBonuses: checkBonuses });

			// The replay reads these as its base, so they are seeded before it rather than in the pass below.
			GMM_5E_ABILITIES.forEach((x) => {
				actorData.abilities[x].value = monsterArtifact.data.ability_modifiers[x].score;
				actorData.abilities[x].mod = monsterArtifact.data.ability_modifiers[x].value;
			});
			AutomationHelpers.applyOverwrittenEffects(actor, effectChanges.early);
			monsterArtifact = _reforgeWithAbilityEffects(actor, monsterBlueprint, monsterArtifact, effectChanges.early, checkBonuses);

			const monsterData = monsterArtifact.data;
			actor.flags.gmm = {
				blueprint: monsterBlueprint,
				monster: monsterArtifact
			};

			const scoreTargeted = _abilitiesTargetedByScore(effectChanges.early);
			GMM_5E_ABILITIES.forEach((x) => {
                // Nothing derives from the score, so an effect that set one outright should keep it.
                if (!scoreTargeted.has(x)) actorData.abilities[x].value = monsterData.ability_modifiers[x].score;
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
				const skill = actorData.skills[x.foundry];
				skill.value = 0;
				skill.mod = monsterData.ability_modifiers[skill.ability].value;
				skill.prof = new Proficiency(monsterSkill ? monsterSkill.value : 0, 1);
				// `bonus` is left as dnd5e resolved it: the skill, ability and global check bonuses.
				// Proficiency stringifies to its term, so adding the object would build text, not a total.
				skill.total = skill.mod + (skill.bonus ?? 0) + (Number.isNumeric(skill.prof.term) ? skill.prof.flat : 0);
				if (x.name == "perception") {
					skill.passive = monsterData.passive_perception.value;
				} else {
					skill.passive = 10 + skill.total;
				}
			});

			actorData.details.cr = monsterData.challenge_rating.value;
			actorData.details.xp.value = monsterData.xp.value;
			actorData.attributes.prof = monsterData.proficiency_bonus.value;
			monsterData.armor_class.display = actorData.attributes.ac.value;

			

			// Both HP modes: the replay below is unconditional, so a mode that skipped this would count an effect twice.
			actorData.attributes.hp.max = _resolveMaximumHitPoints(monsterBlueprint, monsterData);

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

			const reconciledNodes = _snapshotReconciledNodes(actor, effectChanges.late);
			AutomationHelpers.applyOverwrittenEffects(actor, effectChanges.late);
			_reconcileArtifactWithEffects(actor, monsterData, reconciledNodes);

			// dnd5e derived the whole hit point read model before the scaled maximum existed, and its
			// half-health halving has to land on the replayed one rather than the number it saw.
			dnd5e.dataModels?.actor?.AttributesFields?.prepareHitPoints?.call(actorData, actorData.attributes.hp);
			monsterData.hit_points.natural_maximum = actorData.attributes.hp.max;
			monsterData.hit_points.effective_maximum = actorData.attributes.hp.effectiveMax;
			monsterData.hit_points.temporary_maximum = actorData.attributes.hp.tempmax;

			// Reads the finished artifact and current hit points, so it goes after the late replay.
			ParagonDefenses.prepareDerivedData(actor);

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
