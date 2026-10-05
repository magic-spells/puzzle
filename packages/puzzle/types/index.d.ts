/**
 * Hand-authored TypeScript declarations for @magic-spells/puzzle.
 *
 * Pragmatic, not exhaustive: generics where they're cheap and useful
 * (`getData<T>()`), `any` where the framework's dynamic surface resists static
 * typing (the component model returned by `data()`, record fields, formatter
 * args). Targets `<script lang="ts">` authoring — useful autocomplete under
 * `tsc --strict`, not full soundness.
 *
 * Source of truth: constellation/doc/DOC-SPEC.md and the client-runtime sources.
 * Covers the package exports { PuzzleApp, PuzzleView, PuzzleModel, Puzzle, lazy }
 * plus the internal/compiler-support exports re-exported from the package root.
 */

// The opt-in router modes (D159) live in their own subpath so path-mode apps
// never bundle them; the config type re-exports the opaque handle they produce.
import type { RouterMode } from './router-modes.js';
export type { RouterMode };

// ----------------------------------------------------------------------------
// Shared shapes
// ----------------------------------------------------------------------------

/** A field/record value — the framework never constrains model field types. */
export type PuzzleValue = any;

declare const puzzleAdapterCapabilityBrand: unique symbol;

/** Opaque shape accepted only from the `@magic-spells/puzzle/adapter` export. */
export interface PuzzleAdapterCapability {
	readonly [puzzleAdapterCapabilityBrand]: true;
}

declare const puzzleLazyViewBrand: unique symbol;

/** Opaque route-view marker produced by `lazy()`. */
export interface LazyView {
	readonly [puzzleLazyViewBrand]: true;
}

/** A module namespace returned by a lazy route import. */
export interface LazyViewModule {
	default: PuzzleViewConstructor;
}

/**
 * Explicitly mark an async route view/layout loader (D163):
 * `view: lazy(() => import('./views/Admin.pzl'))`. A BARE loader function in a
 * `view`/`layout` position is deliberately a type error — the runtime never
 * guesses which kind of function it was handed.
 */
export declare function lazy(
	loader: () => Promise<LazyViewModule | PuzzleViewConstructor>
): LazyView;

/**
 * A translated route head text (D177): `meta: { title: { t: 'products.title' } }`
 * resolves the key through the app's i18n service (D175), like `t('products.title')`.
 */
export interface HeadTranslation {
	t: string;
}

/**
 * A route definition (constellation/doc/DOC-SPEC.md §9). `view`/`layout` are
 * PuzzleView subclasses (constructors) or `lazy()` markers (D163). `.pzl`
 * default exports and compiled classes are typed `any` by the compiler shim, so
 * they still assign cleanly. Nested via `children` (D30).
 */
export interface Route {
	path: string;
	name?: string;
	view: PuzzleViewConstructor | LazyView;
	layout?: PuzzleViewConstructor | LazyView;
	/** Route-entry guard (D87), inherited root → leaf and run before views load. */
	guard?: GuardFn;
	/**
	 * Route metadata. Four RESERVED head fields (D84 —
	 * constellation/doc/DOC-SPEC.md §45): each resolves independently,
	 * nearest-defined walking the destination chain leaf→root; `undefined`
	 * inherits from a parent, `null` explicitly suppresses an inherited value.
	 * Static strings only (no functions/HTML). `title` and `description` may
	 * instead be a translation reference, `{ t: 'products.title' }` (D177),
	 * resolved through the app's i18n service at build time and in the
	 * browser's title sync; a missing key prints the key itself. Without `i18n`
	 * configured the build emits no text for it and the browser leaves the tab
	 * title as it is.
	 *
	 * Delivery is split (D84): the managed `data-puzzle-head` tags derived from
	 * `description`/`canonical`/`socialImage` (og:/twitter:/description/canonical)
	 * are emitted at BUILD time only, by the SSG shell injector — so `hybrid` and
	 * `static` output bake them into the served HTML crawlers read. The browser
	 * runtime never emits or updates those tags in any output mode; on SPA
	 * navigation only `document.title` is synced. Custom keys are untouched by
	 * the framework.
	 */
	meta?: {
		title?: string | HeadTranslation | null;
		description?: string | HeadTranslation | null;
		canonical?: string | null;
		socialImage?: string | null;
		[key: string]: any;
	};
	children?: Route[];
	/**
	 * Build-time list of the param values to prerender for a `:param` route
	 * (D179), in `output: 'static'` and `'hybrid'` — one page per entry. An array
	 * of params objects, a function (sync or async) returning one, or the name
	 * of a registered model: `'post'` loads every `post` record and takes each
	 * param from the record's same-named field. Declared on the leaf route; each
	 * entry holds every param of the route's full path, inherited ones included.
	 * The browser never calls it, but the route table ships in SPA and hybrid
	 * bundles — keep a heavy list source behind `await import()` in the function.
	 */
	staticPaths?: ReadonlyArray<StaticPathsEntry> | StaticPathsFn | string;
	[key: string]: any;
}

/** One `staticPaths` entry (D179): a value for every param of the route's full path. */
export type StaticPathsEntry = Record<string, string | number>;

/**
 * The build facade a `staticPaths` function receives (D179) — the one
 * `beforeMount` gets at build time, after `beforeMount` has run on its store.
 */
export interface StaticPathsContext {
	store: Store;
	config: PuzzleAppConfig;
	/** The locale being prerendered, when translations are configured (D177). */
	locale?: string;
}

