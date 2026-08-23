import { expect } from '@playwright/test';

// Base URLs of the two dev servers declared in playwright.config.js.
export const TRANSITIONS = 'http://localhost:4173';
export const STAYS = 'http://localhost:4174';

/**
 * Wait until every Web Animation on the page has settled (the transition is
 * done). Optionally wait for a destination selector to be attached first.
 */
export async function waitForAnimationsIdle(page, presentSelector, timeout = 6000) {
	if (presentSelector) {
		await page.locator(presentSelector).first().waitFor({ state: 'attached', timeout });
	}
	await expect
		.poll(() => page.evaluate(() => document.getAnimations().length), { timeout })
		.toBe(0);
}

/**
 * Start a per-frame sampler that records the PEAK number of elements matching
 * `selector` (used to catch the transient "both views coexist" / "only one ever"
 * moment mid-transition — more robust than trying to poll at the right instant).
 * Returns a reader you call after the transition settles.
 */
export async function trackPeakCount(page, selector) {
	await page.evaluate((sel) => {
		window.__peak = document.querySelectorAll(sel).length;
		const sample = () => {
			const n = document.querySelectorAll(sel).length;
			if (n > window.__peak) window.__peak = n;
			window.__peakRaf = requestAnimationFrame(sample);
		};
		window.__peakRaf = requestAnimationFrame(sample);
	}, selector);
	return async () =>
		page.evaluate(() => {
			cancelAnimationFrame(window.__peakRaf);
			return window.__peak;
		});
}

/**
 * Start a per-frame sampler that records the LONGEST animation duration seen on
 * elements matching `targetSelector` (default `.view` — the routed view roots).
 * Used by the reduced-motion spec: the whole point is that no visible-duration
 * (> 0 ms) VIEW transition ever runs. Scoping to the view roots ignores unrelated
 * CSS transitions on chrome (e.g. the control button's 150 ms color transition).
 * Returns a reader you call after the transition settles.
 */
export async function trackMaxAnimationDuration(page, targetSelector = '.view') {
	await page.evaluate((sel) => {
		window.__maxDur = 0;
		const sample = () => {
			for (const a of document.getAnimations()) {
				const t = a.effect && a.effect.target;
				if (!t || !t.matches || !t.matches(sel)) continue;
				const d = a.effect.getComputedTiming ? a.effect.getComputedTiming().duration : 0;
				if (typeof d === 'number' && d > window.__maxDur) window.__maxDur = d;
			}
			window.__durRaf = requestAnimationFrame(sample);
		};
		window.__durRaf = requestAnimationFrame(sample);
	}, targetSelector);
	return async () =>
		page.evaluate(() => {
			cancelAnimationFrame(window.__durRaf);
			return window.__maxDur;
		});
}

/** Count elements matching a selector right now. */
export function count(page, selector) {
	return page.locator(selector).count();
}
