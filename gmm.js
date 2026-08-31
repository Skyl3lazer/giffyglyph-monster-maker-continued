import GmmActor from './scripts/classes/GmmActor.js';
import GmmItem from './scripts/classes/GmmItem.js';
import MonsterSheet from './scripts/classes/MonsterSheet.js';
import ActionSheet from './scripts/classes/ActionSheet.js';
import Templates from './scripts/classes/Templates.js';
import Activities from './scripts/classes/Activities.js';
import ActionBlueprint from './scripts/classes/ActionBlueprint.js';
import ParagonPower from './scripts/classes/ParagonPower.js';
import ParagonDefenses from './scripts/classes/ParagonDefenses.js';
import Auras from './scripts/classes/Auras.js';
import Conditions from './scripts/classes/Conditions.js';
import Exhaustion from './scripts/classes/Exhaustion.js';
import Rolls from './scripts/classes/Rolls.js';
import Deferrals from './scripts/classes/Deferrals.js';
import Durations from './scripts/classes/Durations.js';
import Areas from './scripts/classes/Areas.js';
import MissDamage from './scripts/classes/MissDamage.js';
import Shortcoder from './scripts/classes/Shortcoder.js';
import { GMM_GUI_SKINS } from "./scripts/consts/GmmGuiSkins.js";
import { GMM_GUI_COLORS } from "./scripts/consts/GmmGuiColors.js";
import { GMM_GUI_LAYOUTS } from "./scripts/consts/GmmGuiLayouts.js";
import { GMM_MODULE_TITLE } from "./scripts/consts/GmmModuleTitle.js";

