// @vitest-environment jsdom
//
// examples/auth, end to end: the example's own views, layout, models, auth
// module and mock backend, with the .pzl files compiled by the go compiler
// (tests/fixtures/auth-example/*, from `npm run build:auth-example`) and
// booted the way app/app.js boots them. green here means the flow a reader
// runs with `puzzle dev --fixtures` works: the guard bounces a signed-out
// visit to the sign-in page and back, every notes request carries the bearer
// token, an expiring token is refreshed once (not once per caller), a 401
// renews and retries, a reload restores the session, and signing out leaves
// nothing of the last user behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';
import { createTestApp } from '../client-runtime/testing/index.js';
import Home from './fixtures/auth-example/Home.compiled.js';
import Login from './fixtures/auth-example/Login.compiled.js';
import Dashboard from './fixtures/auth-example/Dashboard.compiled.js';
import Account from './fixtures/auth-example/Account.compiled.js';
import NotFound from './fixtures/auth-example/NotFound.compiled.js';
import ErrorView from './fixtures/auth-example/ErrorView.compiled.js';
import DefaultLayout from './fixtures/auth-example/Default.compiled.js';
import models from '../examples/auth/app/models/index.js';
import fixtures from '../examples/auth/app/fixtures.js';
import { authorize, clearSession, guestOnly, refresh, requireAuth, restore } from '../examples/auth/app/auth.js';

// the example's routes.js imports .pzl sources; these are the same routes
// over the compiled modules, with the same names and guards.
const routes = [
	{ path: '/', name: 'home', view: Home, layout: DefaultLayout },
	{ path: '/login', name: 'login', view: Login, layout: DefaultLayout, guard: guestOnly },
	{ path: '/dashboard', name: 'dashboard', view: Dashboard, layout: DefaultLayout, guard: requireAuth },
	{ path: '/account', name: 'account', view: Account, layout: DefaultLayout, guard: requireAuth },
	{ path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout },
];

/** @type {{ line: string, auth: string | null }[]} every request the mock served */
let requests;
/** @type {() => void} */
let uninstall;
/** @type {any} */
let app;
/** @type {null | ((request: any) => any)} lets a test answer a notes request itself */
let noteOverride;

