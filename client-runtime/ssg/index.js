/**
 * SSG prerender orchestrator (M1) — `@magic-spells/puzzle/ssg`.
 *
 * Turns a PuzzleApp config into per-route static HTML. It wires the same
 * build-time ctx PuzzleApp.mount() wires (Store + FormatterRegistry + an
 * unstarted memory-mode Router), enumerates the config's routes (nested children
 * included), instantiates each route's layout+view chain exactly as the Router's
 * #navigate assembles it (each instance preloaded — created() + awaited data(),
 * no DOM, no mounted()/animations), serializes the tree (serialize.js), and
 * injects the markup + resolved <title> + managed head tags (D84, head.js —
 * description/canonical/social metadata crawlers must see without running JS)
 * into the app shell. The router takes over on load (see router.js #swap SSG
 * branch) so subsequent navigation stays SPA. It does NOT touch the managed
 * tags after that (D111): the browser only syncs <title>, so the values baked
 * here are the ones every crawler reads — they are never re-derived at runtime.
 *
 * This module runs under Node only (it reads/writes files via node:fs). The Go
 * build (M3) bundles it beside the user's `app/app.js` default export and calls
 * prerenderToDir(app.config, …); prerender() is the DOM-free, filesystem-free core
 * that returns the rendered pages for tests or a custom writer.
 *
 * v1 scope (DOC plan): static paths only — a route with a complete `:param`
 * segment is skipped with a warning. A `:` or `*` inside any other segment is
 * literal static text, matching the Router's segment compiler. The bare
 * top-level catch-all (`path: '*'`, D19) renders like any static route and its
 * output lands at `<outDir>/404.html` — the static-host convention (GitHub
 * Pages/Netlify/Render/Cloudflare serve it for unknown URLs); a route flagged
 * `prerender: false` gets the untouched shell written at its path. Dynamic
 * `staticPaths()` is an explicit follow-up.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import { Router, encodeURL, normalizeBase } from '../router/router.js';
import { memoryRouter } from '../router/modes.js';
import { findShadowedPaths, isDynamicSegment } from '../router/routePath.js';
import { walkRouteTree } from '../router/routeTree.js';
import { serialize, escapeText, escapeAttr, escapeScriptJson } from './serialize.js';
import { assembleChain, makeRouteSnapshot, makeRouterStub } from './assemble.js';
import { resolveHead } from '../head.js';
import { MANAGED_TAGS } from '../headTags.js';

/**
 * Prerender every static route in `config` to an HTML content string + title.
 *
 * @param {object} config the PuzzleApp config (the default-exported app's
 *   `app.config`, or a bare config object) — { target, routes, models,
 *   formatters, apiURL, beforeMount, … }
 * @param {object} [opts]
 * @param {'hybrid'|'static'} [opts.mode] `'hybrid'` (default) is the router-takeover
 *   mode; `'static'` additionally captures each page's store snapshot (`data`), its
 *   view/layout `__pzlModule` stamps (`modules`), and a plain-JSON `route` snapshot
 *   so prerenderToDir can emit true static pages (D81).
 * @param {Router} [opts.routeRouter] INTERNAL — an already-constructed memory
 *   Router over `config.routes`, so prerenderToDir's up-front route validation and
 *   this pass share one compiled matcher table instead of building it twice.
 * @param {string[]} [opts.only] STATIC MODE ONLY — the subset of route paths to
 *   actually render. Every other reachable route still produces a page object
 *   (so route enumeration, skip/duplicate detection, slug assignment and the
 *   warning set are exactly what a full render produces), but it is flagged
 *   `reused: true` and carries no `html`/`data`: no context is built for it, so
 *   `beforeMount` and `data()` never run on its behalf. `undefined` renders
 *   everything. This is the dev-loop's route-level invalidation hook (D155) —
 *   the caller is responsible for supplying the previous render's output for
 *   every reused page.
 * @returns {Promise<{
 *   pages: Array<{ path: string, html: string|null, title: string|null,
 *     head: { title: string|null, description: string|null, canonical: string|null,
 *       socialImage: string|null } | null,
 *     prerender?: boolean,
 *     data?: object, modules?: { views: string[], layout: string|null }, route?: object }>,
 *   skipped: Array<{ path: string, reason: string }>,
 *   warnings: string[]
 * }>} `html`/`title`/`head` are null for a `prerender: false` page (the shell is
 *   written verbatim at its path by prerenderToDir — no head injection either).
 *   `head` is the D84 per-field leaf→root resolution (head.js); `title` rides
 *   beside it (=== head.title) for pre-D84 compatibility. `data`/`modules`/`route`
 *   are present only in static mode.
 */
