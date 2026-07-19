import GmmActor from './scripts/classes/GmmActor.js';
import GmmItem from './scripts/classes/GmmItem.js';
import MonsterSheet from './scripts/classes/MonsterSheet.js';
import ActionSheet from './scripts/classes/ActionSheet.js';
import Templates from './scripts/classes/Templates.js';
import Activities from './scripts/classes/Activities.js';
import ActionBlueprint from './scripts/classes/ActionBlueprint.js';
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

	// Backward-compatible API used by legacy migration scripts/macros.
	const moduleRef = game.modules.get(GMM_MODULE_TITLE);
	if (moduleRef) {
		moduleRef.api ??= {};
		moduleRef.api.convertAbilitiesToActivities = (blueprintData) => {
			if (!blueprintData) return [];
			const activity = Activities.buildActivityData({ data: blueprintData });
			return activity ? [activity] : [];
		};
	}

	// Patch ActivityField to sanitise legacy shortcode formulas pre-validation; persistent cleanup runs in migrateWorld().
	if (!Activities.patchActivityField()) {
		console.warn("GMM | dnd5e ActivityField not found at init; activity-source sanitisation patch was not installed.");
	}

	// Reprepare actor/item data when the default sheet is changed
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
	// DAE Autocomplete
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

	// Sheet-swap conversion between vanilla and GMMC. Abort the in-flight update and re-issue a single
	// combined update: convert to scaling (snapshotting originals), re-convert from a preserved blueprint,
	// or revert to vanilla (restoring the snapshot). See the branch helpers below.
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
			// Switching TO the GMMC ActionSheet.
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

	Hooks.on("createActor", (actor, _options, userId) => {
		if (game.userId !== userId) return;
		_syncScalingMonsterHp(actor, { force: true }).catch(e => console.warn("GMM | HP sync on create failed", e));
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
	});

	console.log(`Giffyglyph's 5e Monster Maker Continued | Initialised`);
});


Hooks.once('ready', async () => {
	_applyTokenCompatibilityShim();

	if (!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
		ui.notifications.error("Module Giffyglyph's Monster Maker Continued requires the 'libWrapper' module. Please install and activate it.");
	}

	// One-shot migration of legacy GMM scaling-action items onto the dnd5e v5.x activity model.
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

/* Inverse of _isSheetSwitchToGmm: true when a change moves the sheet away from the GMMC ActionSheet
 * (to another sheet, the default, or by deleting the flag). */
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

/* First-time conversion path: prompt, then commit the sheet flag, a blueprint derived from the item's
 * activities, the GMM activity, the originals snapshot, and the foreign-activity purge in one update. */
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

	// Snapshot originals for a later restore. JSON string so a re-snapshot replaces it wholesale instead of
	// deep-merging (which would resurrect activities deleted while in vanilla mode).
	const savedActivities = JSON.stringify(Activities.snapshotActivities(item));

	const blueprint = ActionBlueprint.deriveFromVanillaItem(item);
	// Full blueprint mirror (name/img/description + GMM activity). buildActivityUpdate alone would skip the
	// description rewrite, leaving the original `[[lookup …]]` markup in the converted item.
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

/* Re-conversion path: rebuild the GMM activity from the preserved blueprint (keeping scaling edits) and
 * re-snapshot the current activities (keeping vanilla edits). Item-level fields are read live by the sheet,
 * so they're left as-is. */
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

/* Revert path: delete the GMM activity and restore the saved originals, keeping the GMM flags so the item
 * can toggle back. The sheet-class change rides along in the same update. */
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

/* True when an actor is an NPC bound to the GMMC monster sheet (i.e. a scaling monster). */
function _isGmmMonster(actor) {
	return actor?.type === "npc" && actor.getSheetId?.() === `${GMM_MODULE_TITLE}.MonsterSheet`;
}

/* Refill a scaling monster's current HP to its (blueprint-derived, unstored) max on creation/conversion or
 * when the max changes. `appliedMax` tracks the last-synced max; it uses the module flag scope because the
 * `flags.gmm` object is rebuilt each prepareData. */
async function _syncScalingMonsterHp(actor, { force = false } = {}) {
	if (!_isGmmMonster(actor)) return;
	const hp = actor.system?.attributes?.hp;
	if (!hp) return;
	// Formula HP is owned by the sheet's "Roll HP" button, which sets current and max together.
	if (actor.flags?.gmm?.monster?.data?.hit_points?.use_formula) return;

	const max = Math.max(1, Number(hp.max) || 0);
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

function _generateFlags() {
	const moduleFlagScope = `flags.gmm`;
	const moduleFlags = new Set([
		//`${moduleFlagScope}.example`,
	]);
	return Array.from(moduleFlags).filter((key) => key.startsWith(`${moduleFlagScope}.`));
}

function _applyTokenCompatibilityShim() {
	// FV13 shim: dnd5e SaveActivity uses the deprecated global `Token`; point it at the namespaced class
	// so `instanceof Token` doesn't hit the deprecated getter.
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

	game.settings.register(GMM_MODULE_TITLE, "monsterLayout", {
		name: "Monster Menu Layout",
		scope: "world",
		config: true,
		default: "slide-out",
		type: String,
		choices: Object.fromEntries(GMM_GUI_LAYOUTS.monster.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterArtifactSkin", {
		name: "Monster Artifact Skin",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.monster.artifact.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterBlueprintSkin", {
		name: "Monster Blueprint Skin",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.monster.blueprint.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterPrimaryColor", {
		name: "Monster Primary Color",
		scope: "world",
		config: true,
		default: "blue",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "monsterSecondaryColor", {
		name: "Monster Secondary Color",
		scope: "world",
		config: true,
		default: "orange",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionLayout", {
		name: "Action Menu Layout",
		scope: "world",
		config: true,
		default: "slide-out",
		type: String,
		choices: Object.fromEntries(GMM_GUI_LAYOUTS.action.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionArtifactSkin", {
		name: "Action Artifact Skin",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.action.artifact.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionBlueprintSkin", {
		name: "Action Blueprint Skin",
		scope: "world",
		config: true,
		default: "vanity",
		type: String,
		choices: Object.fromEntries(GMM_GUI_SKINS.action.blueprint.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionPrimaryColor", {
		name: "Action Primary Color",
		scope: "world",
		config: true,
		default: "blue-gray",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});

	game.settings.register(GMM_MODULE_TITLE, "actionSecondaryColor", {
		name: "Action Secondary Color",
		scope: "world",
		config: true,
		default: "amber",
		type: String,
		choices: Object.fromEntries(GMM_GUI_COLORS.map((x) => [ x.code, x.name]))
	});
}