beforeEach(() => {
	requests = [];
	noteOverride = null;
	localStorage.clear();
	// the example's backend with no latency. the notes handler is wrapped so a
	// test can make the server refuse a token that still looks fresh.
	uninstall = installFixtures({
		...fixtures,
		mock: {
			session: { ...fixtures.mock.session, latency: 0 },
			note: {
				...fixtures.mock.note,
				latency: 0,
				handler: (request) => noteOverride?.(request) ?? fixtures.mock.note.handler(request),
			},
		},
	});
	// the fixtures advisory ("served by its adapter mock") is not under test
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	// drop the session too: auth.js is one module, shared by every test
	if (app) clearSession(app.store);
	app?.destroy();
	app = null;
	uninstall();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/**
 * boot the example at a path, configured the way app/app.js configures it,
 * plus a second hook that records each request after authorize() ran.
 * @param {string} path
 */
async function boot(path) {
	app = await createTestApp({
		routes,
		models,
		adapter,
		apiURL: '/api',
		routerInitialPath: path,
		errorView: ErrorView,
		// app.js's onError: a 401 is the error view's to handle, not a bug
		onError(error) {
			if (error?.status !== 401) console.error(error);
		},
		async beforeMount(instance) {
			await restore(instance.store);
		},
		beforeRequest(init, context) {
			const sent = authorize(init, context) ?? init;
			requests.push({
				line: `${context.method} ${context.url.replace(/^\/api/, '')}`,
				auth: sent.headers?.Authorization ?? null,
			});
			return sent;
		},
	});
	return app;
}

/** the request lines, in order */
const lines = () => requests.map((r) => r.line);

/** the router's committed path */
const currentPath = () => app.router.current.path;

/**
 * fill in the sign-in form and submit it, then wait for wherever it goes
 * @param {string} email
 * @param {string} password
 */
async function signInWith(email, password) {
	await app.type('input[name="email"]', email);
	await app.type('input[name="password"]', password);
	await app.click('button[type="submit"]');
}

describe('examples/auth', () => {
	it('sends a signed-out visit to the sign-in page, then back after signing in', async () => {
		await boot('/dashboard');
		// the guard ran before the page was built, so no notes request went out
		expect(currentPath()).toBe('/login?redirect=%2Fdashboard');
		expect(lines()).toEqual([]);
		expect(app.find('header').textContent).toContain('Sign in');

		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));

		// login went out without a bearer, the notes read with one
		expect(lines()).toEqual(['POST /auth/login', 'GET /notes']);
		expect(requests[0].auth).toBeNull();
		expect(requests[1].auth).toMatch(/^Bearer access\./);
		// the layout read the session record, so the header changed on its own
		expect(app.find('header').textContent).toContain('Ada Lovelace');
		expect(app.find('header').textContent).toContain('Sign out');
	});

	it('shows a wrong password under the password field and stays put', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'nope');
		await vi.waitFor(() => expect(app.find('form').textContent).toContain('Wrong email or password.'));
		expect(currentPath()).toBe('/login');
		expect(localStorage.length).toBe(0);
	});

	it('validates before sending anything', async () => {
		await boot('/login');
		await app.click('button[type="submit"]');
		expect(app.find('form').textContent).toContain('Enter your email.');
		expect(app.find('form').textContent).toContain('Enter your password.');
		expect(lines()).toEqual([]);
	});

	it('ignores a redirect that leaves the app', async () => {
		await boot('/login?redirect=%2F%2Fevil.example');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));
	});

	it('refreshes an expiring token in the guard, once for every caller', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		const firstToken = requests.at(-1).auth;

		// 25 seconds on: inside the 10 second window before the 30 second token ends
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 25_000);

		// two refreshes asked for at once share one request
		await Promise.all([refresh(app.store), refresh(app.store)]);
		expect(lines().filter((l) => l === 'POST /auth/refresh')).toHaveLength(1);

		// and once more: the next protected navigation renews before it loads
		vi.setSystemTime(Date.now() + 25_000);
		await app.visit('/account');
		expect(currentPath()).toBe('/account');
		expect(lines().filter((l) => l === 'POST /auth/refresh')).toHaveLength(2);
		expect(app.find('.name').textContent).toBe('Ada Lovelace');

		// a note saved now carries the newest token, not the first one
		await app.visit('/dashboard');
		await app.type('input[aria-label="New note"]', 'Check the refresh');
		await app.click('button[type="submit"]');
		await vi.waitFor(() => expect(lines()).toContain('POST /notes'));
		const post = requests.find((r) => r.line === 'POST /notes');
		expect(post.auth).toMatch(/^Bearer access\./);
		expect(post.auth).not.toBe(firstToken);
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(3));
	});

	it('renews and retries when the server refuses a token that looked fresh', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));

		// the server revokes the access token: the next notes read gets a 401
		let refused = 0;
		noteOverride = (request) => {
			if (request.method !== 'GET' || refused > 0) return undefined;
			refused++;
			return { status: 401, body: { error: 'Your session has expired.' } };
		};
		app.store.invalidate('note');

		// the error view takes the page's place, refreshes, and retries it
		await vi.waitFor(() => expect(lines().filter((l) => l === 'POST /auth/refresh')).toHaveLength(1));
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		expect(refused).toBe(1);
		expect(app.find('[role="alert"]')).toBeNull();
	});

	it('offers Try again when a load fails for another reason, and it loads the page', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));

		// the server fails the next notes read with a 500, not a 401
		vi.spyOn(console, 'error').mockImplementation(() => {});
		noteOverride = (request) => (request.method === 'GET' ? { status: 500, body: { error: 'Down.' } } : undefined);
		app.store.invalidate('note');
		const tryAgain = await vi.waitFor(() => {
			const button = [...app.findAll('button')].find((b) => b.textContent.includes('Try again'));
			expect(button).toBeTruthy();
			return button;
		});

		// the server is back: the button loads the page again
		noteOverride = null;
		await app.click(tryAgain);
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		expect(app.container.textContent).not.toContain('Try again');
	});

	it('renews and retries a page whose first load gets a 401', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));

		// a reload, and the server refuses the first notes read: a revoked token
		app.destroy();
		const saved = localStorage.getItem('puzzle-auth-example');
		clearSession(app.store);
		localStorage.setItem('puzzle-auth-example', saved);
		let refused = 0;
		noteOverride = (r) => (r.method === 'GET' && !refused++ ? { status: 401, body: { error: 'revoked' } } : undefined);
		await boot('/dashboard');

		// the error view takes the page's place, renews, and loads it, layout and all
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		expect(app.find('header').textContent).toContain('Ada Lovelace');
	});

	it('offers Try again when a first load fails for another reason, and it loads the page', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));

		// a reload while the server fails every notes read with a 500
		app.destroy();
		const saved = localStorage.getItem('puzzle-auth-example');
		clearSession(app.store);
		localStorage.setItem('puzzle-auth-example', saved);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		noteOverride = (r) => (r.method === 'GET' ? { status: 500, body: { error: 'Down.' } } : undefined);
		await boot('/dashboard');
		const tryAgain = await vi.waitFor(() => {
			const button = [...app.findAll('button')].find((b) => b.textContent.includes('Try again'));
			expect(button).toBeTruthy();
			return button;
		});
		// the error view stands in for the layout too
		expect(app.find('header')).toBeNull();

		// the server is back: the button loads the page, layout and all
		noteOverride = null;
		await app.click(tryAgain);
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		expect(app.find('header').textContent).toContain('Ada Lovelace');
	});

	it('sends you to sign in again when the refresh token is refused too', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));

		// a day and a minute on: both tokens are dead
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 60_000);

		await app.visit('/account');
		expect(currentPath()).toBe('/login?redirect=%2Faccount');
		expect(app.store.findOne('session', 'current')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('restores a saved session on the next boot, with no sign-in', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));

		// a reload: a new app (the module keeps nothing that a reload would)
		app.destroy();
		const saved = localStorage.getItem('puzzle-auth-example');
		clearSession(app.store);
		localStorage.setItem('puzzle-auth-example', saved);
		requests = [];

		await boot('/dashboard');
		// beforeMount traded the saved refresh token before the guard ran
		expect(lines()[0]).toBe('POST /auth/refresh');
		expect(currentPath()).toBe('/dashboard');
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		expect(app.find('header').textContent).toContain('Ada Lovelace');
	});

	it('signs out, revokes the refresh token, and keeps nothing for the next user', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(2));
		const saved = JSON.parse(localStorage.getItem('puzzle-auth-example'));

		const signOut = [...app.findAll('header button')].find((b) => b.textContent.includes('Sign out'));
		await app.click(signOut);
		await vi.waitFor(() => expect(lines()).toContain('POST /auth/logout'));

		// left the protected page, dropped the session, the storage and the notes
		expect(currentPath()).toBe('/');
		expect(app.find('header').textContent).toContain('Sign in');
		expect(app.store.findOne('session', 'current')).toBeNull();
		expect(app.store.findMany('note')).toHaveLength(0);
		expect(localStorage.length).toBe(0);

		// the revoked refresh token no longer works on the server
		await expect(app.store.adapter('session').refresh(saved.refreshToken)).rejects.toMatchObject({ status: 401 });

		// the next user fetches their own notes, not a cached copy of the last
		await app.visit('/login');
		await signInWith('grace@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));
		await vi.waitFor(() => expect(app.findAll('.notes li')).toHaveLength(1));
		expect(app.find('.notes').textContent).toContain('Find the moth');
		expect(lines().filter((l) => l === 'GET /notes')).toHaveLength(2);
	});

	it('keeps a signed-in user off the sign-in page', async () => {
		await boot('/login');
		await signInWith('ada@example.com', 'puzzle');
		await vi.waitFor(() => expect(currentPath()).toBe('/dashboard'));
		await app.visit('/login');
		expect(currentPath()).toBe('/dashboard');
	});
});