export async function prerender(config, opts = {}) {
	const mode = opts.mode ?? 'hybrid';
	const isStatic = mode === 'static';

	// Hybrid output is history-mode ONLY. A hybrid page emits path-shaped files the
	// SPA takes over at navigation zero — but a hash or memory router boots at '/'
	// and renders the HOME route over whatever prerendered page loaded, so every
	// deep-linked page would flash home. `routerMode` is PuzzleApp runtime config the
	// Go build can't inspect, so the guard lives here (throws → fails the build). A
	// non-history app must use output: 'static' (no router) instead.
	if (!isStatic && config.routerMode != null) {
		throw new Error(
			`[puzzle] hybrid prerender output requires history routing, but this app sets ` +
				`routerMode (${describeRouterMode(config.routerMode)}) — a hash/memory router boots ` +
				`at "/" and would render the home route over every prerendered page. Use ` +
				`output: 'static' for a non-history app, or drop routerMode (history is the default).`
		);
	}

	// Fail fast on an unsupported target selector before doing any work (v1
	// supports '#id' targets only — the shell surgery keys on the id).
	parseTargetId(config.target);

	// One Router PER BUILD owns route-shape validation + regex compilation, so the
	// SSG never compiles matchers independently — it reads this one's compiled
	// leaves, and (in hybrid) hands the same instance to every page's ctx. Building
	// one per page made route-regex compilation O(routes²) for nothing: the instance
	// is never started, and the only page-varying bits are the two shadowed
	// properties buildContext sets. prerenderToDir constructs it before the shell
	// read (route errors must beat shell errors) and passes it in — `opts.routeRouter`
	// is an internal handoff, not public API.
	const routeRouter = opts.routeRouter ?? new Router(config.routes ?? [], { mode: memoryRouter() });
	const shadowedPaths = findShadowedPaths(routeRouter.routeEntries);
	const shadowedByIndex = new Map(
		shadowedPaths.map(({ index, shadowedBy }) => [index, shadowedBy])
	);
	const entries = enumerateRoutes(config.routes ?? []);
	// The render filter is honoured in static mode only: hybrid's per-page guard
	// warning and shadow attribution assume every reachable route is rendered, and
	// nothing needs a subset render there.
	const only = isStatic && opts.only ? new Set(opts.only) : null;

	const pages = [];
	const skipped = [];
	const warnings = [];
	let hasCatchAll = false;
	let builtContext = false;
	let compiledEntryIndex = 0;
	if (isStatic && hasGuard(config.routes ?? [])) {
		const warning =
			'[puzzle] static output declares route guards, but guards never run in static output (no router)';
		warnings.push(warning);
		console.warn(warning);
	}

	// `routerMode` is meaningless under static output: there is no router to carry a
	// fragment/memory URL, and the emitted files are path-shaped by construction
	// (/about → about/index.html). Honouring 'hash' here would prerender href="#/about"
	// on a page that has no click interception — a dead link. So static forces
	// history-style hrefs (buildContext below) and says so, since the config asked for
	// something else. `routerBase` still applies (a subpath deploy wants the prefix).
	if (isStatic && config.routerMode != null) {
		warnings.push(
			`[puzzle] static output ignores routerMode (${describeRouterMode(config.routerMode)}) — ` +
				'static pages are plain path-shaped documents with no router, so links are emitted ' +
				"history-style. Remove `routerMode`, or drop output: 'static' if you need hash routing."
		);
	}
	// The hybrid ctx router: the build's ONE unstarted memory Router, with url()
	// shadowed once from the app's `routerBase` (a config constant). Lazy so a
	// hybrid build that renders nothing never pays for it and a malformed
	// `routerBase` still throws at the first page, exactly as before.
	let hybridRouterReady = false;
	const hybridRouter = () => {
		if (!hybridRouterReady) {
			hybridRouterReady = true;
			// …a memory router carries no URL, so its url() returns paths UNPREFIXED: a
			// based app would prerender `/about` where the live app renders `/docs/about`
			// — a broken href for crawlers, no-JS visitors, and anyone clicking before
			// takeover. Shadow url() with HISTORY encoding over the app's real base,
			// through the same encoder Router.url() and the static stub use: hybrid
			// output is history-only by construction (the guard above refuses anything
			// else). The compiled route table stays the real memory Router the takeover
			// expects.
			const base = normalizeBase(config.routerBase);
			routeRouter.url = (path) => encodeURL(path, null, base);
		}
		return routeRouter;
	};

	const createPageContext = async (entry) => {
		builtContext = true;
		// Both modes thread the page's route snapshot into their prerender router:
		// static gives it to a fresh throwing stub, while hybrid shadows `current` on
		// the shared memory Router. The beforeMount-only fallback below has no entry —
		// it never renders, so a null route is fine.
		const route = entry ? makeRouteSnapshot(entry) : null;
		let router;
		if (isStatic && route) {
			router = makeRouterStub(route, { base: config.routerBase });
		} else {
			router = hybridRouter();
			if (route) {
				// Own property shadows the prototype getter — the same instance-shadowing
				// trick url() uses above, and for the same reason: `current` reads private
				// fields, so a delegating facade would throw. Redefined per page (the
				// instance is shared); nothing outlives the page's render, and the takeover
				// replaces the whole instance in the browser anyway.
				Object.defineProperty(router, 'current', {
					value: route,
					enumerable: true,
					configurable: true,
				});
			}
		}
		return buildContext(config, { router });
	};

	for (const entry of entries) {
		const { fullPath, chain } = entry;

		// The bare top-level catch-all (`path: '*'`, D19) lands at 404.html (see
		// pageOutputPath). Every non-bare '*' is ordinary literal segment text, just
		// as it is in the Router's regex compiler.
		const isCatchAll = fullPath === '*';
		if (isCatchAll) hasCatchAll = true;
		// The Router drops a catch-all that declares `children` WHOLESALE — its '*'
		// branch stores the flat single-node chain and never walks the tree — so the
		// leaves enumerated beneath it are routes the app can never navigate to. They
		// must also not consume a compiled-entry index: entryIndex is the position in
		// the Router's compiled leaf list, and one phantom index shifts every later
		// leaf's shadow attribution by one.
		const underCatchAll = !isCatchAll && chain[0].path === '*';
		const entryIndex = isCatchAll || underCatchAll ? null : compiledEntryIndex++;
		if (underCatchAll) {
			skipped.push({ path: fullPath, reason: 'unreachable' });
			warnings.push(
				`[puzzle] skipped route "${fullPath}" — it is a child of the catch-all route ` +
					"'*', which the Router matches as a single leaf, so this path is " +
					'unreachable (declare it as a top-level route to prerender it)'
			);
			continue;
		}

		// Only a complete `:name` segment is dynamic. Colons and stars in any
		// other segment are regex-escaped literal text by the Router and therefore
		// produce ordinary prerenderable static paths here.
		if (!isCatchAll && fullPath.split('/').some(isDynamicSegment)) {
			skipped.push({ path: fullPath, reason: 'dynamic' });
			warnings.push(
				`[puzzle] skipped dynamic route "${fullPath}" — SSG v1 renders static paths only ` +
					'(a :param route needs a staticPaths() hook, a post-v1 follow-up)'
			);
			continue;
		}

		// Hybrid pages are taken over by the live first-match-wins Router. Emitting a
		// static page for a route an earlier matcher wins would make first paint and
		// takeover disagree. True static output has no Router, so it deliberately
		// keeps the page.
		if (!isStatic && shadowedByIndex.has(entryIndex)) {
			const shadowedBy = shadowedByIndex.get(entryIndex);
			skipped.push({ path: fullPath, reason: 'shadowed' });
			warnings.push(
				`[puzzle] skipped shadowed route "${fullPath}" — earlier route "${shadowedBy}" ` +
					'matches it first in hybrid output (routes match in declaration order)'
			);
			continue;
		}

		// Subset render (D155): this route's output is unchanged since the last
		// render, so the caller will supply it. The page object is still produced —
		// it consumes its output-path claim and its slug, and the SAME slug must
		// fall to the SAME route as in a full render or the per-page bundle URLs
		// would shift under pages nobody re-rendered. `modules`/`route` are pure
		// functions of the route entry (no context, no store), so the generated
		// per-page entry module is byte-identical either way; `data` is deliberately
		// absent, because a page with no fresh island must not be written.
		if (only && !only.has(fullPath)) {
			const page = { path: fullPath, html: null, title: null, head: null, reused: true };
			if (chain.some((route) => route.prerender === false)) page.prerender = false;
			page.modules = collectModules(entry);
			page.route = serializeRouteJSON(entry);
			pages.push(page);
			continue;
		}

		// Opt-out: a `prerender: false` anywhere in the chain writes the untouched
		// shell at this path (an SPA-only island inside a static site). In static
		// mode the context is still built (beforeMount runs) and its store snapshot
		// captured, so the page's per-page module can rehydrate + mount client-side
		// into the empty target — html stays null (CONTRACT 3).
		if (chain.some((route) => route.prerender === false)) {
			const ctx = await createPageContext(entry);
			const page = { path: fullPath, html: null, title: null, head: null, prerender: false };
			if (isStatic) attachStaticFields(page, entry, ctx);
			pages.push(page);
			continue;
		}

		// Guards are a browser-router gate, never a secrecy boundary: hybrid
		// prerendering still emits the route's markup into public HTML. Warn once
		// per rendered leaf whose effective root→leaf chain contains a guard;
		// `prerender: false` above is the explicit opt-out and therefore stays quiet.
		if (!isStatic && chain.some((route) => route.guard)) {
			const warning =
				`[puzzle] route "${fullPath}" has a guard, but its hybrid-prerendered markup ` +
				'ships publicly — set prerender: false anywhere in its route chain to exclude it';
			warnings.push(warning);
			console.warn(warning);
		}

		const ctx = await createPageContext(entry);
		let rendered;
		try {
			rendered = await renderRoute(entry, ctx);
		} catch (err) {
			// A data() rejection must fail loudly, naming the route (DOC plan risk).
			throw new Error(`[puzzle] prerender failed for route "${fullPath}": ${err.message}`, {
				cause: err,
			});
		}
		const page = { path: fullPath, html: rendered.html, title: rendered.title, head: rendered.head };
		if (isStatic) attachStaticFields(page, entry, ctx);
		pages.push(page);
	}

	// No catch-all → no 404.html: warn (a static host will serve its own default
	// 404 for unknown URLs instead). Flows to the Go build summary like any warning.
	if (!hasCatchAll) {
		warnings.push(
			"[puzzle] no catch-all route (path: '*') — dist/404.html not emitted; " +
				"unknown URLs will get the host's default 404 page"
		);
	}

	// Preserve the old fail-fast lifecycle-hook posture even for a route table that
	// produces no written static pages: a throwing beforeMount still fails the build.
	//
	// An explicit `only` subset is the one caller that opts out. The dev loop passes
	// `only: []` for a rebuild that renders no route at all (a public asset moved),
	// and building the application to render nothing would run beforeMount's side
	// effects on a no-op rebuild and let application setup fail a save that touched
	// no route. `only === null` means no filter was given — a real full render — so
	// every case this guard covered before the subset render existed is unchanged.
	if (!builtContext && only === null && typeof config.beforeMount === 'function') {
		await createPageContext();
	}

	return { pages, skipped, warnings };
}

