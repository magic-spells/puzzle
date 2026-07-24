/**
 * Type-only consumer fixture (`npm run test:types`).
 *
 * Imports from the PUBLIC package root ('@magic-spells/puzzle') and the
 * '@magic-spells/puzzle/morph' subpath exactly as an app authored with
 * `<script lang="ts">` would. The package is NOT installed in this repo, so the
 * fixture tsconfig maps both specifiers at ../types via `paths` — this still
 * type-checks the real exported declaration surface + its exports wiring.
 *
 * Nothing here runs. `tsc --noEmit --strict` failing is the whole test: it
 * guards that the declared surface stays usable (and catches a declaration that
 * silently drifts from the runtime). No `@ts-expect-error` / `any` escape hatches.
 */

import {
	PuzzleApp,
	PuzzleView,
	PuzzleModel,
	Puzzle,
	PuzzleValidationError,
	PuzzleAdapterError,
} from '@magic-spells/puzzle';
import type {
	PuzzleAppConfig,
	Route,
	RouteSnapshot,
	ScrollPosition,
	Formatter,
	ValidationResult,
	MorphHandler,
} from '@magic-spells/puzzle';
import { enableMorph } from '@magic-spells/puzzle/morph';
import type { MorphEngine } from '@magic-spells/puzzle/morph';

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

const routes: Route[] = [
	{
		path: '/',
		name: 'home',
		view: TodoListView,
		meta: { title: 'Todos' },
		// per-route transition override (v1.30, D65) — Route allows extra keys.
		transitionMode: 'overlap',
	},
	{
		path: '/todos/:id',
		name: 'todo',
		view: TodoListView,
		children: [{ path: 'edit', name: 'todo-edit', view: TodoListView }],
	},
];

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

// ---------------------------------------------------------------------------
// PuzzleApp config: all three lifecycle hooks + routerMode/scrollBehavior/transitionMode
// ---------------------------------------------------------------------------

const config: PuzzleAppConfig = {
	target: '#app',
	routes,
	models: { todo: Todo },
	formatters: { upcase },
	apiURL: '',
	routerMode: 'history',
	routerBase: '/app',
	routerInitialPath: '/',
	transitionMode: 'sequential',
	scrollBehavior,
	async beforeMount(app) {
		// `this` is the PuzzleApp; store is live and awaited before nav #0 (§34).
		const self: PuzzleApp = this;
		await self.store.loadAll('todo');
		app.store.createRecord('todo', { title: 'seeded' });
	},
	mounted(app) {
		app.router?.push('/');
	},
	beforeUnmount(app) {
		void app.store.findMany('todo');
	},
};

const app = new PuzzleApp(config);

// mount() resolves to the app; store/router usable after.
app.mount().then((mounted) => {
	const todos = mounted.store.findMany('todo', { filter: (t) => !t.done });
	mounted.router?.push('/todos');
	mounted.router?.go(1);
	return todos.length;
});

// store is readable off the constructed app too (typed non-null).
const seeded = app.store.createRecord('todo', { title: 'a' });
void seeded;

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
