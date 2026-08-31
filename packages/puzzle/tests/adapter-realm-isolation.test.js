// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PuzzleApp } from '../client-runtime/app.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { Puzzle, PuzzleModel } from '../client-runtime/model.js';
import { adapter } from '../client-runtime/datastore/adapter.js';
import { memoryRouter } from '../client-runtime/router/modes.js';

// D157/D161 realm boundary: `adapter.install()` copies the settle/fault methods
// onto the shared prototypes ONCE per realm, so an app that mounted with the
// capability leaves them there for every app mounted afterwards. The seam that
// decides whether a view settles behind fetches must therefore be the CURRENT
// store's capability, not method presence on the prototype — otherwise a second
// app that deliberately shipped no adapter still faults reads it opted out of.

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const API = 'https://x.test';

class Post extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		title: Puzzle.string().required(),
	};
	static adapter = { endpoint: '/api/posts' };
}

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: 'OK',
	text: async () => JSON.stringify(body),
	json: async () => body,
});

const container = (id) => {
	const el = document.createElement('div');
	el.id = id;
	document.body.appendChild(el);
	return el;
};

let apps = [];
let fetchMock;

beforeEach(() => {
	document.body.innerHTML = '';
	apps = [];
	fetchMock = vi.fn(async () => json({ id: 'p1', title: 'From the server' }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
	for (const app of apps) await app.unmount?.();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('adapter install does not leak into a later no-adapter app', () => {
	it('keeps the second app on the single-evaluation local path', async () => {
		// App ONE mounts WITH the capability, which installs the adapter methods on
		// Store/PuzzleModel/PuzzleView prototypes for the rest of this realm.
		const serverRuns = [];
		class ServerView extends PuzzleView {
			data() {
				serverRuns.push('data');
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				return h('puzzle-view', { class: 'server' }, [
					text(this.getData().post?.title ?? 'MISSING'),
				]);
			}
		}
		const first = new PuzzleApp({
			target: '#app-one',
			routes: [{ path: '/', name: 'one', view: ServerView }],
			models: { post: Post },
			apiURL: API,
			adapter,
			routerMode: memoryRouter(),
		});
		container('app-one');
		apps.push(first);
		await first.mount();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(document.querySelector('.server').textContent).toBe('From the server');

		await first.unmount();
		fetchMock.mockClear();

		// App TWO mounts with NO adapter capability. Its model still declares
		// adapter metadata (app.js warns about that in dev), but the app opted out:
		// data() must evaluate exactly once, against local records only.
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const localRuns = [];
		class LocalView extends PuzzleView {
			data() {
				localRuns.push('data');
				return { post: this.ctx.store.findOne('post', 'p1') };
			}
			render() {
				return h('puzzle-view', { class: 'local' }, [
					text(this.getData().post?.title ?? 'MISSING'),
				]);
			}
		}
		const second = new PuzzleApp({
			target: '#app-two',
			routes: [{ path: '/', name: 'two', view: LocalView }],
			models: { post: Post },
			apiURL: API,
			routerMode: memoryRouter(),
		});
		container('app-two');
		apps.push(second);
		await second.mount();

		expect(localRuns).toEqual(['data']);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(document.querySelector('.local').textContent).toBe('MISSING');
		expect(second.store._requests).toBe(null);
		warn.mockRestore();
	});

	it('leaves the no-adapter store unable to fault even when handed a request map', async () => {
		// Defense in depth for the store half of the seam: the prototypes carry the
		// fault methods for the whole realm, so a store built without the capability
		// must refuse to record faults even if a settle-shaped evaluation runs over it.
		const { Store } = await import('../client-runtime/datastore/store.js');
		const store = new Store({ post: Post }, { apiURL: API });
		const requests = new Map();
		const seen = store.withTracking({}, () => store.findOne('post', 'p1'), false, {}, requests);

		expect(seen).toBe(null);
		expect(requests.size).toBe(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
