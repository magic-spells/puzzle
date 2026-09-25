// @vitest-environment jsdom
//
// D173 group (b), expressions and loops: the runtime half of V1 (formatter pipes
// in attributes and block headers), V2 (`==` keeps its JavaScript meaning), V4
// (reading through a missing value prints nothing), V8 (object literals as
// formatter arguments), V12 (a non-list loops zero times; range bounds truncate)
// and V15 (a script-less component reads its props). The fixture graph is
// compiled from the neighboring .pzl sources by the build:core-semantics pretest
// script, so this proves the real compiler output, not a hand-written stand-in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormatterRegistry } from '../client-runtime/formatters.js';
import { listRows, loopItems, loopRange } from '../client-runtime/views/listBlock.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import CoreHost from './fixtures/core-semantics/CoreHost.compiled.js';

let mounted = null;

afterEach(() => {
	mounted?.destroy();
	mounted = null;
	document.body.replaceChildren();
	vi.restoreAllMocks();
});

async function mountHost() {
	const formatters = new FormatterRegistry();
	formatters.register('money', (v) => '$' + v);
	formatters.register('t', (key, vars) => `${key}:${vars.count}:${vars.unit}`);
	formatters.register('echo', (_v, opts) => JSON.stringify(opts));
	const el = document.createElement('div');
	document.body.appendChild(el);
	mounted = new CoreHost({ formatters });
	await mounted.mount(el);
	return el;
}

const text = (el, sel) => el.querySelector(sel)?.textContent.trim();

describe('D173 core semantics — compiled output', () => {
	it('renders every construct without throwing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = await mountHost();

		// V4: member and index access through a missing value print nothing.
		expect(text(el, '.deep')).toBe('');
		expect(text(el, '.index')).toBe('');
		// ...and the undefined-value dev warning still names the path.
		expect(warn.mock.calls.some(([m]) => m.includes('user.profile.name'))).toBe(true);

		// V1: a pipe in a brace-only attribute is a formatter call, not bitwise OR.
		expect(el.querySelector('.title').getAttribute('title')).toBe('$5');
		// V1: chains in {#if}, {#unless} and {#case} subjects.
		expect(el.querySelector('.has-tags')).toBeNull();
		expect(text(el, '.no-tags')).toBe('none');
		expect(text(el, '.unless')).toBe('empty');
		expect(text(el, '.case')).toBe('open');

		// V8: object literals as formatter arguments — keys stay keys, a shorthand
		// property reads the data field, nested and quoted keys survive.
		expect(text(el, '.label')).toBe('cart.count:3:items');
		expect(JSON.parse(text(el, '.nested'))).toEqual({ outer: { inner: 3 }, 'quoted-key': 'items' });

		// V2: `==` is JavaScript loose equality.
		expect(text(el, '.eq')).toBe('loose');

		// V12: a string is not a list (zero rows, a dev warning); a missing
		// collection loops zero times silently; range bounds truncate toward zero.
		expect(el.querySelectorAll('.string-loop li')).toHaveLength(0);
		expect(el.querySelectorAll('.mapped b')).toHaveLength(0);
		expect(el.querySelectorAll('.missing-loop li')).toHaveLength(0);
		expect([...el.querySelectorAll('.range li')].map((li) => li.textContent)).toEqual(['1', '2']);
		const messages = warn.mock.calls.map(([m]) => String(m));
		expect(messages.filter((m) => m.includes('not a list'))).toHaveLength(1);
		expect(messages.some((m) => m.includes('2.7 is not an integer'))).toBe(true);
		expect(messages.some((m) => m.includes('Null'))).toBe(false);

		// V15: a script-less component reads its props by name.
		expect(text(el, '.chip')).toBe('warm');
	});

	it('a two-way bind through a missing record is inert, not a stray local write', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = await mountHost();
		const input = el.querySelector('.missing-bind');
		expect(input.value).toBe('');
		input.value = 'abc';
		input.dispatchEvent(new InputEvent('input', { bubbles: true }));
		await Promise.resolve();
		const data = mounted.getData();
		// The bare-local path would have written `name` at the top level.
		expect(Object.hasOwn(data, 'name')).toBe(false);
		expect(data.profile).toBeNull();
	});

	// V10 / D168: text wrapped next to an inline element keeps one space,
	// stacked elements get none, and <pre>/<textarea> bodies keep their bytes
	// (minus the one newline HTML drops after the start tag) — in the mounted
	// DOM and in the prerendered HTML alike.
	it('applies the merged whitespace rule (V10)', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const el = await mountHost();
		expect(el.querySelector('.prose').textContent).toBe('tokens — a, b and items 3');
		const stack = el.querySelector('.stack');
		expect([...stack.childNodes].map((n) => n.nodeName)).toEqual(['BUTTON', 'BUTTON']);
		expect(el.querySelector('.pre').textContent).toBe('  indented\n    more 3\n');
		expect(el.querySelector('.ta').value).toBe('  keep\n    this');

		vi.spyOn(console, 'error').mockImplementation(() => {});
		const html = await serialize(new ViewNode(CoreHost), { ctx: { formatters: new FormatterRegistry() } });
		const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
		expect(doc.querySelector('.prose').textContent).toBe('tokens — a, b and items 3');
		expect(doc.querySelector('.pre').textContent).toBe('  indented\n    more 3\n');
		expect(doc.querySelector('.ta').value).toBe('  keep\n    this');
	});
});

describe('loop guards (D173 V12)', () => {
	it('loopItems passes a list through and empties everything else', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const list = [1, 2];
		expect(loopItems(list)).toBe(list);
		expect(loopItems(null)).toEqual([]);
		expect(loopItems(undefined)).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
		expect(loopItems('ab')).toEqual([]);
		expect(loopItems({ length: 2, 0: 'a', 1: 'b' })).toEqual([]);
		expect(loopItems(new Set([1]))).toEqual([]);
		expect(loopItems(3)).toEqual([]);
		expect(warn.mock.calls.length).toBeGreaterThan(0);
	});

	it('loopRange truncates bounds and runs a missing or non-finite range zero times', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(loopRange(1, 3)).toEqual([1, 2, 3]);
		expect(loopRange(1.9, 3.9)).toEqual([1, 2, 3]);
		expect(loopRange(-1.5, 1)).toEqual([-1, 0, 1]);
		expect(loopRange(3, 1)).toEqual([]);
		expect(loopRange(null, 3)).toEqual([]);
		expect(loopRange(1, undefined)).toEqual([]);
		expect(loopRange(1, Infinity)).toEqual([]);
		expect(loopRange(1, 'x')).toEqual([]);
	});

	it('loopRange takes a numeric-string bound (a route param) without a truncation warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(loopRange('1', '3')).toEqual([1, 2, 3]);
		expect(warn.mock.calls.some(([m]) => String(m).includes('not an integer'))).toBe(false);
		expect(loopRange(1, '2.5')).toEqual([1, 2]);
		expect(warn.mock.calls.some(([m]) => String(m).includes('"2.5" is not an integer'))).toBe(true);
	});

	it('listRows renders a missing or non-list collection as zero rows', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const view = { __rgen: 0, __dirty: 0 };
		const meta = { key: (item) => item };
		const factory = () => {
			throw new Error('no row should be built');
		};
		expect(listRows(view, view, 0, undefined, factory, meta)).toEqual([]);
		expect(listRows(view, view, 1, null, factory, meta)).toEqual([]);
		expect(listRows(view, view, 2, 'abc', factory, meta)).toEqual([]);
		expect(listRows(view, view, 3, { a: 1 }, factory, meta)).toEqual([]);
	});
});
