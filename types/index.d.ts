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
 * Covers the four package exports { PuzzleApp, PuzzleView, PuzzleModel, Puzzle }
 * plus the internal/compiler-support exports re-exported from the package root.
 */

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

/**
 * A route definition (constellation/doc/DOC-SPEC.md §9). `view`/`layout` are
 * PuzzleView subclasses (constructors) — typed loosely so `.pzl` default
 * exports and compiled classes both assign cleanly. Nested via `children`
 * (v1.3, D30).
 */
export interface Route {
	path: string;
	name?: string;
	view: any;
	layout?: any;
	/** Route-entry guard (v1.53, D87), inherited root → leaf and run before views load. */
	guard?: GuardFn;
	/**
	 * Route metadata. Four RESERVED head fields (v1.50, D84 —
	 * constellation/doc/DOC-SPEC.md §45): each resolves independently,
	 * nearest-defined walking the destination chain leaf→root; `undefined`
	 * inherits from a parent, `null` explicitly suppresses an inherited value.
	 * Static strings only (no functions/HTML).
	 *
	 * Delivery is split (D111): the managed `data-puzzle-head` tags derived from
	 * `description`/`canonical`/`socialImage` (og:/twitter:/description/canonical)
	 * are emitted at BUILD time only, by the SSG shell injector — so `hybrid` and
	 * `static` output bake them into the served HTML crawlers read. The browser
	 * runtime never emits or updates those tags in any output mode; on SPA
	 * navigation only `document.title` is synced. Custom keys are untouched by
	 * the framework.
	 */
	meta?: {
		title?: string | null;
		description?: string | null;
		canonical?: string | null;
		socialImage?: string | null;
		[key: string]: any;
	};
	children?: Route[];
	[key: string]: any;
}

/** A route guard (v1.53, D87): allow, block, or redirect before navigation loads. */
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
	/** `path` minus query + hash (v1.49, D83) — base-free, trailing slash kept verbatim. */
	pathname: string;
	/**
	 * The parsed query (v1.49, D83): a frozen, null-prototype object with
	 * URLSearchParams decoding — a single value is a string, a repeated key a
	 * frozen array in source order, a valueless key (`?debug`) `''`.
	 */
	query: Readonly<Record<string, string | readonly string[]>>;
	/** `''`, or the raw fragment including the leading `#` (v1.49, D83). */
	hash: string;
	route: Route;
	params: Record<string, string>;
	chain: Route[];
}

/**
 * Custom scroll behavior (v1.5, D33): return a position to scroll to, or a
 * falsy value to leave scroll alone.
 */
export type ScrollBehavior = (
	to: RouteSnapshot,
	from: RouteSnapshot | null,
	savedPosition: ScrollPosition | null
) => ScrollPosition | null | undefined | false;

/**
 * Custom router focus behavior (v1.56, D93): return the element focus should land
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
	 * When the enter animation plays (v1.40, D73; constellation/doc/DOC-SPEC.md §39).
	 * `'mount'` (default) plays immediately on mount; `'visible'` holds the element
	 * at its `from` keyframe and reveals it the first time it scrolls into view.
	 * Only meaningful on the `in` spec — a `trigger` on `out` warns once and is
	 * ignored. An unknown value warns once and falls back to `'mount'`.
	 */
	trigger?: 'mount' | 'visible';
	/**
	 * With `trigger: 'visible'` (v1.40, D73), the reveal line's distance ABOVE the
	 * viewport's bottom edge: a number is px, a string must match
	 * `/^\d+(\.\d+)?(px|%)$/` (e.g. `'15%'`). Maps to an IntersectionObserver
	 * `rootMargin` of `'0px 0px -<offset> 0px'` at threshold 0. Invalid values warn
	 * once and are ignored; ignored entirely without `trigger: 'visible'`.
	 */
	triggerOffset?: number | string;
	/**
	 * With `trigger: 'visible'` (v1.40, D73), a CSS selector for an ANCESTOR to
	 * observe INSTEAD of the element itself, so a group of instances sharing one
	 * section reveal together. Resolved once via `element.closest(selector)`
	 * (ancestors only; a self-match is harmless). `triggerOffset` still composes.
	 * A non-string/empty value, an invalid selector, or no ancestor match warns
	 * once and falls back to the element itself; ignored entirely without
	 * `trigger: 'visible'`.
	 */
	triggerAnchor?: string;
}

/** Declarative enter/leave animations on a view/component (v1.1, D28). */
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

/** Options for `store.request(type, path, options)` (v1.18, D50). */
export interface RequestOptions {
	method?: string;
	body?: any;
	headers?: Record<string, string>;
}

/**
 * The frozen, read-only context handed to `beforeRequest` (v1.55, D91): the model
 * type the request belongs to, the HTTP verb, and the fully built URL.
 */