/** A `staticPaths` function (D179): runs once per prerender pass (once per locale under prefix routing). */
export type StaticPathsFn = (
	context: StaticPathsContext
) => ReadonlyArray<StaticPathsEntry> | Promise<ReadonlyArray<StaticPathsEntry>>;

/** A route guard (D87): allow, block, or redirect before navigation loads. */
export type GuardFn = (nav: {
	to: RouteSnapshot;
	from: RouteSnapshot | null;
	ctx: PuzzleContext;
}) => void | boolean | string | Promise<void | boolean | string>;

/** A window scroll position. */
export interface ScrollPosition {
	x: number;
	y: number;
}

/** The current-route snapshot exposed by `router.current` and `view.route`. */
export interface RouteSnapshot {
	/** The raw path-shaped navigation target (base-free), query + hash included. */
	path: string;
	/** `path` minus query + hash (D83) — base-free, trailing slash kept verbatim. */
	pathname: string;
	/**
	 * The parsed query (D83): a frozen, null-prototype object with
	 * URLSearchParams decoding — a single value is a string, a repeated key a
	 * frozen array in source order, a valueless key (`?debug`) `''`.
	 */
	query: Readonly<Record<string, string | readonly string[]>>;
	/** `''`, or the raw fragment including the leading `#` (D83). */
	hash: string;
	route: Route;
	params: Record<string, string>;
	chain: Route[];
}

/**
 * Custom scroll behavior (D33): return a position to scroll to, or a
 * falsy value to leave scroll alone.
 */
export type ScrollBehavior = (
	to: RouteSnapshot,
	from: RouteSnapshot | null,
	savedPosition: ScrollPosition | null
) => ScrollPosition | null | undefined | false;

/**
 * Custom router focus behavior (D93): return the element focus should land
 * on after a committed navigation, or a falsy value to leave focus alone for that
 * navigation. Called AFTER the incoming chain is mounted, so it may query the
 * freshly committed DOM; a throw is logged and treated as falsy. The route
 * announcement still fires either way.
 */
export type FocusBehavior = (
	to: RouteSnapshot,
	from: RouteSnapshot | null
) => Element | null | undefined | false;

/** Stable metadata shared by PuzzleAppConfig.onError and the app error view. */
export interface PuzzleErrorInfo {
	readonly phase:
		| 'mount'
		| 'refresh'
		| 'navigation'
		| 'render'
		| 'bind'
		| 'error-view'
		| 'enter'
		| 'leave'
		| 'unmount'
		| 'transition'
		| 'app-mount'
		| 'app-unmount';
	readonly view: PuzzleView | null;
	readonly route: RouteSnapshot | null;
}

/** App-level reporter for errors the framework contains instead of rethrowing. */
export type PuzzleErrorHandler = (
	error: unknown,
	info: PuzzleErrorInfo
) => void | Promise<void>;

/** Props passed to a fresh app-level error view at a failed view's position. */
export interface PuzzleErrorViewProps {
	readonly error: unknown;
	readonly info: PuzzleErrorInfo;
	readonly retry: () => void | Promise<void>;
}

/** Constructor accepted by PuzzleAppConfig.errorView. */
export type PuzzleViewConstructor = new (ctx?: PuzzleContext) => PuzzleView;

/**
 * What `afterUpdate(prev)` receives (D178): the state the previous render
 * drew, frozen shallowly. `data` is a copy of the merged `getData()` result;
 * `props`, `params` and `route` are the objects that render saw. The snapshot
 * is shallow and a record keeps its identity across its own mutations (D170),
 * so `prev.data.post` is the same live record: to catch an edit, return the
 * field from `data()` (`title: post.title`) and compare that.
 */
export interface PrevViewState {
	readonly props: any;
	readonly params: Record<string, string>;
	readonly route: RouteSnapshot | null;
	readonly data: Readonly<Record<string, any>>;
}

/** A single enter/leave animation spec (constellation/doc/DOC-SPEC.md §12). */
export interface AnimationSpec {
	from: object;
	to: object;
	/**
	 * Duration in ms. Required: the runtime treats a spec without a finite
	 * numeric `duration` as malformed (warn-once, skip — animate.js isValidSpec).
	 */
	duration: number;
	easing?: string;
	delay?: number;
	/**
	 * When the enter animation plays (D73; constellation/doc/DOC-SPEC.md §39).
	 * `'mount'` (default) plays immediately on mount; `'visible'` holds the element
	 * at its `from` keyframe and reveals it the first time it scrolls into view.
	 * Only meaningful on the `in` spec — a `trigger` on `out` warns once and is
	 * ignored. An unknown value warns once and falls back to `'mount'`.
	 */
	trigger?: 'mount' | 'visible';
	/**
	 * With `trigger: 'visible'` (D73), the reveal line's distance ABOVE the
	 * viewport's bottom edge: a number is px, a string must match
	 * `/^\d+(\.\d+)?(px|%)$/` (e.g. `'15%'`). Maps to an IntersectionObserver
	 * `rootMargin` of `'0px 0px -<offset> 0px'` at threshold 0. Invalid values warn
	 * once and are ignored; ignored entirely without `trigger: 'visible'`.
	 */
	triggerOffset?: number | string;
	/**
	 * With `trigger: 'visible'` (D73), a CSS selector for an ANCESTOR to
	 * observe INSTEAD of the element itself, so a group of instances sharing one
	 * section reveal together. Resolved once via `element.closest(selector)`
	 * (ancestors only; a self-match is harmless). `triggerOffset` still composes.
	 * A non-string/empty value, an invalid selector, or no ancestor match warns
	 * once and falls back to the element itself; ignored entirely without
	 * `trigger: 'visible'`.
	 */
	triggerAnchor?: string;
}