Hooks.once("init", function() {
	console.log(`Giffyglyph's 5e Monster Maker Continued | Initialising`);

	_applyTokenCompatibilityShim();

	const ActorsRef = foundry?.documents?.collections?.Actors ?? globalThis.Actors;
	const ItemsRef = foundry?.documents?.collections?.Items ?? globalThis.Items;
	if (ActorsRef?.registerSheet) {
		ActorsRef.registerSheet(GMM_MODULE_TITLE, MonsterSheet, {
			types: ["npc"],
			label: "gmm.sheet.monster.label"
		});
	}
	if (ItemsRef?.registerSheet) {
		ItemsRef.registerSheet(GMM_MODULE_TITLE, ActionSheet, {
			types: ["feat", "weapon"],
			label: "gmm.sheet.action.label"
		});
	}

	Templates.preloadTemplates();
	Templates.registerTemplateHelpers();

	GmmActor.patchActor5e();
	GmmItem.patchItem5e();
	ParagonPower.init();
	ParagonDefenses.init();
	Deferrals.init();
	Durations.init();
	Areas.init();
	Auras.init();
	MissDamage.init();
	Exhaustion.init();

	// Backward-compatible API used by legacy migration scripts/macros.
	const moduleRef = game.modules.get(GMM_MODULE_TITLE);
	if (moduleRef) {
		moduleRef.api ??= {};
		moduleRef.api.convertAbilitiesToActivities = (blueprintData) => {
			if (!blueprintData) return [];
			const activity = Activities.buildActivityData({ data: blueprintData });
			return activity ? [activity] : [];
		};
		// midi reaches this by name through a `function.` optional-bonus flag, so it is API, not internal.
		moduleRef.api.spendParagonDefense = ParagonDefenses.spendParagonDefense;
	}

	Conditions.registerApi();
	Rolls.registerApi();

	// Patch ActivityField to sanitise legacy shortcode formulas pre-validation; persistent cleanup runs in migrateWorld().
	if (!Activities.patchActivityField()) {
		console.warn("GMM | dnd5e ActivityField not found at init; activity-source sanitisation patch was not installed.");
	}

	Hooks.on("updateSetting", (setting, data, options, userId) => {
		if ( setting.key === "core.sheetClasses" ) {
			game.actors.forEach(x => x.prepareData());
			game.items.forEach(x => x.prepareData());
			game.scenes.forEach(x => x.tokens.forEach(y => y.actor.prepareData()));
		}
	});

	// v13+ sidebar directories are ApplicationV2, so the hook signature is `(app, element)` - not the old `html` jQuery arg.
	Hooks.on("renderActorDirectory", (app, element) => {
		if (game.user.isGM) {
			_hookActorDirectory(element);
		}
	});

	Hooks.on("renderItemDirectory", (app, element) => {
		if (game.user.isGM) {
			_hookItemDirectory(element);
		}
	});
	const daeFlags = _generateFlags();
	Hooks.on('dae.setFieldData', (fieldData) => {
		fieldData.GMM = daeFlags;
	});

	_registerSettings();

	// Seed/repair GMM activities for legacy scaling actions and drop dnd5e auto-seeded non-GMM ones.
	Hooks.on("preCreateItem", (item, data, _options, _userId) => {
		try {
			const update = Activities.buildPreCreateUpdate(data, item);
			if (update) item.updateSource(foundry.utils.expandObject(update));
		} catch (e) {
			console.warn("GMM | preCreateItem activity-seed failed", e);
		}
	});

	// One combined update, because re-issuing separately would re-trigger this hook.
	Hooks.on("preUpdateItem", (item, change, options, _userId) => {
		if (options?.gmmConvertingFromVanilla || options?.gmmRevertingToVanilla) return;
		try {
			// Switching AWAY: restore the saved vanilla activities, keeping the GMM flags for a later toggle back.
			if (_isSheetSwitchFromGmm(item, change)) {
				_revertToVanilla(item, change, options).catch(e => {
					console.warn("GMM | GMMC->vanilla revert failed", e);
				});
				return false;
			}
			if (_isSheetSwitchToGmm(item, change)) {
				// A reverted item still has a blueprint; re-convert from it instead of re-deriving from vanilla.
				if (item.flags?.gmm?.blueprint) {
					_reconvertToScaling(item, change, options).catch(e => {
						console.warn("GMM | GMMC re-conversion failed", e);
					});
					return false;
				}
				const activities = item.system?.activities;
				const activityCount = activities?.size
					?? (Array.isArray(activities) ? activities.length : (activities ? Object.keys(activities).length : 0));
				const isDestructive = activityCount > 0;
				_confirmAndConvertVanillaItem(item, change, options, isDestructive).catch(e => {
					console.warn("GMM | vanilla->GMMC conversion failed", e);
				});
				return false;
			}
		} catch (e) {
			console.warn("GMM | preUpdateItem conversion check failed", e);
		}
	});

	/* No builder can delete an embedded document, so a forged effect the blueprint no longer asks for is
	   disposed of here. Gated on the acting client, so two owners do not race the same deletion. */
	Hooks.on("updateItem", (item, _change, _options, userId) => {
		if (game.user.id !== userId) return;
		try {
			const ids = [Activities.strandedDoomClock(item), Activities.strandedDurationCarrier(item)]
				.filter(effect => effect)
				.map(effect => effect.id);
			if (ids.length) {
				item.deleteEmbeddedDocuments("ActiveEffect", ids)
					.catch(e => console.warn("GMM | stranded forged-effect cleanup failed", e));
			}
		} catch (e) {
			console.warn("GMM | stranded forged-effect check failed", e);
		}
	});

	// Re-render the owning monster sheet when an embedded ActiveEffect changes, keeping the forge's effect lists in sync.
	const _rerenderForEffect = (effect) => {
		try {
			const parent = effect?.parent;
			if (!parent) return;
			const actor = parent.documentName === "Actor" ? parent : parent.actor;
			if (!actor) return;
			const sheet = actor.sheet;
			if (sheet instanceof MonsterSheet && sheet.rendered) sheet.render(false);
		} catch (e) {
			console.warn("GMM | active-effect re-render failed", e);
		}
	};
	Hooks.on("createActiveEffect", _rerenderForEffect);
	Hooks.on("updateActiveEffect", _rerenderForEffect);
	Hooks.on("deleteActiveEffect", _rerenderForEffect);

	// Anywhere but the forge's own duration carrier, a shortcode reaches the target verbatim.
	const _warnAboutShortcodes = (effect, data) => {
		try {
			if (Durations.isDurationEffect(effect)) return;
			const parent = effect?.parent;
			const authoredOnScaler = (parent?.documentName === "Actor")
				? _isGmmMonster(parent)
				: (_isGmmMonster(parent?.actor) || parent?.getSheetId?.() === `${GMM_MODULE_TITLE}.ActionSheet`);
			if (!authoredOnScaler) return;

			for (const change of (data?.system?.changes ?? data?.changes ?? [])) {
				for (const code of Shortcoder.findShortcodes(change?.value)) {
					const suggestion = Shortcoder.suggestRollData(code);
					const message = game.i18n.format(
						suggestion ? "gmm.effect.shortcode_not_resolved" : "gmm.effect.shortcode_no_equivalent",
						{ name: effect.name, key: change.key, code: code, suggestion: suggestion }
					);
					ui.notifications?.warn(message);
					console.warn(`GMM | ${message}`);
				}
			}
		} catch (e) {
			console.warn("GMM | shortcode check on effect failed", e);
		}
	};
	Hooks.on("preCreateActiveEffect", _warnAboutShortcodes);
	Hooks.on("preUpdateActiveEffect", _warnAboutShortcodes);

	Hooks.on("createActor", (actor, _options, userId) => {
		if (game.userId !== userId) return;
		_syncScalingMonsterHp(actor, { force: true }).catch(e => console.warn("GMM | HP sync on create failed", e));
		_syncParagonDefenses(actor).catch(e => console.warn("GMM | Paragon defense sync on create failed", e));
	});
	// Foundry auto-follows a synced prototype-token image on an actor rename, but not the name; mirror that here.
	Hooks.on("preUpdateActor", (actor, change) => {
		if (!_isGmmMonster(actor)) return;
		const nextName = change?.name;
		if ((typeof nextName !== "string") || !nextName.trim() || (nextName === actor.name)) return;
		if (foundry.utils.hasProperty(change, "prototypeToken.name")) return;
		if (actor.prototypeToken?.name !== actor.name) return;
		foundry.utils.setProperty(change, "prototypeToken.name", nextName);
	});
	Hooks.on("updateActor", (actor, change, _options, userId) => {
		if (game.userId !== userId) return;
		// A sheet-class switch to the monster sheet is a conversion; force current HP to full.
		const convertedToGmm = foundry.utils.getProperty(change ?? {}, "flags.core.sheetClass") === `${GMM_MODULE_TITLE}.MonsterSheet`;
		_syncScalingMonsterHp(actor, { force: convertedToGmm }).catch(e => console.warn("GMM | HP sync on update failed", e));
		_syncParagonDefenses(actor).catch(e => console.warn("GMM | Paragon defense sync on update failed", e));
	});

	console.log(`Giffyglyph's 5e Monster Maker Continued | Initialised`);
});


