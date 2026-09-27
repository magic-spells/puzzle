// @vitest-environment jsdom
//
// Marker fallback bodies are built lazily (D141): a paired marker's body is
// neither evaluated nor constructed unless the position is unfilled and the
// fallback actually renders. The fixtures are compiled by the
// build:lazy-fallback pretest script — LazyRows is the VirtualList piece's row
// shape (an args-bearing marker in a lowered keyed {#for} whose fallback prints
// the whole item), so this exercises the real compiler output.
//
// The regression: 0.8's value-printing check (D173 V6) warned "object template
// value for row.item" on a VirtualList whose rows a <Snippet> filled, because
// the fallback `{ row.item }` was built for every row and then thrown away.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatterRegistry } from '../client-runtime/formatters.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SNIPPET_TAG } from '../client-runtime/views/ViewNode.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { settled } from '../client-runtime/testing/settled.js';
import LazyRows from './fixtures/lazy-fallback/LazyRows.compiled.js';
import LazyHost from './fixtures/lazy-fallback/LazyHost.compiled.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const snippet = (fits, params, fn) => new ViewNode(SNIPPET_TAG, { fits, params, fn });

const mounted = [];
const container = () => {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
};

afterEach(() => {
	for (const view of mounted.splice(0)) view.destroy();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

// `probe` counts every evaluation of the `note` fallback body, `probeName`
// every evaluation of the `name` fallback body.
function probeFormatters() {
	const probe = vi.fn((value) => `note:${value}`);
	const probeName = vi.fn((value) => `name:${value}`);
	const formatters = new FormatterRegistry();
	formatters.register('probe', probe);
	formatters.register('probeName', probeName);
	return { formatters, probe, probeName };
}

const objectWarnings = (warn) =>
	warn.mock.calls.filter(([message]) => String(message).includes('template value'));

// One stable array: the `names` rows stay clean only while their items do.
const NAMES = ['x', 'y'];

const notes = (el) => [...el.querySelectorAll('.lazy-note')].map((n) => n.textContent);
const names = (el) => [...el.querySelectorAll('.lazy-name')].map((n) => n.textContent);

describe('lazy marker fallbacks (D141)', () => {
	it('never evaluates a fallback a snippet fills — the VirtualList row shape', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { formatters, probe } = probeFormatters();
		const host = new LazyHost({ formatters });
		mounted.push(host);
		const el = container();
		await host.mount(el);

		expect([...el.querySelectorAll('.lazy-row')].map((n) => n.textContent)).toEqual([
			'0:Ada',
			'1:Grace',
		]);
		expect(el.querySelectorAll('.lazy-note-filled')).toHaveLength(2);
		expect(el.querySelector('.lazy-note')).toBeNull();
		expect(objectWarnings(warn)).toEqual([]);
		expect(probe).not.toHaveBeenCalled();

		// A re-render that re-runs data() (fresh row objects, dirty rows) stays lazy.
		await host.refresh();
		await settled();
		expect(el.querySelectorAll('.lazy-note-filled')).toHaveLength(2);
		expect(probe).not.toHaveBeenCalled();
		expect(objectWarnings(warn)).toEqual([]);
	});

	it('never evaluates a filled fallback in prerendered output either', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { formatters, probe } = probeFormatters();
		const html = await serialize(new ViewNode(LazyHost), { ctx: { formatters } });

		expect(html).toContain('<span class="lazy-row">0:Ada</span>');
		expect(html).toContain('<b class="lazy-note-filled">Grace</b>');
		expect(html).not.toContain('lazy-note"');
		expect(probe).not.toHaveBeenCalled();
		expect(objectWarnings(warn)).toEqual([]);
	});

	it('builds an unfilled fallback once per marker and reuses it for a clean cached row', async () => {
		const { formatters, probe, probeName } = probeFormatters();
		const rows = new LazyRows({ formatters });
		mounted.push(rows);
		const el = container();
		await rows.mount(el, { props: { items: ['Ada', 'Grace'], names: ['x', 'y'] }, children: [] });

		expect(notes(el)).toEqual(['note:Ada', 'note:Grace']);
		expect(el.querySelector('.lazy-rows li').firstChild.textContent).toBe('Ada');
		expect(probe).toHaveBeenCalledTimes(2);
		expect(names(el)).toEqual(['name:x', 'name:y']);
		expect(probeName).toHaveBeenCalledTimes(2);
		const firstName = el.querySelector('.lazy-name');

		// setData re-renders without re-running data(). The `rows` loop wraps each
		// item in a plain object, so the list block rebuilds those rows and their
		// fallbacks. The primitive `names` rows are clean: the block hands back the
		// same cached row vnodes, and each marker's fallback — built once, on first
		// use — keeps its vnode identity, so there is no rebuild and no DOM churn.
		rows.setData('unrelated', 1);
		rows.flushUpdates();
		expect(probe).toHaveBeenCalledTimes(4);
		expect(probeName).toHaveBeenCalledTimes(2);
		expect(el.querySelector('.lazy-name')).toBe(firstName);
		expect(names(el)).toEqual(['name:x', 'name:y']);
	});

	it('builds the fallback only for a stamp that renders nothing (D173 V14)', async () => {
		const { formatters, probe } = probeFormatters();
		const rows = new LazyRows({ formatters });
		mounted.push(rows);
		const el = container();
		await rows.mount(el, {
			props: { items: ['Ada', 'Grace'] },
			children: [
				snippet('row', ['item', 'index'], ({ item }) => [text(item)]),
				snippet('note', ['item'], ({ item }) =>
					item === 'Ada' ? [h('b', { class: 'stamped' }, [text(item)])] : []
				),
			],
		});

		expect(el.querySelector('.stamped').textContent).toBe('Ada');
		expect(notes(el)).toEqual(['note:Grace']);
		expect(probe).toHaveBeenCalledTimes(1);
		expect(probe).toHaveBeenCalledWith('Grace');
	});

	it('builds a deferred fallback when a later render leaves the position unfilled', async () => {
		const { formatters, probe, probeName } = probeFormatters();

		class Host extends PuzzleView {
			created() {
				this.setData({ filled: true });
			}
			data() {
				return { filled: this.getData().filled };
			}
			render() {
				const children = this.getData().filled
					? [
							snippet('note', ['item'], ({ item }) => [h('b', { class: 'stamped' }, [text(item)])]),
							snippet('name', ['value'], ({ value }) => [h('b', { class: 'stamped-name' }, [text(value)])]),
						]
					: [];
				return h('div', {}, [
					new ViewNode(LazyRows, { items: ['Ada', 'Grace'], names: NAMES }, children),
				]);
			}
		}

		const host = new Host({ formatters });
		mounted.push(host);
		const el = container();
		await host.mount(el);
		expect(el.querySelectorAll('.stamped')).toHaveLength(2);
		expect(el.querySelectorAll('.stamped-name')).toHaveLength(2);
		expect(probe).not.toHaveBeenCalled();
		expect(probeName).not.toHaveBeenCalled();

		// Unfilling re-renders LazyRows without re-running its data(). The `names`
		// rows are clean, so their cached markers are the ones built on the first
		// render, and each calls the fallback thunk it deferred then.
		host.setData('filled', false);
		host.flushUpdates();
		expect(el.querySelector('.stamped')).toBeNull();
		expect(notes(el)).toEqual(['note:Ada', 'note:Grace']);
		expect(probe).toHaveBeenCalledTimes(2);
		expect(names(el)).toEqual(['name:x', 'name:y']);
		expect(probeName).toHaveBeenCalledTimes(2);

		host.setData('filled', true);
		host.flushUpdates();
		expect(el.querySelectorAll('.stamped')).toHaveLength(2);
		expect(el.querySelectorAll('.stamped-name')).toHaveLength(2);
		expect(el.querySelector('.lazy-note')).toBeNull();
		expect(el.querySelector('.lazy-name')).toBeNull();
		expect(probe).toHaveBeenCalledTimes(2);
		expect(probeName).toHaveBeenCalledTimes(2);
	});
});
