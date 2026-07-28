// @vitest-environment jsdom
//
// Regression cover for `patchComponent`'s `shallowEqual` prop bailout
// (client-runtime/views/viewManager.js) — the mechanism
// constellation/decision/DECISION-D62-HANDLER-CACHING.md measured at n=10,000
// and constellation/doc/DOC-STRESS-EXAMPLE.md drives as the
// `?handlers=stable|inline` A/B.
//
// Nothing else in the suite asserts the bailout FIRES. Without these tests a
// change to `shallowEqual`, or a newly added prop that is freshly allocated on
// every parent render, would keep the suite green while every list-shaped app
// silently reverts to re-running `data()` for every mounted child on every
// parent render. There would be no failure — only a slowdown.
//
// The oracle is `measureRenders().rendersByView`, which devperf keys by
// constructor NAME. Each row therefore gets its own generated subclass name
// (Row00 … Row19) so the report can say WHICH row re-rendered, not merely how
// many did.
import { afterEach, describe, expect, it } from 'vitest';
import { PuzzleView, ViewNode } from '../client-runtime/index.js';
import { measureRenders, mountView, settled } from '../client-runtime/testing/index.js';

const h = (tag, attrs = {}, children = []) => new ViewNode(tag, attrs, children);
const text = (value) => new ViewNode('text', { value });

const ROW_COUNT = 20;
const TARGET_ROW = 7;

const handles = [];

/** data() executions per row id — the count D62's table reports. */
let dataRuns = {};

afterEach(() => {
	for (const handle of handles.splice(0)) handle.destroy();
	dataRuns = {};
});

class Row extends PuzzleView {
	data() {
		const id = this.props.id;
		dataRuns[id] = (dataRuns[id] ?? 0) + 1;
		return { text: `${this.props.label}:${this.props.value}` };
	}

	render() {
		return h('div', { class: 'row', 'data-id': this.props.id }, [
			text(this.getData().text),
		]);
	}
}

const rowName = (index) => `Row${String(index).padStart(2, '0')}`;

/**
 * One distinctly NAMED subclass per row position. Behaviour is identical to
 * Row; only `constructor.name` differs, which is what makes rendersByView an
 * exact per-row oracle instead of a single aggregate count.
 */
function makeRowClasses(count) {
	return Array.from({ length: count }, (_, index) =>
		Object.defineProperty(class extends Row {}, 'name', { value: rowName(index) })
	);
}

const makeRows = (count) =>
	Array.from({ length: count }, (_, index) => ({
		id: index,
		label: `row-${index}`,
		value: index * 10,
	}));

/**
 * The A/B parent, differing ONLY in how the callback prop is spelled — the same
 * axis DOC-STRESS-EXAMPLE's keyed-list scenario switches on.
 *
 * `stableHandlers: true`  → `@select={ selectById }`: codegen caches the arrow
 *   in `this.__h` (D62), so the prop is the SAME function object every render.
 * `stableHandlers: false` → `@select={ selectRow(row) }`: the row is captured,
 *   so codegen emits a FRESH arrow per row per parent render (see the emitted
 *   shape in tests/fixtures/todos/Home.compiled.js, where TodoItem receives
 *   `toggle: (event) => this.events.toggleTodo(todo)`).
 */
function makeList(rowClasses, { stableHandlers }) {
	return class RowList extends PuzzleView {
		selected = null;
		// Instance field: allocated once per instance, so `this.selectById` is a
		// stable reference across renders — the runtime equivalent of `this.__h`.
		selectById = (id) => {
			this.selected = id;
		};

		render() {
			const rows = this.getData().rows ?? [];
			return h(
				'div',
				{ class: 'list' },
				rows.map((row, index) =>
					new ViewNode(
						rowClasses[index],
						{
							key: row.id,
							id: row.id,
							label: row.label,
							value: row.value,
							select: stableHandlers
								? this.selectById
								: (event) => this.selectById(row.id),
						},
						[]
					)
				)
			);
		}
	};
}