Hooks.once('ready', async () => {
	_applyTokenCompatibilityShim();

	if (!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
		ui.notifications.error("Module Giffyglyph's Monster Maker Continued requires the 'libWrapper' module. Please install and activate it.");
	}

	if (game.user.isGM) {
		try {
			await Activities.migrateWorld();
		} catch (e) {
			console.error("GMM | Activity migration encountered an error", e);
		}
	}
});

/* True when a preUpdateItem change binds the sheet to the GMMC ActionSheet from a different sheet. */
function _isSheetSwitchToGmm(item, change) {
	const target = `${GMM_MODULE_TITLE}.ActionSheet`;
	const newSheet = foundry.utils.getProperty(change ?? {}, "flags.core.sheetClass");
	if (newSheet !== target) return false;
	const currentSheet = item?.flags?.core?.sheetClass;
	return currentSheet !== target;
}

/* Away means another sheet, the default, or the flag being deleted outright. */
function _isSheetSwitchFromGmm(item, change) {
	const target = `${GMM_MODULE_TITLE}.ActionSheet`;
	if ((item?.flags?.core?.sheetClass) !== target) return false;
	const c = change ?? {};
	// Reset-to-default forms: `flags.core.-=sheetClass` or the whole `flags.core` being cleared.
	if (foundry.utils.getProperty(c, "flags.core.-=sheetClass") === null) return true;
	if (foundry.utils.getProperty(c, "flags.core") === null) return true;
	// Explicit switch to a different (or empty/default) sheet.
	const newSheet = foundry.utils.getProperty(c, "flags.core.sheetClass");
	if (newSheet === undefined) return false;
	return newSheet !== target;
}

