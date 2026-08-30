/**
 * Type-only consumer fixture (`npm run test:types`).
 *
 * Imports from the PUBLIC package root ('@magic-spells/puzzle') and the
 * '@magic-spells/puzzle/morph', '/ssg', '/static' and '/fixtures' subpaths
 * exactly as an app authored with `<script lang="ts">` would. The package is
 * NOT installed in this repo, so the fixture tsconfig maps the specifiers at
 * ../types via `paths` — this still type-checks the real exported declaration
 * surface + its exports wiring.
 *
 * Nothing here runs. `tsc --noEmit --strict` failing is the whole test: it
 * guards that the declared surface stays usable (and catches a declaration that
 * silently drifts from the runtime).
 */

import {
	PuzzleApp,
	PuzzleView,
	PuzzleModel,
	Puzzle,
	PuzzleValidationError,
	displayValue,
	lazy,
} from '@magic-spells/puzzle';
import type {
	PuzzleAppConfig,
	Route,
	RouteSnapshot,
	GuardFn,
	ScrollPosition,
	Formatter,
	ValidationResult,
	MorphHandler,
	BeforeRequestHook,
	AdapterRequestContext,
	AdapterMock,
	AdapterMockRequest,
	AdapterMockResult,
	ModelAdapter,
	FocusBehavior,
	PuzzleErrorInfo,
	PuzzleErrorViewProps,
	LazyView,
	PuzzleViewConstructor,
} from '@magic-spells/puzzle';
import { adapter, PuzzleAdapterError } from '@magic-spells/puzzle/adapter';
import type {
	AdapterCapability,
	AdapterConfig,
	AdapterDefaultContext,
	AdapterDefaults,
	AdapterFetch,
	AdapterRecord,
} from '@magic-spells/puzzle/adapter';
import { installFixtures, DEFAULT_FIXTURE_SEED } from '@magic-spells/puzzle/fixtures';
import type { FixturesConfig } from '@magic-spells/puzzle/fixtures';
import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
import type { RouterMode } from '@magic-spells/puzzle/router-modes';
import { enableMorph } from '@magic-spells/puzzle/morph';
import type { MorphEngine } from '@magic-spells/puzzle/morph';
import {
	prerender,
	injectShell,
	injectStaticShell,
	enumerateRoutes,
} from '@magic-spells/puzzle/ssg';
import type {
	PrerenderResult,
	PrerenderedPage,
	PrerenderToDirResult,
	ResolvedRouteHead,
	RouteEntry,
} from '@magic-spells/puzzle/ssg';
import { mountStatic } from '@magic-spells/puzzle/static';
import type { MountStaticOptions, StaticRoute } from '@magic-spells/puzzle/static';
import { createTestApp, measureRenders, mountView, type } from '@magic-spells/puzzle/testing';
import type { RenderProfile } from '@magic-spells/puzzle/testing';

const renderedNull: string = displayValue(null);
const renderedNamedValue: string = displayValue(0, 'count');
void renderedNull;
void renderedNamedValue;

// ---------------------------------------------------------------------------
// PuzzleModel + schema builders (§7, §20–§22)
// ---------------------------------------------------------------------------

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required('Title is required').min(1, 'Too short').max(280),
		priority: Puzzle.number().default(0),
		status: Puzzle.string().oneOf(['open', 'done'], 'bad status').default('open'),
		done: Puzzle.boolean().default(false),
		createdAt: Puzzle.date().default(() => new Date()),
		tags: Puzzle.array().validate((v) => Array.isArray(v)),
		author: Puzzle.belongsTo('user'),
		comments: Puzzle.hasMany('comment', { key: 'todoId' }),
	};

	static adapter = { endpoint: '/todos' };

	// Instance getter works because records ARE model instances (§7).
	get label(): string {
		return `${this.title} (${this.priority})`;
	}
}

