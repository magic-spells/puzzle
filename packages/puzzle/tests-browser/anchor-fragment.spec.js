import { test, expect } from '@playwright/test';
import { STAYS } from './helpers.js';

// In-page anchors and the router (D41 — "native in-page anchors are not the
// router's business").
//
// Part A pins the BROWSER BEHAVIOR the router's design bets on, because jsdom
// cannot answer it and getting it backwards leads to opposite conclusions about
// the same code: a bare `<a href="#faq">` click — which #handleClick
// deliberately hands to the browser — fires POPSTATE, then hashchange. The
// router therefore DOES observe browser-handled fragment jumps; they arrive at
// #handlePopState like any other history move, on a brand-new entry whose
// `history.state` is null. modes.js' "fragment navigations fire popstate in
// supported browsers" is correct, and it holds for path routing too, not only
// hash routing. (Confirmed in Chromium, WebKit and Firefox; this suite runs the
// two engines playwright.config.js declares.)
//
// Part B pins what the router must do about it in a real app: nothing. No
// route commit, no view teardown, no scroll of its own on a fresh fragment
// navigation, no focus move, no route announcement — while `current.path` /
// `current.hash` keep naming the address bar so push()'s same-path no-op stays
// truthful. Before the guard in #handlePopState, path routing (the DEFAULT
// mode) ran the entire navigation pipeline for every one of these.

// ---------------------------------------------------------------------------
// Part A — raw engine semantics
// ---------------------------------------------------------------------------

// A standalone page served by route interception: no framework, no router, just
// an anchor, a tall document, and an event log. Interception keeps the fixture
// inside this spec file instead of leaking a probe page into examples/.
const PROBE_HTML = `<!doctype html>
<html><head><title>fragment probe</title></head>
<body style="margin:0">
  <a id="jump" href="#faq" style="position:fixed;top:0;left:0;z-index:9">go to faq</a>
  <div style="height:3000px"></div>
  <h2 id="faq">FAQ</h2>
  <div style="height:3000px"></div>
  <script>
    window.__log = [];
    const rec = (type) => window.__log.push({ type, hash: location.hash, state: history.state });
    addEventListener('popstate', () => rec('popstate'));
    addEventListener('hashchange', () => rec('hashchange'));
  </script>
</body></html>`;

async function openProbe(page) {
	await page.route('**/pw-fragment-probe', (route) =>
		route.fulfill({ contentType: 'text/html; charset=utf-8', body: PROBE_HTML })
	);
	await page.goto(STAYS + '/pw-fragment-probe');
	await expect(page.locator('#jump')).toBeVisible();
}

const readLog = (page) => page.evaluate(() => window.__log.slice());
const clearLog = (page) => page.evaluate(() => (window.__log = []));

test('A1. a bare <a href="#faq"> click fires popstate, then hashchange', async ({ page }) => {
	await openProbe(page);
	await clearLog(page);

	await page.locator('#jump').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#faq');
	await expect.poll(async () => (await readLog(page)).length).toBeGreaterThanOrEqual(2);

	const log = await readLog(page);
	const types = log.map((e) => e.type);

	// THE FINDING. Both fire, and popstate comes first — so a router that listens
	// on popstate only (never hashchange) genuinely sees in-page anchor jumps.
	expect(types).toContain('popstate');
	expect(types).toContain('hashchange');
	expect(types.indexOf('popstate')).toBeLessThan(types.indexOf('hashchange'));
	expect(types[0]).toBe('popstate');

	// The browser created a NEW entry and put NOTHING in history.state — which is
	// why #adoptEntryKey has to stamp a scroll key onto it.
	expect(log[0].hash).toBe('#faq');
	expect(log[0].state).toBeNull();
});

test('A2. the fragment entry carries null state even when the previous entry had some', async ({
	page,
}) => {
	await openProbe(page);
	await page.evaluate(() => history.replaceState({ __puzzleScrollKey: 'seed' }, ''));
	await clearLog(page);

	await page.locator('#jump').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#faq');

	// State is per-entry, so the router cannot rely on inheriting its key.
	expect(await page.evaluate(() => history.state)).toBeNull();
});

test('A3. control — history.back() off a fragment URL also fires popstate', async ({ page }) => {
	await openProbe(page);
	await page.locator('#jump').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#faq');
	await clearLog(page);

	await page.goBack();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('');

	const types = (await readLog(page)).map((e) => e.type);
	expect(types).toContain('popstate');
	expect(types.indexOf('popstate')).toBeLessThan(types.indexOf('hashchange'));
});

