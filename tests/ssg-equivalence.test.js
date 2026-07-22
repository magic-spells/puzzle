// @vitest-environment jsdom
//
// SSG serializer ⟷ ViewManager equivalence (M1). For representative ViewNode
// trees, the pure serializer's output must render the SAME markup as the real
// ViewManager mounting the identical tree under jsdom. This is the regression net
// against serializer/ViewManager drift (DOC plan risk).
//
// Normalization: the ViewManager's live `container.innerHTML` is already canonical
// browser markup; the serializer's STRING is round-tripped through a jsdom element
// (canon) so equivalent-but-differently-spelled forms line up — notably bare
// boolean attrs (`disabled`) canonicalize to `disabled=""` on both sides.
//
// Principled difference (documented, deliberately not asserted-equal):
// controlled form values serialize as HTML initial-state markup, while the
// ViewManager assigns live properties. The equivalence trees therefore avoid
// controlled `value`; serialize's value handling is covered in the goldens.
import { describe, it, expect } from 'vitest';
import { serialize } from '../client-runtime/ssg/serialize.js';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode, SLOT_TAG } from '../client-runtime/views/ViewNode.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });
const comp = (Class, props = {}, children = []) => new ViewNode(Class, props, children);
const slot = () => new ViewNode(SLOT_TAG);
const namedSlot = (name, fallback = []) => new ViewNode(SLOT_TAG, { name }, fallback);
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Round-trip a serialized string through jsdom to canonical browser markup. */
function canon(html) {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d.innerHTML;
}

/** Mount a render tree via the REAL ViewManager and return its innerHTML. */
async function mountTree(tree) {
	class V extends PuzzleView {
		render() {
			return tree;
		}
	}
	const el = document.createElement('div');
	document.body.appendChild(el);
	await new V().mount(el);
	await tick(); // let async child-component mounts settle
	return el.innerHTML;
}

async function assertEquivalent(tree) {
	const mounted = await mountTree(tree);
	const serialized = canon(await serialize(tree));
	expect(serialized).toBe(mounted);
	return mounted;
}

describe('SSG serializer ⟷ ViewManager equivalence (M1)', () => {
	it('text with entities', async () => {
		await assertEquivalent(h('p', {}, [text('a < b & c > "quote"')]));
	});

	it('nested elements with classes and attributes', async () => {
		await assertEquivalent(
			h('div', { class: 'card', 'data-id': '7' }, [
				h('h2', { class: 'title' }, [text('Hello')]),
				h('ul', {}, [
					h('li', {}, [text('one')]),
					h('li', {}, [text('two')]),
				]),
			])
		);
	});

	it('boolean attributes (bare ⟷ ="")', async () => {
		await assertEquivalent(
			h('fieldset', {}, [
				h('button', { disabled: true }, [text('off')]),
				h('button', { disabled: false }, [text('on')]),
			])
		);
	});

	it('void elements', async () => {
		await assertEquivalent(
			h('div', {}, [h('img', { src: 'a.png', alt: 'A' }), h('br'), h('hr', { class: 'sep' })])
		);
	});

	it('scoped-style data attribute passthrough', async () => {
		await assertEquivalent(h('section', { 'data-v-hash7': true, class: 'scoped' }, [text('x')]));
	});

	it('named + default slots with fallbacks', async () => {
		class Card extends PuzzleView {
			render() {
				return h('div', { class: 'card' }, [
					h('header', {}, [namedSlot('header', [text('Untitled')])]),
					h('div', { class: 'body' }, [slot()]),
					h('footer', {}, [namedSlot('footer')]),
				]);
			}
		}
		// one region filled, one falling back
		await assertEquivalent(
			h('main', {}, [
				comp(Card, {}, [h('h2', { slot: 'header' }, [text('Title')]), h('p', {}, [text('body')])]),
			])
		);
	});

	it('nested components with preloaded data', async () => {
		class Badge extends PuzzleView {
			data(params, props) {
				return { n: props.count };
			}
			render() {
				return h('span', { class: 'badge' }, [text(String(this.getData().n))]);
			}
		}
		class Panel extends PuzzleView {
			render() {
				return h('div', { class: 'panel' }, [
					h('h3', {}, [text('Inbox')]),
					comp(Badge, { count: 3 }),
				]);
			}
		}
		await assertEquivalent(h('div', {}, [comp(Panel)]));
	});
});