/* First-time conversion: everything lands in one update so the hook is not re-entered. */
async function _confirmAndConvertVanillaItem(item, originalChange, originalOptions, isDestructive = true) {
	// Only prompt when there are activities to replace; trait items with none convert silently.
	if (isDestructive) {
		const ConfirmDialog = foundry?.applications?.api?.DialogV2;
		let confirmed = false;
		if (ConfirmDialog?.confirm) {
			const name = foundry.utils.escapeHTML?.(item.name) ?? item.name;
			confirmed = await ConfirmDialog.confirm({
				window: { title: game.i18n.localize("gmm.action.convert.title") },
				content: game.i18n.format("gmm.action.convert.content", { name }),
				rejectClose: false,
				modal: true
			});
		} else {
			confirmed = window.confirm(game.i18n.format("gmm.action.convert.confirm", { name: item.name }));
		}
		if (!confirmed) return;
	}

	// A JSON string, not an object: a deep-merged re-snapshot would resurrect deleted activities.
	const savedActivities = JSON.stringify(Activities.snapshotActivities(item));

	const blueprint = ActionBlueprint.deriveFromVanillaItem(item);
	// `buildActivityUpdate` alone would skip the description rewrite and leave vanilla enricher markup.
	const update = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalChange ?? {}),
		{
			flags: { gmm: { blueprint, savedActivities } },
			...ActionBlueprint.getItemDataFromBlueprint(blueprint, item),
			...Activities.buildForeignActivityPurge(item)
		},
		{ inplace: false }
	);
	const passOptions = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalOptions ?? {}),
		{ gmmConvertingFromVanilla: true },
		{ inplace: false }
	);
	await item.update(update, passOptions);
	console.log(`GMM | Converted item ${item.name} (${item.id}) from vanilla to scaling action.`);
}

/* Re-conversion keeps both sets of edits: the preserved blueprint and the current activities. */
async function _reconvertToScaling(item, originalChange, originalOptions) {
	const blueprint = item.flags.gmm.blueprint;
	const savedActivities = JSON.stringify(Activities.snapshotActivities(item));
	const update = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalChange ?? {}),
		{
			flags: { gmm: { savedActivities } },
			...Activities.buildActivityUpdate(item, blueprint),
			...Activities.buildForeignActivityPurge(item)
		},
		{ inplace: false }
	);
	const passOptions = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalOptions ?? {}),
		{ gmmConvertingFromVanilla: true },
		{ inplace: false }
	);
	await item.update(update, passOptions);
	console.log(`GMM | Re-converted item ${item.name} (${item.id}) to scaling action from preserved blueprint.`);
}

/* The GMM flags are kept, so the item can be toggled back. */
async function _revertToVanilla(item, originalChange, originalOptions) {
	const update = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalChange ?? {}),
		Activities.buildRestoreUpdate(item),
		{ inplace: false }
	);
	const passOptions = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalOptions ?? {}),
		{ gmmRevertingToVanilla: true },
		{ inplace: false }
	);
	await item.update(update, passOptions);
	console.log(`GMM | Reverted item ${item.name} (${item.id}) to vanilla; scaling data preserved in flags.`);
}

function _isGmmMonster(actor) {
	return !!actor?.isGmmMonster?.();
}

