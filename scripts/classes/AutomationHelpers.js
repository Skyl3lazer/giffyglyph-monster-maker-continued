/* Interop with the third-party automation stack (midi-qol, DAE). Each function no-ops without them. */
const AutomationHelpers = (function () {

	/* Raw data for one activity, from a prepared item or from creation data. Neither shape can be assumed. */
	function activitySource(item, activityId) {
		const activity = item?.system?.activities?.get?.(activityId);
		const existing = activity
			? (activity.toObject?.() ?? activity._source)
			: item?._source?.system?.activities?.[activityId];
		return (existing && typeof existing === "object") ? existing : null;
	}

	/* Anything outside `ownedFields` was written by another module and a forced replacement would reset it. */
	function preserveForeignActivityFields(item, activityId, newData, ownedFields) {
		const existing = activitySource(item, activityId);
		if (!existing) return newData;

		const merged = { ...newData };
		for (const [key, value] of Object.entries(existing)) {
			if (ownedFields.has(key) || key in merged) continue;
			merged[key] = value;
		}
		return merged;
	}

	/* Core stamps the source effect's uuid, midi the activity's, and dnd5e's tray the concentration
	 * effect's whenever the action concentrates. None of the three can be assumed. */
	function resolveSourceItem(origin) {
		if (typeof origin !== "string" || !origin) return null;
		const viaMidi = globalThis.MidiQOL?.getItemFromEffectOrigin;
		if (viaMidi) {
			try {
				const found = viaMidi(origin);
				if (found) return found;
			} catch (error) {
				console.warn("GMM | midi origin resolution failed; cutting the uuid instead", error);
			}
		}
		const doc = fromUuidSync(origin.split(".Activity.")[0].split(".ActiveEffect.")[0]);
		if (doc?.documentName === "Item") return doc;
		// A concentration effect rides the actor, so cutting its uuid lands on the actor and not the item.
		const carrier = fromUuidSync(origin);
		const itemId = carrier?.getFlag?.("dnd5e", "item")?.id;
		return itemId ? (carrier.parent?.items?.get?.(itemId) ?? null) : null;
	}

	/* A concentration effect names its feature on a flag rather than through `origin`. */
	function concentrationFor(actor, itemId) {
		if (!actor || !itemId) return null;
		return [...(actor.concentration?.effects ?? [])]
			.find(e => e.getFlag("dnd5e", "item")?.id === itemId) ?? null;
	}

	return {
		concentrationFor: concentrationFor,
		activitySource: activitySource,
		preserveForeignActivityFields: preserveForeignActivityFields,
		resolveSourceItem: resolveSourceItem
	};
})();

export default AutomationHelpers;