// ---------------------------------------------------------------------------
// Part B — the router in a real app (examples/stays, path mode)
// ---------------------------------------------------------------------------

const homeMarker = 'h1:has-text("Find your place")';

/**
 * Install a minimal DevTools bridge hook (D100) BEFORE the app boots, so every
 * runtime event is recorded. `route-commit` firing is the unambiguous signal
 * that the navigation pipeline ran — which is exactly what must NOT happen for
 * an in-page fragment move (a committed navigation is what re-runs every
 * ancestor's data()). `view-mounted`/`view-destroyed` catch a teardown even if
 * the commit itself were somehow skipped.
 */
async function installBridge(page) {
	await page.addInitScript(() => {
		window.__PW_EVENTS__ = [];
		window.__PUZZLE_DEVTOOLS_HOOK__ = {
			emit: (msg) => window.__PW_EVENTS__.push(msg && msg.type),
			onRequest: () => {},
		};
	});
}

const eventsSince = (page, mark) =>
	page.evaluate((m) => window.__PW_EVENTS__.slice(m), mark);
const eventCount = (page) => page.evaluate(() => window.__PW_EVENTS__.length);

/** Router state as the app sees it (dev builds publish window.__PUZZLE_APP__). */
const routerState = (page) =>
	page.evaluate(() => {
		const c = window.__PUZZLE_APP__.router.current;
		return { path: c.path, pathname: c.pathname, hash: c.hash, route: c.route.name };
	});

/**
 * Page-level probe furniture: a FIXED anchor bar (clickable at any scroll
 * offset) and a far-down target, both appended to <body> so the app's own DOM
 * is left exactly as the framework rendered it.
 */
async function addAnchorProbe(page) {
	await page.evaluate(() => {
		const bar = document.createElement('div');
		bar.id = 'pw-bar';
		bar.style.cssText =
			'position:fixed;top:0;left:0;z-index:99999;background:#fff;border:1px solid #000;padding:4px';
		const a = document.createElement('a');
		a.id = 'pw-anchor';
		a.href = '#pw-target';
		a.textContent = 'jump';
		bar.appendChild(a);
		document.body.appendChild(bar);

		const spacer = document.createElement('div');
		spacer.style.cssText = 'height:2400px';
		document.body.appendChild(spacer);

		const target = document.createElement('h2');
		target.id = 'pw-target';
		target.textContent = 'PW TARGET';
		document.body.appendChild(target);

		const tail = document.createElement('div');
		tail.style.cssText = 'height:2400px';
		document.body.appendChild(tail);
	});
}

/** How many view roots the router has focused (it stamps tabindex="-1", D93). */
const focusedRoots = (page) =>
	page.evaluate(() => document.querySelectorAll('puzzle-view[tabindex="-1"]').length);

/** The route-announcement live region's current text (D93). */
const announced = (page) =>
	page.evaluate(() => {
		const el = document.querySelector('[data-puzzle-live-region]');
		return el ? el.textContent : null;
	});

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

async function bootHome(page) {
	await installBridge(page);
	await page.goto(STAYS + '/');
	await expect(page.locator(homeMarker)).toBeVisible();

	// Non-vacuity guard: if the dev bridge were not live (a production build, a
	// renamed hook), every "no route-commit" assertion below would pass for the
	// wrong reason.
	await expect.poll(() => page.evaluate(() => window.__PW_EVENTS__)).toContain('app-mounted');

	await addAnchorProbe(page);
	return page;
}

test('B1. a bare anchor click does not commit a navigation, scroll, focus or announce', async ({
	page,
}) => {
	await bootHome(page);

	await page.evaluate(() => window.scrollTo(0, 400));
	await expect.poll(() => scrollY(page)).toBe(400);

	const mark = await eventCount(page);
	const announcedBefore = await announced(page);
	expect(await focusedRoots(page)).toBe(0); // nav #0 never focuses (D93)

	await page.locator('#pw-anchor').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');
	// Give the (skipped) pipeline every chance to run before asserting it didn't.
	await page.waitForTimeout(400);

	// No navigation committed → no ancestor data() re-run, no view torn down.
	const fired = await eventsSince(page, mark);
	expect(fired).not.toContain('route-commit');
	expect(fired).not.toContain('view-destroyed');
	expect(fired).not.toContain('view-mounted');

	// The browser's anchor landing stands: the window is at the target, NOT
	// yanked back to the top a task later.
	const targetTop = await page.evaluate(
		() => Math.round(document.getElementById('pw-target').getBoundingClientRect().top + window.scrollY)
	);
	expect(await scrollY(page)).toBeGreaterThan(1000);
	expect(Math.abs((await scrollY(page)) - targetTop)).toBeLessThan(60);

	// No focus steal into the view tree, no route announcement.
	expect(await focusedRoots(page)).toBe(0);
	expect(
		await page.evaluate(() => {
			const app = document.querySelector('#app');
			return !!app && app.contains(document.activeElement);
		})
	).toBe(false);
	expect(await announced(page)).toBe(announcedBefore);

	// current.path / current.hash still name the address bar.
	const state = await routerState(page);
	expect(state.hash).toBe('#pw-target');
	expect(state.path).toBe('/#pw-target');
	expect(state.pathname).toBe('/');
	expect(state.route).toBe('home');
});