// D158: endpoint is optional when every invoked verb is author-defined. This
// fully custom adapter intentionally uses global fetch, which is also legal
// (and deliberately bypasses beforeRequest plus fixture interception).
class FullyCustomPost extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
	};

	static adapter: AdapterConfig<FullyCustomPost> = {
		async loadMany() {
			const response = await fetch('/custom/posts');
			return (await response.json()).items as AdapterRecord[];
		},
		async loadOne(_fetch, id) {
			const response = await fetch(`/custom/posts/${id}`);
			return (await response.json()).item as AdapterRecord;
		},
		async create(_fetch, record) {
			const response = await fetch('/custom/posts', {
				method: 'POST',
				body: JSON.stringify(record.toJSON()),
			});
			return (await response.json()) as AdapterRecord;
		},
		async update(_fetch, record) {
			return record.toJSON();
		},
		async delete(_fetch, record) {
			await fetch(`/custom/posts/${record.id}`, { method: 'DELETE' });
		},
	};
}

// The fixtures mock block is a first-class adapter key on the /adapter subpath
// type too, not just the base ModelAdapter interface.
const mockedAdapterConfig: AdapterConfig<Todo> = {
	endpoint: '/todos',
	mock: { data: [{ id: '1', title: 'seeded' }], failRate: 0 },
};
void mockedAdapterConfig;

const publishingAdapter = {
	endpoint: '/todos',
	publish: (fetch: AdapterFetch, id: string) =>
		fetch(`/todos/${id}/publish`, { method: 'PATCH' }),
} satisfies AdapterConfig<Todo> & {
	publish(fetch: AdapterFetch, id: string): Promise<Response>;
};

// static + instance validate() both return a ValidationResult.
const staticResult: ValidationResult = Todo.validate({ title: 'x' });
const okFlag: boolean = staticResult.valid;
const firstErr = staticResult.errors[0];
const errShape: { field: string; rule: string; message: string } | undefined = firstErr;

// ---------------------------------------------------------------------------
// PuzzleView subclass: data / events / animations / memo (§4, §12, §32)
// ---------------------------------------------------------------------------

class TodoListView extends PuzzleView {
	// Colocated per-view transition override (v1.30, D65) — a plain class field.
	transitionMode: 'sequential' | 'overlap' = 'overlap';

	animations = {
		in: {
			from: { opacity: 0, transform: 'translateY(12px)' },
			to: { opacity: 1, transform: 'translateY(0)' },
			duration: 260,
			easing: 'ease-out',
			delay: 0,
		},
		out: {
			from: { opacity: 1 },
			to: { opacity: 0 },
			duration: 180,
		},
	};

	events = {
		addTodo: (event?: Event) => {
			event?.preventDefault();
			const title = this.getData<{ draft: string }>().draft;
			// store is reachable via ctx; createRecord returns a record (any).
			this.ctx.store.createRecord('todo', { title });
			this.setData('draft', '');
		},
		selectAll: () => this.setData({ filter: 'all', selectedId: null }),
	};

	async data(params?: Record<string, string>, props?: any): Promise<object> {
		const id = params?.id ?? props?.id;
		const todo = await this.ctx.store.findOne('todo', id);
		const todos = this.ctx.store.findMany('todo', { filter: (t) => !t.done });

		// memo(): reference-stable derived array under shallowEqual (§32, D64).
		const openTitles = this.memo<string[]>('openTitles', [todos.length], () =>
			todos.map((t: any) => t.title)
		);

		// route snapshot readable in the pre-commit gate (v1.15, D47).
		const snap: RouteSnapshot | null = this.route;
		const routeName = snap?.route.name;

		// parsed URL state on the snapshot (v1.49, D83).
		const pathname: string | undefined = snap?.pathname;
		const hash: string | undefined = snap?.hash;
		const q: string | readonly string[] | undefined = snap?.query.tag;
		if (typeof q !== 'string' && q !== undefined) {
			// repeated keys narrow to the readonly array branch.
			const first: string | undefined = q[0];
			void first;
		}
		void pathname;
		void hash;

		return { todo, todos, openTitles, routeName, draft: '', filter: 'all', selectedId: null };
	}

	mounted(): void {
		// router is on ctx; push/go/replace are path-shaped in all modes.
		this.ctx.router.push('/todos');
		this.ctx.router.replace('/todos?tab=2'); // v1.49, D83
		this.ctx.router.go(-1);

		// element is Element | Comment | null (the anchor Comment during async data()).
		const node: Element | Comment | null = this.element;
		if (node && node.nodeType === Node.ELEMENT_NODE) {
			// narrowing to Element works from the union.
			(node as Element).getAttribute('id');
		}
		// isDestroyed liveness getter (constellation/doc/DOC-VIEW-LIFECYCLE.md §3).
		const gone: boolean = this.isDestroyed;
		void gone;
	}
}