/* `appliedMax` lives in the module flag scope because `flags.gmm` is rebuilt each prepareData. */
async function _syncScalingMonsterHp(actor, { force = false } = {}) {
	if (!_isGmmMonster(actor)) return;
	if (!actor.system?.attributes?.hp) return;
	// Formula HP is owned by the sheet's "Roll HP" button, which sets current and max together.
	if (actor.flags?.gmm?.monster?.data?.hit_points?.use_formula) return;
	if (!Number.isFinite(actor._gmmBaseMax)) return;

	const max = Math.max(1, actor._gmmBaseMax);
	const appliedMax = actor.getFlag(GMM_MODULE_TITLE, "appliedMax");

	if (force || (appliedMax !== undefined && appliedMax !== max)) {
		await actor.update({
			"system.attributes.hp.value": max,
			[`flags.${GMM_MODULE_TITLE}.appliedMax`]: max
		});
	} else if (appliedMax === undefined) {
		// First sighting: track the max without touching current HP, so an existing damaged monster isn't healed.
		await actor.setFlag(GMM_MODULE_TITLE, "appliedMax", max);
	}
}

async function _syncParagonDefenses(actor) {
	if (!_isGmmMonster(actor)) return;
	const paragonDefenses = actor.flags?.gmm?.monster?.data?.paragon_defenses;
	if (!paragonDefenses) return;

	const max = Number(paragonDefenses.maximum?.value) || 0;
	const applied = actor.getFlag(GMM_MODULE_TITLE, "appliedParagonDefenses");
	if (applied === max) return;

	const update = { [`flags.${GMM_MODULE_TITLE}.appliedParagonDefenses`]: max };
	if ((applied !== undefined) || (paragonDefenses.current ?? null) === null) {
		update["flags.gmm.blueprint.data.paragon_defenses.current"] = max;
	}
	await actor.update(update);
}

function _generateFlags() {
	const moduleFlagScope = `flags.gmm`;
	const moduleFlags = new Set([
	]);
	return Array.from(moduleFlags).filter((key) => key.startsWith(`${moduleFlagScope}.`));
}

function _applyTokenCompatibilityShim() {
	// dnd5e SaveActivity still uses the global `Token`, whose getter is deprecated on v13.
	try {
		// Not needed on Foundry v14+ and can fail because global `Token` is non-configurable there.
		if ((game.release?.generation ?? 0) >= 14) return;

		const TokenClass = foundry?.canvas?.placeables?.Token;
		if (!TokenClass) return;

		const desc = Object.getOwnPropertyDescriptor(globalThis, "Token");
		if (desc?.value === TokenClass) return;
		// Some runtimes expose `Token` as a locked global; treat that as already handled.
		if (desc && !desc.configurable) return;

		try { Reflect.deleteProperty(globalThis, "Token"); } catch (_e) { /* ignore */ }

		Object.defineProperty(globalThis, "Token", {
			value: TokenClass,
			writable: true,
			configurable: true
		});
	} catch (e) {
		console.warn("GMM | Token compatibility shim failed", e);
	}
}

/* Find where to insert the GMM "create" button row in a sidebar directory header (before search, else append). */
function _findDirectoryInsertionPoint(root) {
	if (!root?.querySelector) return null;
	const header = root.querySelector(".directory-header");
	if (!header) return null;
	const before = header.querySelector("search") ?? header.querySelector(".header-search");
	return { header, before };
}

