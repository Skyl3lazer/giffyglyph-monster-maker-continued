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

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

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

	// Patch ActivityField to sanitize legacy shortcode formulas before validation.
	// Persistent cleanup still runs in migrateWorld() on ready.
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

	// In Foundry v13+ the sidebar directories are ApplicationV2-based, so the `render*` hook signature is `(app, eleme...
	// Older GMM code dereferenced `html[0]` which is `undefined` on a HTMLElement and crashed before the GMM "Create S
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

	// Seed/repair GMM activities on preCreateItem for legacy scaling actions.
	// Also removes dnd5e auto-seeded non-GMM activities from migrated sources.
	Hooks.on("preCreateItem", (item, data, _options, _userId) => {
		try {
			const update = Activities.buildPreCreateUpdate(data, item);
			if (update) item.updateSource(foundry.utils.expandObject(update));
		} catch (e) {
			console.warn("GMM | preCreateItem activity-seed failed", e);
		}
	});

	// Vanilla -> GMMC conversion. When the user changes an existing weapon/feat's sheet to the GMMC
	// ActionSheet we abort the in-flight update, optionally prompt for confirmation (only when the
	// item has activities that would be destroyed), and on OK re-issue a single update that flips
	// the sheet flag, seeds `flags.gmm.blueprint` from the original activities + description, installs
	// the GMM activity, and purges any foreign activities. Trait items with no activities still get
	// converted so their description goes through the replacement pipeline. Cancel leaves the item
	// exactly as it was.
	Hooks.on("preUpdateItem", (item, change, options, _userId) => {
		if (options?.gmmConvertingFromVanilla) return;
		try {
			if (!_isSheetSwitchToGmm(item, change)) return;
			if (item.flags?.gmm?.blueprint) return;
			const activities = item.system?.activities;
			const activityCount = activities?.size
				?? (Array.isArray(activities) ? activities.length : (activities ? Object.keys(activities).length : 0));
			const isDestructive = activityCount > 0;
			_confirmAndConvertVanillaItem(item, change, options, isDestructive).catch(e => {
				console.warn("GMM | vanilla->GMMC conversion failed", e);
			});
			return false;
		} catch (e) {
			console.warn("GMM | preUpdateItem conversion check failed", e);
		}
	});

	// Re-render the owning GMM monster sheet when an embedded ActiveEffect changes,
	// so the forge's effect lists stay in sync with the underlying item.
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

	console.log(`Giffyglyph's 5e Monster Maker Continued | Initialised`);
});


Hooks.once('ready', async () => {
	_applyTokenCompatibilityShim();

	if (!game.modules.get('lib-wrapper')?.active && game.user.isGM) {
		ui.notifications.error("Module Giffyglyph's Monster Maker Continued requires the 'libWrapper' module. Please install and activate it.");
	}

	// One-shot migration of legacy GMM scaling-action items onto the dnd5e v5.x activity model
	// Items that already carry a GMM-managed activity (for example items created via the new MonsterSheet#actionAddIte
	if (game.user.isGM) {
		try {
			await Activities.migrateWorld();
		} catch (e) {
			console.error("GMM | Activity migration encountered an error", e);
		}
	}
});

/* Detect when a `preUpdateItem` change targets `flags.core.sheetClass` and the new value is the
 * GMMC ActionSheet, while the item is currently bound to a different sheet. Used to gate the
 * vanilla->GMMC conversion confirmation flow. */
function _isSheetSwitchToGmm(item, change) {
	const target = `${GMM_MODULE_TITLE}.ActionSheet`;
	const newSheet = foundry.utils.getProperty(change ?? {}, "flags.core.sheetClass");
	if (newSheet !== target) return false;
	const currentSheet = item?.flags?.core?.sheetClass;
	return currentSheet !== target;
}

/* Confirmation + conversion path for vanilla weapons/feats whose sheet was switched to the GMMC
 * ActionSheet. Builds a fresh blueprint from the item's existing activities (and item-level
 * fallbacks), then commits the sheet flag, the blueprint, the GMM activity, and the foreign-
 * activity purge in one update so the user observes a single transition. */
async function _confirmAndConvertVanillaItem(item, originalChange, originalOptions, isDestructive = true) {
	// Only prompt when the conversion would actually destroy something (existing activities). Trait
	// items with no activities convert silently — there's nothing to warn about, and skipping the
	// dialog avoids a confusing "delete activities" message when no activities exist.
	if (isDestructive) {
		const ConfirmDialog = foundry?.applications?.api?.DialogV2;
		let confirmed = false;
		if (ConfirmDialog?.confirm) {
			confirmed = await ConfirmDialog.confirm({
				window: { title: "Convert to GMMC Scaling Action?" },
				content: `<p>Converting <strong>${foundry.utils.escapeHTML?.(item.name) ?? item.name}</strong> to a GMMC Scaling Action will <strong>delete this item's existing activities</strong> and replace them with a single GMM-managed activity built from the original data.</p><p>This cannot be undone. Continue?</p>`,
				rejectClose: false,
				modal: true
			});
		} else {
			confirmed = window.confirm(`Convert "${item.name}" to a GMMC Scaling Action? This will delete the item's existing activities.`);
		}
		if (!confirmed) return;
	}

	const blueprint = ActionBlueprint.deriveFromVanillaItem(item);
	// `getItemDataFromBlueprint` produces the full mirror update for the blueprint:
	// `system.description.value` (carrying the rewritten description), `name`, `img`, AND the GMM
	// activity payload. Just calling `buildActivityUpdate` here would skip the description rewrite
	// and the original `[[lookup …]]` markup would survive into the converted item.
	const update = foundry.utils.mergeObject(
		foundry.utils.deepClone(originalChange ?? {}),
		{
			flags: { gmm: { blueprint } },
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

function _generateFlags() {
	const moduleFlagScope = `flags.gmm`;
	const moduleFlags = new Set([
		//`${moduleFlagScope}.example`,
	]);
	return Array.from(moduleFlags).filter((key) => key.startsWith(`${moduleFlagScope}.`));
}

function _applyTokenCompatibilityShim() {
	// FV13 compatibility shim:
	// dnd5e SaveActivity references global `Token`; in V13 this global is deprecated.
	// Provide the namespaced class directly on globalThis so `instanceof Token` doesn't hit the deprecated getter.
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

/* Locate the insertion point inside a sidebar directory's header for the GMM "create" button row
 * The dnd5e v5.x / Foundry v14 directory header (templates/sidebar/directory/header.hbs) lays its children out ver */
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
		// Use a nested flags object:
		// Foundry reads the bound sheet at `document.flags.core?.sheetClass`, so a literal `"core.sheetClass"` key would n
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
