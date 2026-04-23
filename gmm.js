import GmmActor from './scripts/classes/GmmActor.js';
import GmmItem from './scripts/classes/GmmItem.js';
import MonsterSheet from './scripts/classes/MonsterSheet.js';
import ActionSheet from './scripts/classes/ActionSheet.js';
import Templates from './scripts/classes/Templates.js';
import Activities from './scripts/classes/Activities.js';
import { GMM_GUI_SKINS } from "./scripts/consts/GmmGuiSkins.js";
import { GMM_GUI_COLORS } from "./scripts/consts/GmmGuiColors.js";
import { GMM_GUI_LAYOUTS } from "./scripts/consts/GmmGuiLayouts.js";
import { GMM_MODULE_TITLE } from "./scripts/consts/GmmModuleTitle.js";

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", function() {
	console.log(`Giffyglyph's 5e Monster Maker Continued | Initialising`);

	foundry.documents.collections.Actors.registerSheet(GMM_MODULE_TITLE, MonsterSheet, {
		types: ["npc"],
		label: "gmm.sheet.monster.label"
	});
	foundry.documents.collections.Items.registerSheet(GMM_MODULE_TITLE, ActionSheet, {
		label: "gmm.sheet.action.label"
	});

	Templates.preloadTemplates();
	Templates.registerTemplateHelpers();

	GmmActor.patchActor5e();
	GmmItem.patchItem5e();

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