/**
 * Prerender and write one `index.html` per route into `outDir`, injecting each
 * page into the shell at `shellPath`. Directory-style output: `/` → `outDir/
 * index.html`, `/components/panel-stack` → `outDir/components/panel-stack/
 * index.html` (parent dirs created as needed).
 *
 * @param {object} config the PuzzleApp config (see prerender)
 * @param {object} options
 * @param {string} options.outDir directory to write the per-route files into
 * @param {string} options.shellPath the app shell HTML (the built index.html)
 * @param {'hybrid'|'static'} [options.mode] `'hybrid'` (default) is the current
 *   router-takeover output, byte-identical to before D81. `'static'` emits true
 *   static pages: the `/app.js` bundle tag is stripped, each page carries a
 *   `data-puzzle-static` target + an inline JSON data island + a per-page module
 *   script, and the summary gains the extra fields the Go static build needs.
 * @param {string[]} [options.only] static mode only — render just these route
 *   paths (see prerender). Every other page is reported in `written` with
 *   `reused: true` and NO file is written for it; the caller must place the
 *   previous render's file at the reported `file` path.
 * @returns {Promise<{ outDir: string, written: Array<object>, skipped: Array<{path,reason}>,
 *   warnings: string[], count: number, mode?: string, target?: string,
 *   apiURL?: string|null, hasFormatters?: boolean }>}
 */
export async function prerenderToDir(config, { outDir, shellPath, mode = 'hybrid', only } = {}) {
	if (!outDir) throw new Error('[puzzle] prerenderToDir requires an outDir');
	if (!shellPath) throw new Error('[puzzle] prerenderToDir requires a shellPath');

	// Validate the complete route table FIRST, before the target selector and the
	// shell read: a bad route table should be the error a build reports either way.
	// (It is also the only route validation an all-dynamic app with no beforeMount
	// hook ever gets — every page is skipped before a per-page context is built.)
	// This instance IS prerender's route router — the compiled matcher table is
	// built once per build, not once here and again inside.
	const routeRouter = new Router(config.routes ?? [], { mode: memoryRouter() });

	const targetId = parseTargetId(config.target);
	const shell = fs.readFileSync(shellPath, 'utf8');
	const { pages, skipped, warnings } = await prerender(config, { mode, routeRouter, only });

	if (mode === 'static') {
		return writeStaticDir({ config, outDir, shell, targetId, pages, skipped, warnings });
	}

	// Claim the output paths FIRST (paths only, no HTML). Two route paths can
	// normalize to one file — `/caf%C3%A9` and `/café` decode identically — and the
	// write pool would race two workers on it: nondeterministic winner, and an
	// interleaved truncate/write leaves half a page on disk. The last claimant wins,
	// which is what the sequential writer's overwrite produced. Unlike static output
	// every page still appears in `written`: both routes are live in the SPA router,
	// they just share a prerendered file.
	const written = [];
	const claimedPaths = new Map();
	for (const page of pages) {
		const outPath = pageOutputPath(outDir, page.path);
		claimedPaths.set(outPath, page);
		written.push({ path: page.path, file: outPath, prerender: page.prerender !== false });
	}

	// Injection is pure CPU and runs one page at a time as the pool pulls, so only
	// the pool's window of injected HTML is alive at once — building the full file
	// list first held a second copy of the whole site's markup at peak.
	function* injectPages() {
		for (const [outPath, page] of claimedPaths) {
			const html =
				page.prerender === false
					? shell // opt-out: the plain SPA shell, untouched (no head injection either)
					: injectShell(shell, {
							targetId,
							content: page.html,
							title: page.title,
							head: page.head,
						});
			yield { outPath, html };
		}
	}
	await writeFiles(injectPages());

	return { outDir, written, skipped, warnings, count: written.length };
}

/**
 * Write every page file with bounded concurrency. Page HTML is independent, so the
 * sync per-page `mkdirSync` + `writeFileSync` pair serialized the whole build
 * behind the filesystem one route at a time; `WRITE_CONCURRENCY` workers keep it
 * busy instead. Three details are load-bearing:
 *  - `files` is an ITERATOR of `{ outPath, html }`, pulled one item per worker
 *    turn, so the callers inject each page's HTML as the pool consumes it and at
 *    most `WRITE_CONCURRENCY` injected pages are alive at once. The pulls are
 *    serialized, so a producing generator still runs page by page in order.
 *  - `madeDirs` skips the mkdir for a directory this build already created. Docs
 *    sections share parents heavily, so the recursive mkdir was mostly a repeated
 *    stat of paths that already existed. (A duplicate mkdir would be harmless
 *    anyway — `recursive: true` is idempotent — so the racy check is safe.)
 *  - the FIRST error wins and stops the pool, then throws: a failed write (or a
 *    failed injection, which surfaces out of the pull) fails the build with the
 *    same error object the sync call produced.
 * Order of the caller's `written`/summary arrays is unaffected — it is built from
 * the page list, not from completion order. Callers must claim output paths before
 * producing, since two workers writing one path would race.
 */