// ---------------------------------------------------------------------------
// Routes + scroll behavior + formatters
// ---------------------------------------------------------------------------

const requireAuth: GuardFn = ({ to, from, ctx }) => {
	const sessions = ctx.store.findMany('session');
	if (from?.pathname === '/login' || sessions.length > 0) return true;
	return '/login?redirect=' + encodeURIComponent(to.path);
};

const requireAdmin: GuardFn = async ({ ctx }) => {
	await Promise.resolve();
	return ctx.store.findMany('admin').length > 0;
};

const routes: Route[] = [
	{
		path: '/',
		name: 'home',
		view: TodoListView,
		// Reserved head fields (v1.50, D84): static strings, plus custom keys.
		meta: {
			title: 'Todos',
			description: 'All the todos',
			canonical: 'https://example.com/',
			socialImage: 'https://example.com/og.png',
			section: 'app',
		},
		// per-route transition override (v1.30, D65) — Route allows extra keys.
		transitionMode: 'overlap',
	},
	{
		path: '/todos/:id',
		name: 'todo',
		view: TodoListView,
		// `null` explicitly suppresses an inherited head value (D84).
		meta: { title: null, description: null },
		guard: requireAuth,
		children: [{ path: 'edit', name: 'todo-edit', view: TodoListView, guard: requireAdmin }],
	},
];

// D163: lazy route views/layouts are explicit branded markers. A loader may
// resolve to a class directly or to the module-namespace shape import() returns.
const lazyClass: LazyView = lazy(async () => TodoListView);
const lazyNamespace: LazyView = lazy(async () => ({ default: TodoListView }));
const lazyConstructor: PuzzleViewConstructor = TodoListView;
void lazyConstructor;
routes.push({ path: '/lazy', view: lazyClass, layout: lazyNamespace });

// A bare loader never occupies a view position — lazy() is the explicit API.
// @ts-expect-error a loader function is not a PuzzleView constructor or LazyView.
routes.push({ path: '/bare-loader', view: async () => TodoListView });

// The marker brand cannot be forged by a structural look-alike.
// @ts-expect-error only lazy() produces LazyView.
const forgedLazy: LazyView = {};
void forgedLazy;

// A module namespace must carry the route class as its default export.
// @ts-expect-error named-only modules do not satisfy the lazy loader contract.
lazy(async () => ({ NamedView: TodoListView }));

const upcase: Formatter = (s: unknown) => String(s).toUpperCase();

const scrollBehavior = (
	to: RouteSnapshot,
	from: RouteSnapshot | null,
	saved: ScrollPosition | null
): ScrollPosition | null => {
	if (saved) return saved;
	if (from && to.path === from.path) return null;
	return { x: 0, y: 0 };
};

// Router focus behavior (v1.56, D93): return an element to focus after the
// committed navigation, or a falsy value to leave focus alone for that one.
const focusBehavior: FocusBehavior = (to, from) => {
	if (from && to.pathname === from.pathname) return null;
	return document.querySelector('h1');
};

// ---------------------------------------------------------------------------
// PuzzleApp config: all three lifecycle hooks + routerMode/scrollBehavior/transitionMode
// ---------------------------------------------------------------------------

// Adapter request hook (v1.55, D91): both documented shapes type-check — mutate
// the init in place, or return a replacement.
const attachAuth: BeforeRequestHook = (init, context) => {
	const where: AdapterRequestContext = context;
	void `${where.type} ${where.method} ${where.url}`;
	init.headers = { ...(init.headers as Record<string, string>), Authorization: 'Bearer t' };
};

const replaceInit: BeforeRequestHook = (init) => ({ ...init, credentials: 'include' });
void replaceInit;

const appDefaults: AdapterDefaults = {
	async loadMany(fetch, _options, { type, endpoint }: AdapterDefaultContext) {
		const response = await fetch(`${endpoint}?type=${type}`);
		return (await response.json()).data as AdapterRecord[];
	},
	loadOne: (fetch, id, { endpoint }) => fetch(`${endpoint}/${id}`),
};
const configuredAdapter: AdapterCapability = adapter.defaults(appDefaults);

