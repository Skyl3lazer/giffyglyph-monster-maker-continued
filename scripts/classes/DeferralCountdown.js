import { GMM_MODULE_TITLE } from '../consts/GmmModuleTitle.js';
import {
	GMM_DEFERRAL_COUNTDOWN_DEFAULTS,
	GMM_DEFERRAL_COUNTDOWN_SETTING
} from '../consts/GmmDeferralCountdown.js';

const GMM_CLOCK_FLAG = "deferral";
const GMM_BADGE_PROPERTY = "gmmDeferralBadge";
const GMM_BADGE_EXTRA_STROKE = 1;

/* No socket and no write of its own. The effect update each tick already performs repaints every client. */
const DeferralCountdown = (function () {

	function init() {
		Hooks.on("drawToken", _paint);
		Hooks.on("refreshToken", _paint);
	}

	/* A stored object predating a new control is missing its key, so every read lands on the defaults first. */
	function getSettings() {
		try {
			const stored = game.settings.get(GMM_MODULE_TITLE, GMM_DEFERRAL_COUNTDOWN_SETTING);
			return { ...GMM_DEFERRAL_COUNTDOWN_DEFAULTS, ...(stored ?? {}) };
		} catch (error) {
			return { ...GMM_DEFERRAL_COUNTDOWN_DEFAULTS };
		}
	}

	/* The nameplate's own style, so a badge belongs to the same family as every other label on a token. */
	function buildStyle(config, { fontSize, due }) {
		const style = CONFIG.canvasTextStyle.clone();
		style.fontFamily = config.font || GMM_DEFERRAL_COUNTDOWN_DEFAULTS.font;
		style.fontSize = fontSize;
		style.fill = (due ? config.dueColor : config.color) || GMM_DEFERRAL_COUNTDOWN_DEFAULTS.color;
		style.strokeThickness = style.strokeThickness + GMM_BADGE_EXTRA_STROKE;
		style.align = "center";
		return style;
	}

	/* A percentage of the smaller side, so a badge can never outgrow the token carrying it. */
	function fontSizeFor(config, width, height) {
		return Math.max(1, Math.min(width, height) * (Number(config.size) || 0) / 100);
	}

	function labelFor(remaining) {
		return remaining > 0 ? String(remaining) : game.i18n.localize("gmm.deferral.clock.due");
	}

	function repaintAll() {
		for (const token of canvas?.tokens?.placeables ?? []) _paint(token);
	}

	function _paint(token) {
		try {
			const remaining = _lowestRemaining(token?.actor);
			const config = getSettings();
			// Core hides a secret token's effects from anyone but an observer. A countdown is one of them.
			const show = config.enabled && (remaining !== null) && !token.document.isSecret;

			let badge = token[GMM_BADGE_PROPERTY];
			if (!show) {
				if (badge && !badge.destroyed) badge.visible = false;
				return;
			}

			if (!badge || badge.destroyed) {
				const text = new foundry.canvas.containers.PreciseText("", CONFIG.canvasTextStyle.clone());
				badge = token[GMM_BADGE_PROPERTY] = token.addChild(text);
			}

			const due = !(remaining > 0);
			const fontSize = fontSizeFor(config, token.w, token.h);
			// A refresh runs every animation frame a token moves. Assigning a style re-rasterizes the glyph.
			const signature = `${config.font}|${fontSize}|${due ? config.dueColor : config.color}`;
			if (badge.gmmStyleSignature !== signature) {
				badge.style = buildStyle(config, { fontSize, due });
				badge.gmmStyleSignature = signature;
			}

			badge.text = labelFor(remaining);
			_anchor(token, badge, config);
			badge.visible = true;
		} catch (error) {
			console.error("GMM | Drawing a deferral countdown failed", error);
		}
	}

	/* Anchored to the chosen edge rather than inset from it, so a large badge cannot hang off the token. */
	function _anchor(token, badge, config) {
		const x = { left: 0, center: 0.5, right: 1 }[config.horizontal] ?? 0.5;
		const y = { top: 0, center: 0.5, bottom: 1 }[config.vertical] ?? 0.5;
		badge.anchor.set(x, y);
		badge.position.set(token.w * x, token.h * y);
	}

	/* The nearest clock is the only one the book's countdown is about. */
	function _lowestRemaining(actor) {
		let lowest = null;
		for (const effect of actor?.effects ?? []) {
			const clock = effect.getFlag(GMM_MODULE_TITLE, GMM_CLOCK_FLAG);
			if (!clock) continue;
			const remaining = Number(clock.remaining ?? clock.timer);
			if (!Number.isFinite(remaining) || remaining < 0) continue;
			if ((lowest === null) || (remaining < lowest)) lowest = remaining;
		}
		return lowest;
	}

	return {
		init: init,
		getSettings: getSettings,
		buildStyle: buildStyle,
		fontSizeFor: fontSizeFor,
		labelFor: labelFor,
		repaintAll: repaintAll
	};
})();

export default DeferralCountdown;
