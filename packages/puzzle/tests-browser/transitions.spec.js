import { test, expect } from '@playwright/test';
import {
	TRANSITIONS,
	waitForAnimationsIdle,
	trackPeakCount,
	trackMaxAnimationDuration,
	count,
} from './helpers.js';

// examples/transitions-demo mounts the SAME three-route module twice on one page:
//   #app-seq      → transitionMode: 'sequential' (default)
//   #app-overlap  → transitionMode: 'overlap'    (v1.24, D56)
// A shared control bar drives BOTH at once. Views render as
// <puzzle-view class="view view-{aurora|gallery|about}">; the shared layout is
// <puzzle-view class="demo-layout"> (no `.view` class), so `.view` counts only
// routed view instances. Route buttons are `.ctl-route[data-name="…"]`.

const btn = (name) => `.ctl-route[data-name="${name}"]`;

test.beforeEach(async ({ page }) => {
	await page.goto(TRANSITIONS + '/');
	// Both apps boot on aurora ('/').
	await expect(page.locator('#app-seq .view-aurora')).toHaveCount(1);
	await expect(page.locator('#app-overlap .view-aurora')).toHaveCount(1);
});

test('a. sequential: only the outgoing view is in the DOM mid-transition, destination alone after settle', async ({
	page,
}) => {
	const readPeak = await trackPeakCount(page, '#app-seq .view');
	await page.click(btn('gallery'));
	await waitForAnimationsIdle(page, '#app-seq .view-gallery');

	// Sequential: old `out` fully plays, THEN new mounts — the two views never
	// coexist. The per-frame peak of `.view` count must stay at 1.
	const peak = await readPeak();
	expect(peak).toBeLessThanOrEqual(1);

	// After settle only the destination remains.
	expect(await count(page, '#app-seq .view')).toBe(1);
	expect(await count(page, '#app-seq .view-gallery')).toBe(1);
	expect(await count(page, '#app-seq .view-aurora')).toBe(0);
});

test('b. overlap: outgoing + incoming coexist mid-transition; destination alone and no fixed pin after settle', async ({
	page,
}) => {
	const readPeak = await trackPeakCount(page, '#app-overlap .view');
	await page.click(btn('gallery'));
	await waitForAnimationsIdle(page, '#app-overlap .view-gallery');

	// Overlap: leaver is pinned and newcomer mounts immediately — both live at once.
	const peak = await readPeak();
	expect(peak).toBeGreaterThanOrEqual(2);

	// After settle: only the destination, and the inline `position: fixed` pin the
	// router stamps on the leaver is gone (leaver destroyed on its out-settle).
	expect(await count(page, '#app-overlap .view')).toBe(1);
	expect(await count(page, '#app-overlap .view-gallery')).toBe(1);
	const fixedPins = await page.evaluate(() =>
		[...document.querySelectorAll('#app-overlap *')].filter(
			(el) => el.style && el.style.position === 'fixed'
		).length
	);
	expect(fixedPins).toBe(0);
});

test('c. rapid interruption: lands on the final destination with no orphans and no running animations', async ({
	page,
}) => {
	// Fire two navigations back to back; the second supersedes the first.
	await page.click(btn('gallery'));
	await page.click(btn('about'));

	await waitForAnimationsIdle(page, '#app-seq .view-about');
	await waitForAnimationsIdle(page, '#app-overlap .view-about');

	// Both apps land on `about`, each with exactly one view (no orphaned nodes
	// from the superseded gallery navigation).
	for (const app of ['#app-seq', '#app-overlap']) {
		expect(await count(page, `${app} .view`)).toBe(1);
		expect(await count(page, `${app} .view-about`)).toBe(1);
		expect(await count(page, `${app} .view-gallery`)).toBe(0);
		expect(await count(page, `${app} .view-aurora`)).toBe(0);
	}

	// Nothing is still animating.
	expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test.describe('e. reduced motion', () => {
	test('navigation settles with no visible-duration animation', async ({ page }) => {
		// Emulate prefers-reduced-motion, then reload so the app boots with it
		// active. (`test.use({ reducedMotion })` did not reach matchMedia here.)
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.reload();
		await expect(page.locator('#app-seq .view-aurora')).toHaveCount(1);
		expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
			true
		);

		const readMaxDur = await trackMaxAnimationDuration(page, '.view');
		await page.click(btn('gallery'));
		await waitForAnimationsIdle(page, '#app-seq .view-gallery');

		// prefers-reduced-motion zeroes durations (SPEC §12): no VIEW transition
		// with a visible (> 0 ms) duration ever runs; the swap is ~immediate.
		const maxDur = await readMaxDur();
		expect(maxDur).toBe(0);

		expect(await count(page, '#app-seq .view-gallery')).toBe(1);
		expect(await count(page, '#app-overlap .view-gallery')).toBe(1);
	});
});