const WRITE_CONCURRENCY = 16;

async function writeFiles(files) {
	const madeDirs = new Set();
	let failure = null;

	const worker = async () => {
		while (failure === null) {
			try {
				const step = files.next();
				if (step.done) return;
				const { outPath, html } = step.value;
				const dir = path.dirname(outPath);
				if (!madeDirs.has(dir)) {
					await fs.promises.mkdir(dir, { recursive: true });
					madeDirs.add(dir);
				}
				await fs.promises.writeFile(outPath, html);
			} catch (err) {
				if (failure === null) failure = err;
				return;
			}
		}
	};

	const workers = [];
	for (let i = 0; i < WRITE_CONCURRENCY; i++) workers.push(worker());
	await Promise.all(workers);
	if (failure) throw failure;
}

/**
 * The static-mode (D81) writer: strip the app-bundle tag once, then per page compute
 * a collision-free slug, inject the static shell (content + `data-puzzle-static`
 * marker, inline JSON data island, per-page module script), and collect the extended
 * summary the Go static build consumes (per page: `entry`, `modules`, `route`; top
 * level: `mode`, `target`, `apiURL`, `hasFormatters`).
 *
 * A page whose output file an earlier page already claimed is skipped here with
 * reason `'duplicate'` rather than overwriting it (see claimedPaths below).
 *
 * A page flagged `reused` by a subset render (D155) takes its output-path claim
 * and its slug exactly as it would have, and is reported in `written` with
 * `reused: true` — but no file is produced for it. Everything order-dependent
 * therefore lands identically to a full render; only the writes differ.
 */
async function writeStaticDir({ config, outDir, shell, targetId, pages, skipped, warnings }) {
	// The app-bundle tag is stripped once (the shell is identical for every page) so
	// a missing tag warns once, not per page.
	const { shell: baseShell, found } = stripAppBundle(shell);
	if (!found) {
		warnings.push(
			'[puzzle] static output: no <script src="/app.js"> found in the shell to strip — ' +
				'a page referencing a nonstandard bundle name would 404 it at runtime'
		);
	}

	// Static output has no persistence layer: a live Storage object can't cross the
	// build→client boundary (it JSON-serializes to a dead `{}`), so a static build
	// never threads `config.storage`. Warn when it's set so the missing persistence
	// isn't a silent surprise (records won't survive a page load). A direct
	// mountStatic({storage}) caller can still wire real persistence by hand.
	if (config.storage != null) {
		warnings.push(
			'[puzzle] static output ignores `storage` — a static page has no persistence layer, ' +
				"so records won't persist across page loads. Remove `storage` from the config, or use " +
				"output: 'hybrid' if you need the SPA store."
		);
	}

	// Normalized route base ('' for a root deploy) — prefixes each page's module href
	// so a subpath deploy resolves it (item B5). Validated the same way the Router /
	// the client stub validate it, so a malformed base fails the build here.
	const base = normalizeBase(config.routerBase);

	const slugCounts = new Map();
	// outPath → the route path that already claimed it. Two routes can declare the
	// SAME path, or two paths that normalize to one file (`/caf%C3%A9` and `/café`
	// decode identically). Slugs are collision-suffixed but the output file is
	// path-DERIVED, so the later page used to overwrite the earlier one's HTML while
	// both bundles still shipped. Hybrid output never reaches this: the live
	// first-match-wins Router makes the second route shadowed and prerender() skips
	// it. Static output deliberately keeps shadowed pages (no router), so the writer
	// itself refuses the second claim — the emitted HTML then belongs to the first
	// route in reachable order and no dead second bundle is generated.
	const claimedPaths = new Map();
	const written = [];
	// The pool pulls pages through this generator, so only its window of injected
	// HTML is alive at once — collecting every page's HTML first held a second copy
	// of the whole site's markup at peak. The pulls are serialized, so claims, slugs
	// and `written` still land in enumeration order exactly as they did.
	function* injectPages() {
		for (const page of pages) {
			const outPath = pageOutputPath(outDir, page.path);
			if (claimedPaths.has(outPath)) {
				skipped.push({ path: page.path, reason: 'duplicate' });
				warnings.push(
					`[puzzle] skipped duplicate route "${page.path}" — earlier route ` +
						`"${claimedPaths.get(outPath)}" already writes ${path.relative(outDir, outPath)} ` +
						'(two routes cannot own one static page; remove or rename one of them)'
				);
				continue;
			}
			claimedPaths.set(outPath, page.path);

			// The slug is assigned BEFORE the reuse check on purpose: slugs are
			// order-dependent (uniqueSlug's collision counter walks the page list), so a
			// subset render has to consume them for every page a full render would, or
			// the surviving pages' `_puzzle/<slug>.js` URLs would renumber.
			const slug = uniqueSlug(computeSlug(page.path), slugCounts);
			if (page.reused) {
				written.push({
					path: page.path,
					file: outPath,
					prerender: page.prerender !== false,
					entry: `_puzzle/${slug}.js`,
					modules: page.modules,
					route: page.route,
					reused: true,
				});
				continue;
			}
			const html = injectStaticShell(baseShell, {
				targetId,
				base,
				content: page.html, // null for a prerender:false page → empty, unmarked target
				title: page.title,
				head: page.head, // null for prerender:false → no head injection (D84)
				slug,
				data: page.data ?? {},
			});
			written.push({
				path: page.path,
				file: outPath,
				prerender: page.prerender !== false,
				entry: `_puzzle/${slug}.js`,
				modules: page.modules,
				route: page.route,
			});
			yield { outPath, html };
		}
	}
	await writeFiles(injectPages());

	return {
		outDir,
		written,
		skipped,
		warnings,
		count: written.length,
		mode: 'static',
		target: targetId,
		apiURL: config.apiURL ?? null,
		routerBase: config.routerBase,
		hasModels: Object.keys(config.models ?? {}).length > 0,
		hasFormatters: Object.keys(config.formatters ?? {}).length > 0,
	};
}

// ---- ctx wiring -------------------------------------------------------------

