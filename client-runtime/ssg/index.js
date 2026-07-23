/**
 * SSG prerender orchestrator (M1) — `@magic-spells/puzzle/ssg`.
 *
 * Turns a PuzzleApp config into per-route static HTML. It wires the same
 * build-time ctx PuzzleApp.mount() wires (Store + FormatterRegistry + an
 * unstarted memory-mode Router), enumerates the config's routes (nested children
 * included), instantiates each route's layout+view chain exactly as the Router's
 * #navigate assembles it (each instance preloaded — created() + awaited data(),
 * no DOM, no mounted()/animations), serializes the tree (serialize.js), and
 * injects the markup + resolved <title> into the app shell. The router takes over
 * on load (see router.js #swap SSG branch) so subsequent navigation stays SPA.
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
import { FormatterRegistry } from '../formatters.js';
import { Router } from '../router/router.js';
import builtinFormatters from '@magic-spells/puzzle/formatters/manifest';
import { serialize } from './serialize.js';
import { assembleChain } from './assemble.js';

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
 *   pages: Array<{ path: string, html: string|null, title: string|null, prerender?: boolean,
 *     data?: object, modules?: { views: string[], layout: string|null }, route?: object }>,
 *   skipped: Array<{ path: string, reason: string }>,
 *   warnings: string[]
 * }>} `html`/`title` are null for a `prerender: false` page (the shell is written
 *   verbatim at its path by prerenderToDir). `data`/`modules`/`route` are present
 *   only in static mode.
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
			const page = { path: fullPath, html: null, title: null, prerender: false };
			if (isStatic) attachStaticFields(page, entry, ctx);
			pages.push(page);
			continue;
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
		const page = { path: fullPath, html: rendered.html, title: rendered.title };
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
				? shell // opt-out: the plain SPA shell, untouched
				: injectShell(shell, { targetId, content: page.html, title: page.title });
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
	const { models = {}, formatters = {}, apiURL } = config;

	const store = new Store(models, { apiURL });

	const registry = new FormatterRegistry(builtinFormatters);
	for (const [name, fn] of Object.entries(formatters)) {
		registry.register(name, fn);
	}

	const router = new Router(config.routes ?? [], { mode: 'memory' });

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
 * Flatten the routes array into one entry PER LEAF (mirrors the Router's flatten):
 * a node WITH children is not a leaf — each child recurses with the joined path;
 * a node WITHOUT children emits `{ fullPath, chain (root→leaf defs), layout }`.
 * The layout is the top-level route's `layout` (children inherit it).
 */
function enumerateRoutes(routes) {
	const entries = [];
	for (const route of routes) {
		walkRoute(route, [], null, entries);
	}
	return entries;
}

function walkRoute(node, ancestors, parentPath, entries) {
	const isRoot = ancestors.length === 0;
	const fullPath = isRoot ? node.path : joinPath(parentPath, node.path);
	const chain = [...ancestors, node];

	if (node.children && node.children.length) {
		for (const child of node.children) {
			walkRoute(child, chain, fullPath, entries);
		}
	} else {
		entries.push({ fullPath, chain, layout: chain[0].layout ?? null });
	}
}

/**
 * Join a parent path pattern with a relative child path (mirrors the Router's
 * joinPath): an index child (`''`) composes to exactly the parent path; otherwise
 * a single '/' joins them with the parent's trailing slash trimmed.
 */
function joinPath(parentPath, childPath) {
	if (childPath === '') return parentPath;
	return parentPath.replace(/\/$/, '') + '/' + childPath;
}

// ---- per-route render -------------------------------------------------------

/**
 * Assemble the layout+view chain for a static route (shared assembleChain: preload
 * every instance created() + awaited data() with no DOM, build the nested keyed
 * component vnodes the way the Router's #navigate does) and serialize to an HTML
 * string. Returns the rendered content plus the resolved <title>.
 */
async function renderRoute(entry, ctx) {
	const { chain } = entry;
	const { topVnode } = await assembleChain(entry, ctx);
	const html = await serialize(topVnode, { ctx });
	const title = resolveTitle(chain);
	return { html, title };
}

/** Nearest-defined `meta.title` walking the chain leaf → root (mirrors #setTitle). */
function resolveTitle(chain) {
	for (let i = chain.length - 1; i >= 0; i--) {
		const meta = chain[i].meta;
		if (meta && meta.title != null) return meta.title;
	}
	return null;
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
 * the browser kernel, which rebuilds the full `{ path, route, params, chain }` shape
 * by zipping the page's view classes back on.
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
 * Inject rendered markup and the resolved title into the app shell by STRING
 * SURGERY (no HTML-parser dependency). Finds the EMPTY target element by its id,
 * rebuilds it with a `data-puzzle-ssg` marker (the router's takeover signal) and
 * the content inside, and replaces the first `<title>…</title>` with the resolved
 * title when one exists (else the shell title is kept). A missing or non-empty
 * target element is a descriptive throw.
 */
export function injectShell(shell, { targetId, content, title }) {
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

	if (title != null) {
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
 *  - replaces the title as injectShell does.
 * The caller has already stripped the app-bundle tag from `shell`.
 */
export function injectStaticShell(shell, { targetId, content, title, slug, data }) {
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

	if (title != null) out = replaceTitle(out, title);
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
	return html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
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

/** Escape the three characters that would break HTML text content (for <title>). */
function escapeHtml(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape every regex metacharacter so an id matches literally in the shell regex. */
function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
