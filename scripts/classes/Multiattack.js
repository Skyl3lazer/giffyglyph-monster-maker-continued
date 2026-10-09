import Activities from './Activities.js';

/* One use of an attack activity rolls once. Each attack is therefore its own use. */
const Multiattack = (function () {

	function init() {
		Hooks.on("dnd5e.postUseActivity", _onPostUseActivity);
	}

	function _onPostUseActivity(activity) {
		if (activity?.id !== Activities.GMM_ACTIVITY_ID) return;
		const count = Activities.attackCount(activity.item?.flags?.gmm?.blueprint);
		if (count < 2) return;
		const item = activity.actor?.items?.get?.(activity.item.id) ?? activity.item;
		const attacks = item.system?.activities?.get?.(Activities.GMM_ATTACKS_ACTIVITY_ID);
		if (!attacks) return;
		_rollAttacks(attacks, _assignTargets(count))
			.catch(error => console.error("GMM | Multiattack failed", error));
	}

	/* The GM's targeting order decides who takes the leftover attacks. */
	function _assignTargets(count) {
		const targets = Array.from(game.user.targets ?? []);
		if (targets.length > count) {
			ui.notifications.warn(game.i18n.format("gmm.multiattack.too_many_targets", { count, targets: targets.length }));
		}
		return Array.from({ length: count }, (_, i) => targets.length ? targets[i % targets.length] : null);
	}

	async function _rollAttacks(activity, targets) {
		const saved = Array.from(game.user.targets ?? []);
		try {
			for (const target of targets) {
				if (!await _rollAttack(activity, target)) break;
			}
		} finally {
			_setTargets(saved);
		}
	}

	/* False once the GM cancels one, which ends the sequence. */
	async function _rollAttack(activity, target) {
		if (game.modules.get("midi-qol")?.active && globalThis.MidiQOL?.completeActivityUse) {
			const usage = { midiOptions: { workflowOptions: { targetConfirmation: "never" } } };
			if (target) usage.midiOptions.targetsToUse = new Set([target]);
			const workflow = await MidiQOL.completeActivityUse(activity, usage);
			return !!workflow && !workflow.aborted;
		}

		// Core reads the user's targets at roll time. Its own follow-up roll is not awaited.
		_setTargets(target ? [target] : []);
		const results = await activity.use({ subsequentActions: false });
		if (!results) return false;
		const rolls = await activity.rollAttack({}, {}, {
			data: { "flags.dnd5e.originatingMessage": results.message?.id }
		});
		return !!rolls;
	}

	function _setTargets(tokens) {
		canvas.tokens?.setTargets(tokens.map(token => token.id));
	}

	return {
		init: init
	};
})();

export default Multiattack;
