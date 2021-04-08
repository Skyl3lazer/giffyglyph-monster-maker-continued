import Blueprint from "../classes/Blueprint.js";
import Gui from "../classes/Gui.js";
import Factory from "../classes/Factory.js";

export default class ActorSheetMonster extends ActorSheet {

	static get defaultOptions() {
		return mergeObject(
			super.defaultOptions,
			{
				classes: ["gg5e-mm-window gg5e-mm-window--monster expanded"],
				height: 900,
				width: 540,
				template: 'modules/giffyglyphs-5e-monster-maker/templates/sheets/monster.html',
				resizable: true
			}
		);
	}

    getData() {
        const data = super.getData();

		// Prepare essential monster/gui data
		let gui = Gui.prepareGui(this._getDefaultGui(), data.data.gg5e_mm ? data.data.gg5e_mm.gui : null);
		let blueprint = Blueprint.prepareBlueprint(
			"monster",
			data.data.gg5e_mm ? data.data.gg5e_mm.blueprint : null,
			this._getActorData(data.actor)
		);
		let monster = Factory.createEntity(blueprint);

		// Pass monster/gui data to sheet
		data.data.gg5e_mm = {
			gui: gui,
			blueprint: blueprint,
			monster: monster
		};

        return data;
    }

	activateListeners(html) {
		super.activateListeners(html);
		Gui.activateListeners(html);
		html.find('.toggle-mode--edit').click(this._toggleModeEdit.bind(this));
		html.find('.ability-ranking .move-up, .ability-ranking .move-down').click(this._updateAbilityRanking.bind(this));
		html.find('.save-ranking .move-up, .save-ranking .move-down').click(this._updateSaveRanking.bind(this));
	}

	_getActorData(actor) {
		return {
			data: {
				name: actor.name
			}
		}
	}

	_updateAbilityRanking(event) {
		const rankings = [];
		event.currentTarget.closest(".accordion-section__body").querySelectorAll("[name='data.gg5e_mm.blueprint.data.ability_modifiers.ranking']").forEach(x => rankings.push(x.value));
		this.actor.update({
			[`data.gg5e_mm.blueprint.data.ability_modifiers.ranking`]: rankings
		});
	}

	_updateSaveRanking(event) {
		const rankings = [];
		event.currentTarget.closest(".accordion-section__body").querySelectorAll("[name='data.gg5e_mm.blueprint.data.saving_throws.ranking']").forEach(x => rankings.push(x.value));
		this.actor.update({
			[`data.gg5e_mm.blueprint.data.saving_throws.ranking`]: rankings
		});
	}

// 	_moveDown(event) {
// 		const li = event.currentTarget.closest('.ability-ranking');
// 		if(li.nextElementSibling) {
//     		li.parentNode.insertBefore(li.nextElementSibling, li);
// 		}
// 		const rankings = [];
// 		event.currentTarget.closest(".accordion-section__body").querySelectorAll("[name='data.gg5e_mm.blueprint.data.ability_modifiers.ranking']").forEach(x => rankings.push(x.value));
// 		this.actor.update({
// 			[`data.gg5e_mm.blueprint.data.ability_modifiers.ranking`]: rankings
// 		});
// 	}

	_toggleModeEdit(event) {
		const li = event.currentTarget.closest(".gg5e-mm-window");
		li.classList.toggle("expanded");
	}

	_getDefaultGui() {
		return {
			data: {
				accordions: {
					accordion_builder: 0
				},
				panels: {
					panel_abilities: true
				}
			}
		}
	}

  _updateObject(event, form) {

	// let requiredStrings = [
	// 	"name",
	// 	"data.gg5e_mm.blueprint.data.combat.rank.custom_name",
	// 	"data.gg5e_mm.blueprint.data.combat.role.custom_name"
	// ];

	// requiredStrings.forEach(function(str) {
	// 	if (form[str].trim().length == 0) {
	// 		form[str] = "???";
	// 	}
	// });

	if (form["data.gg5e_mm.blueprint.data.saving_throws.method"] === "sync") {
		form["data.gg5e_mm.blueprint.data.saving_throws.ranking"] = form["data.gg5e_mm.blueprint.data.ability_modifiers.ranking"];
	}

	if (event.currentTarget && event.currentTarget.name) {
		switch (event.currentTarget.name) {
			case "data.gg5e_mm.blueprint.data.combat.rank.type":
				for (const key in form) {
					if (/\.rank\.modifiers/.test(key)) delete form[key];
				}
				form["data.gg5e_mm.blueprint.data.combat.rank.custom_name"] = null;
				form["data.gg5e_mm.blueprint.data.combat.rank.modifiers"] = null;
				break;
			case "data.gg5e_mm.blueprint.data.combat.role.type":
				for (const key in form) {
					if (/\.role\.modifiers/.test(key)) delete form[key];
				}
				form["data.gg5e_mm.blueprint.data.combat.role.custom_name"] = null;
				form["data.gg5e_mm.blueprint.data.combat.role.modifiers"] = null;
				break;
		}
	}

    super._updateObject(event, form);
  }
}