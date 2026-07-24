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
 * branch) so subsequent navigation stays SPA — and adopts the marker-bearing
 * head tags by identity at its own commits.
 *
 * This module runs under Node only (it reads/writes files via node:fs). The Go
 * build (M3) bundles it beside the user's `app/app.js` default export and calls
 * prerenderToDir(app.config, …); prerender() is the DOM-free, filesystem-free core
 * that returns the rendered pages for tests or a custom writer.
 *
 * v1 scope (DOC plan): static paths only — a route whose full path carries a
 * `:param` (or a `*` that is NOT the top-level catch-all) is skipped with a
 * warning; the bare top-level catch-all (`path: '*'`, D19) renders like any
 * static route and its output lands at `<outDir>/404.html` — the static-host
 * convention (GitHub Pages/Netlify/Render/Cloudflare serve it for unknown
 * URLs); a route flagged `prerender: false` gets the untouched shell written at
 * its path. Dynamic `staticPaths()` is an explicit follow-up.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Store } from '../datastore/store.js';
import { makeFormatterRegistry } from '../formatters.js';
import { Router } from '../router/router.js';
import { walkRouteTree } from '../router/routeTree.js';
import { serialize, escapeText, escapeAttr } from './serialize.js';
import { assembleChain } from './assemble.js';
import { resolveHead, MANAGED_TAGS } from '../head.js';

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

	// Fail fast on an unsupported target selector before doing any work (v1
	// supports '#id' targets only — the shell surgery keys on the id).
	parseTargetId(config.target);

	const entries = enumerateRoutes(config.routes ?? []);

	const pages = [];
	const skipped = [];
	const warnings = [];
	let hasCatchAll = false;
	let builtContext = false;
	if (isStatic && hasGuard(config.routes ?? [])) {
		const warning =
			'[puzzle] static output declares route guards, but guards never run in static output (no router)';
		warnings.push(warning);
		console.warn(warning);
	}
	const createPageContext = async () => {
		builtContext = true;
		return buildContext(config);
	};

	for (const entry of entries) {
		const { fullPath, chain } = entry;

		// The bare top-level catch-all (`path: '*'`, D19) is NOT dynamic in the
		// skip sense — it renders like any static route and lands at 404.html
		// (see pageOutputPath). The router construction-checks `'*'` anywhere else,
		// so `fullPath === '*'` is the only legal `*` shape here.
		const isCatchAll = fullPath === '*';
		if (isCatchAll) hasCatchAll = true;

		// Dynamic route (`:param`, or a `*` that is NOT the catch-all): v1 skips it
		// with a warning (DOC plan).
		if (!isCatchAll && (fullPath.includes(':') || fullPath.includes('*'))) {
			skipped.push({ path: fullPath, reason: 'dynamic' });
			warnings.push(
				`[puzzle] skipped dynamic route "${fullPath}" — SSG v1 renders static paths only ` +
					'(a :param/* route needs a staticPaths() hook, a post-v1 follow-up)'
			);
			continue;
		}

		// Opt-out: a `prerender: false` anywhere in the chain writes the untouched
		// shell at this path (an SPA-only island inside a static site). In static
		// mode the context is still built (beforeMount runs) and its store snapshot
		// captured, so the page's per-page module can rehydrate + mount client-side
		// into the empty target — html stays null (CONTRACT 3).
		if (chain.some((route) => route.prerender === false)) {
			const ctx = await createPageContext();
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

		const ctx = await createPageContext();
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
	if (!builtContext && typeof config.beforeMount === 'function') {
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
 * @returns {Promise<{ outDir: string, written: Array<object>, skipped: Array<{path,reason}>,
 *   warnings: string[], count: number, mode?: string, target?: string,
 *   apiURL?: string|null, hasFormatters?: boolean }>}
 */
export async function prerenderToDir(config, { outDir, shellPath, mode = 'hybrid' } = {}) {
	if (!outDir) throw new Error('[puzzle] prerenderToDir requires an outDir');
	if (!shellPath) throw new Error('[puzzle] prerenderToDir requires a shellPath');

	// Validate the complete route table even when enumeration will skip every
	// page (for example, an all-dynamic app with no beforeMount hook). Per-page
	// contexts also construct memory routers, but skipped routes never reach that
	// path; this construction makes their config errors fail the static build.
	new Router(config.routes ?? [], { mode: 'memory' });

	const targetId = parseTargetId(config.target);
	const shell = fs.readFileSync(shellPath, 'utf8');
	const { pages, skipped, warnings } = await prerender(config, { mode });

	if (mode === 'static') {
		return writeStaticDir({ config, outDir, shell, targetId, pages, skipped, warnings });
	}

	const written = [];
	for (const page of pages) {
		const html =
			page.prerender === false
				? shell // opt-out: the plain SPA shell, untouched (no head injection either)
				: injectShell(shell, {
						targetId,
						content: page.html,
						title: page.title,
						head: page.head,
					});
		const outPath = pageOutputPath(outDir, page.path);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, html);
		written.push({ path: page.path, file: outPath, prerender: page.prerender !== false });
	}

	return { outDir, written, skipped, warnings, count: written.length };
}

/**
 * The static-mode (D81) writer: strip the app-bundle tag once, then per page compute
 * a collision-free slug, inject the static shell (content + `data-puzzle-static`
 * marker, inline JSON data island, per-page module script), and collect the extended
 * summary the Go static build consumes (per page: `entry`, `modules`, `route`; top
 * level: `mode`, `target`, `apiURL`, `hasFormatters`).
 */
function writeStaticDir({ config, outDir, shell, targetId, pages, skipped, warnings }) {
	// The app-bundle tag is stripped once (the shell is identical for every page) so
	// a missing tag warns once, not per page.
	const { shell: baseShell, found } = stripAppBundle(shell);
	if (!found) {
		warnings.push(
			'[puzzle] static output: no <script src="/app.js"> found in the shell to strip — ' +
				'a page referencing a nonstandard bundle name would 404 it at runtime'
		);
	}

	const slugCounts = new Map();
	const written = [];
	for (const page of pages) {
		const slug = uniqueSlug(computeSlug(page.path), slugCounts);
		const html = injectStaticShell(baseShell, {
			targetId,
			content: page.html, // null for a prerender:false page → empty, unmarked target
			title: page.title,
			head: page.head, // null for prerender:false → no head injection (D84)
			slug,
			data: page.data ?? {},
		});
		const outPath = pageOutputPath(outDir, page.path);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, html);
		written.push({
			path: page.path,
			file: outPath,
			prerender: page.prerender !== false,
			entry: `_puzzle/${slug}.js`,
			modules: page.modules,
			route: page.route,
		});
	}

	return {
		outDir,
		written,
		skipped,
		warnings,
		count: written.length,
		mode: 'static',
		target: targetId,
		apiURL: config.apiURL ?? null,
		storage: config.storage,
		routerBase: config.routerBase,
		routerMode: config.routerMode,
		hasModels: Object.keys(config.models ?? {}).length > 0,
		hasFormatters: Object.keys(config.formatters ?? {}).length > 0,
	};
}

// ---- ctx wiring -------------------------------------------------------------

/**
 * Wire the build-time ctx the way PuzzleApp.mount() does (app.js §mount): a Store
 * over the models + apiURL, a FormatterRegistry seeded with the built-ins then the
 * config formatters registered over them, and an UNSTARTED memory-mode Router so
 * `ctx.router` has full fidelity (no URL/DOM side effects — it is never started).
 * `config.beforeMount` is awaited with a `{ store, config }` facade (not a real
 * PuzzleApp — documented) so a build-time store seed lands before the first data().
 */
async function buildContext(config) {
	const { models = {}, formatters = {}, apiURL, storage } = config;

	const storeOptions = { apiURL };
	if (storage !== undefined) storeOptions.storage = storage;
	const store = new Store(models, storeOptions);
	const router = new Router(config.routes ?? [], { mode: 'memory' });
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
 * the content inside, then applies the head: with a resolved `head` (D84) the
 * title replacement AND the managed `data-puzzle-head` tags are applied
 * (applyHead); with only a bare `title` (a direct API caller predating D84) the
 * pre-D84 title-only path runs — no managed tags, byte-compatible. A missing or
 * non-empty target element is a descriptive throw.
 */
export function injectShell(shell, { targetId, content, title, head }) {
	// Match `<tag …id="targetId"…></tag>` with NOTHING (but whitespace) inside —
	// the backreference \1 requires the same tag name to close (targetElementRe).
	const match = shell.match(targetElementRe(targetId));
	if (!match) {
		throw new Error(
			`[puzzle] SSG target element not found or not empty — expected an EMPTY ` +
				`<… id="${targetId}"></…> in the shell (config.target "#${targetId}")`
		);
	}

	const [full, tag, attrs] = match;
	const rebuilt = `<${tag}${attrs} data-puzzle-ssg>${content}</${tag}>`;
	// Function replacement so a `$` in content/attrs is never read as a $-pattern.
	let out = shell.replace(full, () => rebuilt);

	if (head) {
		out = applyHead(out, head);
	} else if (title != null) {
		out = replaceTitle(out, title);
	}
	return out;
}

// ---- static-mode shell surgery (D81) ----------------------------------------

// Any `<script … src="/app.js" …></script>` — the SPA bundle tag. Static pages
// have no router/app.js, so it is struck once (a missing tag warns; see
// writeStaticDir). `\/?` tolerates a bare `app.js` too; the trailing group allows
// attrs after src (type/defer/etc.) up to the tag close.
const APP_BUNDLE_RE = /<script\b[^>]*\bsrc=["']\/?app\.js["'][^>]*><\/script>\s*/i;

/** Strip the app-bundle `<script>` from the shell. `found` is false if none matched. */
function stripAppBundle(shell) {
	const found = APP_BUNDLE_RE.test(shell);
	return { shell: found ? shell.replace(APP_BUNDLE_RE, '') : shell, found };
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
 *    applyHead with managed D84 tags; bare `title` → pre-D84 title-only path).
 * The caller has already stripped the app-bundle tag from `shell`.
 */
export function injectStaticShell(shell, { targetId, content, title, head, slug, data }) {
	let out = shell;

	// A prerender:false page keeps its empty, UNMARKED target (the kernel mounts into
	// it client-side); only a rendered page rebuilds the target with content + marker.
	if (content != null) {
		const match = shell.match(targetElementRe(targetId));
		if (!match) {
			throw new Error(
				`[puzzle] static target element not found or not empty — expected an EMPTY ` +
					`<… id="${targetId}"></…> in the shell (config.target "#${targetId}")`
			);
		}
		const [full, tag, attrs] = match;
		const rebuilt = `<${tag}${attrs} data-puzzle-static>${content}</${tag}>`;
		out = out.replace(full, () => rebuilt);
	}

	// `<` → `<` keeps the JSON valid (it only appears inside string values) while
	// making a literal `</script>` in a record impossible to emit — so content cannot
	// terminate the data island early.
	const json = JSON.stringify(data ?? {}).replace(/</g, '\\u003c');
	const scripts =
		`<script type="application/json" data-puzzle-static-data>${json}</script>` +
		`<script type="module" src="/_puzzle/${slug}.js"></script>`;
	out = /<\/body>/i.test(out)
		? out.replace(/<\/body>/i, () => `${scripts}</body>`)
		: out + scripts;

	if (head) {
		out = applyHead(out, head);
	} else if (title != null) {
		out = replaceTitle(out, title);
	}
	return out;
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
 */
function targetElementRe(targetId) {
	const idPattern = escapeRegExp(targetId);
	return new RegExp('<(\\w+)([^>]*(?<![-\\w])id=["\']' + idPattern + '["\'][^>]*)>\\s*</\\1>');
}

/** Replace the first `<title>…</title>` with an HTML-escaped title. */
function replaceTitle(html, title) {
	return html.replace(
		/<title>[\s\S]*?<\/title>/,
		() => `<title>${escapeText(String(title))}</title>`
	);
}

// ---- managed head surgery (D84) ---------------------------------------------

/**
 * Apply a resolved head (head.js resolveHead) to shell HTML — the SSG half of
 * the D84 contract, shared by injectShell and injectStaticShell. The `<title>`
 * goes through the pre-existing replaceTitle for a NON-NULL head.title (null or
 * never-resolved keeps the shell's title — the same leave-alone posture the SPA
 * applies to document.title). Then per managed tag identity (head.js
 * MANAGED_TAGS — the same table syncHead consumes, so the two delivery paths
 * can never emit different shapes or identities):
 *  - same-identity `data-puzzle-head` tags already in the shell are collapsed:
 *    the first is REPLACED in place and every stale duplicate is removed;
 *  - tags whose field no longer resolves are ALL REMOVED (the framework owns
 *    every marker-bearing tag — mirrors syncHead's removal);
 *  - the rest are collected and inserted ONCE immediately before `</head>`
 *    (case-insensitive). No `</head>` (fragment/malformed shell) DEGRADES:
 *    ride after the first `</title>` instead, or warn + skip — never throw,
 *    the page content is still worth writing.
 * All values are attribute-escaped (escapeAttr) so hostile metadata — quotes,
 * `</head>`, `<script>` — cannot break out of the generated tag.
 */
function applyHead(html, head) {
	let out = head.title != null ? replaceTitle(html, head.title) : html;

	const inserts = [];
	for (const spec of MANAGED_TAGS) {
		const value = head[spec.field];
		const markerRe = managedTagRe(spec.id);
		if (value == null) {
			out = out.replace(markerRe, '');
			continue;
		}
		const tagHtml = buildHeadTag(spec, value);
		let replaced = false;
		out = out.replace(markerRe, () => {
			if (replaced) return '';
			replaced = true;
			return tagHtml;
		});
		if (!replaced) {
			inserts.push(tagHtml);
		}
	}

	if (inserts.length) {
		const block = inserts.join('');
		if (/<\/head>/i.test(out)) {
			out = out.replace(/<\/head>/i, () => `${block}</head>`);
		} else if (/<\/title>/i.test(out)) {
			out = out.replace(/<\/title>/i, (m) => m + block);
		} else {
			console.warn(
				'[puzzle] head injection skipped — the shell has no </head> (or </title>) to anchor the managed tags'
			);
		}
	}
	return out;
}

/**
 * One managed tag as an HTML string (the string twin of syncHead's DOM build).
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
 * outDir/a/b/index.html. The bare catch-all (`path: '*'`) is the exception — it
 * writes `outDir/404.html`, the filename static hosts serve for unknown URLs.
 */
function pageOutputPath(outDir, routePath) {
	let outPath;
	if (routePath === '*') {
		outPath = path.join(outDir, '404.html');
	} else {
		const clean = routePath.replace(/^\//, '').replace(/\/$/, '');
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