/**
 * Wire the build-time ctx the way PuzzleApp.mount() does (app.js §mount): a Store
 * over the models + apiURL, a FormatterRegistry seeded with the built-ins then the
 * config formatters registered over them, and the page's `router` facade.
 *
 * Router facade parity (D81) is decided by the caller (prerender's
 * createPageContext), which owns the per-build/per-page split. In HYBRID that
 * facade is the build's single UNSTARTED memory-mode Router (full fidelity, no
 * URL/DOM side effects — the SPA takes over on load) with url() shadowed to
 * HISTORY encoding over the app's `routerBase` and `current` shadowed with this
 * page's route snapshot, so prerendered route-aware markup matches the live app.
 * In STATIC it is a per-page makeRouterStub over the same snapshot — the SAME stub
 * the browser kernel (static/index.js buildStaticContext) wires, and it encodes
 * history-style too, or router.url()/current would differ between the prerendered
 * HTML and the client re-render for any based app (the `{ path | link }` formatter
 * reads router.url; a view may read router.current). Static pages ship no router
 * and no click interception, so a hash-shaped href (`#/about`) would be a dead link
 * on a page that physically lives at /about/index.html; the file layout is
 * path-shaped, so the hrefs must be too. `config.routerMode` is warned about in
 * prerender() and otherwise ignored there; `routerBase` DOES flow through (a
 * subpath deploy still wants prefixed hrefs).
 *
 * `config.beforeMount` is awaited with a `{ store, config }` facade (not a real
 * PuzzleApp — documented) so a build-time store seed lands before the first data().
 */
async function buildContext(config, { router }) {
	const { models = {}, formatters = {}, apiURL, storage, beforeRequest } = config;

	const storeOptions = { apiURL };
	if (storage !== undefined) storeOptions.storage = storage;
	// The adapter request hook rides along (v1.55, D91) so a build-time beforeMount
	// seed hits an authenticated API exactly the way the browser store would. (The
	// static browser kernel cannot: its options are serialized into a generated
	// per-page entry module by the Go build, and a function does not survive that.)
	if (beforeRequest !== undefined) storeOptions.beforeRequest = beforeRequest;
	const store = new Store(models, storeOptions);
	const registry = makeFormatterRegistry(formatters, (path) => router.url(path));

	const ctx = { store, router, formatters: registry };

	// Receiver parity with the browser mount (app.js: beforeMount.call(app, app)):
	// the function-form hook sees the `{ store, config }` facade as BOTH its receiver
	// and its argument (the documented D67 arg contract). Destructuring beforeMount
	// off config keeps the method-call receiver from silently being config itself.
	const { beforeMount } = config;
	if (typeof beforeMount === 'function') {
		const facade = { store, config };
		await beforeMount.call(facade, facade);
	}

	return ctx;
}

// ---- route enumeration ------------------------------------------------------

/**
 * Flatten the routes array into one entry PER LEAF via walkRouteTree — the shared
 * tree→leaf walk (routeTree.js) the Router compiles its matcher table from, so a
 * navigable route and its prerendered page can never disagree on the leaf set or
 * composed path. The SSG-only bit is what each leaf carries: `{ fullPath, chain
 * (root→leaf defs), layout }`, where the layout is the top-level route's `layout`
 * (children inherit it). Exported for the drift-guard test.
 */
export function enumerateRoutes(routes) {
	const entries = [];
	const makeLeaf = (chain, fullPaths) => ({
		fullPath: fullPaths[fullPaths.length - 1],
		chain,
		layout: chain[0].layout ?? null,
	});
	for (const route of routes) {
		walkRouteTree(route, entries, makeLeaf);
	}
	return entries;
}

/**
 * Name a configured `routerMode` for a build diagnostic (D159). A mode object is
 * opaque, but the factories tag their descriptor with a `name` for exactly this;
 * a leftover mode STRING (which the Router itself now rejects) is quoted as-is,
 * so an app mid-migration reads a message about the value it actually wrote.
 */
function describeRouterMode(mode) {
	if (typeof mode === 'string') return `the string "${mode}"`;
	return mode?.name ? `${mode.name} routing` : 'a non-history mode';
}

/** Whether any route definition at any depth declares a guard. */
function hasGuard(routes) {
	return routes.some(
		(route) => typeof route.guard === 'function' || (route.children && hasGuard(route.children))
	);
}

// ---- per-route render -------------------------------------------------------

/**
 * Assemble the layout+view chain for a static route (shared assembleChain: preload
 * every instance created() + awaited data() with no DOM, build the nested keyed
 * component vnodes the way the Router's #navigate does) and serialize to an HTML
 * string. Returns the rendered content plus the resolved head fields (D84) —
 * ONE resolveHead walk feeds both `head` and the compatibility `title`
 * (=== head.title), so this path and the router's #syncHead can never diverge
 * on resolution semantics.
 */
async function renderRoute(entry, ctx) {
	const { chain } = entry;
	const { topVnode } = await assembleChain(entry, ctx);
	const html = await serialize(topVnode, { ctx });
	const head = resolveHead(chain);
	return { html, title: head.title, head };
}

// ---- static-mode per-page capture (D81) -------------------------------------

/**
 * Attach the static-mode fields to a rendered page (CONTRACT 3): the page's store
 * snapshot (`data`, the same wire shape the HMR path uses — `_serializeAll()`), the
 * chain's `__pzlModule` stamps (`modules`), and a plain-JSON `route` snapshot the
 * browser kernel zips its view classes onto. Mutates `page` in place.
 */
function attachStaticFields(page, entry, ctx) {
	page.data = ctx.store._serializeAll();
	page.modules = collectModules(entry);
	page.route = serializeRouteJSON(entry);
}

/**
 * Read the app-root-relative `__pzlModule` stamp (CONTRACT 2) from every chain view
 * class and the layout class. A missing stamp means the route is built from a class
 * that codegen did not emit (a hand-written PuzzleView subclass) — static output
 * cannot ship a per-page module for it, so this is a build error naming the route
 * and class.
 */
function collectModules(entry) {
	const views = [];
	for (const node of entry.chain) {
		views.push(requireStamp(node.view, entry.fullPath, 'view'));
	}
	const layout = entry.layout ? requireStamp(entry.layout, entry.fullPath, 'layout') : null;
	return { views, layout };
}

function requireStamp(Class, routePath, kind) {
	const stamp = Class?.__pzlModule;
	if (typeof stamp !== 'string') {
		const name = Class?.name || '<anonymous>';
		throw new Error(
			`[puzzle] static output requires .pzl views/layouts — route "${routePath}" ${kind} ` +
				`${name} has no __pzlModule stamp (compile it from a .pzl file)`
		);
	}
	return stamp;
}

/**
 * The plain-JSON route snapshot for the summary (CONTRACT 3): `{ path, params: {},
 * chain: [{ path, name?, meta? }] }` — no classes, so it survives JSON.stringify to
 * the browser kernel, which rebuilds the full `{ path, pathname, query, hash, route,
 * params, chain }` shape by zipping the page's view classes back on and handing the
 * entry to the shared assembleChain (which derives pathname/query/hash there, D83 —
 * they are constants of a static path, so this summary never needs to carry them).
 */