export interface AdapterRequestContext {
	readonly type: string;
	readonly method: string;
	readonly url: string;
}

/**
 * Adapter request hook (v1.55, D91). Called synchronously before every adapter
 * fetch — `loadAll`/`loadOne` (D21), `save()`/`delete()` and `request()` (D50).
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
	/** Adapter request hook (v1.55, D91). */
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
	/** Look up one record by primary key (auto-subscribes). Null when absent. */
	findOne(type: string, id: any): any;
	/** List records of a type, optionally filtered (auto-subscribes). */
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
 * The shared-element morph slot (v1.23, D55) — normally filled by
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
	/** Navigate to a path REPLACING the current history entry — no new entry, scroll left alone by default (v1.49, D83). */
	replace(path: string): void | Promise<void>;
	/** Move `n` entries in history (negative = back). All modes (v1.11, D42). */
	go(n: number): void | Promise<void>;
	/** Go back one entry. */
	back(): void | Promise<void>;
	/** Go forward one entry. */
	forward(): void | Promise<void>;
	/** Path-shaped route in, mode-encoded href out (`'/x'` history, `'#/x'` hash, unchanged memory); strings not starting with `/` pass through (v1.46, D79). */
	url(path: string): string;
	/** The current route snapshot, or null before the first navigation. */
	readonly current: RouteSnapshot | null;
	/** Register the shared-element morph handler (v1.23, D55); null unregisters. */
	setMorphHandler(handler: MorphHandler | null): void;
	[key: string]: any;
}

// ----------------------------------------------------------------------------
// FormatterRegistry (constellation/doc/DOC-SPEC.md §6)
// ----------------------------------------------------------------------------

/** A template formatter — a display-only value transform. */
export type Formatter = (...args: any[]) => any;

/**
 * The formatter registry (constellation/doc/DOC-SPEC.md §6). Reachable in views
 * as `this.ctx.formatters`; rarely touched directly by app code.
 */
export declare class FormatterRegistry {
	constructor(seedMap?: Record<string, Formatter>);
	/** Register (or overwrite) a formatter by name. */
	register(name: string, fn: Formatter): void;
	/** Look up a formatter by name (returns a pass-through for unknown names). */
	get(name: string): Formatter;
	/** The raw name → function map handed to compiled render code. */
	getAll(): Record<string, Formatter>;
}

// ----------------------------------------------------------------------------
// Component context (constellation/doc/DOC-SPEC.md §10)
// ----------------------------------------------------------------------------

/** The minimal per-view service object — `this.ctx` in every view. */
export interface PuzzleContext {
	store: Store;
	router: Router;
	formatters: FormatterRegistry;
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
	 * (v1.15, D47). Correct inside the pre-commit `data()` gate; null off-router.
	 */
	readonly route: RouteSnapshot | null;

	/**
	 * The DOM node occupying this view's position (null before mount). While an
	 * async `data()` is in flight this is the placeholder Comment anchor, so the
	 * type is `Element | Comment`, not `Element` alone.
	 */
	readonly element: Element | Comment | null;

	/**
	 * Live element refs (v1.39, D72): `ref="name"` in the template exposes the
	 * mounted DOM element as `this.refs.name`, and `null` while not mounted.
	 */
	readonly refs: Record<string, Element | null>;

	/** Whether the first `data()` result has committed (v1.8, D39). */
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
	 * Reference-stable derived value (v1.29, D64). Per-instance cache keyed by
	 * `key`: returns the cached value while `deps` match the previous call
	 * positionally by `Object.is` (length change = miss); otherwise runs `factory()`,
	 * caches, and returns the fresh value. The blessed way to return object/array
	 * props from `data()` so they compare equal under shallowEqual across re-runs.
	 */
	memo<T>(key: string, deps: unknown[], factory: () => T): T;

	/** Re-run data() and re-render. */
	refresh(): void | Promise<void>;

	/**
	 * Event handlers referenced from the template (`@click={ handler }`).
	 * A class field of arrow functions.
	 */
	events: Record<string, (event?: any) => void>;

	/** Declarative enter/leave animations (v1.1, D28). */
	animations?: Animations;

	// ---- lifecycle hooks (all optional to override) ----
	created(): void;
	mounted(): void;
	beforeUpdate(): void;
	afterUpdate(): void;
	destroyed(): void;

	// ---- enter/leave hooks (v1.1, D28) ----
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
 * The request handed to an `adapter.mock.handler` (v1.57, D95). `path` is
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

/** What an `adapter.mock.handler` returns to serve a request (v1.57, D95). */
export interface AdapterMockResult {
	/** HTTP status (default 200). */
	status?: number;
	/** Response body; omit for an empty (204-style) response. */
	body?: any;
}

/**
 * Development/test mock for a model's adapter (v1.57, D95). Declared on the
 * model; served only when `@magic-spells/puzzle/fixtures` is installed (D98),
 * which replaces the Store's one network seam. `loadAll` / `loadOne` / `save()` /
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
	endpoint: string;
	/** Development/test mock served in place of the network (v1.57, D95). */
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