/** Mount the parent with ROW_COUNT rows already committed. */
async function mountList({ stableHandlers }) {
	const rowClasses = makeRowClasses(ROW_COUNT);
	const rows = makeRows(ROW_COUNT);
	const view = await mountView(makeList(rowClasses, { stableHandlers }));
	handles.push(view);
	view.instance.setData('rows', rows);
	await settled();
	dataRuns = {};
	return { view, rows };
}

/**
 * The measured op: one row's `label` changes; every other row object is carried
 * forward BY REFERENCE, so its primitive props are identical values.
 */
function changeOneRow(view, rows) {
	return measureRenders(view, () => {
		view.instance.setData(
			'rows',
			rows.map((row) =>
				row.id === TARGET_ROW ? { ...row, label: 'changed' } : row
			)
		);
	});
}

describe('patchComponent prop bailout', () => {
	it('re-renders ONLY the child whose props changed when props are stable', async () => {
		const { view, rows } = await mountList({ stableHandlers: true });

		const profile = await changeOneRow(view, rows);

		// The assertion the whole D62 finding rests on: 19 of 20 mounted children
		// never woke up. The parent rendered once; exactly one row followed.
		expect(profile.rendersByView).toEqual({ RowList: 1, [rowName(TARGET_ROW)]: 1 });
		expect(dataRuns).toEqual({ [TARGET_ROW]: 1 });
		expect(profile.renders).toBe(2);
		// Only the changed row's text node moved. The parent's own render mutates
		// nothing (its children are all component vnodes), so it counts as wasted.
		expect(profile.domMutations).toBe(1);
		expect(profile.wastedRenders).toBe(1);
		expect(view.find(`[data-id="${TARGET_ROW}"]`).textContent).toBe('changed:70');
	});

	// CHARACTERIZATION of a KNOWN COST, not an endorsement. A prop that is
	// freshly allocated on every parent render can never compare shallow-equal,
	// so the bailout is defeated for EVERY child and the whole list re-runs
	// data(). This is the canonical Puzzle list idiom (examples/todos), and D62
	// deliberately rejected making `shallowEqual` special-case functions: a
	// closure capturing a loop variable genuinely IS a new prop, and treating it
	// as equal would fire stale captures. The test exists so that a later
	// "improvement" — deep-comparing props, comparing function source, skipping
	// function-valued props — becomes a loud red test rather than a silent
	// behaviour change.
	it('re-runs EVERY child when a freshly-allocated prop defeats the bailout', async () => {
		const { view, rows } = await mountList({ stableHandlers: false });

		const profile = await changeOneRow(view, rows);

		const expected = { RowList: 1 };
		for (let index = 0; index < ROW_COUNT; index++) expected[rowName(index)] = 1;
		expect(profile.rendersByView).toEqual(expected);
		expect(Object.keys(dataRuns)).toHaveLength(ROW_COUNT);
		expect(Object.values(dataRuns).every((count) => count === 1)).toBe(true);
		expect(profile.renders).toBe(ROW_COUNT + 1);
		// The cost is entirely upstream of the DOM: 20 extra data() runs and 20
		// extra render passes produced exactly the same single text mutation.
		expect(profile.domMutations).toBe(1);
		expect(profile.wastedRenders).toBe(ROW_COUNT);
	});

	it('produces byte-identical DOM and identical mutation counts in both arms', async () => {
		const stable = await mountList({ stableHandlers: true });
		const stableProfile = await changeOneRow(stable.view, stable.rows);
		const stableHtml = stable.view.element.innerHTML;

		dataRuns = {};
		const inline = await mountList({ stableHandlers: false });
		const inlineProfile = await changeOneRow(inline.view, inline.rows);

		// The point of the finding: the user's screen is the same either way. The
		// stable spelling skips no DOM work — it only stops waking rows that had
		// nothing to do.
		expect(inline.view.element.innerHTML).toBe(stableHtml);
		expect(inlineProfile.domMutations).toBe(stableProfile.domMutations);
		// ...while paying ROW_COUNT extra renders for it.
		expect(inlineProfile.renders - stableProfile.renders).toBe(ROW_COUNT - 1);
	});
});

