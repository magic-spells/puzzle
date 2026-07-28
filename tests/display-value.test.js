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
			expect(displayValue(NaN, 'nullish-semantics.nan')).toBe('NaN');
			expect(displayValue({ ok: true }, 'nullish-semantics.object')).toBe('[object Object]');
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