function serializeRouteJSON(entry) {
	return {
		path: entry.fullPath,
		params: {},
		chain: entry.chain.map((def) => {
			const out = { path: def.path };
			if (def.name != null) out.name = def.name;
			if (def.meta != null) out.meta = def.meta;
			return out;
		}),
	};
}

// ---- shell injection --------------------------------------------------------

/**
 * Inject rendered markup and the resolved title/head into the app shell by STRING
 * SURGERY (no HTML-parser dependency). Finds the EMPTY target element by its id,
 * rebuilds it with a `data-puzzle-ssg` marker (the router's takeover signal) and
 * the content inside, and rewrites the shell's head region in the same pass: with
 * a resolved `head` (D84) the title replacement AND the managed `data-puzzle-head`
 * tags are applied; with only a bare `title` (a direct API caller predating D84)
 * the title-only path runs — no managed tags, byte-compatible. Both read the
 * per-shell plan compiled ONCE per build (getShellPlan, D151), so a page costs
 * one splice over precomputed offsets rather than a document-wide rescan. A
 * missing or non-empty target element is a descriptive throw.
 */
export function injectShell(shell, { targetId, content, title, head }) {
	const plan = getShellPlan(shell);
	const target = findTarget(shell, plan, targetId);
	if (!target) {
		throw new Error(
			`[puzzle] SSG target element not found or not empty — expected an EMPTY ` +
				`<… id="${targetId}"></…> in the shell (config.target "#${targetId}")`
		);
	}

	const ops = [
		{
			start: target.start,
			end: target.end,
			text: `<${target.tag}${target.attrs} data-puzzle-ssg>${content}</${target.tag}>`,
		},
	];
	const headOp = headOperation(shell, plan, { head, title });
	if (headOp) ops.push(headOp);
	return spliceShell(shell, ops);
}

// ---- static-mode shell surgery (D81) ----------------------------------------

