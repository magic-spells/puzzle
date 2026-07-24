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
	/**
	 * Route metadata. Four RESERVED head fields (v1.50, D84 —
	 * constellation/doc/DOC-SPEC.md §45): each resolves independently,
	 * nearest-defined walking the destination chain leaf→root; `undefined`
	 * inherits from a parent, `null` explicitly suppresses an inherited value.
	 * Static strings only (no functions/HTML). Rendered as managed
	 * `data-puzzle-head` tags by both prerender output and SPA navigation;
	 * custom keys are untouched by the framework.
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
	/** GET the collection endpoint and upsert every record (D21). */
	loadAll(type: string): Promise<any[]>;
	/** GET one record by id and upsert it (D21). */
	loadOne(type: string, id: any): Promise<any>;
	/** Custom-endpoint escape hatch (v1.18, D50). */
	request(type: string, path?: string, options?: RequestOptions): Promise<any>;
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

/** A model's API adapter descriptor. */
export interface ModelAdapter {
	endpoint: string;
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

	/** Sync the record to the server: POST when new, PUT thereafter (v1.18, D50). */
	save(): Promise<this>;

	/** Confirmed server delete, then local remove; resolves the record (v1.18, D50). */
	delete(): Promise<this>;

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

/** Thrown when an adapter request responds non-OK (constellation/doc/DOC-SPEC.md §22). */
export declare class PuzzleAdapterError extends Error {
	constructor(status: number, statusText?: string, body?: any);
	status: number;
	statusText?: string;
	body?: any;
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
	/** Router scroll handling (v1.5, D33): `false`, or a custom function. */
	scrollBehavior?: false | ScrollBehavior;
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
	readonly props: Record<string, any>;
}

/** Reserved tag marking a composition-marker (`<children/>`/`<Slot/>`/`<slot name>`) substitution point. */
export declare const SLOT_TAG: string;
