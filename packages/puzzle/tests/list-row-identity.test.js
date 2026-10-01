// @vitest-environment jsdom
//
// What a CACHED row must still behave like (D170 Consequences — the
// browser-identity checks).
//
// A reorder that returns every row from the list block's cache is the sharpest
// test of the identity short-circuit: the patcher does nothing below a row, so
// the three things that used to be re-established by a full rebuild have to
// survive on their own —
//
//   1. live, out-of-band DOM state in an UNCONTROLLED input (what the user
//      typed, and the focus that put it there);
//   2. the re-assert of a CONTROLLED value that drifted, which is the one piece
//      of work the short-circuit still does;
//   3. FLIP, which must see the row as MOVED rather than remounted.
//
// These live in jsdom rather than tests-browser/ deliberately: the Playwright
// suite is bound to two fixed dev servers (examples/transitions-demo and
// examples/stays), neither of which renders a reorderable list with form
// controls, and standing a third example up for three assertions would cost
// more than it proves. The DOM facts asserted here — node identity across a
// keyed move, input.value, activeElement, and the WAAPI calls — are ones jsdom
// models faithfully; nothing here depends on real layout or real timing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuzzleView } from '../client-runtime/views/PuzzleView.js';
import { ViewNode } from '../client-runtime/views/ViewNode.js';
import { listRows } from '../client-runtime/views/listBlock.js';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';
import { devperfInstallSink } from '../client-runtime/devperf.js';
import { mountView, settled } from '../client-runtime/testing/index.js';

class Todo extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		text: Puzzle.string(),
	};
}

const META = { key: (item) => ViewNode.keyOf(item), ctrl: true };
const IDS = ['a', 'b', 'c'];

/**
 * A keyed list whose DISPLAY ORDER is view state, so a reorder writes to no
 * record: every row's reference and revision are untouched and the list block
 * must hand back the very vnodes it built. `flip` is on the row root so the
 * third test can watch the move.
 */
class Rows extends PuzzleView {
	created() {
		this.order = [...IDS];
	}

	data() {
		return { rows: this.order.map((id) => this.ctx.store.findOne('todo', id)) };
	}

	reverse() {
		this.order = [...this.order].reverse();
		this.refresh();
	}

	render() {
		return new ViewNode(
			'ul',
			{},
			listRows(
				this,
				this,
				0,
				this.getData().rows,
				(s) =>
					new ViewNode('li', { key: s.k, flip: true, 'data-id': s.item.id }, [
						// No `value` attr: the framework never writes this one, so whatever
						// the user typed is the only thing in it.
						new ViewNode('input', { class: 'loose', type: 'text' }, []),
						// Controlled: `value` comes from the record on every build, and the
						// identity short-circuit re-asserts it from the row's control list.
						new ViewNode('input', { class: 'bound', type: 'text', value: s.item.text }, []),
					]),
				META
			)
		);
	}
}

/**
 * The CONTROL: the same list written the way 0.7.1 compiled it — a plain
 * `.map()` that rebuilds every row vnode on every render. Keys are identical, so
 * the patcher takes the same move path; only the vnode identity differs.
 */
class RowsUncached extends Rows {
	render() {
		return new ViewNode(
			'ul',
			{},
			this.getData().rows.map(
				(item) =>
					new ViewNode('li', { key: ViewNode.keyOf(item), flip: true, 'data-id': item.id }, [
						new ViewNode('input', { class: 'loose', type: 'text' }, []),
						new ViewNode('input', { class: 'bound', type: 'text', value: item.text }, []),
					])
			)
		);
	}
}

const handles = [];

function seed() {
	const store = new Store({ todo: Todo });
	for (const id of IDS) store.createRecord('todo', { id, text: `text-${id}` });
	return store;
}

/** Mount and attach to the document — focus is inert on a detached tree. */
async function mountAttachedAs(ViewClass, store) {
	const view = await mountView(ViewClass, { store });
	handles.push(view);
	document.body.appendChild(view.container);
	return view;
}

