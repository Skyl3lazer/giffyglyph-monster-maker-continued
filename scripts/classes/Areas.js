import Activities from './Activities.js';
import AutomationHelpers from './AutomationHelpers.js';
import Zones from './Zones.js';

/* dnd5e honors `flags.dnd5e.dependentOn` through a mixin it never puts on a Region, so a placed area
   never registers itself and nothing ever deletes it. */
const Areas = (function () {

	function init() {
		Hooks.on("createRegion", _onCreateRegion);
		Hooks.on("updateRegion", _track);
		Hooks.on("deleteRegion", _onDeleteRegion);
		Hooks.once("ready", _trackExisting);
	}

	/* dnd5e 6.0 repurposes `origin` to the casting token and moves the activity onto its own flag. */
	function _gmmActivityUuid(region) {
		const uuid = region?.getFlag?.("dnd5e", "activity") ?? region?.getFlag?.("dnd5e", "origin");
		if (typeof uuid !== "string") return null;
		return Activities.isGmmActivityId(uuid.split(".Activity.")[1]) ? uuid : null;
	}

	function _track(region) {
		if (!game.user?.isGM) return;
		const owner = region?.getFlag?.("dnd5e", "dependentOn");
		if (typeof owner !== "string" || !_gmmActivityUuid(region)) return;
		dnd5e?.registry?.dependents?.track(owner, region);
	}

	function _onDeleteRegion(region) {
		if (!game.user?.isGM) return;
		const owner = region?.getFlag?.("dnd5e", "dependentOn");
		if (typeof owner === "string") dnd5e?.registry?.dependents?.untrack(owner, region);
	}

	function _onCreateRegion(region) {
		_track(region);
		_declareOwner(region).catch(e => console.warn("GMM | Declaring an area's owner failed", e));
		Zones.attach(region, _gmmActivityUuid(region)).catch(e => console.warn("GMM | Attaching a zone failed", e));
	}

	/* midi declares the owner itself, and writes the same value. Without midi nobody does. */
	async function _declareOwner(region) {
		if (!game.users.activeGM?.isSelf || region.getFlag("dnd5e", "dependentOn")) return;
		const uuid = _gmmActivityUuid(region);
		if (!uuid) return;
		const item = AutomationHelpers.resolveSourceItem(uuid);
		const concentration = AutomationHelpers.concentrationFor(item?.actor, item?.id);
		if (concentration) await region.setFlag("dnd5e", "dependentOn", concentration.uuid);
	}

	/* An area outlives the session that placed it, and nothing refills the registry on a reload. */
	function _trackExisting() {
		for (const scene of game.scenes ?? []) {
			for (const region of scene.regions ?? []) _track(region);
		}
	}

	return {
		init: init
	};
})();

export default Areas;