// @ts-expect-error app defaults are deliberately limited to the five framework verbs.
adapter.defaults({ publish: (_fetch: AdapterFetch) => Promise.resolve() });

class AppErrorView extends PuzzleView {
	data(_params?: Record<string, string>, props?: PuzzleErrorViewProps) {
		props?.retry();
		return { message: String(props?.error), phase: props?.info.phase };
	}
}

const config: PuzzleAppConfig = {
	target: '#app',
	routes,
	models: { todo: Todo },
	adapter,
	formatters: { upcase },
	apiURL: '',
	beforeRequest: attachAuth,
	// Path routing is the default and needs no `routerMode`; the opt-in modes
	// are imported factories (D159), and the handle they produce is opaque.
	routerBase: '/app',
	transitionMode: 'sequential',
	scrollBehavior,
	focusBehavior,
	errorView: AppErrorView,
	async beforeMount(app) {
		// `this` is the PuzzleApp; store is live and awaited before nav #0 (§34).
		const self: PuzzleApp = this;
		await self.store.loadMany('todo');
		app.store.createRecord('todo', { title: 'seeded' });
	},
	mounted(app) {
		app.router?.push('/');
	},
	beforeUnmount(app) {
		void app.store.findMany('todo');
	},
	onError(error, info) {
		const typedInfo: PuzzleErrorInfo = info;
		// Every phase literal the runtime funnels must be assignable to the public
		// union — the list the reportError call sites actually emit. A phase added to
		// the runtime without a matching member here fails this file.
		const emittedPhases: PuzzleErrorInfo['phase'][] = [
			'mount',
			'refresh',
			'render',
			'bind',
			'enter',
			'leave',
			'unmount',
			'navigation',
			'transition',
			'app-mount',
			'app-unmount',
			'error-view',
		];
		void [error, typedInfo.phase, typedInfo.view, typedInfo.route, emittedPhases];
	},
};

const adapterCapability: AdapterCapability = adapter;
const configuredApp = new PuzzleApp({ target: '#app', routes, adapter: configuredAdapter });
type RawAdapterAccepted = { endpoint: string } extends NonNullable<
	PuzzleAppConfig['adapter']
>
	? true
	: false;
const rawAdapterAccepted: RawAdapterAccepted = false;
void [adapterCapability, configuredApp, rawAdapterAccepted];

const app = new PuzzleApp(config);

const restAdapter = app.store.adapter<typeof Todo.adapter>('todo');
const restLoad = restAdapter.loadMany({ page: 2, limit: 20 });
const customAdapter = app.store.adapter<typeof publishingAdapter>('todo');
const publishResult: Promise<Response> = customAdapter.publish('server-1');
const noEndpointAdapter = app.store.adapter<typeof FullyCustomPost.adapter>('post');
void noEndpointAdapter.loadMany?.();
void app.store.loadMany('todo', { page: 2, limit: 20 });
void [restLoad, publishResult];

// ---------------------------------------------------------------------------
// router-modes subpath: the two opt-in mode factories (D159)
// ---------------------------------------------------------------------------

// Both factories produce the same opaque handle, and it is what `routerMode`
// accepts — a mode string no longer type-checks.
const hashMode: RouterMode = hashRouter();
const memoryMode: RouterMode = memoryRouter({ initialPath: '/about' });
void memoryRouter(); // options are optional; initialPath defaults to '/'

// A mode is only ever a factory's return value. A hand-written descriptor has
// the right shape but cannot build the instance the Router needs, so the brand
// rejects it at compile time rather than at `new Router(...)`.
// @ts-expect-error a structural look-alike is not a RouterMode.
const forgedMode: RouterMode = { name: 'hash', create: () => ({}) };
void forgedMode;

const hashApp = new PuzzleApp({ target: '#app', routes, routerMode: hashMode });
const memoryApp = new PuzzleApp({
	target: '#app',
	routes,
	routerMode: memoryMode,
	routerBase: '/app', // still accepted alongside a mode (inert in memory)
});
void [hashApp, memoryApp];