test('B2. the router still stamps a scroll key onto the entry the browser created', async ({
	page,
}) => {
	await bootHome(page);
	await page.locator('#pw-anchor').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');

	// Without this, back/forward across the pair could never restore.
	await expect
		.poll(() => page.evaluate(() => history.state && history.state.__puzzleScrollKey))
		.toBeTruthy();
});

test('B3. back/forward across the /#fragment pair restores scroll without navigating', async ({
	page,
}) => {
	await bootHome(page);

	// Read partway down the page, THEN take the anchor — so "restored something"
	// and "reset to the top" are distinguishable on the way back.
	await page.evaluate(() => window.scrollTo(0, 400));
	await expect.poll(() => scrollY(page)).toBe(400);

	await page.locator('#pw-anchor').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');
	await page.waitForTimeout(200);

	// --- back to the bare path ------------------------------------------------
	let mark = await eventCount(page);
	const announcedBefore = await announced(page);

	await page.goBack();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
	await page.waitForTimeout(400);

	expect(await eventsSince(page, mark)).not.toContain('route-commit');
	expect((await routerState(page)).hash).toBe('');
	expect((await routerState(page)).route).toBe('home');
	expect(await focusedRoots(page)).toBe(0);
	expect(await announced(page)).toBe(announcedBefore);
	// The traversal restored a position; it did NOT reset the page to the top.
	// Only "not the top" is asserted here, deliberately. The exact value is
	// engine-dependent because this entry's position was recorded during the
	// FRESH fragment navigation: Chromium fires popstate BEFORE its anchor jump
	// (so the pre-click 400 is what #savePosition reads), while WebKit and
	// Firefox jump first (so the anchor offset is what it reads). The precise
	// restore is pinned on the hop below instead, where every engine agrees.
	expect(await scrollY(page)).toBeGreaterThan(0);

	// --- forward to the fragment, then assert an EXACT restore ----------------
	mark = await eventCount(page);
	await page.goForward();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');
	await page.waitForTimeout(400);

	expect(await eventsSince(page, mark)).not.toContain('route-commit');
	expect((await routerState(page)).hash).toBe('#pw-target');
	expect(await focusedRoots(page)).toBe(0);
	expect(await scrollY(page)).toBeGreaterThan(0);

	// Read further down the fragment entry, then leave it. The move away targets
	// a URL with NO fragment, so no engine performs an anchor jump ahead of
	// popstate and #savePosition's live read is trustworthy everywhere — this is
	// the case that pins the restore to an exact number.
	await page.evaluate(() => window.scrollTo(0, 1500));
	await expect.poll(() => scrollY(page)).toBe(1500);

	mark = await eventCount(page);
	await page.goBack();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
	await page.waitForTimeout(400);
	expect(await eventsSince(page, mark)).not.toContain('route-commit');

	// --- forward again: 1500 must come back exactly, on every engine ----------
	mark = await eventCount(page);
	await page.goForward();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');
	await expect.poll(() => scrollY(page)).toBe(1500);

	expect(await eventsSince(page, mark)).not.toContain('route-commit');
	expect(await focusedRoots(page)).toBe(0);
	expect((await routerState(page)).route).toBe('home');
});

test('B4. a real route change from a fragment URL still commits normally', async ({ page }) => {
	await bootHome(page);
	await page.locator('#pw-anchor').click();
	await expect.poll(() => page.evaluate(() => location.hash)).toBe('#pw-target');

	// The guard must not swallow genuine navigations away from the fragment URL.
	const mark = await eventCount(page);
	await page.locator('a[href="/search"]').first().click();
	await expect(page).toHaveURL(/\/search$/);
	await expect(page.locator('h1:has-text("Search stays")')).toBeVisible();

	expect(await eventsSince(page, mark)).toContain('route-commit');
	const state = await routerState(page);
	expect(state.route).toBe('search');
	expect(state.hash).toBe('');
});