// ---------------------------------------------------------------------------
// The comparator itself.
//
// `shallowEqual` is module-private in viewManager.js and stays that way — these
// probes drive the REAL patch path and read the observable consequence (did the
// child re-render?). That is deliberately stronger than a direct unit test: it
// also fails if someone stops calling `shallowEqual` from `patchComponent` at
// all, which a unit test of the function alone could never notice.
//
// Every assertion below records what the code does TODAY.
// ---------------------------------------------------------------------------

/**
 * Mount a host whose single child receives `before`, swap in `after`, force one
 * parent re-render, and report whether the child re-rendered.
 */
async function childRerenders(before, after) {
	class Probe extends PuzzleView {
		render() {
			return h('span', {}, [text('probe')]);
		}
	}
	class Host extends PuzzleView {
		childProps = before;

		render() {
			return h('div', {}, [new ViewNode(Probe, this.childProps, [])]);
		}
	}

	const view = await mountView(Host);
	handles.push(view);
	const profile = await measureRenders(view, () => {
		view.instance.childProps = after;
		view.instance.setData('tick', 1);
	});
	expect(profile.rendersByView.Host).toBe(1);
	return (profile.rendersByView.Probe ?? 0) > 0;
}

describe('shallowEqual boundaries as patchComponent sees them', () => {
	it('bails out for the identical props OBJECT (the a === b fast path)', async () => {
		const props = { a: 1 };
		expect(await childRerenders(props, props)).toBe(false);
	});

	it('bails out for a new object with equal primitive values', async () => {
		expect(await childRerenders({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(false);
	});

	it('re-renders when the key COUNT differs', async () => {
		expect(await childRerenders({ a: 1 }, { a: 1, b: 2 })).toBe(true);
		expect(await childRerenders({ a: 1, b: 2 }, { a: 1 })).toBe(true);
	});

	it('treats a key present-with-undefined as different from an absent key', async () => {
		// Object.keys() counts an explicitly-undefined key, so the length guard
		// catches this before the value loop (which would have compared
		// undefined === undefined and wrongly bailed out). Deliberate: this is
		// exactly what the length guard is for.
		expect(await childRerenders({ a: 1, b: undefined }, { a: 1 })).toBe(true);
		expect(await childRerenders({ a: 1 }, { a: 1, b: undefined })).toBe(true);
	});

	it('re-renders for the same key count with a different key name', async () => {
		expect(await childRerenders({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(true);
	});

	it('KNOWN QUIRK: an all-undefined disjoint key set of equal size bails out', async () => {
		// shallowEqual compares key COUNT plus the values under `a`'s keys; it
		// never compares the key SETS. `b.a` and `b.b` are both undefined here, so
		// every comparison passes and the child never learns its props changed
		// shape. Harmless in practice — codegen emits a fixed key set per call
		// site — but it is the comparator's real contract, not an accident of
		// these particular objects.
		expect(await childRerenders({ a: undefined }, { b: undefined })).toBe(false);
	});

	it('re-renders for NaN vs NaN — the comparator uses strict !==, not Object.is', async () => {
		// NOT a SameValueZero comparison. Note the contrast with `sameNode()` a
		// few lines above shallowEqual in viewManager.js, which compares KEYS by
		// SameValueZero specifically so a NaN key matches itself. Props do not get
		// that treatment, so a NaN-valued prop defeats the bailout permanently:
		// its child re-runs data() on every single parent render.
		expect(await childRerenders({ a: NaN }, { a: NaN })).toBe(true);
	});

	it('bails out for +0 vs -0 — again because it is !== and not Object.is', async () => {
		// The mirror image of the NaN case: `Object.is(+0, -0)` is false, but
		// `+0 !== -0` is false too, so the child is NOT told the sign flipped.
		expect(await childRerenders({ a: 0 }, { a: -0 })).toBe(false);
	});

	it('bails out when a prop VALUE is the same object reference', async () => {
		// The reason examples/stress/app/scenarios/ListRow.pzl passes primitive
		// fields instead of the record: store records mutate IN PLACE, so the
		// patcher sees the same reference before and after an update and the row
		// never re-evaluates. Identity, not liveness (SPEC §4).
		const record = { id: 1, label: 'before' };
		const after = { record };
		record.label = 'after';
		expect(await childRerenders({ record }, after)).toBe(false);
	});
});
