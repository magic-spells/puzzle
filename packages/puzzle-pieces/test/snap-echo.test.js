import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The controlled `snap` path of the two overlay wrappers, replayed against the
// failure the ported sheet used to show: flick up, flick down, and a parent
// render that lands LATE (Puzzle's patch scheduler can defer a render by a
// frame, or by its 220 ms visibility fallback) re-drives the component back to
// a rung the user already left, which then bounces again when the next render
// lands. The rule under test — the same one `open` follows — is that only a
// CHANGE in the parent's prop acts, and a change that merely echoes a rung the
// component itself announced is absorbed, never re-applied. No DOM: the
// component is a fake element that records snapTo() calls, and "renders" are
// explicit afterUpdate() calls.

const puzzleViewStub = `
class PuzzleView {
	constructor() {
		this.props = {};
		this.refs = {};
	}
}`;

class FakeElement {
	constructor() {
		this.listeners = {};
		this.calls = [];
		this.attrs = {};
		this.isOpen = false;
		this.activeSnap = 0;
	}
	addEventListener(type, fn) {
		(this.listeners[type] ??= []).push(fn);
	}
	removeEventListener(type, fn) {
		this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
	}
	dispatch(type, detail) {
		for (const fn of (this.listeners[type] || []).slice()) fn({ type, detail, target: this });
	}
	setAttribute(name, value) {
		this.attrs[name] = String(value);
	}
	getAttribute(name) {
		return this.attrs[name] ?? null;
	}
	show(trigger) {
		this.calls.push(['show', trigger ?? null]);
		this.isOpen = true;
	}
	hide() {
		this.calls.push(['hide']);
		this.isOpen = false;
	}
	snapTo(value) {
		this.calls.push(['snapTo', value]);
	}
	get snapToCalls() {
		return this.calls.filter((c) => c[0] === 'snapTo').map((c) => c[1]);
	}
}

async function loadWrapper(file, dynamicImports) {
	const source = await readFile(new URL(file, import.meta.url), 'utf8');
	let script = source.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
	assert.ok(script, `${file} contains a script block`);
	script = script.replace("import { PuzzleView } from '@magic-spells/puzzle';", puzzleViewStub);
	for (const spec of dynamicImports) {
		assert.ok(script.includes(`import('${spec}')`), `${file} dynamic-imports ${spec}`);
		script = script.replaceAll(`import('${spec}')`, 'Promise.resolve({})');
	}
	const url = `data:text/javascript;base64,${Buffer.from(script).toString('base64')}`;
	const { default: View } = await import(url);
	return View;
}

globalThis.window = globalThis;
globalThis.document = { activeElement: null, body: {} };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// One scenario set, two wrappers. `event` is the component's commit event
// (sheet: lowercase index-valued `snapchange`; bottom-sheet: camelCase
// dvh-valued `snapChange`); a/b/c are three distinct rungs in that unit.
const WRAPPERS = [
	{
		name: 'Sheet',
		file: '../registry/ui/sheet/Sheet.pzl',
		imports: ['@magic-spells/sheet'],
		event: 'snapchange',
		rungs: [1, 2, 0],
	},
	{
		name: 'BottomSheet',
		file: '../registry/ui/bottom-sheet/BottomSheet.pzl',
		imports: ['@magic-spells/dialog-panel', '@magic-spells/bottom-sheet'],
		event: 'snapChange',
		rungs: [55, 85, 25],
	},
];

async function mount(View, props) {
	const panel = new FakeElement();
	const sheet = new FakeElement();
	const view = new View();
	view.props = { ...props };
	view.refs = { panel, sheet };
	view.data({}, view.props);
	view.mounted();
	await tick(); // the dynamic import resolves → #ready
	return { view, panel, sheet };
}

function render(view, props) {
	view.props = { ...view.props, ...props };
	view.data({}, view.props);
	view.afterUpdate();
}

for (const w of WRAPPERS) {
	const [a, b, c] = w.rungs;

	test(`${w.name}: a parent echoing the rung the component just announced is a no-op`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const announced = [];
		const { view, sheet } = await mount(View, { open: true, snap: a, snapChange: (v) => announced.push(v) });
		sheet.dispatch(w.event, { from: a, to: b });
		assert.deepEqual(announced, [b]);
		render(view, { snap: b });
		assert.deepEqual(sheet.snapToCalls, [], 'the echo must not re-run snapTo');
	});

	test(`${w.name}: a LATE, out-of-order echo after two flicks never bounces the sheet`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const { view, sheet } = await mount(View, { open: true, snap: a, snapChange() {} });
		// user flicks a→b, then b→a, before the parent's renders land
		sheet.dispatch(w.event, { from: a, to: b });
		sheet.dispatch(w.event, { from: b, to: a });
		// the parent's renders arrive late and in order: b (stale), then a
		render(view, { snap: b });
		assert.deepEqual(sheet.snapToCalls, [], 'the stale echo of b must not drag the sheet back up');
		render(view, { snap: a });
		assert.deepEqual(sheet.snapToCalls, [], 'the final echo of a is where the sheet already is');
	});

	test(`${w.name}: an unrelated re-render carrying the parent's PREVIOUS value is not a request`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const { view, sheet } = await mount(View, { open: true, snap: a, snapChange() {} });
		sheet.dispatch(w.event, { from: a, to: b });
		// a render queued before the flick flushes after it — the prop still reads a
		render(view, { title: 'unrelated', snap: a });
		assert.deepEqual(sheet.snapToCalls, [], 'a prop that did not change must not re-drive the component');
		render(view, { snap: b });
		assert.deepEqual(sheet.snapToCalls, [], 'and the real echo is absorbed');
	});

	test(`${w.name}: a genuine parent-driven change still calls snapTo exactly once`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const { view, sheet } = await mount(View, { open: true, snap: a, snapChange() {} });
		render(view, { snap: c });
		assert.deepEqual(sheet.snapToCalls, [c]);
		render(view, { snap: c, title: 'unrelated' });
		assert.deepEqual(sheet.snapToCalls, [c], 'repeating the same value does nothing');
		// the component settles there and announces it; the parent already holds c
		sheet.dispatch(w.event, { from: a, to: c });
		render(view, { snap: c });
		assert.deepEqual(sheet.snapToCalls, [c], 'the announcement of our own request is not a new request');
	});

	test(`${w.name}: a parent-driven change while an announcement is still pending wins`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const { view, sheet } = await mount(View, { open: true, snap: a, snapChange() {} });
		sheet.dispatch(w.event, { from: a, to: b }); // user flick, echo not yet rendered
		render(view, { snap: c }); // parent asserts a different rung instead
		assert.deepEqual(sheet.snapToCalls, [c]);
	});

	test(`${w.name}: snap left unset never drives the component`, async () => {
		const View = await loadWrapper(w.file, w.imports);
		const { view, sheet } = await mount(View, { open: true });
		sheet.dispatch(w.event, { from: a, to: b });
		render(view, { title: 'unrelated' });
		assert.deepEqual(sheet.snapToCalls, []);
	});
}
