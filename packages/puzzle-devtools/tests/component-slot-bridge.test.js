import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	PuzzleView,
	ViewNode,
	SLOT_TAG,
	dynamicComponent,
} from '../../puzzle/client-runtime/index.js';
import { createTestApp, settled } from '../../puzzle/client-runtime/testing/index.js';

// Drive the working-tree runtime through the extension's real protocol seam.
// No compiled panel or canned snapshot is involved in these assertions.
const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => h('text', { value });
const handles = [];
const HOOK_KEY = '__PUZZLE_DEVTOOLS_HOOK__';

function installHook() {
	const events = [];
	let handler;
	window[HOOK_KEY] = {
		emit: (message) => events.push(message),
		onRequest: (fn) => { handler = fn; },
	};
	return {
		events,
		of: (type) => events.filter((event) => event.type === type),
		request: (type, payload = {}) => handler({ puzzle: 1, v: 1, type, payload }),
	};
}

async function boot(View) {
	const handle = await createTestApp({ routes: [{ path: '/', view: View }] });
	handles.push(handle);
	return handle;
}

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	delete window[HOOK_KEY];
	vi.restoreAllMocks();
});

class Card extends PuzzleView {
	data(_params, props) { return props; }
	render() { return h('section', {}, [text(this.getData().title), h(SLOT_TAG)]); }
}
class TaskCard extends Card {}
TaskCard.__pzlModule = 'components/TaskCard.pzl';
class BacktestCard extends Card {}
BacktestCard.__pzlModule = 'components/BacktestCard.pzl';
class Badge extends Card {}
Badge.__pzlModule = 'components/Badge.pzl';

describe('Component selections through the runtime DevTools bridge', () => {
	it('snapshots a selected child and nested default-slot child, then replaces both with current props', async () => {
		const hook = installHook();
		let host;
		class Host extends PuzzleView {
			created() { host = this; this.setData({ choice: TaskCard, title: 'first' }); }
			render() {
				const { choice, title } = this.getData();
				return h('puzzle-view', {}, [
					dynamicComponent(choice, { title }, [dynamicComponent(Badge, { title: `slot ${title}` })]),
				]);
			}
		}
		Host.__pzlModule = 'views/Host.pzl';
		const app = await boot(Host);
		const before = hook.request('snapshot:views').roots;
		expect(before).toEqual([expect.objectContaining({
			name: 'Host', module: 'views/Host.pzl', children: [expect.objectContaining({
				name: 'TaskCard', module: 'components/TaskCard.pzl', children: [expect.objectContaining({
					name: 'Badge', module: 'components/Badge.pzl', children: [],
				})],
			})],
		})]);
		const oldCard = before[0].children[0];
		const oldBadge = oldCard.children[0];
		expect(hook.request('inspect:view', { id: oldCard.id }).props).toEqual({ title: 'first' });
		expect(hook.request('inspect:view', { id: oldBadge.id }).props).toEqual({ title: 'slot first' });

		host.setData({ choice: BacktestCard, title: 'second' });
		await settled();
		const after = hook.request('snapshot:views').roots;
		const card = after[0].children[0];
		const badge = card.children[0];
		expect(after[0].id).toBe(before[0].id);
		expect(after[0].children).toHaveLength(1);
		expect(card).toMatchObject({ name: 'BacktestCard', module: 'components/BacktestCard.pzl' });
		expect(card.id).not.toBe(oldCard.id);
		expect(badge).toMatchObject({ name: 'Badge', children: [] });
		expect(badge.id).not.toBe(oldBadge.id);
		expect(hook.request('inspect:view', { id: card.id }).props).toEqual({ title: 'second' });
		expect(hook.request('inspect:view', { id: badge.id }).props).toEqual({ title: 'slot second' });
		for (const old of [oldCard, oldBadge]) {
			expect(hook.of('view-destroyed').map((event) => event.payload.id)).toContain(old.id);
			expect(hook.request('inspect:view', { id: old.id })).toHaveProperty('error');
		}
		expect(app.element.textContent).toBe('secondslot second');
	});

	it('snapshots indexed-map selection and null/undefined without a synthetic Component view', async () => {
		const hook = installHook();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let host;
		const cards = { task: TaskCard, backtest: BacktestCard, empty: null };
		class MapHost extends PuzzleView {
			created() { host = this; this.setData({ key: 'task', title: 'first' }); }
			render() {
				const { key, title } = this.getData();
				return h('puzzle-view', {}, [dynamicComponent(cards[key], { title, name: 'child name', from: 'child source' })]);
			}
		}
		MapHost.__pzlModule = 'views/MapHost.pzl';
		const app = await boot(MapHost);
		const initial = hook.request('snapshot:views').roots[0];
		expect(initial.name).toBe('MapHost');
		expect(initial.children).toEqual([expect.objectContaining({ name: 'TaskCard', children: [] })]);
		const oldId = initial.children[0].id;

		host.setData({ key: 'backtest', title: 'next' });
		await settled();
		const selected = hook.request('snapshot:views').roots[0].children;
		expect(selected).toEqual([expect.objectContaining({ name: 'BacktestCard', children: [] })]);
		expect(hook.request('inspect:view', { id: selected[0].id }).props).toEqual({ title: 'next', name: 'child name', from: 'child source' });
		expect(hook.request('inspect:view', { id: oldId })).toHaveProperty('error');
		expect(hook.of('view-destroyed').map((event) => event.payload.id)).toContain(oldId);

		for (const key of ['empty', 'unknown']) {
			host.setData('key', key);
			await settled();
			expect(hook.request('snapshot:views').roots).toEqual([expect.objectContaining({ id: initial.id, children: [] })]);
			expect(app.element.textContent).toBe('');
			expect(hook.request('inspect:view', { id: selected[0].id })).toHaveProperty('error');
		}
		expect(hook.of('view-destroyed').map((event) => event.payload.id)).toContain(selected[0].id);
		expect(warn).not.toHaveBeenCalled();
	});
});
