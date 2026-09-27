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
import { ViewNode, SLOT_TAG, SNIPPET_TAG, PLACEHOLDER_TAG } from '../client-runtime/views/ViewNode.js';
import { expandSlots } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { preloadTakeoverComponents } from '../client-runtime/ssg/preload.js';
import { settled } from '../client-runtime/testing/settled.js';
import LazyRows from './fixtures/lazy-fallback/LazyRows.compiled.js';
import LazyHost from './fixtures/lazy-fallback/LazyHost.compiled.js';
import LazyCard from './fixtures/lazy-fallback/LazyCard.compiled.js';
import LazyCardHost from './fixtures/lazy-fallback/LazyCardHost.compiled.js';

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

	it('builds an unfilled compiled fallback in prerendered output', async () => {
		const { formatters, probe, probeName } = probeFormatters();
		const rows = await serialize(new ViewNode(LazyRows, { items: ['Ada', 'Grace'], names: ['x'] }), {
			ctx: { formatters },
		});
		expect(rows).toContain('<em class="lazy-note">note:Ada</em>');
		expect(rows).toContain('<em class="lazy-note">note:Grace</em>');
		expect(rows).toContain('<i class="lazy-name">name:x</i>');
		expect(probe).toHaveBeenCalledTimes(2);
		expect(probeName).toHaveBeenCalledTimes(1);

		const card = await serialize(new ViewNode(LazyCard, { label: 'L' }), { ctx: { formatters } });
		expect(card).toContain('<em class="lazy-card-fallback">note:L</em>');
		expect(probe).toHaveBeenCalledTimes(3);
	});

	it('never evaluates a fallback that plain call-site content fills', async () => {
		const { formatters, probe } = probeFormatters();
		const host = new LazyCardHost({ formatters });
		mounted.push(host);
		const el = container();
		await host.mount(el);
		expect(el.querySelector('.lazy-card-custom').textContent).toBe('Custom');
		expect(el.querySelector('.lazy-card-fallback')).toBeNull();

		const html = await serialize(new ViewNode(LazyCardHost), { ctx: { formatters } });
		expect(html).toContain('<span class="lazy-card-custom">Custom</span>');
		expect(html).not.toContain('lazy-card-fallback');
		expect(probe).not.toHaveBeenCalled();
	});

	it('shows a fallback again after it was hidden by filled content', async () => {
		const { formatters, probe } = probeFormatters();

		class Host extends PuzzleView {
			created() {
				this.setData({ custom: false });
			}
			render() {
				const children = this.getData().custom
					? [h('span', { slot: 'label', class: 'lazy-card-custom' }, [text('Custom')])]
					: [];
				return h('div', {}, [new ViewNode(LazyCard, { label: 'L' }, children)]);
			}
		}

		const host = new Host({ formatters });
		mounted.push(host);
		const el = container();
		await host.mount(el);
		expect(el.querySelector('.lazy-card-fallback').textContent).toBe('note:L');

		host.setData('custom', true);
		host.flushUpdates();
		expect(el.querySelector('.lazy-card-fallback')).toBeNull();
		expect(el.querySelector('.lazy-card-custom').textContent).toBe('Custom');
		const calls = probe.mock.calls.length;

		host.setData('custom', false);
		host.flushUpdates();
		expect(el.querySelector('.lazy-card-custom')).toBeNull();
		expect(el.querySelector('.lazy-card-fallback').textContent).toBe('note:L');
		expect(probe.mock.calls.length).toBeGreaterThan(calls);
	});

	it('keeps the marker arity constant when the fallback builds nothing', async () => {
		const { formatters } = probeFormatters();
		const host = new LazyCardHost({ formatters });
		mounted.push(host);
		const el = container();
		await host.mount(el);
		const input = el.querySelector('.lazy-card-input');
		input.value = 'typed';
		expect(el.querySelector('.lazy-tip')).toBeNull();

		// `tips` is empty, so the default marker's fallback builds nothing. The
		// false call-site {#if}'s placeholder must stay in the position, or the
		// true branch adds a node, shifts the input and remounts it.
		host.setData('show', true);
		host.flushUpdates();
		expect(el.querySelector('.lazy-card-shown')).not.toBeNull();
		expect(el.querySelector('.lazy-card-input')).toBe(input);

		host.setData('show', false);
		host.flushUpdates();
		expect(el.querySelector('.lazy-card-shown')).toBeNull();
		expect(el.querySelector('.lazy-card-input')).toBe(input);
		expect(input.value).toBe('typed');
	});

	it('runs a fallback thunk at most once per marker vnode, empty or not', () => {
		const empty = vi.fn(() => []);
		const emptyTree = h('div', {}, [new ViewNode(SLOT_TAG, { fallback: empty })]);
		const placeholder = new ViewNode(PLACEHOLDER_TAG);
		for (let i = 0; i < 2; i++) {
			const out = expandSlots(emptyTree, [placeholder]);
			expect(out.children).toEqual([placeholder]);
		}
		expect(empty).toHaveBeenCalledTimes(1);

		const body = vi.fn(() => [h('p', {}, [text('fallback')])]);
		const tree = h('div', {}, [new ViewNode(SLOT_TAG, { fallback: body })]);
		const first = expandSlots(tree, []).children[0];
		const second = expandSlots(tree, []).children[0];
		expect(body).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it('degrades one component, not the takeover, when a fallback throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		class Boom extends PuzzleView {
			render() {
				return h('div', {}, [
					new ViewNode(SLOT_TAG, {
						fallback: () => {
							throw new Error('fallback boom');
						},
					}),
				]);
			}
		}
		class Fine extends PuzzleView {
			render() {
				return h('p', {}, [text('fine')]);
			}
		}

		const boom = new ViewNode(Boom);
		const fine = new ViewNode(Fine);
		const instances = await preloadTakeoverComponents(h('main', {}, [boom, fine]), {});

		expect(boom.takeoverFailed).toBe(true);
		expect(boom.instance).toBeNull();
		expect(fine.takeoverPreloaded).toBe(true);
		expect(instances).toEqual([fine.instance]);
		expect(error).toHaveBeenCalledWith('[puzzle] child mount failed:', expect.any(Error));
		for (const instance of instances) instance.destroy();
	});
});