const mountAttached = (store) => mountAttachedAs(Rows, store);
const mountAttached2 = (store) => mountAttachedAs(RowsUncached, store);

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('a reorder over cached rows', () => {
	it('keeps focus and typed text through a cached pass that does not reorder', async () => {
		const view = await mountAttached(seed());
		const loose = view.find('[data-id="b"] .loose');

		// What a user has in flight: focus plus characters the framework has never
		// seen, in a field it does not control.
		loose.focus();
		loose.value = 'half typed';
		expect(document.activeElement).toBe(loose);

		const passes = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'list-rows') passes.push(event);
		});
		try {
			// A parent render that changes nothing about the rows — the pass the row
			// cache exists for.
			view.instance.refresh();
			await settled();
		} finally {
			off();
		}

		expect(passes.at(-1)).toMatchObject({ built: 0, cached: IDS.length });
		expect(view.find('[data-id="b"] .loose')).toBe(loose);
		expect(loose.value).toBe('half typed');
		expect(document.activeElement).toBe(loose);
	});

	it('keeps the row NODES and their typed text through a reorder — exactly as an uncached list does', async () => {
		const view = await mountAttached(seed());
		const row = view.find('[data-id="b"]');
		const loose = row.querySelector('.loose');
		loose.focus();
		loose.value = 'half typed';

		const passes = [];
		const off = devperfInstallSink((event) => {
			if (event.type === 'list-rows') passes.push(event);
		});
		try {
			view.instance.reverse();
			await settled();
		} finally {
			off();
		}

		// The precondition: this really was a fully cached pass.
		expect(passes.at(-1)).toMatchObject({ built: 0, cached: IDS.length });
		// The rows MOVED — same elements, new order, nothing remounted.
		const moved = view.find('[data-id="b"]');
		expect(moved).toBe(row);
		expect([...view.findAll('li')].map((el) => el.dataset.id)).toEqual(['c', 'b', 'a']);
		expect(moved.querySelector('.loose')).toBe(loose);
		expect(loose.value).toBe('half typed');

		// Focus is the ONE thing a keyed reorder cannot carry, and it never could:
		// the patcher's move pass re-inserts the row, and re-inserting an element
		// blurs what is focused inside it. The control below proves the row cache
		// did not introduce that — an uncached list of the same shape loses focus
		// on the same op.
		const cachedActive = document.activeElement;

		const control = await mountAttached2(seed());
		const controlRow = control.find('[data-id="b"]');
		const controlLoose = controlRow.querySelector('.loose');
		controlLoose.focus();
		controlLoose.value = 'half typed';
		control.instance.reverse();
		await settled();

		expect(control.find('[data-id="b"]')).toBe(controlRow);
		expect(controlLoose.value).toBe('half typed');
		expect(document.activeElement === controlLoose).toBe(cachedActive === loose);
	});

	it('re-asserts a drifted CONTROLLED value in a row the reorder moved', async () => {
		const view = await mountAttached(seed());
		const bound = view.find('[data-id="a"] .bound');
		expect(bound.value).toBe('text-a');

		// The live DOM drifts out of band — a change-committed edit, an IME
		// composition the bind guard is holding, a browser autofill.
		bound.value = 'drifted';

		view.instance.reverse();
		await settled();

		// The row came back cached and was MOVED, so the only thing that can
		// correct the drift is the control list patch() re-asserts on the identity
		// short-circuit.
		expect(view.find('[data-id="a"] .bound')).toBe(bound);
		expect(bound.value).toBe('text-a');
	});

	it('still plays FLIP on the rows the reorder moved', async () => {
		// jsdom has neither layout nor WAAPI. Position comes from the element's
		// index among its siblings (a row is 20px tall), which is all FLIP needs to
		// compute a delta; `animate` records its calls.
		const animations = [];
		const origGBCR = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = function () {
			const index = this.parentNode ? [...this.parentNode.children].indexOf(this) : 0;
			const top = index * 20;
			return { left: 0, top, x: 0, y: top, right: 100, bottom: top + 20, width: 100, height: 20 };
		};
		Element.prototype.animate = function (keyframes, options) {
			animations.push({ target: this, keyframes, options });
			return {
				finished: Promise.resolve(),
				cancel() {},
				finish() {},
				onfinish: null,
			};
		};

		try {
			const view = await mountAttached(seed());
			const before = [...view.findAll('li')];

			const passes = [];
			const off = devperfInstallSink((event) => {
				if (event.type === 'list-rows') passes.push(event);
			});
			try {
				view.instance.reverse();
				await settled();
			} finally {
				off();
			}

			// Every row cached, so this is the move path over vnodes the patcher
			// short-circuits — the case FLIP has to keep working through.
			expect(passes.at(-1)).toMatchObject({ built: 0, cached: IDS.length });
			const after = [...view.findAll('li')];
			expect(after).toEqual([before[2], before[1], before[0]]);

			// The two rows that actually moved animated; the middle row did not.
			const moved = animations.map((a) => a.target.dataset.id).sort();
			expect(moved).toEqual(['a', 'c']);
			// A FLIP is an INVERTED translate: start at the old offset, settle at the
			// element's natural state. Rows are 20px and the list is three long, so
			// the outer two swap across 40px.
			expect(animations.map((a) => a.keyframes[0].transform).sort()).toEqual([
				'translate(0px, -40px)',
				'translate(0px, 40px)',
			]);
			for (const animation of animations) {
				expect(animation.keyframes[1].transform).toBe('none');
			}
		} finally {
			Element.prototype.getBoundingClientRect = origGBCR;
			delete Element.prototype.animate;
		}
	});
});