// mount() resolves to the app; store/router usable after.
app.mount().then((mounted) => {
	const todos = mounted.store.findMany('todo', { filter: (t) => !t.done });
	const seeded = mounted.store.createRecord('todo', { title: 'a' });
	mounted.store.upsert('todo', { id: 'server-1', title: 'server' });
	void mounted.store.loadOne('todo', 'server-1');
	void mounted.store.request('todo', '/server-1/archive', { method: 'POST' });
	void seeded.save();
	void seeded.delete();
	mounted.router?.push('/todos');
	mounted.router?.go(1);
	return todos.length;
});

// ---------------------------------------------------------------------------
// fixtures subpath: installFixtures() attaches seed()/resetFixtureSeed() (D98)
// ---------------------------------------------------------------------------

const fixturesConfig: FixturesConfig = {
	seed: 1234,
	mock: { todo: { data: [{ id: '1', title: 'a' }], latency: [200, 600], failRate: 0.25 } },
	async setup(setupApp) {
		const self: PuzzleApp = this;
		self.store.seed('todo', 3);
		setupApp.store.seed('todo', [{ title: 'pinned' }]);
	},
};

const uninstallFixtures: () => void = installFixtures(fixturesConfig);

const fixtures: any[] = app.store.seed('todo', 5);
const withOverrides: any[] = app.store.seed('todo', 3, { done: false });
const explicitShapes: any[] = app.store.seed('todo', [{ title: 'a' }, { title: 'b' }]);
app.store.resetFixtureSeed();
app.store.resetFixtureSeed(1234);
uninstallFixtures();
void [fixtures, withOverrides, explicitShapes, DEFAULT_FIXTURE_SEED];

const mockBlock: AdapterMock = { data: [{ id: '1' }], latency: 400, failRate: 0.25 };
void mockBlock;

class MockedTodo extends PuzzleModel {
	static schema = { id: Puzzle.string().primary(), title: Puzzle.string().required() };
	static adapter: ModelAdapter = {
		endpoint: '/todos',
		mock: {
			data: [{ id: '1', title: 'seeded' }],
			latency: [200, 600],
			failRate: 0,
			fail: false,
			handler({ method, path, body, collection }: AdapterMockRequest): AdapterMockResult | null {
				if (method !== 'POST' || !path.endsWith('/archive')) return null;
				void body;
				return { status: 200, body: { archived: collection.size } };
			},
		},
	};
}
void MockedTodo;

// ---------------------------------------------------------------------------
// morph subpath: enableMorph returns a MorphEngine; handler shape is structural
// ---------------------------------------------------------------------------

const engine: MorphEngine = enableMorph(app, { attribute: 'data-puzzle-morph', friction: 0.8 });
const engineState: string = engine.state;
void engineState;

const handler: MorphHandler = {
	enter(el, meta) {
		void el;
		void meta.initial;
	},
	leave(el) {
		void el;
		return engine.hide();
	},
};
app.setMorphHandler(handler);
app.setMorphHandler(null);

// ---------------------------------------------------------------------------
// ssg subpath: prerendered pages carry the resolved head beside the
// compatibility title (v1.50, D84); injectShell accepts it.
// ---------------------------------------------------------------------------

prerender(config).then((result: PrerenderResult) => {
	const page = result.pages[0];
	// `head` is per-field string|null (ResolvedRouteHead), or null for prerender:false.
	const head: ResolvedRouteHead | null = page.head;
	if (head) {
		const description: string | null = head.description;
		const canonical: string | null = head.canonical;
		void description;
		void canonical;
	}
	// title kept beside head for compatibility; head is optional on injectShell.
	return injectShell('<html><head></head><body><div id="app"></div></body></html>', {
		targetId: 'app',
		content: page.html ?? '',
		title: page.title,
		head,
	});
});

// ---------------------------------------------------------------------------
// ssg subpath: static-mode (D81) surface — the per-page capture fields on
// PrerenderedPage, the exported route enumeration, and the static shell surgery.
// ---------------------------------------------------------------------------

// enumerateRoutes flattens the tree to one entry per leaf (the drift-guard export).
const entries: RouteEntry[] = enumerateRoutes(routes);
const leaf = entries[0];
const leafPath: string = leaf.fullPath;
const leafChain: any[] = leaf.chain;
const leafLayout: any | null = leaf.layout;
void [leafPath, leafChain, leafLayout];

declare const staticSummary: PrerenderToDirResult;
const summaryHasAdapter: boolean | undefined = staticSummary.hasAdapter;
void summaryHasAdapter;