/** Declarative enter/leave animations on a view/component (D28). */
export interface Animations {
	in?: AnimationSpec;
	out?: AnimationSpec;
}

/** A validation-result bag (constellation/doc/DOC-SPEC.md §20, D48). */
export interface ValidationResult {
	valid: boolean;
	errors: Array<{ field: string; rule: string; message: string }>;
}

// ----------------------------------------------------------------------------
// Store (constellation/doc/DOC-SPEC.md §8, §21, §22)
// ----------------------------------------------------------------------------

/** Options for `store.findMany(type, options)`. */
export interface FindManyOptions {
	filter?: (record: any) => boolean;
}

/** Options for `store.request(type, path, options)` (D50). */
export interface RequestOptions {
	method?: string;
	body?: any;
	headers?: Record<string, string>;
}

/**
 * The frozen, read-only context handed to `beforeRequest` (D91): the model
 * type the request belongs to, the HTTP verb, and the fully built URL.
 */
export interface AdapterRequestContext {
	readonly type: string;
	readonly method: string;
	readonly url: string;
}

/**
 * Adapter request hook (D91). Called synchronously before every adapter
 * fetch — `loadMany`/`loadOne` (D21), `save()`/`delete()` and `request()` (D50).
 * Mutate `init` in place or return a replacement object (a truthy object return
 * wins) to attach auth headers, `credentials`, or an `AbortSignal`. `method` and
 * `body` are re-stamped by the Store afterwards, and the URL is not reachable —
 * a hook cannot change what the request IS, only how it is sent. A throw rejects
 * the calling verb without sending anything.
 */
export type BeforeRequestHook = (
	init: RequestInit,
	context: AdapterRequestContext
) => RequestInit | void;

/** Store construction options (wired by `PuzzleApp` from its config). */
export interface StoreOptions {
	/** Storage-like object for opt-in persistence. */
	storage?: any;
	/** Persistence key (default `'puzzle-store'`). */
	storageKey?: string;
	/** Base URL for the server read/write path. */
	apiURL?: string;
	/** Adapter request hook (D91). */
	beforeRequest?: BeforeRequestHook;
}

/**
 * The reactive datastore (constellation/doc/DOC-SPEC.md §8). Reachable in views
 * as `this.ctx.store`. Records are instances of the registered model classes;
 * queries made inside `data()` auto-subscribe the component.
 */
export interface Store {
	/** Create a record; applies schema defaults, validates, inserts. */
	createRecord(type: string, data?: Record<string, any>): any;
	/**
	 * Look up one record by primary key (auto-subscribes). Null when absent.
	 * A miss also FETCHES the record — and the view settles before it commits, so
	 * a committed null means the record does not exist — when, and only when, the
	 * read is made through the view's own `this.ctx.store` handle inside that
	 * view's `data()` run, on an app with the adapter capability (D161). Any
	 * other read — an event handler, a captured `app.store`, a model method — is
	 * a local snapshot.
	 */
	findOne(type: string, id: any): any;
	/**
	 * List records of a type, optionally filtered (auto-subscribes). Read through
	 * `this.ctx.store` inside `data()`, the collection loads once if it has not
	 * already; the filter always runs locally (D161).
	 */
	findMany(type: string, options?: FindManyOptions): any[];
	// Adapter methods are attached by the app's adapter capability and declared through
	// module augmentation in types/adapter.d.ts.
	// `seed()` and `resetFixtureSeed()` are NOT declared here: the core Store does
	// not have them (D98). They are attached by `installFixtures()` and declared
	// through module augmentation in types/fixtures.d.ts, so they type-check only
	// where `@magic-spells/puzzle/fixtures` is actually imported.
	[key: string]: any;
}

// ----------------------------------------------------------------------------
// Router (constellation/doc/DOC-SPEC.md §9, §15, §23)
// ----------------------------------------------------------------------------

/**
 * The shared-element morph slot (D55) — normally filled by
 * `enableMorph(app)` from `@magic-spells/puzzle/morph`. The router only knows
 * WHEN: `enter` fires after a committed swap mounts (pre-paint); `leave` fires
 * as an outgoing unit's out phase starts, and a returned promise is awaited
 * before destroy. Handler errors are logged and never wedge navigation.
 */
export interface MorphHandler {
	enter(el: Element | null, meta: { initial: boolean }): void;
	leave(el: Element | null): Promise<unknown> | null | void;
}

/**
 * Client-side router (constellation/doc/DOC-SPEC.md §9). Reachable in views as
 * `this.ctx.router`. The public API is path-shaped in all router modes.
 */
