import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sheetFile = new URL('../registry/ui/sheet/Sheet.pzl', import.meta.url);
const engineFile = new URL('../registry/lib/sheet-engine.js', import.meta.url).href;
const policyFile = new URL('../registry/lib/sheet-policy.js', import.meta.url).href;
const dragFile = new URL('../registry/lib/sheet-drag.js', import.meta.url).href;
const sheetSource = await readFile(sheetFile, 'utf8');
const script = sheetSource.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

assert.ok(script, 'Sheet.pzl contains a script block');

const puzzleViewStub = `
class PuzzleView {
	constructor() {
		this.props = {};
		this.refs = {};
		this.element = null;
		this._data = {};
	}

	setData(key, value) {
		if (typeof key === 'string') this._data = { ...this._data, [key]: value };
		else this._data = { ...this._data, ...key };
	}

	getData() {
		return this._data;
	}
}`;

const testHooks = `
	__testDragStart(surface, event) {
		return this.#dragStart(surface, event);
	}

	__testEngine() {
		return this.#engine;
	}

	__testQueueMeasure(profile) {
		this.#pendingMeasure = profile;
	}

	__testPendingMeasure() {
		return this.#pendingMeasure;
	}

`;

const moduleSource = script
	.replace("import { PuzzleView } from '@magic-spells/puzzle';", puzzleViewStub)
	.replace("'../../lib/sheet-engine.js'", JSON.stringify(engineFile))
	.replace("'../../lib/sheet-policy.js'", JSON.stringify(policyFile))
	.replace("'../../lib/sheet-drag.js'", JSON.stringify(dragFile))
	.replace('  events = {\n', `${testHooks}  events = {\n`);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;
const { default: Sheet } = await import(moduleUrl);

class BaseElement {}

class StubElement extends BaseElement {
	constructor(rect = {}) {
		super();
		this.listeners = new Map();
		this.style = {};
		this.rect = {
			top: 300,
			left: 0,
			right: 400,
			bottom: 800,
			width: 400,
			height: 500,
			...rect,
		};
		this.scrollTop = 0;
		this.scrollLeft = 0;
		this.scrollHeight = this.rect.height;
		this.scrollWidth = this.rect.width;
		this.clientHeight = this.rect.height;
		this.clientWidth = this.rect.width;
		this.capturedPointerId = null;
		this.isConnected = true;
	}

	addEventListener(type, listener) {
		this.listeners.set(type, listener);
	}

	removeEventListener(type, listener) {
		if (this.listeners.get(type) === listener) this.listeners.delete(type);
	}

	setPointerCapture(pointerId) {
		this.capturedPointerId = pointerId;
	}

	setAttribute(name) {
		this.attributes ??= new Set();
		this.attributes.add(name);
	}

	removeAttribute(name) {
		this.attributes?.delete(name);
	}

	contains(node) {
		return node === this;
	}

	getBoundingClientRect() {
		return this.rect;
	}

	fire(type, overrides = {}) {
		const event = {
			isPrimary: true,
			pointerId: 1,
			clientX: 0,
			clientY: 0,
			timeStamp: 0,
			target: this,
			...overrides,
		};
		this.listeners.get(type)?.(event);
	}
}

class StubDialog extends StubElement {
	constructor() {
		super({ top: 0, left: 0, right: 400, bottom: 800, width: 400, height: 800 });
		this.open = false;
	}

