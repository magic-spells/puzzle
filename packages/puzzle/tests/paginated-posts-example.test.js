// @vitest-environment jsdom
//
// examples/paginated-posts, end to end (D193): the example's own views,
// layout, models and fixtures file, compiled by the go compiler
// (tests/fixtures/paginated-posts/*, from `npm run build:paginated-posts`)
// and booted as a real app over the fixtures mock. green here means the
// example a reader runs with `puzzle dev --fixtures` does what its comments
// say: page links fetch one page each and reuse cached ones, publish shows its
// pending and error state and invalidates the lists, and "load more" walks
// the cursor one page at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { installFixtures } from '../client-runtime/fixtures/index.js';
import { createTestApp } from '../client-runtime/testing/index.js';
import PostList from './fixtures/paginated-posts/PostList.compiled.js';
import PostDetail from './fixtures/paginated-posts/PostDetail.compiled.js';
import Comments from './fixtures/paginated-posts/Comments.compiled.js';
import NotFound from './fixtures/paginated-posts/NotFound.compiled.js';
import DefaultLayout from './fixtures/paginated-posts/Default.compiled.js';
import models from '../examples/paginated-posts/app/models/index.js';
import fixtures from '../examples/paginated-posts/app/fixtures.js';

// the example's routes.js imports .pzl sources; these are the same four
// routes over the compiled modules.
const routes = [
	{ path: '/', view: PostList, layout: DefaultLayout },
	{ path: '/posts/:id', view: PostDetail, layout: DefaultLayout },
	{ path: '/comments', view: Comments, layout: DefaultLayout },
	{ path: '*', view: NotFound, layout: DefaultLayout },
];

/** @type {string[]} every request the mock served, as "METHOD path?query" */
let requests;
/** @type {() => void} */
let uninstall;
/** @type {any} */
let app;

beforeEach(() => {
	requests = [];
	// the example's fixtures with no latency, and a beforeRequest hook below
	// that records every request so the test can count them.
	uninstall = installFixtures({
		...fixtures,
		mock: {
			post: { ...fixtures.mock.post, latency: 0 },
			comment: { ...fixtures.mock.comment, latency: 0 },
		},
	});
});

afterEach(() => {
	app?.destroy();
	app = null;
	uninstall();
});

/**
 * boot the example at a path, the way app.js configures it
 * @param {string} path
 */
async function boot(path) {
	app = await createTestApp({
		routes,
		models,
		adapter,
		apiURL: '/api',
		routerInitialPath: path,
		beforeRequest(init, { method, url }) {
			requests.push(`${method} ${url.replace(/^\/api/, '')}`);
		},
	});
	return app;
}

/** the visible row titles */
const rowText = () => app.findAll('.rows li').map((li) => li.textContent.replace(/\s+/g, ' ').trim());

describe('examples/paginated-posts', () => {
	it('fetches one page per query and reuses a cached page on the way back', async () => {
		await boot('/');
		expect(requests).toEqual(['GET /posts?page=1']);
		expect(app.findAll('.rows li')).toHaveLength(10);
		expect(app.find('.pager').textContent).toContain('Page 1 of 5');
		// page 1 has no previous link, and a next link to page 2
		expect(app.find('.pager a').getAttribute('href')).toBe('/?page=2');

		await app.visit('/?page=2');
		expect(requests).toEqual(['GET /posts?page=1', 'GET /posts?page=2']);
		expect(rowText()[0]).toContain('part 2');
		expect(app.find('.pager').textContent).toContain('Page 2 of 5');

		// back to page 1: answered from its cached entry, no request
		await app.visit('/?page=1');
		expect(requests).toHaveLength(2);
		expect(app.findAll('.rows li')).toHaveLength(10);

		// the last page holds the remainder and has no next link
		await app.visit('/?page=5');
		expect(app.findAll('.rows li')).toHaveLength(7);
		expect([...app.findAll('.pager a')].map((a) => a.textContent)).toEqual(['Previous']);
	});

	it('shows a failed publish and keeps the button', async () => {
		// the fixtures mock refuses to publish every fifth post
		await boot('/posts/5');
		const button = app.find('button');
		expect(button.textContent.trim()).toBe('Publish');

		await app.click(button);
		// while the PUT runs, syncStatus(post).pending is 'save'
		expect(app.find('button').textContent.trim()).toBe('Publishing…');
		expect(app.find('button').disabled).toBe(true);

		// the save settles on its own clock; the alert comes from syncStatus(post).error
		await vi.waitFor(() =>
			expect(app.find('[role="alert"]')?.textContent).toBe('The server refused to publish this post.')
		);
		// the view put the field back, so Publish is still offered
		expect(app.find('button').textContent.trim()).toBe('Publish');
		expect(app.find('button').disabled).toBe(false);
	});

	it('publishes, then the list refetches its page with the new badge', async () => {
		await boot('/');
		const before = rowText().find((t) => t.startsWith('Notes on'));
		expect(app.findAll('.badge')).toHaveLength(3); // posts 3, 6, 9

		await app.visit('/posts/4');
		await app.click('button');
		await vi.waitFor(() => expect(app.find('.badge')?.textContent).toBe('Published'));
		expect(app.find('[role="alert"]')).toBeNull();
		expect(requests).toContain('PUT /posts/4');

		// invalidate('post') marked page 1 stale: showing it again refetches it
		const pageLoads = () => requests.filter((r) => r === 'GET /posts?page=1').length;
		expect(pageLoads()).toBe(1);
		await app.visit('/');
		expect(pageLoads()).toBe(2);
		expect(app.findAll('.badge')).toHaveLength(4);
		expect(rowText().find((t) => t.startsWith('Notes on'))).toBe(before);
	});

	it('walks the comment cursor one page at a time', async () => {
		await boot('/comments');
		expect(requests).toEqual(['GET /comments?limit=5']);
		expect(app.findAll('.rows li')).toHaveLength(5);
		expect(app.find('.pager').textContent).toContain('5 of 23');

		await app.click('button');
		expect(requests).toEqual(['GET /comments?limit=5', 'GET /comments?after=5&limit=5']);
		expect(app.findAll('.rows li')).toHaveLength(10);

		// walk to the end: 23 comments is five pages, and the button goes away
		for (let i = 0; i < 3; i++) await app.click('button');
		expect(app.findAll('.rows li')).toHaveLength(23);
		expect(app.find('button')).toBeNull();
		// each click fetched only the new page
		expect(requests).toHaveLength(5);
	});
});