	/** API adapter — `{ endpoint }` drives the store's server read/write path. */
	static adapter?: ModelAdapter;

	/** Validate a plain data object against the schema (non-throwing). */
	static validate(data: Record<string, any>): ValidationResult;

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
 * (v1.17, D49). Not chainable — a relationship is not a field.
 */
export interface Relationship {}

/** Options for the relationship builders (v1.17, D49). */
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
	/** App-level template formatters (override built-ins). */
	formatters?: Record<string, Formatter>;
	/** Base URL for the server read/write path. */
	apiURL?: string;
	/** Storage-like object for opt-in persistence. */
	storage?: any;
	/** REST adapter capability imported from `@magic-spells/puzzle/adapter`. */
	adapter?: PuzzleAdapterCapability;
	/**
	 * Adapter request hook (v1.55, D91): `beforeRequest(init, { type, method, url })`,
	 * called synchronously before every adapter fetch. Mutate `init` or return a
	 * replacement to attach auth headers, `credentials`, or an `AbortSignal`.
	 */
	beforeRequest?: BeforeRequestHook;
	/** Router scroll handling (v1.5, D33): `false`, or a custom function. */
	scrollBehavior?: false | ScrollBehavior;
	/**
	 * Router focus management + route announcement (v1.56, D93). Omit for the
	 * default: after every committed navigation focus the leaf view's root
	 * (`tabindex="-1"` stamped and removed on blur) with `{ preventScroll: true }`,
	 * and announce the committed `document.title` in a framework-owned
	 * visually-hidden `aria-live="polite"` region. `false` disables both — no focus
	 * move and no live region is ever created. A function chooses the target
	 * element itself. Inert in memory mode; navigation #0 never moves focus.
	 */
	focusBehavior?: false | FocusBehavior;
	/** Router URL carrier (v1.6/v1.11): pathname, hash, or in-memory. */
	routerMode?: 'history' | 'hash' | 'memory';
	/** Memory-mode initial route (v1.11, D42). */
	routerInitialPath?: string;
	/** Serve the app under a sub-path (v1.19, D51). */
	routerBase?: string;
	/**
	 * Route transition feel (v1.24, D56): `'sequential'` (default — old `out`
	 * finishes before the new view mounts) or `'overlap'` (old `out` and new `in`
	 * play concurrently via fixed-pin positioning). Also resolvable per-route
	 * (routes.js) and per-view/layout (a class field) since v1.30 (D65).
	 */
	transitionMode?: 'sequential' | 'overlap';
	/**
	 * App lifecycle hook (v1.31, SPEC §34, D66): runs inside `mount()` after the
	 * ctx services (store/router/formatters) are wired but BEFORE navigation #0,
	 * and is awaited — store seeding here is visible to the first `data()`. A
	 * throw aborts the mount (`mount()` rejects; `beforeUnmount` is skipped).
	 */
	beforeMount?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
	/**
	 * App lifecycle hook (v1.31, SPEC §34, D66): runs after the initial route has
	 * rendered (and the dev HMR state restore, D57). Its errors are logged, never
	 * wedging a succeeded mount.
	 */
	mounted?: (this: PuzzleApp, app: PuzzleApp) => void | Promise<void>;
	/**
	 * App lifecycle hook (v1.31, SPEC §34, D66): runs at the top of `unmount()`
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
	/** The shared context injected into every view (null before mount). */
	ctx: PuzzleContext | null;
	/** Boot the app and run the initial navigation. */
	mount(): Promise<this>;
	/** Tear down the app. Idempotent. */
	unmount(): this;
	/**
	 * Register the shared-element morph handler (v1.23, D55) — the app-level
	 * face of Router.setMorphHandler, safe to call before OR after mount().
	 * Called by `enableMorph(app)`; pass null to unregister.
	 */
	setMorphHandler(handler: MorphHandler | null): this;
}

// ----------------------------------------------------------------------------
// Compiler-support exports (not part of the user-facing SPEC §1 surface)
// ----------------------------------------------------------------------------

/** Shared nullish-safe display coercion used by compiled render functions. */
export declare function displayValue(value: unknown, expression?: string | 0): string;

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
	readonly isPortal: boolean;
	readonly props: Record<string, any>;
}

/** Reserved tag marking a composition-marker (`<children/>`/`<Slot/>`/`<slot name>`) substitution point. */
export declare const SLOT_TAG: string;

/** Reserved tag marking a `<Portal>…</Portal>` teleport (D144). */
export declare const PORTAL_TAG: string;