export interface Router {
	/** Navigate to a path (push a history entry). */
	push(path: string): void | Promise<void>;
	/** Navigate to a path REPLACING the current history entry — no new entry, scroll left alone by default (D83). */
	replace(path: string): void | Promise<void>;
	/** Move `n` entries in history (negative = back). All modes (D42). */
	go(n: number): void | Promise<void>;
	/** Go back one entry. */
	back(): void | Promise<void>;
	/** Go forward one entry. */
	forward(): void | Promise<void>;
	/**
	 * Path-shaped route in, mode-encoded href out (`'/x'` path mode, `'#/x'` hash, unchanged memory); strings not starting with `/` pass through (D79).
	 * Under `i18n.routing: 'prefix'` the href carries the page's locale prefix; `{ locale: 'es' }` forces one locale, `{ locale: false }` skips the prefix for a file that exists once (D177).
	 */
	url(path: string, options?: LinkOptions | null): string;
	/** The current route snapshot, or null before the first navigation. */
	readonly current: RouteSnapshot | null;
	/** Register the shared-element morph handler (D55); null unregisters. */
	setMorphHandler(handler: MorphHandler | null): void;
	[key: string]: any;
}

// ----------------------------------------------------------------------------
// FormatterRegistry (constellation/doc/DOC-SPEC.md §6)
// ----------------------------------------------------------------------------

/**
 * A library function — a display-only value transform a template calls as
 * `name(value, …args)` (D176 §4). An app registers its own through the
 * `formatters` config map.
 */
export type Formatter = (...args: any[]) => any;

/**
 * The function library's registry (constellation/doc/DOC-SPEC.md §6). Reachable
 * in views as `this.ctx.formatters`; rarely touched directly by app code.
 */
export declare class FormatterRegistry {
	constructor(seedMap?: Record<string, Formatter>);
	/** Register (or overwrite) a function by name. */
	register(name: string, fn: Formatter): void;
	/** Look up a function by name (returns a pass-through for unknown names). */
	get(name: string): Formatter;
	/** The raw name → function map handed to compiled render code. */
	getAll(): Record<string, Formatter>;
}

// ----------------------------------------------------------------------------
// Library signatures (D176 §4)
// ----------------------------------------------------------------------------

/**
 * A `date`/`time`/`datetime` preset: the three Intl styles, in the viewer's (or
 * the active) locale and time zone, and the locale-free RFC 3339 `iso` form.
 * Leaving the preset out renders the function's default.
 */
export type DatePreset = 'short' | 'medium' | 'long' | 'iso';

/** A locale argument Intl accepts: a BCP 47 tag or a list of them. */
export type LocaleArgument = string | readonly string[];

/**
 * Options for `link(path, options)` under locale prefix routing (D177):
 * `{ locale: 'es' }` links to that configured locale's page, `{ locale: false }`
 * skips the locale prefix (a file that exists once) but keeps `routerBase`.
 * Without `i18n.routing: 'prefix'` there is no prefix, and they are ignored.
 */
export type LinkOptions = { locale?: string | false };

/**
 * library signatures — every built-in function a template calls as
 * `name(args)` (D176 §4), with the arguments the runtime takes. `puzzle check`
 * types a template's library calls against this interface, so it moves with
 * the runtime (client-runtime/formatters/builtins.js, plus the registry-built
 * `link` and the i18n service's `t`). A value parameter is `unknown` because
 * every function coerces what it is given and prints a missing value as
 * nothing. Functions an app registers through the `formatters` config map are
 * not listed here.
 */
export interface LibraryFunctions {
	/**
	 * The URL for an app path in the active routing mode (D79). Under
	 * `i18n.routing: 'prefix'` it adds the active locale's prefix; `locale`
	 * forces one locale, and `locale: false` skips the prefix for a file that
	 * exists once (D177).
	 */
	link(path: unknown, options?: LinkOptions | null): string;
	/**
	 * The translation for `key` in the active locale (D175), `{name}`
	 * placeholders filled from `vars`, a `count` choosing the plural form; a
	 * missing key prints itself, and a number or boolean key is converted to
	 * text and looked up. Present when the app configures `i18n`.
	 */
	t(key: string | number | boolean | null | undefined, vars?: TranslationVars | null): string;
	/** `$1,234.50`: thousands grouped, the sign before the symbol, half away from zero. */
	currency(value: unknown, symbol?: string, places?: number): string;
	/** `12.5%`: the number as written, not a ratio. */
	percentage(value: unknown, places?: number): string;
	/** The whole part grouped: the locale's way, or by an explicit delimiter. */
	number_with_delimiter(value: unknown, delimiter?: string): string;
	/** `1.2K`, `3.4M` in the locale. */
	compact_number(value: unknown): string;
	/** The count and the word: `1 comment`, `3 comments`, `2 people`. */
	pluralize(count: unknown, singular: string, plural?: string): string;
	/** Half away from zero on the decimal value; negative places round to tens. */
	round(value: unknown, places?: number): number;
	/** Default `medium`: `Sep 24, 2026`. */
	date(value: unknown, preset?: DatePreset, locale?: LocaleArgument): string;
	/** Default `short`: `3:04 PM`. */
	time(value: unknown, preset?: DatePreset, locale?: LocaleArgument): string;
	/** Default: the medium date with the short time, `Sep 24, 2026, 3:04 PM`. */
	datetime(value: unknown, preset?: DatePreset, locale?: LocaleArgument): string;
	/** `2 hours ago`, `in 3 days`, in the locale. */
	timeago(value: unknown): string;
	/** The instant re-expressed as the wall clock in an IANA zone; a calendar date unchanged. */
	in_timezone(value: unknown, timeZone?: string): Date | '';
	/** At most `length` code points, the ellipsis included (default 100, `…`). */
	truncate(value: unknown, length?: number, ellipsis?: string): string;
	/** The first character upper-cased, the rest left alone. */
	capitalize(value: unknown): string;
	strip_html(value: unknown): string;
	strip_newlines(value: unknown): string;
	/** The value as text (a text interpolation is already escaped). */
	escape(value: unknown): string;
	/** Sanitized markup; in a template, only as a whole text interpolation. */
	raw(html: unknown): string;
	/** The escaped text with a `<br>` per line break; placed like `raw`. */
	newline_to_br(value: unknown): string;
	/** JSON with object keys sorted by code point. */
	json(value: unknown): string;
}