prerender(config, { mode: 'static' }).then((result: PrerenderResult) => {
	const page: PrerenderedPage = result.pages[0];
	// The three static-mode-only capture fields (all optional — absent in hybrid).
	const islandData: Record<string, any[]> | undefined = page.data;
	const modules: { views: string[]; layout: string | null } | undefined = page.modules;
	const pageRoute: object | undefined = page.route;
	const firstViewModule: string | undefined = modules?.views[0];
	void [firstViewModule, pageRoute];

	// Static shell surgery takes the data island + slug, plus the normalized
	// `base` prefix for a sub-path deploy.
	const shell = '<html><head><title>x</title></head><body><div id="app"></div></body></html>';
	return injectStaticShell(shell, {
		targetId: 'app',
		content: page.html,
		title: page.title,
		head: page.head,
		slug: 'index',
		data: islandData ?? {},
		base: '/app',
	});
});

// ---------------------------------------------------------------------------
// static subpath: the browser kernel for `output: 'static'` (D81). The generated
// per-page entry module calls mountStatic with the summary's serialized route.
// ---------------------------------------------------------------------------

const staticRoute: StaticRoute = {
	path: '/todos/edit',
	params: {},
	chain: [
		{ path: '/todos', name: 'todos' },
		{ path: 'edit', name: 'todo-edit', meta: { title: 'Edit' } },
	],
};

const staticOptions: MountStaticOptions = {
	target: '#app',
	views: [TodoListView, TodoListView],
	layout: null,
	route: staticRoute,
	models: { todo: Todo },
	formatters: { upcase },
	apiURL: '',
	adapter,
	// The three options the kernel destructures beyond the summary basics. (A static
	// page carries no `routerMode` at all — D117/D159.)
	storage: window.localStorage,
	routerBase: '/app',
};

mountStatic(staticOptions).then(() => {
	// Also assignable inline (the shape is a plain options bag, not a nominal type).
	return mountStatic({
		target: '#app',
		views: [TodoListView],
		route: { path: '/', params: {}, chain: [{ path: '/' }] },
		storage: window.sessionStorage,
		routerBase: '',
	});
});

// ---------------------------------------------------------------------------
// Testing helpers (D94/D121) — both measureRenders call shapes, plus type()
// ---------------------------------------------------------------------------

async function typeIntoBoundInput(): Promise<void> {
	const view = await mountView(TodoListView, { adapter });
	// Handle form: selector or element, chainable like click().
	await view.type('input.draft', 'hello');
	await (await createTestApp({ routes: [{ path: '/', view: TodoListView }], adapter })).type(
		'input.draft',
		'hello'
	);
	// Free form (D147): the element itself, resolved by the caller.
	const input = view.find('input.draft');
	if (input) await type(input, 'hello');
}
void typeIntoBoundInput;

async function profileRenders(): Promise<void> {
	const view = await mountView(TodoListView);
	// Callback-only form: the handle is optional (the sink is global).
	const bare: Readonly<RenderProfile> = await measureRenders(async () => {
		await view.click('.toggle');
	});
	// Handle + callback form, unchanged.
	const named: Readonly<RenderProfile> = await measureRenders(view, () => {
		view.find('.toggle');
	});
	const app = await createTestApp({ routes: [{ path: '/', view: TodoListView }] });
	const appProfile: Readonly<RenderProfile> = await measureRenders(app, async () => {
		await app.visit('/');
	});
	const renders: number = bare.renders + named.wastedRenders + appProfile.domMutations;
	void renders;
}
void profileRenders;

// ---------------------------------------------------------------------------
// Error shapes (§20, §22)
// ---------------------------------------------------------------------------

function handle(e: unknown): void {
	if (e instanceof PuzzleValidationError) {
		const fields: string[] = e.errors.map((x) => x.field);
		void fields;
	} else if (e instanceof PuzzleAdapterError) {
		const status: number = e.status;
		const statusText: string | undefined = e.statusText;
		void status;
		void statusText;
	}
}
handle(new PuzzleValidationError([{ field: 'title', rule: 'required', message: 'x' }]));
handle(new PuzzleAdapterError(404, 'Not Found', { detail: 'missing' }));

void okFlag;
void errShape;
void upcase;
