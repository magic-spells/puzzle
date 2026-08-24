// @vitest-environment jsdom
//
// D145/D146 — a REUSED view whose render throws during the prepared commit must
// be contained by the same error funnel every other refresh() caller uses. The
// throw happens inside the router's synchronous commit window (after
// #commitLocation), so leaving it bare moved the URL and router.current while the
// DOM still showed the previous record, rejected push() with a raw TypeError, and
// mounted no error view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, settled } from '../client-runtime/testing/index.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { SLOT_TAG, ViewNode } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const slot = () => new ViewNode(SLOT_TAG);

const apps = [];

afterEach(() => {
	for (const app of apps.splice(0)) app.destroy();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function flush() {
	for (let i = 0; i < 4; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
		await settled();
	}
}

class AppError extends PuzzleView {
	render() {
		return h('section', { class: 'app-error' }, [
			h('span', { class: 'message' }, [text(this.props.error.message)]),
		]);
	}
}

// The list→detail→detail shape: one route node, so the whole chain is REUSED
// across an id change and every level goes through prepareRefresh/commit.
const USERS = { 1: { name: 'ONE' }, 2: { name: 'TWO' } };

describe('prepared-commit render failures reach the D145 funnel', () => {
	it('a reused LEAF whose render throws on commit does not reject push()', async () => {
		const errors = [];
		class User extends PuzzleView {
			data(params) {
				return { user: USERS[params.id] ?? null };
			}
			render() {
				// Null-deref exactly like `{ user.name }` compiles to.
				return h('puzzle-view', { class: 'user' }, [text(this.getData().user.name)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/users/:id', view: User }],
			routerInitialPath: '/users/1',
			errorView: AppError,
			onError: (error, info) => errors.push({ error, info }),
		});
		apps.push(app);
		await flush();
		expect(app.find('.user').textContent).toBe('ONE');

		await expect(app.router.push('/users/999')).resolves.not.toThrow();
		await flush();

		// Contained: reported once through the funnel, the app error view holds the
		// failed position, and the stale record is gone from the DOM.
		expect(errors).toHaveLength(1);
		expect(errors[0].info.phase).toBe('refresh');
		expect(app.find('.app-error')).not.toBeNull();
		expect(app.find('.user')).toBeNull();
		expect(app.router.current.path).toBe('/users/999');
	});

	it('a throwing reused LEAF leaves the reused ancestor fully committed', async () => {
		const errors = [];
		let shell = null;

		class Shell extends PuzzleView {
			created() {
				shell = this;
			}
			data(params) {
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'shell' }, [
					h('h1', {}, [text(this.getData().id)]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Inner extends PuzzleView {
			data(params) {
				return { user: USERS[params.id] ?? null };
			}
			render() {
				return h('puzzle-view', { class: 'inner' }, [text(this.getData().user.name)]);
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/users/:id', view: Shell, children: [{ path: 'detail', view: Inner }] },
			],
			routerInitialPath: '/users/1/detail',
			errorView: AppError,
			onError: (error, info) => errors.push({ error, info }),
		});
		apps.push(app);
		await flush();
		expect(app.find('.inner').textContent).toBe('ONE');

		await expect(app.router.push('/users/999/detail')).resolves.not.toThrow();
		await flush();

		// The ancestor committed before the leaf threw, and the leaf's containment
		// replaced only ITS position — the ancestor keeps its destination params and
		// its rendered DOM instead of being left half-committed by an escaping throw.
		expect(errors).toHaveLength(1);
		expect(shell.isDestroyed).toBe(false);
		expect(shell.params.id).toBe('999');
		expect(app.find('.shell h1').textContent).toBe('999');
		// The error face occupies the LEAF's exact position — inside the ancestor's
		// outlet, where the failed view was — not the root.
		expect(app.find('.shell section .app-error')).not.toBeNull();
		expect(app.find('.inner')).toBeNull();
		expect(app.router.current.path).toBe('/users/999/detail');

		// __failedView marked the chain invalid, so the next navigation rebuilds it
		// rather than reusing the torn-down position.
		await expect(app.router.push('/users/2/detail')).resolves.not.toThrow();
		await flush();
		expect(app.find('.inner').textContent).toBe('TWO');
		expect(app.find('.app-error')).toBeNull();
	});

	it('a throwing onError hook cannot escape the commit either', async () => {
		// Why the router's `for (const p of next.prepared) p.commit()` loop needs no
		// guard of its own: the funnel this arm now routes through cannot throw
		// synchronously. reportError contains a throwing user hook, and
		// __showErrorView is async, so anything failing inside it becomes a rejected
		// promise rather than an exception in the router's commit window.
		class User extends PuzzleView {
			data(params) {
				return { user: USERS[params.id] ?? null };
			}
			render() {
				return h('puzzle-view', { class: 'user' }, [text(this.getData().user.name)]);
			}
		}

		const app = await createTestApp({
			routes: [{ path: '/users/:id', view: User }],
			routerInitialPath: '/users/1',
			errorView: AppError,
			onError() {
				throw new Error('the app error hook is broken too');
			},
		});
		apps.push(app);
		await flush();

		await expect(app.router.push('/users/999')).resolves.not.toThrow();
		await flush();
		expect(app.router.current.path).toBe('/users/999');
		expect(app.find('.app-error')).not.toBeNull();
	});

	it('a throwing reused ANCESTOR replaces its whole subtree and still resolves', async () => {
		const errors = [];
		let leaf = null;

		class Shell extends PuzzleView {
			data(params) {
				return { user: USERS[params.id] ?? null };
			}
			render() {
				return h('puzzle-view', { class: 'shell' }, [
					h('h1', {}, [text(this.getData().user.name)]),
					h('section', {}, [slot()]),
				]);
			}
		}
		class Inner extends PuzzleView {
			created() {
				leaf = this;
			}
			data(params) {
				return { id: params.id };
			}
			render() {
				return h('puzzle-view', { class: 'inner' }, [text(this.getData().id)]);
			}
		}

		const app = await createTestApp({
			routes: [
				{ path: '/users/:id', view: Shell, children: [{ path: 'detail', view: Inner }] },
			],
			routerInitialPath: '/users/1/detail',
			errorView: AppError,
			onError: (error, info) => errors.push({ error, info }),
		});
		apps.push(app);
		await flush();
		expect(app.find('.inner').textContent).toBe('1');

		await expect(app.router.push('/users/999/detail')).resolves.not.toThrow();
		await flush();

		// __showErrorView destroys the failed ancestor, which takes the descendant
		// with it — the error view owns the whole position. The point is that the
		// commit loop RAN to completion: the descendant's prepared handle settled
		// (its subscription hold unwound) instead of the throw aborting the loop.
		expect(errors).toHaveLength(1);
		expect(leaf.isDestroyed).toBe(true);
		expect(app.find('.app-error')).not.toBeNull();
		expect(app.find('.inner')).toBeNull();
	});
});