// ----------------------------------------------------------------------------
// Component context (constellation/doc/DOC-SPEC.md §10)
// ----------------------------------------------------------------------------

/** The minimal per-view service object — `this.ctx` in every view. */
export interface PuzzleContext {
	/**
	 * The datastore. On an app with the adapter capability this is a PER-VIEW
	 * handle on the app's store, and it is the only channel through which a
	 * tracked read may fetch what it missed (D161) — read the store as
	 * `this.ctx.store`, not through a captured `app.store`.
	 */
	store: Store;
	router: Router;
	formatters: FormatterRegistry;
	/**
	 * The translation service (D175) — present only when `puzzle.config.js`
	 * configures `i18n`, so it is optional here.
	 */
	i18n?: PuzzleI18n;
}

/**
 * Variables for a translation: `{name}` placeholders, and `count` for plurals.
 * Any object value — a data field, a store record, an interface-typed value (a
 * `Record` type would reject an interface, which carries no index signature).
 */
export type TranslationVars = object;

/**
 * The translation service (D175) — `this.ctx.i18n` and `app.i18n` when
 * `i18n: { locales, defaultLocale }` is configured in `puzzle.config.js`.
 * The template's `t(key, vars)` library function calls the same `t`.
 */
export interface PuzzleI18n {
	/** The active locale tag. */
	readonly locale: string;
	/**
	 * Every configured locale, in config order, as a language switcher renders
	 * it (D177). Rebuilt on each read, so `href` is the page shown now.
	 */
	readonly locales: readonly PuzzleLocale[];
	readonly defaultLocale: string;
	/**
	 * The active locale's text direction (D177), from its tag's script or
	 * language: `'rtl'` for Arabic, Hebrew, Persian, Urdu and the like, `'ltr'`
	 * otherwise. `<html dir>` follows it.
	 */
	readonly dir: 'rtl' | 'ltr';
	/**
	 * Look `key` up in the active locale. A missing key prints the key itself;
	 * `vars` fill `{name}` placeholders in one pass, and a numeric `count` picks
	 * the plural form through `Intl.PluralRules`.
	 */
	t(key: unknown, vars?: TranslationVars): string;
	/**
	 * Fetch `tag`'s strings, then switch the locale, store the choice and
	 * rebuild the page at the same location. Rejects (changing nothing) when the
	 * fetch fails; overlapping calls resolve last-wins, and a call a later one
	 * overtook settles with the later call's outcome. Throws a RangeError for a
	 * tag that is not configured. Under `i18n.routing: 'prefix'` (D177) on a
	 * static page it instead stores the choice and loads the same page under
	 * the new locale's prefix, resolving once that navigation is issued.
	 */
	setLocale(tag: string): Promise<void>;
}

/** One entry of `i18n.locales` (D177). */
export interface PuzzleLocale {
	/** The configured tag (`'pt-BR'`). */
	readonly locale: string;
	/**
	 * The language's own name (`'Español'`), from `Intl.DisplayNames`; the tag
	 * itself where the browser cannot name it.
	 */
	readonly label: string;
	/**
	 * The current page in this locale: under `i18n.routing: 'prefix'` the same
	 * page under this locale's prefix; otherwise the current page for every
	 * entry (switch with `setLocale(entry.locale)`).
	 */
	readonly href: string;
	/** Whether this is the active locale. */
	readonly active: boolean;
}

// ----------------------------------------------------------------------------
// PuzzleView (constellation/doc/DOC-SPEC.md §4, §12)
// ----------------------------------------------------------------------------

/**
 * Base class for every `.pzl` component, view, and layout
 * (constellation/doc/DOC-SPEC.md §4). Subclass it and implement `data()`;
 * the compiler attaches `render()` from the template. State lives in
 * `getData()`/`setData()`; reactive sources (store, props, route params) flow
 * through `data()`.
 */
export declare class PuzzleView {
	constructor(ctx?: PuzzleContext);

	/** Framework services (store/router/formatters). */
	ctx: PuzzleContext;

	/** Props passed from the parent component (reactive). */
	readonly props: any;

	/** Route params for the navigation that mounted this view. */
	readonly params: Record<string, string>;

	/**
	 * The route snapshot of the navigation delivering this view's params
	 * (D47). Correct inside the pre-commit `data()` gate; null off-router.
	 */
	readonly route: RouteSnapshot | null;

	/**
	 * The DOM node occupying this view's position (null before mount). While an
	 * async `data()` is in flight this is the placeholder Comment anchor, so the
	 * type is `Element | Comment`, not `Element` alone.
	 */
	readonly element: Element | Comment | null;

	/**
	 * Live element refs (D72): `ref="name"` in the template exposes the
	 * mounted DOM element as `this.refs.name`, and `null` while not mounted.
	 */
	readonly refs: Record<string, Element | null>;

	/** Whether the first `data()` result has committed (D39). */
	readonly loaded: boolean;

	/** True once `destroy()` has run (constellation/doc/DOC-VIEW-LIFECYCLE.md §3). */
	readonly isDestroyed: boolean;

