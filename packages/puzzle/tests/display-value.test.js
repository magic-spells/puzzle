// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { displayValue } from '../client-runtime/index.js';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

function renderInterpolationShapes(value, label) {
	const container = document.createElement('div');
	const vm = new ViewManager(container);
	vm.render(h('section', {
		title: `${displayValue(value, `${label}.quoted`)}`,
		'data-quoted': `${displayValue(value, `${label}.dataQuoted`)}`,
		'data-brace': value,
	}, [
		h('span', { class: 'bare' }, [text(displayValue(value, `${label}.bare`))]),
		h('span', { class: 'concat' }, [text('Hello ' + displayValue(value, `${label}.concat`) + '!')]),
		h('input', {
			class: 'quoted',
			value: `${displayValue(value, `${label}.quotedValue`)}`,
		}),
		h('input', { class: 'brace', value }),
	]));
	return container;
}

describe('displayValue', () => {
	it('uses nullish rather than falsy semantics', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(displayValue(null, 'nullish-semantics.null')).toBe('');
			expect(displayValue(undefined, 'nullish-semantics.undefined')).toBe('');
			expect(displayValue(0, 'nullish-semantics.zero')).toBe('0');
			expect(displayValue(false, 'nullish-semantics.false')).toBe('false');
			expect(displayValue('', 'nullish-semantics.empty')).toBe('');
			expect(displayValue(NaN, 'nullish-semantics.nan')).toBe('');
			expect(displayValue({ ok: true }, 'nullish-semantics.object')).toBe('');
		} finally {
			warn.mockRestore();
		}
	});

	it('warns exactly once for undefined in development and never for null', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			displayValue(undefined, 'warning-once.missing');
			displayValue(undefined, 'warning-once.missing');
			displayValue(null, 'warning-once.null');

			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "warning-once.missing"; rendering an empty string'
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('renders null and undefined empty in bare, concatenated, quoted, and brace-only forms', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (const [label, value] of [['null', null], ['undefined', undefined]]) {
				const container = renderInterpolationShapes(value, `all-shapes.${label}`);

				expect(container.querySelector('.bare').textContent).toBe('');
				expect(container.querySelector('.concat').textContent).toBe('Hello !');
				expect(container.querySelector('section').getAttribute('title')).toBe('');
				expect(container.querySelector('section').getAttribute('data-quoted') ?? '').toBe('');
				expect(container.querySelector('section').getAttribute('data-brace') ?? '').toBe('');
				expect(container.querySelector('.quoted').value).toBe('');
				expect(container.querySelector('.brace').value).toBe('');
			}
		} finally {
			warn.mockRestore();
		}
	});

	it('keeps quoted and brace-only controlled attributes identical for nullish values', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (const [label, value] of [['null', null], ['undefined', undefined]]) {
				const container = renderInterpolationShapes(value, `attribute-parity.${label}`);
				const section = container.querySelector('section');
				expect(section.getAttribute('data-quoted') ?? '').toBe(
					section.getAttribute('data-brace') ?? ''
				);
				expect(container.querySelector('.quoted').value).toBe(
					container.querySelector('.brace').value
				);
			}
		} finally {
			warn.mockRestore();
		}
	});

	it('keeps browser and SSG nullish text/value coercion aligned', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			for (const value of [null, undefined]) {
				const tree = h('div', {}, [
					text(value),
					h('input', { value }),
				]);
				expect(await serialize(tree)).toBe('<div><input value=""></div>');
			}
		} finally {
			warn.mockRestore();
		}
	});

	// setAttr's nullish branch calls the display helper and DISCARDS the result —
	// the call exists solely for this warning, so it now sits behind the
	// __PUZZLE_DEV__ probe. These two lock the behavior the probe must preserve.
	//
	// Fresh module graph: display.js's warned-once set is module state, and an
	// earlier test in this file may already have spent this attribute's key.
	// Without the reset these would silently pass on a suppressed warning.
	it('still warns for an undefined attribute value on the removal path', async () => {
		vi.resetModules();
		const [{ ViewNode: Node }, { ViewManager: Manager }] = await Promise.all([
			import('../client-runtime/views/ViewNode.js'),
			import('../client-runtime/views/viewManager.js'),
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const container = document.createElement('div');
			new Manager(container).render(new Node('section', { 'data-missing': undefined }, []));

			const section = container.querySelector('section');
			expect(section.hasAttribute('data-missing')).toBe(false);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "data-missing"; rendering an empty string'
			);
		} finally {
			warn.mockRestore();
		}
	});

	// The probes call the display helper with no label, so every unlabeled warning
	// collapsed into the '' dedup key and only the FIRST brace-only undefined in a
	// whole session ever warned. Both sites have the attribute name in scope.
	it('dedups the undefined-attribute warning PER ATTRIBUTE and names each one', async () => {
		vi.resetModules();
		const [{ ViewNode: Node }, { ViewManager: Manager }] = await Promise.all([
			import('../client-runtime/views/ViewNode.js'),
			import('../client-runtime/views/viewManager.js'),
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const container = document.createElement('div');
			new Manager(container).render(
				new Node('section', { 'data-one': undefined, 'data-two': undefined }, [])
			);

			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "data-one"; rendering an empty string'
			);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "data-two"; rendering an empty string'
			);
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	it('names the attribute in the SSG serializer warning too', async () => {
		vi.resetModules();
		const [{ ViewNode: Node }, { serialize: serializeFresh }] = await Promise.all([
			import('../client-runtime/views/ViewNode.js'),
			import('../client-runtime/ssg/serialize.js'),
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			await serializeFresh(new Node('section', { 'data-alpha': undefined, 'data-beta': undefined }, []));

			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "data-alpha"; rendering an empty string'
			);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] undefined template value for "data-beta"; rendering an empty string'
			);
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	it('stays silent when a null attribute is removed', async () => {
		vi.resetModules();
		const [{ ViewNode: Node }, { ViewManager: Manager }] = await Promise.all([
			import('../client-runtime/views/ViewNode.js'),
			import('../client-runtime/views/viewManager.js'),
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const container = document.createElement('div');
			new Manager(container).render(new Node('section', { 'data-empty': null }, []));

			expect(container.querySelector('section').hasAttribute('data-empty')).toBe(false);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it('has both runtime stringify adapters delegate to the shared helper', () => {
		// Both rename the import instead of wrapping it — a pure alias wrapper was
		// one call per interpolation for nothing.
		const paths = ['client-runtime/views/viewManager.js', 'client-runtime/ssg/serialize.js'];
		for (const path of paths) {
			const source = readFileSync(path, 'utf8');
			expect(source).toContain("import { displayValue as stringify } from '../display.js';");
			expect(source).not.toContain("return v == null ? '' : String(v);");
		}
	});
});

// D173 V6 — one printing rule for every text position, browser and SSG alike.
describe('value printing (D173 V6)', () => {
	it('prints numbers by Number::toString and non-finite numbers as nothing', () => {
		expect(displayValue(0)).toBe('0');
		expect(displayValue(-0)).toBe('0');
		expect(displayValue(1.5)).toBe('1.5');
		expect(displayValue(0.1 + 0.2)).toBe('0.30000000000000004');
		expect(displayValue(1e21)).toBe('1e+21');
		expect(displayValue(123456789012345680000)).toBe('123456789012345680000');
		expect(displayValue(1e-7)).toBe('1e-7');
		expect(displayValue(0.000001)).toBe('0.000001');
		expect(displayValue(NaN)).toBe('');
		expect(displayValue(Infinity)).toBe('');
		expect(displayValue(-Infinity)).toBe('');
	});

	it('prints booleans, strings and lists; a list joins its items with commas by the same rule', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(displayValue(true)).toBe('true');
			expect(displayValue(false)).toBe('false');
			expect(displayValue('x')).toBe('x');
			expect(displayValue([1, 'a', true])).toBe('1,a,true');
			expect(displayValue([1, null, NaN, [2, 3], { a: 1 }], 'v6.list')).toBe('1,,,2,3,');
			expect(displayValue([])).toBe('');
		} finally {
			warn.mockRestore();
		}
	});

	it('prints an object as nothing and warns once per expression in development', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(displayValue({ ok: true }, 'v6.object')).toBe('');
			expect(displayValue(new Date(0), 'v6.object')).toBe('');
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] object template value for "v6.object"; rendering nothing — format it or print one of its fields'
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('renders and serializes non-finite numbers and objects as empty text', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const tree = () => h('p', {}, [text(NaN), text(Infinity), text({ a: 1 }), text([1, 2])]);
			const container = document.createElement('div');
			new ViewManager(container).render(tree());
			expect(container.querySelector('p').textContent).toBe('1,2');
			expect(await serialize(tree())).toBe('<p>1,2</p>');
		} finally {
			warn.mockRestore();
		}
	});
});

// D173 V9 — a list or object in a brace-only attribute.
describe('list and object attribute values (D173 V9)', () => {
	const tree = () =>
		h('div', {
			class: ['card', 'is-active', null, 3],
			'data-obj': { a: 1 },
			'data-nan': NaN,
			'data-empty-list': [],
		}, [h('input', { value: ['a', 'b'] })]);

	it('joins a list with spaces and omits an object attribute, browser and SSG alike', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const container = document.createElement('div');
			new ViewManager(container).render(tree());
			const div = container.firstElementChild;
			expect(div.getAttribute('class')).toBe('card is-active  3');
			expect(div.hasAttribute('data-obj')).toBe(false);
			expect(div.getAttribute('data-nan')).toBe('');
			expect(div.getAttribute('data-empty-list')).toBe('');
			expect(container.querySelector('input').value).toBe('a b');

			expect(await serialize(tree())).toBe(
				'<div class="card is-active  3" data-nan="" data-empty-list=""><input value="a b"></div>'
			);
		} finally {
			warn.mockRestore();
		}
	});

	it('removes a previously written attribute when its value becomes an object, and warns in development', async () => {
		vi.resetModules();
		const [{ ViewNode: Node }, { ViewManager: Manager }] = await Promise.all([
			import('../client-runtime/views/ViewNode.js'),
			import('../client-runtime/views/viewManager.js'),
		]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const container = document.createElement('div');
			const vm = new Manager(container);
			vm.render(new Node('section', { 'data-x': ['a', 'b'] }, []));
			expect(container.querySelector('section').getAttribute('data-x')).toBe('a b');
			vm.render(new Node('section', { 'data-x': { a: 1 } }, []));
			expect(container.querySelector('section').hasAttribute('data-x')).toBe(false);
			expect(warn).toHaveBeenCalledWith(
				'[puzzle] object template value for "data-x"; rendering nothing — format it or print one of its fields'
			);
		} finally {
			warn.mockRestore();
		}
	});
});