	showModal() {
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

function stubGlobal(cleanups, name, value) {
	const had = name in globalThis;
	const original = globalThis[name];
	globalThis[name] = value;
	cleanups.push(() => {
		if (had) globalThis[name] = original;
		else delete globalThis[name];
	});
}

function drainFrames(frames, limit = 1000) {
	let time = 0;
	let count = 0;
	while (frames.length && count < limit) {
		time += 16.66;
		frames.shift()(time);
		count += 1;
	}
	assert.ok(count < limit, 'spring settled before the safety limit');
}

async function mountSheet(t, { open, dismiss = 'none', close }) {
	const frames = [];
	const locked = new Set();
	const cleanups = [];
	const documentElement = new StubElement();
	const body = {
		style: {},
		append() {},
	};
	const document = {
		activeElement: null,
		body,
		documentElement,
		createElement() {
			const probe = new StubElement();
			probe.getBoundingClientRect = () => {
				const match = String(probe.style.height || '').match(/^([\d.]+)px$/);
				return { height: match ? Number(match[1]) : 0 };
			};
			probe.remove = () => {};
			return probe;
		},
		querySelector(selector) {
			if (selector !== '[data-scroll-lock]') return null;
			return locked.values().next().value || null;
		},
	};
	const window = {
		innerWidth: 400,
		innerHeight: 800,
		matchMedia: () => ({ matches: false }),
		addEventListener() {},
		removeEventListener() {},
	};

	stubGlobal(cleanups, 'Element', BaseElement);
	stubGlobal(cleanups, 'HTMLElement', BaseElement);
	stubGlobal(cleanups, 'document', document);
	stubGlobal(cleanups, 'window', window);
	stubGlobal(cleanups, 'requestAnimationFrame', (callback) => frames.push(callback));
	stubGlobal(cleanups, 'getComputedStyle', (element) => {
		if (element === documentElement) return { fontSize: '16px' };
		return {
			borderRadius: '16px',
			direction: 'ltr',
			overflowX: 'auto',
			overflowY: 'auto',
		};
	});

	const dialog = new StubDialog();
	const originalSetAttribute = dialog.setAttribute.bind(dialog);
	const originalRemoveAttribute = dialog.removeAttribute.bind(dialog);
	dialog.setAttribute = (name) => {
		originalSetAttribute(name);
		if (name === 'data-scroll-lock') locked.add(dialog);
	};
	dialog.removeAttribute = (name) => {
		originalRemoveAttribute(name);
		if (name === 'data-scroll-lock') locked.delete(dialog);
	};
	const refs = {
		backdrop: new StubElement(),
		panel: new StubElement(),
		header: new StubElement(),
		content: new StubElement(),
		footer: new StubElement(),
	};
	const sheet = new Sheet();
	sheet.props = {
		open,
		dismiss,
		snapPoints: '500px',
		close,
	};
	sheet.refs = refs;
	sheet.element = dialog;
	sheet.data(null, sheet.props);
	sheet.mounted();
	drainFrames(frames);
	await Promise.resolve();
	t.after(() => {
		sheet.destroyed();
		for (const cleanup of cleanups.reverse()) cleanup();
	});

	return { sheet, refs, frames };
}

test('Sheet refuses gesture starts while its engine is not shown', async (t) => {
	const { sheet, refs } = await mountSheet(t, { open: false });
	assert.equal(
		sheet.__testDragStart('backdrop', { target: refs.backdrop }),
		false
	);
});

test('Sheet refuses gesture starts while a profile morph is active', async (t) => {
	const { sheet, refs } = await mountSheet(t, { open: true });
	assert.equal(sheet.__testEngine().beginMorph(), true);
	assert.equal(
		sheet.__testDragStart('backdrop', { target: refs.backdrop }),
		false
	);
});

test('a refused claimed backdrop micro-drag settles back to its active snap', async (t) => {
	const { sheet, refs, frames } = await mountSheet(t, {
		open: true,
		dismiss: 'none',
	});
	const engine = sheet.__testEngine();
	const settleTo = engine.settleTo.bind(engine);
	const settles = [];
	engine.settleTo = (...args) => {
		settles.push(args);
		return settleTo(...args);
	};

	refs.backdrop.fire('pointerdown');
	refs.backdrop.fire('pointermove', { clientY: 6, timeStamp: 50 });
	assert.equal(refs.panel.style.transform, 'translate3d(0px, 6px, 0px) scale(1)');
	refs.backdrop.fire('pointerup', { clientY: 6, timeStamp: 100 });

	assert.deepEqual(settles, [[0, 0]]);
	drainFrames(frames);
	await Promise.resolve();
	assert.equal(refs.panel.style.height, '500px');
});

test('a queued native close cannot interrupt a reopened sheet entrance', async (t) => {
	const reasons = [];
	const { sheet, frames } = await mountSheet(t, {
		open: false,
		close: (reason) => reasons.push(reason),
	});

	sheet.props.open = true;
	sheet.syncOpen();
	assert.equal(sheet.__testEngine().state, 'showing');

	sheet.events.handleClose();
	assert.equal(sheet.__testEngine().state, 'showing');
	assert.deepEqual(reasons, []);

	drainFrames(frames);
	await Promise.resolve();
});

test('closing clears a deferred measurement before a later reopen', async (t) => {
	const { sheet } = await mountSheet(t, { open: false });
	const staleProfile = { position: 'bottom' };
	sheet.__testQueueMeasure(staleProfile);
	assert.equal(sheet.__testPendingMeasure(), staleProfile);

	sheet.afterUpdate();
	assert.equal(sheet.__testPendingMeasure(), null);
});