	/**
	 * The component model. Runs on mount and whenever a subscribed store query,
	 * prop, or route param changes. May be async. Override in every view.
	 */
	data(params?: Record<string, string>, props?: any): any | Promise<any>;

	/** Read the current component model. */
	getData<T = any>(): T;

	/** Merge local UI state and schedule a re-render (does NOT re-run data()). */
	setData(key: string, value: any): void;
	setData(partial: Record<string, any>): void;

	/**
	 * Reference-stable derived value (D64). Per-instance cache keyed by
	 * `key`: returns the cached value while `deps` match the previous call
	 * positionally by `Object.is` (length change = miss); otherwise runs `factory()`,
	 * caches, and returns the fresh value. The blessed way to return object/array
	 * props from `data()` so they compare equal under shallowEqual across re-runs.
	 */
	memo<T>(key: string, deps: unknown[], factory: () => T): T;

	/** Re-run data() and re-render. */
	refresh(): void | Promise<void>;

	/**
	 * Event handlers referenced from the template: `@click={ handler }` passes
	 * the DOM event, and `@click={ save(item.id, event) }` passes whatever the
	 * call lists, so a handler takes any arguments (D176 §4). A class field of
	 * arrow functions. A handler named like a library function draws a
	 * development warning at mount. Declared by the subclass: the base class has
	 * none, so a view without handlers has no `events`.
	 */
	events?: Record<string, (...args: any[]) => void>;

	/** Declarative enter/leave animations (D28). */
	animations?: Animations;

	// ---- lifecycle hooks (all optional to override) ----
	created(): void;
	mounted(): void;
	beforeUpdate(): void;
	/** After every update render; `prev` is what the previous render drew (D178). */
	afterUpdate(prev: PrevViewState): void;
	destroyed(): void;

	// ---- enter/leave hooks (D28) ----
	viewWillShow(): void;
	viewDidShow(): void;
	viewWillHide(): void;
	viewDidHide(): void;

	/** Attached by the compiler from the template; not authored by hand. */
	render(): any;
}

// ----------------------------------------------------------------------------
// PuzzleModel + schema builders (constellation/doc/DOC-SPEC.md §7, §20–§22)
// ----------------------------------------------------------------------------

/**
 * The request handed to an `adapter.mock.handler` (D95). `path` is
 * relative to `apiURL + endpoint` (`''` for the collection), `body` is the parsed
 * request body, and `collection` is the mock's LIVE state — a `Map` keyed by
 * primary key, so a handler can read and mutate it.
 */
export interface AdapterMockRequest {
	method: string;
	url: string;
	path: string;
	body: any;
	collection: Map<any, any>;
}

/** What an `adapter.mock.handler` returns to serve a request (D95). */
export interface AdapterMockResult {
	/** HTTP status (default 200). */
	status?: number;
	/** Response body; omit for an empty (204-style) response. */
	body?: any;
}

/**
 * Development/test mock for a model's adapter (D95). Declared on the
 * model; served only when `@magic-spells/puzzle/fixtures` is installed (D98),
 * which replaces the Store's one network seam. `loadMany` / `loadOne` / `save()` /
 * `delete()` / `request()` are unchanged and the real read and write paths still
 * run. `beforeRequest` still fires; no network call does. Without the fixtures
 * module this block is inert data — the request goes to the real endpoint.
 */
export interface AdapterMock {
	/** Initial collection; deep-cloned on first use, then owned by the Store. */
	data?: Record<string, any>[];
	/** Delay in ms, or a `[min, max]` range picked from the seeded PRNG. */
	latency?: number | [number, number];
	/** 0..1 failure probability, rolled against the seeded PRNG. */
	failRate?: number;
	/** Force EVERY request to fail with a 500 — a deterministic rejection. */
	fail?: boolean;
	/** Custom routes; a falsy return falls through to the default CRUD. */
	handler?: (request: AdapterMockRequest) => AdapterMockResult | null | undefined | false | void;
}

/** A model's API adapter descriptor. */
export interface ModelAdapter {
	/** Optional REST shorthand; `/adapter` augments this interface with typed verbs. */
	endpoint?: string;
	/** Development/test mock served in place of the network (D95). */
	mock?: AdapterMock;
	[key: string]: any;
}

/**
 * Base class for data models (constellation/doc/DOC-SPEC.md §7). Records ARE
 * instances of the subclass, so instance methods and getters work on any record.
 * Declare fields with `static schema` using the `Puzzle.*` builders.
 */
export declare class PuzzleModel {
	constructor(data?: Record<string, any>);

	/** Field/relationship declarations built with `Puzzle.*`. */
	static schema?: Record<string, SchemaField | Relationship>;

	/** API adapter — per-verb fetch functions, optionally filled by `{ endpoint }` REST shorthand. */
	static adapter?: ModelAdapter;

	/**
	 * Validate a plain data object against the schema (non-throwing).
	 * `options.fields` limits the check to those declared field names; omitted
	 * means every declared field.
	 */
	static validate(
		data: Record<string, any>,
		options?: { fields?: readonly string[] },
	): ValidationResult;

	/** Merge a patch into the record; notifies the store. Returns the record. */
	update(patch: Record<string, any>): this;

	/** Remove the record from its store (local-only). */
	destroy(): this;

	/** Validate this record's current field values (non-throwing). */
	validate(): ValidationResult;

	/** Plain-object snapshot of the record's own enumerable fields. */
	toJSON(): Record<string, any>;

