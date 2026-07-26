/**
 * Public declarations for @magic-spells/puzzle/testing (v1.58, D94).
 *
 * These helpers target app-authored DOM tests. They require a DOM environment
 * such as jsdom; no test runner is imported or assumed.
 */

import type {
	Formatter,
	PuzzleApp,
	PuzzleAppConfig,
	PuzzleContext,
	PuzzleView,
	RouteSnapshot,
	Router,
	Store,
} from './index.js';

export type PuzzleViewClass<T extends PuzzleView = PuzzleView> = new (
	ctx: PuzzleContext
) => T;

export interface MountViewOptions {
	props?: any;
	params?: Record<string, string>;
	children?: any[];
	ref?: Node | null;
	/** Route snapshot delivered to the first data() through preload(). */
	route?: RouteSnapshot;
	/** Run preload() before the detached atomic mount even without `route`. */
	preloaded?: boolean;
	/** Complete or partial caller-supplied service context. */
	ctx?: Partial<PuzzleContext>;
	store?: Store;
	router?: Router;
	models?: Record<string, any>;
	formatters?: Record<string, Formatter>;
}

export interface MountedView<T extends PuzzleView = PuzzleView> {
	readonly instance: T;
	readonly container: HTMLDivElement;
	readonly ctx: PuzzleContext;
	readonly store: Store;
	readonly router: Router;
	readonly element: Element | Comment | null;
	find(selector: string): Element | null;
	findAll(selector: string): Element[];
	click(target: string | Element): Promise<this>;
	setProps(props: any): Promise<this>;
	destroy(): void;
}

export type TestAppConfig = Omit<PuzzleAppConfig, 'target' | 'routerMode'>;

export interface TestApp {
	readonly app: PuzzleApp;
	readonly container: HTMLDivElement;
	readonly element: HTMLDivElement;
	readonly store: Store;
	readonly router: Router;
	readonly ctx: PuzzleContext | null;
	find(selector: string): Element | null;
	findAll(selector: string): Element[];
	click(target: string | Element): Promise<this>;
	visit(path: string): Promise<this>;
	destroy(): void;
}

/**
 * Mount one view/component with a minimal `{ store, router, formatters }` ctx.
 * The detached container is never appended to document.body.
 */
export declare function mountView<T extends PuzzleView>(
	ViewClass: PuzzleViewClass<T>,
	options?: MountViewOptions
): Promise<MountedView<T>>;

/**
 * Mount a real PuzzleApp into a detached element with routerMode forced to
 * `'memory'`; visit() uses the real guard/load/commit router pipeline.
 */
export declare function createTestApp(config?: TestAppConfig): Promise<TestApp>;

export interface SettledOptions {
	/**
	 * Maximum fixed-point passes before settled() diagnoses non-convergence.
	 * Must be a positive integer.
	 * @default 100
	 */
	maxPasses?: number;
}

/**
 * Drain tracked data() promises, registered Store.flush() work, scheduled view
 * renders, and tracked memory-router navigation until two stable microtask
 * passes observe no new work.
 *
 * It does not advance arbitrary user timers, resolve fetches not awaited by a
 * data()/navigation, trigger IntersectionObserver, or finish CSS/WAAPI
 * animations. A navigation awaiting a leave animation remains pending until
 * that animation is finished or cancelled by the test.
 *
 * Throws after maxPasses (default 100) when framework work does not converge.
 */
export declare function settled(options?: SettledOptions): Promise<void>;

export interface RenderProfile {
	readonly renders: number;
	readonly wastedRenders: number;
	readonly domMutations: number;
	readonly rendersByView: Readonly<Record<string, number>>;
	readonly causes: Readonly<Record<string, number>>;
	readonly maxRecursiveDepth: number;
	readonly storeNotifications: number;
}

/**
 * Measure actual ViewManager.render entries caused by callback, then drain
 * framework work with settled(). A render with no DOM writes is wasted.
 *
 * The returned report and its nested records are frozen.
 */
export declare function measureRenders(
	handle: MountedView | TestApp,
	callback: () => void | Promise<void>
): Promise<Readonly<RenderProfile>>;

export interface RecordedMethod {
	(...args: any[]): any;
	readonly calls?: any[][];
}

export interface FakeAnimation {
	readonly target: Element;
	readonly keyframes: any;
	readonly options: KeyframeAnimationOptions;
	readonly finished: Promise<FakeAnimation>;
	finishedState: 'running' | 'finished' | 'cancelled';
	playState: 'running' | 'paused' | 'finished' | 'idle';
	finish(): void;
	cancel: RecordedMethod;
	pause: RecordedMethod;
	play: RecordedMethod;
}

export interface FakeAnimateController {
	readonly animations: FakeAnimation[];
	readonly animateCalls: Array<[Element, any, KeyframeAnimationOptions]>;
	finishAll(): void;
	uninstall(): void;
}

export interface FakeAnimateOptions {
	/** Optional Vitest/Jest-shaped spy factory, e.g. `vi.fn`. */
	spy?: (implementation: (...args: any[]) => any) => RecordedMethod;
}

/**
 * Install a deferred, manually finishable Element.animate/getAnimations fake.
 * uninstall() restores the exact previous prototype properties.
 */
export declare function installFakeAnimate(
	options?: FakeAnimateOptions
): FakeAnimateController;

export interface FakeIntersectionObserver {
	readonly callback: IntersectionObserverCallback;
	readonly options: IntersectionObserverInit;
	readonly root: Element | Document | null;
	readonly rootMargin: string;
	readonly thresholds: number[];
	readonly observed: Set<Element>;
	readonly observeCalls: Array<[Element]>;
	readonly unobserveCalls: Array<[Element]>;
	disconnectCalls: number;
	disconnected: boolean;
	observe(element: Element): void;
	unobserve(element: Element): void;
	disconnect(): void;
	takeRecords(): IntersectionObserverEntry[];
}

export interface FakeObserverController {
	readonly observers: FakeIntersectionObserver[];
	trigger(element: Element, isIntersecting?: boolean): void;
	triggerAll(isIntersecting?: boolean): void;
	uninstall(): void;
}

/**
 * Install a controllable global IntersectionObserver. trigger()/triggerAll()
 * deliver entries synchronously; uninstall() restores the previous global.
 */
export declare function installFakeObserver(): FakeObserverController;

/**
 * Convenience re-export of `@magic-spells/puzzle/fixtures` (D98) — deterministic
 * `store.seed()` plus the adapter mock, attached to the core classes and detached
 * by the returned `uninstall()`. Importing this subpath also augments `Store`
 * with the two attached methods.
 */
export { installFixtures } from './fixtures.js';
export type { FixturesConfig } from './fixtures.js';
