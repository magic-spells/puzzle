// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { ViewManager } from '../client-runtime/views/viewManager.js';
import { serialize } from '../client-runtime/ssg/serialize.js';

// An authored SVG `<text>` ELEMENT compiles to `new ViewNode('text', { x, y }, […])`
// — the same tag the runtime reserves for text-node vnodes, which codegen always
// emits as `new ViewNode('text', { value })`. `ViewNode.isText` tells them apart by
// the `value` attr, so hand-written inline SVG labels mount, patch, serialize and
// flip like any other element (DOC-SPEC §18, DOC-TEMPLATE-SYNTAX inline SVG).

const SVG_NS = 'http://www.w3.org/2000/svg';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const setup = () => {
	const container = document.createElement('div');
	document.body.appendChild(container);
	return { container, vm: new ViewManager(container) };
};

// svg > [rect, text(x,y) > "…"], the shape a hand-written chart template compiles to.
const chart = (label) =>
	h('svg', { viewBox: '0 0 40 40' }, [
		h('rect', { x: '0', y: '0', width: '10', height: '10' }),
		h('text', { x: '2', y: '30' }, [text(label)]),
	]);

describe('authored SVG <text> element (not the text-node marker)', () => {
	it('mounts as an SVG-namespace element with its attrs and label', () => {
		const { container, vm } = setup();
		vm.render(chart('AB'));

		const svg = container.firstChild;
		expect(svg.tagName.toLowerCase()).toBe('svg');
		const el = svg.querySelector('text');
		expect(el).not.toBeNull();
		expect(el.namespaceURI).toBe(SVG_NS);
		expect(el.getAttribute('x')).toBe('2');
		expect(el.getAttribute('y')).toBe('30');
		expect(el.textContent).toBe('AB');
		// The sibling element survives too — the whole node used to collapse into
		// an empty text node built from a missing attrs.value.
		expect(svg.querySelector('rect')).not.toBeNull();
	});

	it('patches the label in place on re-render', () => {
		const { container, vm } = setup();
		vm.render(chart('AB'));
		const el = container.querySelector('text');

		vm.render(chart('CD'));
		expect(container.querySelector('text')).toBe(el); // same node, patched
		expect(el.textContent).toBe('CD');
		expect(el.getAttribute('x')).toBe('2');
	});

	it('serializes as an element in the SSG output', async () => {
		expect(await serialize(chart('AB'))).toBe(
			'<svg viewBox="0 0 40 40"><rect x="0" y="0" width="10" height="10"></rect>' +
				'<text x="2" y="30">AB</text></svg>'
		);
	});

	it('still renders a value-carrying vnode as a text node, even for undefined', () => {
		const { container, vm } = setup();
		vm.render(h('p', {}, [new ViewNode('text', { value: undefined })]));
		const p = container.firstChild;
		expect(p.childNodes.length).toBe(1);
		expect(p.firstChild.nodeType).toBe(3); // Node.TEXT_NODE
		expect(p.firstChild.data).toBe('');
	});

	it('replaces cleanly when a position flips between a text node and an SVG <text>', () => {
		const { container, vm } = setup();

		// Text node first.
		vm.render(h('svg', {}, [text('hi')]));
		let svg = container.firstChild;
		expect(svg.childNodes.length).toBe(1);
		expect(svg.firstChild.nodeType).toBe(3);
		expect(svg.textContent).toBe('hi');

		// Flip to the element: a replacement, not a patch.
		vm.render(h('svg', {}, [h('text', { x: '5' }, [text('hi')])]));
		svg = container.firstChild;
		expect(svg.childNodes.length).toBe(1);
		expect(svg.firstChild.nodeType).toBe(1); // Node.ELEMENT_NODE
		expect(svg.firstChild.tagName.toLowerCase()).toBe('text');
		expect(svg.firstChild.getAttribute('x')).toBe('5');
		expect(svg.textContent).toBe('hi');

		// And back.
		vm.render(h('svg', {}, [text('bye')]));
		svg = container.firstChild;
		expect(svg.childNodes.length).toBe(1);
		expect(svg.firstChild.nodeType).toBe(3);
		expect(svg.textContent).toBe('bye');
	});
});
