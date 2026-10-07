export const GMM_EFFECT_POINT_BUDGET = {
	common: 1,
	uncommon: 3,
	rare: 5
};

export const GMM_EFFECT_POINT_LADDER = {
	common: 1,
	uncommon: 2,
	rare: 4
};

/* Keyed by status id, a Condition is recognized by the status. */
export const GMM_CONDITION_RARITIES = {
	deafened: "common",
	grappled: "common",
	poisoned: "common",
	prone: "common",
	"gmm.exposed": "common",
	"gmm.feeble": "common",
	"gmm.silenced": "common",
	"gmm.slowed": "common",
	"gmm.stinking": "common",
	blinded: "uncommon",
	charmed: "uncommon",
	frightened: "uncommon",
	invisible: "uncommon",
	restrained: "uncommon",
	"gmm.bleeding": "uncommon",
	"gmm.bound": "uncommon",
	"gmm.dazed": "uncommon",
	"gmm.dehydrated": "uncommon",
	"gmm.disoriented": "uncommon",
	"gmm.fatigued": "uncommon",
	"gmm.starving": "uncommon",
	"gmm.swarmed": "uncommon",
	"gmm.vulnerable": "uncommon",
	paralyzed: "rare",
	petrified: "rare",
	stunned: "rare",
	unconscious: "rare",
	"gmm.banished": "rare",
	"gmm.cursed": "rare",
	"gmm.decaying": "rare",
	"gmm.transformed": "rare"
};

export const GMM_TERRAIN_RARITIES = {
	difficult: "common",
	half_cover: "common",
	lightly_obscured: "common",
	loud: "common",
	uncomfortable: "common",
	unstable: "common",
	damaging: "uncommon",
	heavily_obscured: "uncommon",
	three_quarters_cover: "uncommon",
	impassable: "rare",
	magical_darkness: "rare",
	total_cover: "rare",
	vacuum: "rare"
};

export const GMM_HEALING_BOONS = {
	temphp: { boon: "barrier", rarity: "uncommon" },
	healing: { boon: "healer", rarity: "rare" }
};

export const GMM_DEAL_DAMAGE = {
	step: 25,
	aimedBase: 75,
	areaBase: 50,
	missStep: 50,
	overkillAbove: 250
};