// Any `<script … src="/app.js" …></script>` — the SPA bundle tag. Static pages
// have no router/app.js, so it is struck once (a missing tag warns; see
// writeStaticDir). `\/?` tolerates a bare `app.js` too; the trailing group allows
// attrs after src (type/defer/etc.) up to the tag close.
const APP_BUNDLE_RE = /<script\b[^>]*\bsrc=["']\/?app\.js["'][^>]*><\/script>\s*/i;

/** Strip the app-bundle `<script>` from the shell. `found` is false if none matched. */
function stripAppBundle(shell) {
	const match = APP_BUNDLE_RE.exec(shell);
	if (!match) return { shell, found: false };
	return {
		shell: shell.slice(0, match.index) + shell.slice(match.index + match[0].length),
		found: true,
	};
}

/**
 * The static-mode shell surgery (CONTRACT 3). Unlike injectShell (which stamps the
 * router's `data-puzzle-ssg` takeover marker), this:
 *  - stamps `data-puzzle-static` (NEVER `data-puzzle-ssg` — the router must never
 *    try to take these pages over) and drops the rendered content into the target,
 *    UNLESS `content` is null (a prerender:false page) in which case the target is
 *    left empty and unmarked;
 *  - injects, immediately before `</body>` (or appended if none): an inline JSON
 *    data island (`<` escaped to `<` so a `</script>` in a record can never
 *    break out of the script) and the per-page ES module `<script>`;
 *  - applies the title/head exactly as injectShell does (resolved `head` →
 *    the managed D84 tags; bare `title` → the pre-D84 title-only path), scoped
 *    to the shell's head region (D151).
 * The caller has already stripped the app-bundle tag from `shell`.
 */
export function injectStaticShell(shell, { targetId, content, title, head, slug, data, base = '' }) {
	const plan = getShellPlan(shell);
	const ops = [];

	// A prerender:false page keeps its empty, UNMARKED target (the kernel mounts into
	// it client-side); only a rendered page rebuilds the target with content + marker.
	if (content != null) {
		const target = findTarget(shell, plan, targetId);
		if (!target) {
			throw new Error(
				`[puzzle] static target element not found or not empty — expected an EMPTY ` +
					`<… id="${targetId}"></…> in the shell (config.target "#${targetId}")`
			);
		}
		ops.push({
			start: target.start,
			end: target.end,
			text: `<${target.tag}${target.attrs} data-puzzle-static>${content}</${target.tag}>`,
		});
	}

	const json = islandJson(data);
	// Base-prefix the per-page module href so a subpath deploy (routerBase set) resolves
	// it instead of 404ing at the domain root. `base` is the already-normalized prefix
	// ('' for a root deploy → unchanged `/_puzzle/…`). The shell's own asset hrefs
	// (styles.css, favicon) stay the app author's responsibility under a base.
	const scripts =
		`<script type="application/json" data-puzzle-static-data>${json}</script>` +
		`<script type="module" src="${base}/_puzzle/${slug}.js"></script>`;
	// The island rides before the SHELL's `</body>` — a fixed offset from the plan, so
	// rendered content can never move the anchor (a `</body>` inside a raw <script>
	// block used to steal it) and no page rescans the document for it.
	if (plan.bodyCloseIndex >= 0) {
		ops.push({ start: plan.bodyCloseIndex, end: plan.bodyCloseIndex, text: scripts });
	}

	const headOp = headOperation(shell, plan, { head, title });
	if (headOp) ops.push(headOp);

	const out = spliceShell(shell, ops);
	return plan.bodyCloseIndex >= 0 ? out : out + scripts;
}

// The data island's payload, memoized across the pages of one build.
//
// The shared JSON-in-script rule (serialize.js) keeps the JSON valid (the escape
// only appears inside string values) while making a literal `</script>` in a
// record impossible to emit — so content cannot terminate the data island early.
//
// Most static builds seed the SAME store content for every route (a beforeMount
// hook that loads shared data, and nothing route-specific), so the escape pass
// re-derived one identical string per page. The memo key is the STRINGIFIED
// payload itself, compared for exact equality: it cannot serve a stale island,
// because a payload that differs by a single byte misses the cache. Only the
// escape is skipped — the store snapshot is still serialized fresh per page.
let lastIslandInput = null;
let lastIslandOutput = null;
function islandJson(data) {
	const json = JSON.stringify(data ?? {});
	if (json !== lastIslandInput) {
		lastIslandInput = json;
		lastIslandOutput = escapeScriptJson(json);
	}
	return lastIslandOutput;
}

/**
 * Compute a page's entry slug from its route path (CONTRACT 3): `'/'` → `index`,
 * `'*'` → `404`, otherwise strip leading/trailing `/` and replace each remaining
 * `/` with `--` (`/guide/templates` → `guide--templates`).
 */
function computeSlug(routePath) {
	if (routePath === '/') return 'index';
	if (routePath === '*') return '404';
	return routePath.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\//g, '--');
}

/**
 * Deduplicate a slug within one build: the first occurrence keeps the base, later
 * collisions get `-2`, `-3`, … in enumeration order (CONTRACT 3). `counts` tracks
 * how many times each base has been requested across the run.
 */
function uniqueSlug(base, counts) {
	const n = (counts.get(base) ?? 0) + 1;
	counts.set(base, n);
	return n === 1 ? base : `${base}-${n}`;
}

/**
 * The EMPTY-target element regex, shared by injectShell + injectStaticShell:
 * `<tag …id="targetId"…></tag>` with only whitespace inside (`\1` closes the same
 * tag). `(?<![-\w])id=` requires a real attribute boundary before `id=` — a plain
 * `\b` matches after a hyphen too, so `data-id="app"`/`aria-id="app"` would falsely
 * satisfy the id lookup; the lookbehind excludes a preceding hyphen or word char.
 * Compiled once per distinct target id (ids are config constants, so this is a
 * one-entry map in every real build).
 */
const targetRes = new Map();
function targetElementRe(targetId) {
	let re = targetRes.get(targetId);
	if (!re) {
		const idPattern = escapeRegExp(targetId);
		re = new RegExp('<(\\w+)([^>]*(?<![-\\w])id=["\']' + idPattern + '["\'][^>]*)>\\s*</\\1>');
		targetRes.set(targetId, re);
	}
	return re;
}

// ---- the compiled shell plan (D151) -----------------------------------------
//
// The shell is read ONCE per build and is identical for every page, so every
// structural offset the injectors need — where the head region starts and ends,
// where its `<title>` sits, where each `data-puzzle-head` marker sits, where the
// target element is, where `</body>` is — is a constant of the build. The plan
// computes them once; a page then costs one O(head) splice over the precomputed
// offsets instead of a dozen document-wide regex scans (which, with the body
// already injected, scanned the rendered page too).
//
// This is also what makes the ownership boundary structural rather than
// hopeful: the head surgery can only ever touch bytes inside the shell's head
// region, so rendered body markup — a `<svg><title>`, a `data-puzzle-head`
// attribute a view happens to emit — is never rewritten.

const HEAD_OPEN_RE = /<head\b[^>]*>/i;
const HEAD_CLOSE_RE = /<\/head>/i;
const TITLE_ELEMENT_RE = /<title>[\s\S]*?<\/title>/;
const TITLE_CLOSE_RE = /<\/title>/i;
const BODY_CLOSE_RE = /<\/body>/i;

/**
 * One compiled marker matcher per managed tag. `spec.id` values are framework
 * constants, so these are module-level literals — never rebuilt per page.
 */
const MANAGED_TAG_RES = MANAGED_TAGS.map((spec) => managedTagRe(spec.id));

// Shell → plan. A build uses one or two shells (hybrid: the shell; static: the
// app-bundle-stripped shell), and a long-lived process could see a few more
// across builds, so the map is bounded and evicts oldest-first.
const MAX_SHELL_PLANS = 4;
const shellPlans = new Map();

function getShellPlan(shell) {
	let plan = shellPlans.get(shell);
	if (plan) return plan;
	plan = compileShellPlan(shell);
	if (shellPlans.size >= MAX_SHELL_PLANS) shellPlans.delete(shellPlans.keys().next().value);
	shellPlans.set(shell, plan);
	return plan;
}

/**
 * Locate the shell's head region and everything the head surgery edits inside it.
 *
 * The region is `<head …>` → `</head>` (case-insensitive; a missing open tag
 * starts it at byte 0). A shell with NO `</head>` — a fragment or malformed shell
 * — degrades exactly as it always has: the region becomes the prefix ending after
 * the first `</title>`, so managed tags ride after the title; with neither anchor
 * there is no region at all and inserts warn + skip rather than throw.
 */
function compileShellPlan(shell) {
	let headStart = 0;
	let headEnd = 0;
	let hasAnchor = false;

	const close = HEAD_CLOSE_RE.exec(shell);
	if (close) {
		headEnd = close.index;
		const open = HEAD_OPEN_RE.exec(shell);
		if (open && open.index + open[0].length <= headEnd) headStart = open.index + open[0].length;
		hasAnchor = true;
	} else {
		const titleClose = TITLE_CLOSE_RE.exec(shell);
		if (titleClose) {
			headEnd = titleClose.index + titleClose[0].length;
			hasAnchor = true;
		}
	}

	const region = shell.slice(headStart, headEnd);
	const edits = [];

	// `<title>` is matched case-sensitively (the historical replaceTitle regex);
	// the `</title>` fallback anchor above stays case-insensitive, as it always was.
	let titleSpan = null;
	const titleMatch = TITLE_ELEMENT_RE.exec(region);
	if (titleMatch) {
		titleSpan = {
			start: headStart + titleMatch.index,
			end: headStart + titleMatch.index + titleMatch[0].length,
		};
		edits.push({ start: titleSpan.start, end: titleSpan.end, spec: -1, first: true });
	}

	const markerCounts = new Array(MANAGED_TAGS.length).fill(0);
	for (let i = 0; i < MANAGED_TAGS.length; i++) {
		const re = MANAGED_TAG_RES[i];
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(region)) !== null) {
			edits.push({
				start: headStart + m.index,
				end: headStart + m.index + m[0].length,
				spec: i,
				first: markerCounts[i] === 0,
			});
			markerCounts[i]++;
		}
	}
	edits.sort((a, b) => a.start - b.start);

	const bodyClose = BODY_CLOSE_RE.exec(shell);

	return {
		headStart,
		headEnd,
		hasAnchor,
		titleSpan,
		edits,
		markerCounts,
		bodyCloseIndex: bodyClose ? bodyClose.index : -1,
		targets: new Map(),
	};
}

/** The shell's empty target element span + tag/attrs, memoized on the plan. */
function findTarget(shell, plan, targetId) {
	let target = plan.targets.get(targetId);
	if (target === undefined) {
		const m = targetElementRe(targetId).exec(shell);
		target = m
			? { start: m.index, end: m.index + m[0].length, tag: m[1], attrs: m[2] }
			: null;
		plan.targets.set(targetId, target);
	}
	return target;
}

/**
 * Apply non-overlapping replacement ops to the shell in ONE pass. Ops are
 * `{ start, end, text }` in shell coordinates (a zero-length span inserts);
 * they are sorted here, and an op overlapping an earlier one is dropped — only
 * reachable for a pathological shell (a target element nested inside `<head>`),
 * where the pre-D151 sequential-replace path produced garbage anyway.
 */
function spliceShell(shell, ops) {
	if (ops.length > 1) ops.sort((a, b) => a.start - b.start);
	let out = '';
	let cursor = 0;
	for (const op of ops) {
		if (op.start < cursor) continue;
		out += shell.slice(cursor, op.start) + op.text;
		cursor = op.end;
	}
	return out + shell.slice(cursor);
}

// ---- managed head surgery (D84, D151) ---------------------------------------

