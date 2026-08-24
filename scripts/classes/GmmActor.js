import AutomationHelpers from './AutomationHelpers.js';
import ParagonDefenses from './ParagonDefenses.js';
import MonsterBlueprint from './MonsterBlueprint.js';
import MonsterForge from './MonsterForge.js';
import { GMM_5E_ABILITIES } from "../consts/Gmm5eAbilities.js";
import { GMM_5E_SKILLS } from '../consts/Gmm5eSkills.js';
import { GMM_5E_SPEEDS } from '../consts/Gmm5eSpeeds.js';
import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';
import CompatibilityHelpers from './CompatibilityHelpers.js';

const GmmActor = (function () {
	function Proficiency(...args) {
		return new dnd5e.documents.Proficiency(...args);
	}

	function patchActor5e() {
		CompatibilityHelpers.safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareBaseData', function (wrapped, ...args) {
			if (this.type == "npc" && this.getSheetId() == `${GMM_MODULE_TITLE}.MonsterSheet`) {
				wrapped(...args);
				_prepareMonsterBaseData(this);
			} else {
				wrapped(...args);
				// A sheet switch away from the forge would otherwise leave the surface behind until a reload.
				delete this._gmmRollData;
				delete this._gmmBaseMax;
				delete this._gmmBaseProf;
				delete this._gmmBaseAbilityMods;
			}
		}, 'WRAPPER');
		CompatibilityHelpers.safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareDerivedData', function (wrapped, ...args) {
			if (this.type == "npc" && this.getSheetId() == `${GMM_MODULE_TITLE}.MonsterSheet`) {
				wrapped(...args);
				_prepareMonsterDerivedData(this);
				_postProcessData(this);
			} else {
				wrapped(...args);
			}
		}, 'WRAPPER');

		/* Foundry runs the data model's derived pass, where prepareMovement resolves every mode, before
		 * the document's. */
		CompatibilityHelpers.safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareEmbeddedDocuments', function (wrapped, ...args) {
			wrapped(...args);
			if (this.isGmmMonster()) _stashAppliedMovement(this);
		}, 'WRAPPER');

		/* Wrapped here rather than on applyActiveEffects because DAE applies its phase-corrected changes
		 * after delegating. */
		CompatibilityHelpers.safeWrap('game.dnd5e.documents.Actor5e.prototype.prepareData', function (wrapped, ...args) {
			wrapped(...args);
			if (this.isGmmMonster()) _prepareMonsterSettledData(this);
		}, 'WRAPPER');

		// DAE wraps this too, through libWrapper. The two interleave by priority.
		CompatibilityHelpers.safeWrap('game.dnd5e.documents.Actor5e.prototype.getRollData', function (wrapped, ...args) {
			const data = wrapped(...args);
			if (this._gmmRollData) data.gmm = this._gmmRollData;
			return data;
		}, 'WRAPPER');

		const Actor5eProto = game.dnd5e.documents.Actor5e.prototype;
		if (typeof Actor5eProto.prepareBaseData === "function") Actor5eProto.prepare5eBaseData = Actor5eProto.prepareBaseData;
		if (typeof Actor5eProto.prepareDerivedData === "function") Actor5eProto.prepare5eDerivedData = Actor5eProto.prepareDerivedData;
		Actor5eProto.getSheetId = _getActorSheetId;
		Actor5eProto.isGmmMonster = _isGmmMonster;
	}

	function _prepareMonsterBaseData(actor) {
		const actorData = actor.system;
		const monsterBlueprint = MonsterBlueprint.createBaseFromActor(actor);
		const baseAttributes = MonsterForge.createBaseAttributes(monsterBlueprint);
		// Seeded here because an initial-phase effect change is substituted before the derived pass runs.
		actor._gmmRollData = MonsterForge.createBaseRollData(monsterBlueprint);
		actorData.attributes.ac.calc = "natural";
		actorData.attributes.ac.flat = baseAttributes.armor_class.value;
		actorData.attributes.ac.base = baseAttributes.armor_class.value;
		actorData.attributes.hp.max = _resolveMaximumHitPoints(monsterBlueprint, baseAttributes);
		// Stashed before effects reach the ceiling, so the HP sync can tell a build change from a cap.
		actor._gmmBaseMax = actorData.attributes.hp.max;
		actorData.attributes.prof = baseAttributes.proficiency_bonus.value;
		// The forge computes the same number from the blueprint, so this is what the settled pass measures against.
		actor._gmmBaseProf = actorData.attributes.prof;
		// Only the score is seeded. dnd5e derives the modifier from it, after a Change has moved it.
		actor._gmmBaseAbilityMods = {};
		GMM_5E_ABILITIES.forEach((x) => {
			actorData.abilities[x].value = baseAttributes.ability_modifiers[x].score;
			actorData.abilities[x].proficient = baseAttributes.trained_saves[x] ? 1 : 0;
			actor._gmmBaseAbilityMods[x] = baseAttributes.ability_modifiers[x].value;
		});
		_applyRoleSpeedBonus(actorData, monsterBlueprint);
	}

	/* dnd5e adds this to every non-zero mode, which is what the stat block does with it. Assigning a mode
	 * instead would flatten what prepareMovement derives from conditions, exhaustion and encumbrance. */
	function _applyRoleSpeedBonus(actorData, blueprint) {
		const role = Number(blueprint.data.combat.role?.modifiers?.speed) || 0;
		if (!role) return;
		const movement = actorData.attributes.movement;
		const authored = String(movement.bonus ?? "").trim();
		movement.bonus = authored ? `${authored} ${role < 0 ? "-" : "+"} ${Math.abs(role)}` : String(role);
	}

	/* `bonus` already carries the Role at this point. Stashing it would invite the double-count the
	 * speed tooltip exists to avoid. */
	function _stashAppliedMovement(actor) {
		const movement = actor.system?.attributes?.movement ?? {};
		actor._gmmAppliedMovement = Object.fromEntries(GMM_5E_SPEEDS.map((x) => [x, movement[x]]));
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
				// dnd5e counts every check bonus toward a passive score. The forge had proficiency and the modifier.
				monsterData.passive_perception.add(skill.bonus ?? 0, game.i18n.format('gmm.common.derived_source.check_bonus'));
				monsterData.passive_perception.add(dnd5e.utils.simplifyBonus(skill.bonuses.passive, rollData), game.i18n.format('gmm.common.derived_source.passive_bonus'));
				/* Assigned here rather than in the skills pass, where the node is not yet final. It also keeps
				   the blueprint's own modifier, its override and the floor reaching the schema. */
				skill.passive = monsterData.passive_perception.value;
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
				// prepareAbilities consumed bonuses.save before this wrote to it, so both totals follow by hand.
				ability.saveBonus += delta;
				ability.save.value += delta;
			}
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

	// `value` is absent by design. prepareSkill reads the effect off `effectValue` and sets it itself.
	const GMM_DERIVED_SKILL_FIELDS = ["mod", "prof", "total", "passive"];

	/* Read to decide whether a Role's skill grant still applies, never replayed. */
	const GMM_OBSERVED_SKILL_KEYS = new Set(GMM_5E_SKILLS.map((x) => `system.skills.${x.foundry}.value`));

	/* Effects apply before prepareDerivedData, so anything the pass below assigns would discard them. */
	const GMM_DERIVED_KEYS = new Set([
		...GMM_5E_ABILITIES.map((x) => `system.abilities.${x}.dc`),
		...GMM_5E_SKILLS.flatMap((x) => GMM_DERIVED_SKILL_FIELDS.map((f) => `system.skills.${x.foundry}.${f}`)),
		"system.details.cr",
		"system.details.xp.value",
		"system.attributes.init.prof",
		"system.attributes.init.ability",
		"system.attributes.init.mod",
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

	/* The Forge sheet reads these off the artifact, so a replayed change is invisible until it is folded back.
	 * Absent by design: a skill's mod is the ability's, and value/prof target a Proficiency object. */
	const GMM_RECONCILED_NODES = new Map([
		["system.attributes.init.mod", (x) => [x.initiative]],
		["system.details.cr", (x) => [x.challenge_rating]],
		["system.details.xp.value", (x) => [x.xp]],
		["system.attributes.spell.dc", (x) => [x.spellbook.spellcasting.dc]],
		["system.attributes.encumbrance.max", (x) => [x.inventory.capacity]],
		["system.attributes.encumbrance.value", (x) => [x.inventory.weight]],
		[`system.skills.${GMM_5E_SKILLS.find((x) => x.name == "perception").foundry}.passive`, (x) => [x.passive_perception]],
		...GMM_5E_SKILLS.map((x) => [`system.skills.${x.foundry}.total`, (y) => [y.skills.find((z) => z.code == x.name)]])
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

	function _effectSourceLabel(changes) {
		const names = [...new Set(changes.map((x) => x.effect?.name).filter(Boolean))];
		if (!names.length) return game.i18n.format('gmm.common.derived_source.in_play');
		return names.length === 1
			? names[0]
			: game.i18n.format('gmm.common.derived_source.active_effects', { count: names.length });
	}

	/* dnd5e resolves these from the bonus formulas before the derived pass, so they are already final. */
	function _collectCheckBonuses(actorData) {
		return Object.fromEntries(GMM_5E_ABILITIES.map((x) => [x, actorData.abilities[x].checkBonus ?? 0]));
	}

	/* Re-run because GMMC seeds the multiplier after dnd5e has already consumed it.
	 * The multiplier is the only thing GMMC contributes. */
	function _prepareMonsterSkills(actor, monsterData, observed) {
		const actorData = actor.system;
		const rollData = actor.getRollData({ deterministic: true });
		const roleSkills = monsterData.role?.skill_prof ?? [];
		GMM_5E_SKILLS.forEach((x) => {
			const skill = actorData.skills[x.foundry];
			const targeted = observed.filter((y) => y.key === `system.skills.${x.foundry}.value`);
			const granted = roleSkills.includes(x.name) ? 1 : 0;
			// A GM who moved the multiplier deliberately outranks the Role, including down to nothing.
			skill.value = targeted.length ? (skill.effectValue ?? 0) : Math.max(skill.effectValue ?? 0, granted);
			actorData.prepareSkill(x.foundry, { skillData: skill, rollData: rollData });

			const node = monsterData.skills.find((y) => y.code == x.name);
			if (!node) return;
			node.ability = skill.ability;
			const delta = skill.prof.flat - node.value;
			if (!delta) return;
			const source = _effectSourceLabel(targeted);
			node.add(delta, source);
			if (x.name == "perception") monsterData.passive_perception.add(delta, source);
		});
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
			const nodes = GMM_RECONCILED_NODES.get(key)(monsterData);
			const delta = Number(foundry.utils.getProperty(actor, key)) - entry.before;
			if (!Number.isFinite(delta)) continue;
			for (const node of nodes) {
				if (node) node.add(delta, _effectSourceLabel(entry.changes));
			}
		}
	}

	/* A rolled total is the creature's own maximum once it exists; until then the scaled average stands in for it. */
	function _resolveMaximumHitPoints(blueprint, attributes) {
		const rolled = Number(blueprint.data.hit_points.rolled_max) || 0;
		return (attributes.hit_points.use_formula && rolled) ? rolled : attributes.hit_points.maximum.value;
	}

	function _prepareMonsterDerivedData(actor) {
		try {
			const actorData = actor.system;
			const monsterBlueprint = MonsterBlueprint.createFromActor(actor);
			const effectChanges = AutomationHelpers.collectOverwrittenEffects(actor, GMM_DERIVED_KEYS, GMM_UNSUPPORTED_EFFECT_PREFIXES, GMM_OBSERVED_SKILL_KEYS);
			if (effectChanges.unsupported.length) _warnUnsupportedEffectTargets(actor, effectChanges.unsupported);
			const checkBonuses = _collectCheckBonuses(actorData);
			const monsterArtifact = MonsterForge.createArtifact(monsterBlueprint, { checkBonuses: checkBonuses });

			const monsterData = monsterArtifact.data;
			actor.flags.gmm = {
				blueprint: monsterBlueprint,
				monster: monsterArtifact
			};

			GMM_5E_ABILITIES.forEach((x) => {
				// The schema modifier, not the artifact's, because a Change has already reached it here.
				actorData.abilities[x].dc = 8 + actorData.abilities[x].mod;
			});

			actorData.details.cr = monsterData.challenge_rating.value;
			actorData.details.xp.value = monsterData.xp.value;
			// Re-read by the settled pass, which cannot rebuild the bucket after the final phase.
			actor._gmmObservedSkills = effectChanges.observed;
			_prepareMonsterSkills(actor, monsterData, effectChanges.observed);
			monsterData.armor_class.display = actorData.attributes.ac.value;

			// Field-wise, because replacing the init object would overwrite the `roll` mode dnd5e keeps beside these.
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
			dnd5e.dataModels?.actor?.AttributesFields?.prepareSpellcastingAbility?.call(actorData);

			actorData.attributes.spell ??= {};
			actorData.attributes.spell.level = monsterData.spellbook.spellcasting.level;
			actorData.attributes.spell.dc = monsterData.spellbook.spellcasting.dc.value;

			const reconciledNodes = _snapshotReconciledNodes(actor, effectChanges.replay);
			AutomationHelpers.applyOverwrittenEffects(actor, effectChanges.replay);
			_reconcileArtifactWithEffects(actor, monsterData, reconciledNodes);

			// Replaces the pre-effect seed from the base pass. A roll-time reference must read reconciled numbers.
			actor._gmmRollData = MonsterForge.createRollData(monsterBlueprint, monsterData);
		} catch (error) {
			console.error(error);
		}
	}

	/* The forge builds every node below from the blueprint's proficiency bonus and ability modifiers,
	 * either of which a Change in either phase can have moved by the time the schema settles. */
	function _reparseSettledDependents(actor, monsterData) {
		const actorData = actor.system;
		const proficiency = Number(actorData?.attributes?.prof);
		if (!Number.isFinite(proficiency)) return;
		// Both are stamped together, so either one missing means the base pass never ran for this actor.
		if (!Number.isFinite(actor._gmmBaseProf) || !actor._gmmBaseAbilityMods) return;

		const abilityModifiers = {};
		GMM_5E_ABILITIES.forEach((x) => { abilityModifiers[x] = Number(actorData.abilities[x]?.mod) || 0; });
		const moved = proficiency !== actor._gmmBaseProf
			|| GMM_5E_ABILITIES.some((x) => abilityModifiers[x] !== actor._gmmBaseAbilityMods?.[x]);
		if (!moved) return;

		const blueprint = actor.flags.gmm.blueprint;
		const builtInitiative = monsterData.initiative.value;
		try {
			MonsterForge.reparseSettledDependents(monsterData, blueprint, { proficiency: proficiency, abilityModifiers: abilityModifiers }, actor);
		} catch (error) {
			console.error(error);
			return;
		}

		if (actor._gmmRollData) {
			actor._gmmRollData.attackBonus = monsterData.attack_bonus.value;
			actor._gmmRollData.saveDc = monsterData.attack_dcs.primary.value + monsterData.ability_modifiers.max.value;
		}

		// Idempotent: it folds the difference against the node it already wrote.
		_prepareMonsterSkills(actor, monsterData, actor._gmmObservedSkills ?? []);

		// init.mod is wholly the artifact's, so total and score follow it by the same amount.
		const initiativeDelta = monsterData.initiative.value - builtInitiative;
		if (initiativeDelta) {
			actorData.attributes.init.mod = monsterData.initiative.value;
			actorData.attributes.init.total += initiativeDelta;
			actorData.attributes.init.score += initiativeDelta;
		}
		const perception = GMM_5E_SKILLS.find((x) => x.name == "perception");
		if (perception) actorData.skills[perception.foundry].passive = monsterData.passive_perception.value;
		if (actorData.attributes.spell) actorData.attributes.spell.dc = monsterData.spellbook.spellcasting.dc.value;

		GMM_5E_ABILITIES.forEach((x) => {
			const ability = actorData.abilities[x];
			ability.saveProf = new Proficiency(proficiency, blueprint.data.trained_saves[x].trained ? 1 : 0);
			ability.attack = ability.mod + proficiency;
			// saveBonus already carries the forge's excess, so recomputing cannot lose it.
			ability.save.value = ability.mod + ability.saveBonus
				+ (Number.isNumeric(ability.saveProf.term) ? ability.saveProf.flat : 0);
		});
	}

	/* dnd5e derives the hit point read model before Foundry's final change phase. Everything
	 * downstream of the maximum is therefore read here instead. */
	function _prepareMonsterSettledData(actor) {
		const hp = actor.system?.attributes?.hp;
		if (!hp) return;

		hp.effectiveMax = Math.max((hp.max ?? 0) + (hp.tempmax ?? 0), 0);
		const stored = actor._source?.system?.attributes?.hp?.value ?? hp.value;
		hp.value = Math.min(Number(stored) || 0, hp.effectiveMax);
		hp.damage = hp.effectiveMax - hp.value;
		hp.pct = CompatibilityHelpers.clamped(hp.effectiveMax ? (hp.value / hp.effectiveMax) * 100 : 0, 0, 100);

		const monsterData = actor.flags?.gmm?.monster?.data;
		if (!monsterData) return;
		const hitPoints = monsterData.hit_points;

		const delta = (hp.max ?? 0) - hitPoints.maximum.value;
		if (delta) hitPoints.maximum.add(delta, game.i18n.format('gmm.common.derived_source.effects'));
		hitPoints.natural_maximum = hp.max;
		hitPoints.effective_maximum = hp.effectiveMax;
		hitPoints.temporary_maximum = hp.tempmax;
		hitPoints.current = hp.value;
		if (actor._gmmRollData) actor._gmmRollData.naturalMax = hp.max;

		_reparseSettledDependents(actor, monsterData);

		try {
			MonsterForge.reconcileWithSettledActor(monsterData, actor.flags.gmm.blueprint, actor);
		} catch (error) {
			console.error(error);
		}

		ParagonDefenses.prepareDerivedData(actor);

		actor.items.contents.forEach((item) => {
			try {
				item.prepareShortcodes?.();
			} catch (e) {
				console.warn(`GMM | prepareShortcodes failed for item ${item.id}`, e);
			}
		});
	}

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