	/** Dynamic model fields. */
	[key: string]: any;
}

/**
 * A schema field descriptor built by the `Puzzle.*` builders
 * (constellation/doc/DOC-SPEC.md §7). Every modifier returns the field for
 * chaining: `Puzzle.string().required().min(1, 'msg')`.
 */
export interface SchemaField {
	/** Mark as the primary key (implies required). */
	primary(): SchemaField;
	/** Mark required, optionally with a custom message. */
	required(message?: string): SchemaField;
	/** Provide a default value (or a factory function). */
	default(value: any): SchemaField;
	/** Minimum (numbers/dates by value; strings/arrays by length). */
	min(value: number | Date, message?: string): SchemaField;
	/** Maximum (numbers/dates by value; strings/arrays by length). */
	max(value: number | Date, message?: string): SchemaField;
	/** Restrict to a set of allowed values. */
	oneOf(values: any[], message?: string): SchemaField;
	/** Custom predicate — return truthy for valid. */
	validate(fn: (value: any) => boolean, message?: string): SchemaField;
}

/**
 * A relationship descriptor built by `Puzzle.hasMany`/`Puzzle.belongsTo`
 * (D49). Not chainable — a relationship is not a field.
 */
export interface Relationship {}

/** Options for the relationship builders (D49). */
export interface RelationshipOptions {
	/** Override the by-convention foreign-key field name. */
	key?: string;
}

/**
 * The schema-builder namespace (constellation/doc/DOC-SPEC.md §7). Each builder
 * returns a chainable `SchemaField`; `hasMany`/`belongsTo` build relationships.
 */
export declare const Puzzle: {
	string(): SchemaField;
	number(): SchemaField;
	boolean(): SchemaField;
	date(): SchemaField;
	array(): SchemaField;
	object(): SchemaField;
	belongsTo(type: string, options?: RelationshipOptions): Relationship;
	hasMany(type: string, options?: RelationshipOptions): Relationship;
};

// ----------------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------------

/** Thrown when a write fails schema validation (constellation/doc/DOC-SPEC.md §20). */
export declare class PuzzleValidationError extends Error {
	constructor(errors?: Array<{ field: string; rule: string; message: string }>);
	errors: Array<{ field: string; rule: string; message: string }>;
}

// ----------------------------------------------------------------------------
// PuzzleApp (constellation/doc/DOC-SPEC.md §1–§2)
// ----------------------------------------------------------------------------

/** The PuzzleApp config surface (constellation/doc/DOC-SPEC.md §2 + amendments). */
export interface PuzzleAppConfig {
	/** CSS selector or Element to mount into. */
	target: string | Element;
	/** Route definitions. */
	routes?: Route[];
	/** Type name → model class registry. */
	models?: Record<string, any>;
	/**
	 * The app's own library functions (D176 §4), called bare from templates —
	 * `{ specialFormat(product.title) }`. One named like a built-in overrides it.
	 */
	formatters?: Record<string, Formatter>;
	/** Base URL for the server read/write path. */
	apiURL?: string;
	/** Storage-like object for opt-in persistence. */
	storage?: any;
	/** Bare or defaults-configured capability from `@magic-spells/puzzle/adapter`. */
	adapter?: PuzzleAdapterCapability;
	/**
	 * Adapter request hook (D91): `beforeRequest(init, { type, method, url })`,
	 * called synchronously before every adapter fetch. Mutate `init` or return a
	 * replacement to attach auth headers, `credentials`, or an `AbortSignal`.
	 */
	beforeRequest?: BeforeRequestHook;
	/** Router scroll handling (D33): `false`, or a custom function. */
	scrollBehavior?: false | ScrollBehavior;
	/**
	 * Router focus management + route announcement (D93). Omit for the
	 * default: after every committed navigation focus the leaf view's root
	 * (`tabindex="-1"` stamped and removed on blur) with `{ preventScroll: true }`,
	 * and announce the committed `document.title` in a framework-owned
	 * visually-hidden `aria-live="polite"` region. `false` disables both — no focus
	 * move and no live region is ever created. A function chooses the target
	 * element itself. Inert in memory mode; navigation #0 never moves focus.
	 */
	focusBehavior?: false | FocusBehavior;
	/**
	 * Router URL carrier (D34 / D42, opt-in imports since D159). Omit
	 * for path routing (the pathname — the default), or pass a mode object from
	 * `@magic-spells/puzzle/router-modes`: `hashRouter()` or
	 * `memoryRouter({ initialPath })`. A mode STRING is a constructor error.
	 */
	routerMode?: RouterMode;
	/** Serve the app under a sub-path (D51). */
	routerBase?: string;
	/**
	 * Route transition feel (D56): `'sequential'` (default — old `out`
	 * finishes before the new view mounts) or `'overlap'` (old `out` and new `in`
	 * play concurrently via fixed-pin positioning). Also resolvable per-route
	 * (routes.js) and per-view/layout (a class field) (D65).
	 */
	transitionMode?: 'sequential' | 'overlap';
	/**
	 * App lifecycle hook (SPEC §34, D66): runs inside `mount()` after the
	 * ctx services (store/router/formatters) are wired but BEFORE navigation #0,
	 * and is awaited — store seeding here is visible to the first `data()`. A
	 * throw aborts the mount (`mount()` rejects; `beforeUnmount` is skipped).
	 *
	 * In a prerender (`output: 'hybrid'`/`'static'`) it runs at build time for
	 * every page with a `{ store, config }` facade (argument and `this`) instead
	 * of the app — plus `locale`, the page's locale, when translations are
	 * configured (under `i18n.routing: 'prefix'` each locale's pages, D177).
	 */
	beforeMount?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
	/**
	 * App lifecycle hook (SPEC §34, D66): runs after the initial route has
	 * rendered (and the dev HMR state restore, D57). Its errors are logged, never
	 * wedging a succeeded mount.
	 */
	mounted?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
	/**
	 * App lifecycle hook (SPEC §34, D66): runs at the top of `unmount()`
	 * before any teardown, with services still live (persistence can flush).
	 * Errors are logged; teardown always proceeds.
	 */
	beforeUnmount?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
	/**
	 * Called for every framework-contained application error. `info` always has
	 * the stable `{ phase, view, route }` shape. A throwing or rejecting reporter
	 * is logged and swallowed without recursion.
	 */
	onError?: PuzzleErrorHandler;
	/**
	 * Ordinary compiled PuzzleView constructor used for framework-contained error
	 * UI. A fresh instance replaces only the failed view and receives
	 * `{ error, info, retry }` props.
	 */
	errorView?: PuzzleViewConstructor;
}