/**
 * The head-region rewrite as a single splice op, or null when there is nothing to
 * do. With a resolved `head` (D84) the whole region is rebuilt (renderHeadRegion);
 * with only a bare `title` (a direct API caller predating D84) just the shell's
 * `<title>` element is replaced — no managed tags, byte-compatible. Either way the
 * op is confined to the SHELL HEAD: a `<title>` or `data-puzzle-head` attribute in
 * rendered body markup is view output and is never touched (D151).
 */
function headOperation(shell, plan, { head, title }) {
	if (head) {
		return { start: plan.headStart, end: plan.headEnd, text: renderHeadRegion(shell, plan, head) };
	}
	if (title != null && plan.titleSpan) {
		return {
			start: plan.titleSpan.start,
			end: plan.titleSpan.end,
			text: `<title>${escapeText(String(title))}</title>`,
		};
	}
	return null;
}

/**
 * Rebuild the shell's head region for one resolved head (head.js resolveHead) —
 * the SSG half of the D84 contract, shared by injectShell and injectStaticShell.
 * The `<title>` element is replaced for a NON-NULL head.title (null or
 * never-resolved keeps the shell's title — the same leave-alone posture the SPA
 * applies to document.title). Then per managed tag identity (headTags.js
 * MANAGED_TAGS — since D111 this is the table's ONLY consumer; the runtime
 * syncTags that once shared it is deleted):
 *  - same-identity `data-puzzle-head` tags already in the shell head are
 *    collapsed: the first is REPLACED in place and every stale duplicate removed;
 *  - tags whose field no longer resolves are ALL REMOVED (the framework owns
 *    every marker-bearing tag IN THE SHELL HEAD, so a shell carrying a stale one
 *    is corrected);
 *  - the rest are appended ONCE at the end of the region, i.e. immediately before
 *    `</head>`. A shell with no `</head>` DEGRADES (see compileShellPlan): the
 *    region ends after the first `</title>` so the tags ride there, or — with
 *    neither anchor — they warn + skip; never a throw, the page content is still
 *    worth writing.
 * All values are attribute-escaped (escapeAttr) so hostile metadata — quotes,
 * `</head>`, `<script>` — cannot break out of the generated tag.
 */
function renderHeadRegion(shell, plan, head) {
	const { headStart, headEnd, edits, markerCounts } = plan;
	let out = '';
	let cursor = headStart;

	for (const edit of edits) {
		if (edit.start < cursor) continue; // overlapping spans in a pathological shell
		out += shell.slice(cursor, edit.start);
		cursor = edit.end;
		if (edit.spec < 0) {
			out +=
				head.title != null
					? `<title>${escapeText(String(head.title))}</title>`
					: shell.slice(edit.start, edit.end);
			continue;
		}
		const spec = MANAGED_TAGS[edit.spec];
		const value = head[spec.field];
		// A resolving field replaces its FIRST marker in place; a non-resolving one
		// removes every marker, and a duplicate is always collapsed away.
		if (value != null && edit.first) out += buildHeadTag(spec, value);
	}
	out += shell.slice(cursor, headEnd);

	let inserts = '';
	for (let i = 0; i < MANAGED_TAGS.length; i++) {
		if (markerCounts[i] > 0) continue; // already replaced in place above
		const spec = MANAGED_TAGS[i];
		const value = head[spec.field];
		if (value == null) continue;
		inserts += buildHeadTag(spec, value);
	}
	if (inserts) {
		if (plan.hasAnchor) {
			out += inserts;
		} else {
			console.warn(
				'[puzzle] head injection skipped — the shell has no </head> (or </title>) to anchor the managed tags'
			);
		}
	}
	return out;
}

/**
 * One managed tag as an HTML string. Since D111 this is the only place managed
 * tags are ever built — there is no DOM twin at runtime to stay in step with.
 * `spec.id`/`spec.attr`/`spec.name` are framework constants (MANAGED_TAGS) and
 * need no escaping; the VALUE is author/route data and always escapes.
 */
function buildHeadTag(spec, value) {
	// twitter:card is a constant flag of "a social image exists", not a value carrier.
	const content = escapeAttr(String(spec.fixed ?? value));
	if (spec.tag === 'link') {
		return `<link rel="canonical" href="${content}" data-puzzle-head="${spec.id}">`;
	}
	return `<meta ${spec.attr}="${spec.name}" content="${content}" data-puzzle-head="${spec.id}">`;
}

/**
 * Match every element open tag by its `data-puzzle-head` identity. The lookbehind
 * mirrors targetElementRe's id= handling: a plain \b would let a hypothetical
 * `x-data-puzzle-head=` attribute satisfy the match.
 */
function managedTagRe(id) {
	return new RegExp(
		'<[^>]*(?<![-\\w])data-puzzle-head=["\']' + escapeRegExp(id) + '["\'][^>]*>',
		'g'
	);
}

/**
 * Directory-style output path: `/` → outDir/index.html, `/a/b` →
 * outDir/a/b/index.html. Percent-encoded route text is decoded to the UTF-8
 * filesystem name a static server resolves from the browser's encoded request
 * (`/caf%C3%A9/` → `outDir/café/index.html`); decodeURI deliberately preserves
 * escaped URI delimiters such as `%2F`. Malformed percent text keeps its current
 * literal-directory behavior. The bare catch-all (`path: '*'`) is the exception
 * — it writes `outDir/404.html`, the filename static hosts serve for unknown URLs.
 */
function pageOutputPath(outDir, routePath) {
	let outPath;
	if (routePath === '*') {
		outPath = path.join(outDir, '404.html');
	} else {
		let filesystemPath = routePath;
		try {
			filesystemPath = decodeURI(routePath);
		} catch {
			// Preserve the pre-normalization output for a literal malformed '%'
			// sequence; the Router also treats malformed literal text as bytes.
		}
		const clean = filesystemPath.replace(/^\//, '').replace(/\/$/, '');
		const rel = clean === '' ? 'index.html' : path.join(clean, 'index.html');
		outPath = path.join(outDir, rel);
	}
	// Containment guard: a route path like "/../x" path.joins OUT of outDir and would
	// write outside the staging dir. Reject any resolved path that escapes it before
	// a single byte is written.
	const relToOut = path.relative(outDir, outPath);
	if (relToOut.startsWith('..') || path.isAbsolute(relToOut)) {
		throw new Error(`[puzzle] route "${routePath}" escapes the output directory`);
	}
	return outPath;
}

// ---- helpers ----------------------------------------------------------------

/**
 * Validate + extract the id from a `config.target` — v1 supports `#id` CSS
 * selectors only (the shell surgery keys on the id). Anything else is a throw.
 */
function parseTargetId(target) {
	if (typeof target !== 'string' || !/^#[\w-]+$/.test(target)) {
		throw new Error(
			`[puzzle] SSG requires a config.target of the form '#id' (got ${JSON.stringify(target)})`
		);
	}
	return target.slice(1);
}

/** Escape every regex metacharacter so an id matches literally in the shell regex. */
function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