async function _hookActorDirectory(html) {
	const target = _findDirectoryInsertionPoint(html);
	if (!target) return;
	let section = document.createElement("div");
	section.classList.add("header-actions", "action-buttons", "flexrow", "giffyglyph");
	section.insertAdjacentHTML(
		"afterbegin",
		`
			<div class="btn-group">
				<button type="button" data-action="create-scaling-monster"><i class="fas fa-skull"></i> ${game.i18n.format('gmm.sidebar.create_monster')}</button>
			</div>
		`
	);
	section.querySelector("[data-action='create-scaling-monster']").addEventListener("click", async (ev) => {
		ev.preventDefault();
		// Nested flags object: Foundry reads the bound sheet at `flags.core.sheetClass`, not a flat key.
		Actor.create({
			name: "New Scaling Monster",
			type: "npc",
			img: "icons/svg/eye.svg",
			flags: { core: { sheetClass: `${GMM_MODULE_TITLE}.MonsterSheet` } },
			system: {
				details: {
					alignment: "unaligned",
					type: { value: "humanoid" },
					cr: 1
				}
			}
		});
	});
	if (target.before) target.header.insertBefore(section, target.before);
	else target.header.appendChild(section);
}

async function _hookItemDirectory(html) {
	const target = _findDirectoryInsertionPoint(html);
	if (!target) return;
	let section = document.createElement("div");
	section.classList.add("header-actions", "action-buttons", "flexrow", "giffyglyph");
	section.insertAdjacentHTML(
		"afterbegin",
		`
			<div class="btn-group">
				<button type="button" data-action="create-scaling-action"><i class="fas fa-skull"></i> ${game.i18n.format('gmm.sidebar.create_action')}</button>
			</div>
		`
	);
	section.querySelector("[data-action='create-scaling-action']").addEventListener("click", (ev) => {
		ev.preventDefault();
		Item.create({
			name: "New Scaling Action",
			type: "feat",
			img: "icons/svg/clockwork.svg",
			flags: { core: { sheetClass: `${GMM_MODULE_TITLE}.ActionSheet` } }
		});
	});
	if (target.before) target.header.insertBefore(section, target.before);
	else target.header.appendChild(section);
}

function _registerSettings() {

	game.settings.register(GMM_MODULE_TITLE, "trackParagonActions", {
		name: "gmm.settings.track_paragon_actions.name",
		hint: "gmm.settings.track_paragon_actions.hint",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register(GMM_MODULE_TITLE, "trackParagonDefenses", {
		name: "gmm.settings.track_paragon_defenses.name",
		hint: "gmm.settings.track_paragon_defenses.hint",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register(GMM_MODULE_TITLE, "automateDeferrals", {
		name: "gmm.settings.automate_deferrals.name",
		hint: "gmm.settings.automate_deferrals.hint",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register(GMM_MODULE_TITLE, "automateDurations", {
		name: "gmm.settings.automate_durations.name",
		hint: "gmm.settings.automate_durations.hint",
		scope: "world",
		config: true,
		default: true,
		type: Boolean
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterLayout", {
		name: "gmm.settings.monster_layout.name",
		scope: "world",
		config: true,
		default: "slide-out",
		type: String,
		choices: Object.fromEntries(GMM_GUI_LAYOUTS.monster.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterArtifactSkin", {
		name: "gmm.settings.monster_artifact_skin.name",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.monster.artifact.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterBlueprintSkin", {
		name: "gmm.settings.monster_blueprint_skin.name",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.monster.blueprint.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterPrimaryColor", {
		name: "gmm.settings.monster_primary_color.name",
		scope: "world",
		config: true,
		default: "blue",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterSecondaryColor", {
		name: "gmm.settings.monster_secondary_color.name",
		scope: "world",
		config: true,
		default: "orange",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionLayout", {
		name: "gmm.settings.action_layout.name",
		scope: "world",
		config: true,
		default: "slide-out",
		type: String,
		choices: Object.fromEntries(GMM_GUI_LAYOUTS.action.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionArtifactSkin", {
		name: "gmm.settings.action_artifact_skin.name",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.action.artifact.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionBlueprintSkin", {
		name: "gmm.settings.action_blueprint_skin.name",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.action.blueprint.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionPrimaryColor", {
		name: "gmm.settings.action_primary_color.name",
		scope: "world",
		config: true,
		default: "blue-gray",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionSecondaryColor", {
		name: "gmm.settings.action_secondary_color.name",
		scope: "world",
		config: true,
		default: "amber",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});
}
