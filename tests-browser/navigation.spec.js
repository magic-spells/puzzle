import { test, expect } from '@playwright/test';
import { STAYS } from './helpers.js';

// examples/stays — history-mode, multi-route (/, /search, /account, …), seeded
// in beforeMount so views render full content on first commit (Home is NOT a
// <puzzle-skeleton> view). Used for the two scenarios transitions-demo can't
// cover (it's memory-mode: no URL, no window scroll). The layout + hero hold
// real <a href> links the history-mode router intercepts. Distinguishing
// headings: Home has "Find your place"; Search has "Search stays".

const searchLink = 'a[href="/search"]';
const homeMarker = 'h1:has-text("Find your place")';
const searchMarker = 'h1:has-text("Search stays")';

test('d. browser back/forward returns to the correct committed route (URL + view agree)', async ({
	page,
}) => {
	await page.goto(STAYS + '/');
	await expect(page.locator(homeMarker)).toBeVisible();

	// Navigate to Search via a real link; the history-mode router intercepts it.
	await page.locator(searchLink).first().click();
	await expect(page).toHaveURL(/\/search$/);
	await expect(page.locator(searchMarker)).toBeVisible();
	await expect(page.locator(homeMarker)).toHaveCount(0);

	// Browser back → home: URL and view content agree.
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`${STAYS}/?$`));
	await expect(page.locator(homeMarker)).toBeVisible();
	await expect(page.locator(searchMarker)).toHaveCount(0);

	// Browser forward → search again.
	await page.goForward();
	await expect(page).toHaveURL(/\/search$/);
	await expect(page.locator(searchMarker)).toBeVisible();
});

test('f. router owns window scroll: a forward push lands the new route at the top', async ({
	page,
}) => {
	await page.goto(STAYS + '/');
	await expect(page.locator(homeMarker)).toBeVisible();

	// The seeded listing grids make Home tall; wait until it is genuinely scrollable.
	await expect
		.poll(() => page.evaluate(() => document.body.scrollHeight - window.innerHeight), {
			timeout: 8000,
		})
		.toBeGreaterThan(600);

	// Scroll down, then push to another route. The router owns window scroll and
	// resets to the top on a push (SPEC §14, D33).
	const target = await page.evaluate(() => {
		const y = Math.min(1200, document.body.scrollHeight - window.innerHeight - 10);
		window.scrollTo(0, y);
		return y;
	});
	expect(target).toBeGreaterThan(300);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(target - 50);

	await page.locator(searchLink).first().click();
	await expect(page).toHaveURL(/\/search$/);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

// REGRESSION GUARD for a bug this suite originally surfaced: D61 moved the
// outgoing-scroll SAVE into the swap's commit window, which runs AFTER
// `oldAnimator.destroy()` collapsed the page — a real browser clamped
// window.scrollY to ~0 and every saved position was {0,0}, so back-navigation
// restored to the top. jsdom performs no layout (never clamps on DOM removal),
// so only a real browser catches this. Fixed in the runtime: #navigate captures
// the departure position synchronously at nav start and #commitLocation
// persists that captured value (D61 atomicity holds — a superseded/failed nav
// discards it).
test(
	'f2. browser back restores the previous scroll position',
	async ({ page }) => {
		await page.goto(STAYS + '/');
		await expect(page.locator(homeMarker)).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => document.body.scrollHeight - window.innerHeight), {
				timeout: 8000,
			})
			.toBeGreaterThan(600);

		const target = await page.evaluate(() => {
			const y = Math.min(1200, document.body.scrollHeight - window.innerHeight - 10);
			window.scrollTo(0, y);
			return y;
		});
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(target - 50);

		await page.locator(searchLink).first().click();
		await expect(page).toHaveURL(/\/search$/);

		await page.goBack();
		await expect(page.locator(homeMarker)).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => window.scrollY), { timeout: 6000 })
			.toBeGreaterThan(target - 150);
	}
);