/**
 * The application class (constellation/doc/DOC-SPEC.md §1–§2). Construct once
 * with the config surface and call `mount()`.
 */
export declare class PuzzleApp {
	constructor(config: PuzzleAppConfig);
	/** The wired datastore — readable only after mount() has started. */
	readonly store: Store;
	/** The wired router (null before mount / after unmount). */
	router: Router | null;
	/** The wired formatter registry (null before mount / after unmount). */
	formatters: FormatterRegistry | null;
	/**
	 * The translation service (D175) — absent when `i18n` is not configured,
	 * null after unmount.
	 */
	i18n?: PuzzleI18n | null;
	/** The shared context injected into every view (null before mount). */
	ctx: PuzzleContext | null;
	/**
	 * Boot the app and run the initial navigation. Under `i18n.routing: 'prefix'`,
	 * when the first-visit redirect sends the visitor to their language's URL, the
	 * promise never settles: the page is being replaced and nothing was wired (D177).
	 */
	mount(): Promise<this>;
	/** Tear down the app. Idempotent. */
	unmount(): this;
	/**
	 * Register the shared-element morph handler (D55) — the app-level
	 * face of Router.setMorphHandler, safe to call before OR after mount().
	 * Called by `enableMorph(app)`; pass null to unregister.
	 */
	setMorphHandler(handler: MorphHandler | null): this;
}

// ----------------------------------------------------------------------------
// Compiler-support exports (not part of the user-facing SPEC §1 surface)
// ----------------------------------------------------------------------------

/**
 * Shared nullish-safe display coercion used by compiled render functions. With
 * `sep`, a list prints its items joined by it, dropping `false` and empty items.
 */
export declare function displayValue(value: unknown, expression?: string | 0, sep?: string): string;

/** One node of the virtual tree — compiled render functions build these. */
export declare class ViewNode {
	constructor(tag: any, attrs?: object, children?: any);
	tag: any;
	attrs: Record<string, any>;
	/**
	 * Child vnodes, OR a raw HTML string for island-frozen subtrees (inline SVG,
	 * `{#svg}`): the viewManager seeds a string child once via innerHTML and never
	 * reconciles it (D44/D46).
	 */
	children: any[] | string;
	key: any;
	el: any;
	component: any;
	instance: any;
	readonly isText: boolean;
	readonly isComponent: boolean;
	readonly isSlot: boolean;
	readonly isSnippet: boolean;
	readonly isPortal: boolean;
	readonly props: Record<string, any>;
}

/** Reserved tag marking a composition-marker (`<Children/>`/`<Slot/>`/`<Slot name>`) substitution point. */
export declare const SLOT_TAG: string;

/** Reserved tag carrying a caller-owned `<Snippet>…</Snippet>` declaration (D166). */
export declare const SNIPPET_TAG: string;

/** Reserved tag marking a `<Portal>…</Portal>` teleport (D144). */
export declare const PORTAL_TAG: string;

/**
 * Render one item-form `{#for}` site (D170). A compiled module imports this as
 * `__l`, and ONLY when it lowers at least one such loop — the same conditional
 * import `displayValue as __s` uses, so a loop-free app never carries the list
 * runtime. Never called from user code.
 */
export declare function listRows(
	view: object,
	owner: object,
	id: number,
	items: unknown,
	factory: (row: any) => ViewNode,
	meta: {
		key: (item: any, index: number) => any;
		counter?: boolean;
		ctrl?: boolean;
		roots?: number;
		fields?: string[];
		deep?: boolean;
		volatile?: boolean;
	}
): ViewNode[];

/**
 * The loop domain of an item-form `{#for}` (D173 V12): returns the collection
 * when it is an array and an empty list otherwise (a non-list other than
 * `null`/`undefined` also warns in development). A compiled module whose item
 * loop keeps `.map` imports this as `__e`. Never called from user code.
 */
export declare function loopItems(value: unknown): any[];

/**
 * The numbers of a range `{#for from...to}` (D173 V12): both bounds truncated
 * toward zero, zero iterations for a missing or non-finite bound. A compiled
 * module with a range loop imports this as `__r`. Never called from user code.
 */
export declare function loopRange(from: unknown, to: unknown): number[];
