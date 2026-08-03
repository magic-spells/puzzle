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

// A hand-driven stand-in for @magic-spells/morph-engine. The blob transport is
// entirely event-shaped, so the flight is driven from the tests rather than
// simulated: `show`/`hide` only record and park the state, and reveal/shown/
// hidden are fired explicitly at the moments the classification table cares
// about. Every instance publishes itself so a test can reach the one its
// component built.
const morphEngineStub = `
class MorphEngine {
	constructor(options = {}) {
		this.options = options;
		this.zIndex = options.zIndex;
		this.cloneContents = true;
		this.state = 'idle';
		this.calls = [];
		this.handlers = {};
		this.restoreCount = 0;
		this.attraction = options.attraction;
		this.friction = options.friction;
		(globalThis.__morphEngines ??= []).push(this);
	}

	on(name, handler) {
		(this.handlers[name] ??= []).push(handler);
		return this;
	}

	emit(name, detail) {
		for (const handler of (this.handlers[name] || []).slice()) handler(detail);
	}

	setAttraction(value) {
		this.attraction = value;
	}

	setFriction(value) {
		this.friction = value;
	}

	show(options) {
		this.calls.push(['show', options]);
		this.state = 'showing';
		return Promise.resolve(true);
	}

	hide() {
		this.calls.push(['hide']);
		this.state = 'hiding';
		return Promise.resolve(true);
	}

	stop(options = {}) {
		this.calls.push(['stop', options]);
		this.state = 'idle';
		if (options.restoreSource !== false) this.restoreSource();
	}

	restoreSource() {
		this.restoreCount += 1;
	}

	destroy() {
		this.calls.push(['destroy']);
		this.state = 'idle';
	}

	settleShown() {
		this.state = 'shown';
		this.emit('shown');
	}

	settleHidden() {
		this.state = 'idle';
		this.emit('hidden');
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

	__testUsableTrigger(trigger) {
		return !!this.#usableTriggerBox(trigger);
	}

	__testExpectedCloses() {
		return this.#expectedCloses;
	}

	__testBlobDeferred() {
		return this.#blobDeferredProfile;
	}

	__testTriggerReturn() {
		return this.#triggerReturn;
	}

`;

const moduleSource = script
	.replace("import { PuzzleView } from '@magic-spells/puzzle';", puzzleViewStub)
	.replace(
		"import { MorphEngine } from '@magic-spells/morph-engine';",
		morphEngineStub
	)
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
		this.animations = [];
		// Overridable so a test can say "this element renders no boxes at all",
		// which is the ancestor-display:none case getComputedStyle cannot see.
		this.rects = null;
	}

	getClientRects() {
		return this.rects ?? [this.rect];
	}

	// A minimal WAAPI Animation: enough for the trigger-return pop, whose only
	// contract is "entered the timeline immediately, cancel() rejects finished".
	animate(keyframes, options) {
		let settle;
		let reject;
		const animation = {
			keyframes,
			options,
			cancelled: false,
			finished: new Promise((resolveFinished, rejectFinished) => {
				settle = resolveFinished;
				reject = rejectFinished;
			}),
			cancel() {
				if (this.cancelled) return;
				this.cancelled = true;
				reject(new Error('cancelled'));
			},
			finish() {
				settle(this);
			},
		};
		animation.finished.catch(() => {});
		this.animations.push(animation);
		return animation;
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

async function mountSheet(
	t,
	{ open, dismiss = 'none', close, props = {}, selectors = {}, reducedMotion = false }
) {
	const frames = [];
	const locked = new Set();
	const cleanups = [];
	const styleOverrides = new Map();
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
			if (selector === '[data-scroll-lock]') {
				return locked.values().next().value || null;
			}
			return selectors[selector] ?? null;
		},
	};
	const window = {
		innerWidth: 400,
		innerHeight: 800,
		matchMedia: () => ({ matches: reducedMotion }),
		addEventListener() {},
		removeEventListener() {},
	};

	globalThis.__morphEngines = [];
	cleanups.push(() => {
		delete globalThis.__morphEngines;
	});

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
			...(styleOverrides.get(element) || {}),
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
		...props,
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

	return {
		sheet,
		refs,
		frames,
		dialog,
		styleOverrides,
		morphEngines: globalThis.__morphEngines,
	};
}

// The trigger a morph flies out of. Sized and positioned inside the 400x800
// stub viewport so the geometry gates pass by default.
function makeTrigger(rect = {}) {
	return new StubElement({
		top: 700,
		left: 20,
		right: 120,
		bottom: 740,
		width: 100,
		height: 40,
		...rect,
	});
}

// Opens through the proxy transport and drives the blob to its settled `shown`.
// Mirrors the real sequence: show() records the flight, `reveal` promotes the
// dialog mid-air, `shown` hands geometry back to the sheet.
function flyOpen(sheet, morphEngines, { reveal = true, settle = true } = {}) {
	sheet.props.open = true;
	sheet.syncOpen();
	const blob = morphEngines[0];
	if (blob && reveal) blob.emit('reveal', {});
	if (blob && settle) blob.settleShown();
	return blob;
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

// The source reads a synchronous `beforeHide` veto; a controlled piece cannot,
// so a resolved dismissal is banked until the parent answers. Both outcomes
// report through the same event, and neither may report before the answer.
function swipeAway(refs) {
	refs.backdrop.fire('pointerdown');
	refs.backdrop.fire('pointermove', { clientY: 400, timeStamp: 50 });
	refs.backdrop.fire('pointerup', { clientY: 400, timeStamp: 100 });
}

test('a swipe dismissal reports nothing until the parent accepts the close', async (t) => {
	const reasons = [];
	const releases = [];
	const { sheet, refs, frames } = await mountSheet(t, {
		open: true,
		dismiss: 'swipe',
		close: (reason) => reasons.push(reason),
	});
	sheet.props.snapRelease = (detail) => releases.push(detail);

	swipeAway(refs);
	assert.deepEqual(reasons, ['swipe']);
	assert.deepEqual(releases, [], 'nothing is reported before the parent answers');

	sheet.props.open = false;
	sheet.syncOpen();

	assert.equal(releases.length, 1);
	assert.equal(releases[0].target, null);
	assert.equal(releases[0].prevented, false);
	drainFrames(frames);
	await Promise.resolve();
});

test('a dismissal the parent never accepts settles back and reports prevented', async (t) => {
	const releases = [];
	const { sheet, refs, frames } = await mountSheet(t, {
		open: true,
		dismiss: 'swipe',
		close: () => {},
	});
	sheet.props.snapRelease = (detail) => releases.push(detail);

	swipeAway(refs);
	assert.deepEqual(releases, []);

	// Past DISMISS_ACK_MS with `open` still true: nothing took the close.
	await new Promise((resolve) => setTimeout(resolve, 320));

	assert.equal(releases.length, 1);
	assert.equal(releases[0].target, 0, 'reports the snap the panel landed on');
	assert.equal(releases[0].prevented, true);
	assert.equal(sheet.__testEngine().state, 'shown');

	drainFrames(frames);
	await Promise.resolve();
	assert.equal(refs.panel.style.height, '500px', 'settled back rather than frozen');
});

test('a fresh grab supersedes a swipe still waiting on its answer', async (t) => {
	const releases = [];
	const { sheet, refs } = await mountSheet(t, {
		open: true,
		dismiss: 'swipe',
		close: () => {},
	});
	sheet.props.snapRelease = (detail) => releases.push(detail);

	swipeAway(refs);
	assert.deepEqual(releases, [], 'the dismissal is banked, not yet reported');

	// The user grabs the sheet again inside DISMISS_ACK_MS. Left banked, the
	// deadline would later fire under this finger: settling the panel back
	// mid-drag and reporting a dismissal the user has already moved past.
	assert.notEqual(
		sheet.__testDragStart('header', { target: refs.header }),
		false,
		'the new gesture is accepted'
	);
	assert.equal(releases.length, 1, 'the owed report is refused, not dropped');
	assert.equal(releases[0].prevented, true);
	assert.equal(releases[0].target, 0, 'reports the snap the panel is still on');

	// And the bank is consumed, so the deadline cannot fire a second time.
	await new Promise((resolve) => setTimeout(resolve, 320));
	assert.equal(releases.length, 1, 'no deadline report lands under the finger');
	assert.equal(sheet.__testEngine().state, 'shown');
});

test('an effect change applies without running a profile morph', async (t) => {
	const { sheet } = await mountSheet(t, { open: true });
	const engine = sheet.__testEngine();
	const setProfile = engine.setProfile.bind(engine);
	const effects = [];
	engine.setProfile = (profile) => {
		effects.push(profile.effect);
		return setProfile(profile);
	};

	sheet.props.effect = 'fade-scale';
	sheet.data(null, sheet.props);
	sheet.afterUpdate();

	assert.equal(engine.morphing, false, 'no FLIP for an identical from/to box');
	assert.deepEqual(effects, ['fade-scale'], 'the new choreography reached the engine');
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

// ---------------------------------------------------------------------------
// TRIGGER MORPH
//
// The classification table, one test per row. What distinguishes the rows is
// exactly two observable facts: whether showModal() ran inside syncOpen() or
// only after the engine's `reveal`, and whether close() preceded engine.hide().
// ---------------------------------------------------------------------------

test('an open with a usable trigger defers showModal to the blob reveal', async (t) => {
	const trigger = makeTrigger();
	const { sheet, refs, dialog, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: '#trigger' },
		selectors: { '#trigger': trigger },
	});

	sheet.props.open = true;
	sheet.syncOpen();

	assert.equal(morphEngines.length, 1, 'the blob transport was built');
	const blob = morphEngines[0];
	assert.equal(
		dialog.open,
		false,
		'the dialog is deliberately NOT promoted inside syncOpen'
	);
	assert.equal(
		dialog.style.display,
		'flex',
		'it is display-forced instead, so the panel keeps a measurable box'
	);
	assert.deepEqual(blob.calls[0][0], 'show');
	assert.equal(blob.calls[0][1].from, trigger);
	assert.equal(blob.calls[0][1].to, refs.panel);
	assert.equal(sheet.__testEngine().state, 'showing');

	// Promotion — and therefore focus — happens at the reveal, mid-flight, while
	// the panel is still invisible.
	blob.emit('reveal', {});
	assert.equal(dialog.open, true, 'reveal promotes the real dialog');

	blob.settleShown();
	assert.equal(sheet.__testEngine().state, 'shown');
});

test('an open with no trigger promotes immediately and builds no blob', async (t) => {
	const { sheet, dialog, morphEngines } = await mountSheet(t, { open: false });

	sheet.props.open = true;
	sheet.syncOpen();

	assert.equal(morphEngines.length, 0, 'no MorphEngine is constructed');
	assert.equal(dialog.open, true, 'the direct transport promotes at once');
	assert.equal(sheet.__testEngine().state, 'showing');
});

test('a deliberate close with a live trigger demotes before it morphs back', async (t) => {
	const trigger = makeTrigger();
	const { sheet, dialog, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines);

	// The order is the whole point: a top-layer dialog paints over a body-child
	// blob whatever the z-index, so close() has to land first and in the same
	// synchronous task.
	const order = [];
	const nativeClose = dialog.close.bind(dialog);
	dialog.close = () => {
		order.push('close');
		nativeClose();
	};
	const blobHide = blob.hide.bind(blob);
	blob.hide = (...args) => {
		order.push('hide');
		return blobHide(...args);
	};

	sheet.props.open = false;
	sheet.syncOpen();

	assert.deepEqual(order, ['close', 'hide']);
	assert.equal(sheet.__testEngine().state, 'hiding');
	assert.equal(blob.cloneContents, false, 'the reverse blob never clones the panel');
});

test('a swipe dismissal leaves by the direct spring, not the blob', async (t) => {
	const trigger = makeTrigger();
	const { sheet, refs, dialog, frames, morphEngines } = await mountSheet(t, {
		open: false,
		dismiss: 'swipe',
		close: () => {},
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines);
	drainFrames(frames);
	await Promise.resolve();

	swipeAway(refs);
	sheet.props.open = false;
	sheet.syncOpen();

	assert.equal(
		dialog.open,
		true,
		'a direct exit keeps the dialog modal for the whole flight'
	);
	assert.equal(
		blob.calls.some(([name]) => name === 'hide'),
		false,
		'no reverse flight is launched'
	);
	assert.deepEqual(
		blob.calls.at(-1),
		['stop', { restoreSource: false }],
		'the blob is handed off, not aborted — the trigger stays held'
	);
	assert.equal(blob.restoreCount, 0, 'the source is NOT restored at the handoff');

	// The engine hands the trigger back at the hidden settle, announcing first.
	drainFrames(frames);
	await Promise.resolve();
	assert.equal(blob.restoreCount, 1, 'released once the exit landed');
	assert.equal(trigger.animations.length, 1, 'and the return pop played');
});

test('a close after the trigger detaches falls back to the direct spring', async (t) => {
	const trigger = makeTrigger();
	const { sheet, dialog, frames, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines);
	drainFrames(frames);
	await Promise.resolve();

	trigger.isConnected = false;
	sheet.props.open = false;
	sheet.syncOpen();

	assert.equal(dialog.open, true, 'no demotion — there is nothing to fly back to');
	assert.equal(
		blob.calls.some(([name]) => name === 'hide'),
		false
	);
	assert.equal(sheet.__testEngine().state, 'hiding');

	drainFrames(frames);
	await Promise.resolve();
	assert.equal(
		trigger.animations.length,
		0,
		'a detached trigger gets no pop — it is not on the page to pop'
	);
});

// --- arm gates --------------------------------------------------------------

test('the trigger morph refuses to arm without a resolvable trigger', async (t) => {
	for (const [label, options] of [
		['no morphTrigger prop', {}],
		['a selector that matches nothing', { props: { morphTrigger: '#nope' } }],
	]) {
		await t.test(label, async (inner) => {
			const { sheet, dialog, morphEngines } = await mountSheet(inner, {
				open: false,
				...options,
			});
			sheet.props.open = true;
			sheet.syncOpen();
			assert.equal(morphEngines.length, 0);
			assert.equal(dialog.open, true);
		});
	}
});

test('a zero morphDuration disables the trigger morph outright', async (t) => {
	const trigger = makeTrigger();
	const { sheet, dialog, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger, morphDuration: 0 },
	});

	sheet.props.open = true;
	sheet.syncOpen();

	assert.equal(morphEngines.length, 0);
	assert.equal(dialog.open, true);
});

test('reduced motion disables the trigger morph through the same one read', async (t) => {
	const trigger = makeTrigger();
	const { sheet, dialog, morphEngines } = await mountSheet(t, {
		open: false,
		reducedMotion: true,
		props: { morphTrigger: trigger },
	});

	sheet.props.open = true;
	sheet.syncOpen();

	assert.equal(morphEngines.length, 0, 'morphDuration is the whole policy');
	assert.equal(dialog.open, true);
});

// --- #usableTriggerBox ------------------------------------------------------

test('a detached, empty, or off-screen trigger is not usable', async (t) => {
	const { sheet } = await mountSheet(t, { open: false });

	const detached = makeTrigger();
	detached.isConnected = false;
	assert.equal(sheet.__testUsableTrigger(detached), false, 'detached');

	const empty = makeTrigger({ width: 0, height: 0, right: 20, bottom: 700 });
	assert.equal(sheet.__testUsableTrigger(empty), false, 'zero-size');

	const offscreen = makeTrigger({ left: 500, right: 600 });
	assert.equal(sheet.__testUsableTrigger(offscreen), false, 'wholly past the viewport');

	const unrendered = makeTrigger();
	unrendered.rects = [];
	assert.equal(sheet.__testUsableTrigger(unrendered), false, 'renders no boxes');

	assert.equal(sheet.__testUsableTrigger(makeTrigger()), true, 'an ordinary button');
});

// THE STATE GATE. MorphEngine hides the source for the whole flight AND the
// whole shown period, so a hidden trigger read while the sheet is open is the
// morph's own doing. Checking visibility there would refuse every reverse
// morph — the feature would look like it worked on open and silently never
// morph back. Both sides are asserted, because only the pair pins the gate:
// dropping it makes the second assertion fail, and dropping the check entirely
// makes the first.
test('trigger visibility is read only while the engine is hidden', async (t) => {
	const trigger = makeTrigger();
	const { sheet, styleOverrides, morphEngines, frames } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	styleOverrides.set(trigger, { visibility: 'hidden' });

	assert.equal(sheet.__testEngine().state, 'hidden');
	assert.equal(
		sheet.__testUsableTrigger(trigger),
		false,
		'hidden by the PAGE at arm time: refuse, or the blob flashes content the page hid'
	);

	// Open through the direct transport (the arm gate above refuses), settle, and
	// ask again with exactly the same hidden style.
	styleOverrides.delete(trigger);
	flyOpen(sheet, morphEngines);
	drainFrames(frames);
	await Promise.resolve();
	assert.equal(sheet.__testEngine().state, 'shown');
	styleOverrides.set(trigger, { visibility: 'hidden' });
	assert.equal(
		sheet.__testUsableTrigger(trigger),
		true,
		'hidden by the MORPH while shown: still a usable reverse destination'
	);
});

// --- the close counter ------------------------------------------------------

test('the component own closes are suppressed, an app close is not', async (t) => {
	const reasons = [];
	const trigger = makeTrigger();
	const { sheet, morphEngines } = await mountSheet(t, {
		open: false,
		close: (reason) => reasons.push(reason),
		props: { morphTrigger: trigger },
	});
	flyOpen(sheet, morphEngines);

	sheet.props.open = false;
	sheet.syncOpen();
	assert.equal(
		sheet.__testExpectedCloses(),
		1,
		'the proxy reverse demoted the dialog itself'
	);

	// dialog.close() QUEUES its close event, so the handler runs a task later —
	// a boolean cleared beside the call would already be gone.
	sheet.events.handleClose();
	assert.equal(sheet.__testExpectedCloses(), 0);
	assert.deepEqual(reasons, [], 'our own close is not reported back to the parent');
});

test('a native close landing mid-blob-flight stops the flight', async (t) => {
	const reasons = [];
	const trigger = makeTrigger();
	const { sheet, dialog, morphEngines } = await mountSheet(t, {
		open: false,
		close: (reason) => reasons.push(reason),
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines, { settle: false });
	assert.equal(dialog.open, true, 'the reveal promoted it');

	// A <form method="dialog"> submit, or app code, closes it natively while the
	// blob is still flying in. Left alone the blob would land and re-show a
	// dialog the user explicitly closed.
	dialog.close();
	sheet.events.handleClose();

	assert.equal(sheet.__testEngine().state, 'hidden');
	assert.equal(blob.state, 'idle', 'the blob was stopped, not left to land');
	assert.deepEqual(reasons, ['close']);
	assert.equal(dialog.style.display, '', 'a closed dialog goes back to display:none');
});

// --- flight deferrals -------------------------------------------------------

test('a blob flight refuses gestures and defers profile rebuilds to shown', async (t) => {
	const trigger = makeTrigger();
	const { sheet, refs, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines, { reveal: false, settle: false });
	const engine = sheet.__testEngine();
	assert.equal(engine.blobFlight, true);

	assert.equal(
		sheet.__testDragStart('header', { target: refs.header }),
		false,
		'MorphEngine owns every panel style while the blob is up'
	);

	const setProfile = engine.setProfile.bind(engine);
	let profileWrites = 0;
	engine.setProfile = (profile) => {
		profileWrites += 1;
		return setProfile(profile);
	};

	sheet.data(null, sheet.props);
	sheet.afterUpdate();
	assert.notEqual(sheet.__testBlobDeferred(), null, 'the rebuild is queued');
	assert.equal(profileWrites, 0, 'and nothing reached the engine mid-flight');

	blob.emit('reveal', {});
	blob.settleShown();
	assert.equal(sheet.__testBlobDeferred(), null, 'flushed at shown');
	assert.ok(profileWrites > 0, 'the queued rebuild ran once the sheet owns the panel');
});

// --- teardown ---------------------------------------------------------------

test('teardown releases the trigger hold and cancels the pop', async (t) => {
	const trigger = makeTrigger();
	const { sheet, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	const blob = flyOpen(sheet, morphEngines);

	// A pop already in flight when the view is torn down.
	sheet.__testEngine().emit('triggerreturn', { trigger });
	assert.equal(trigger.animations.length, 1);

	sheet.destroyed();

	assert.equal(trigger.animations[0].cancelled, true, 'the pop is cancelled');
	assert.equal(
		blob.restoreCount,
		1,
		'the hold is released — a leaked one leaves the page button invisible forever'
	);
	assert.ok(blob.calls.some(([name]) => name === 'destroy'));
});

// --- blob stacking ----------------------------------------------------------

// Scrim and dialog 1000 < panel 1001 < blob 1002. Five-digit z-indexes are
// banned library-wide, so the default is a contract rather than a detail. One
// mount per test: mountSheet's global stubs are torn down in registration
// order, so two mounts in one test pull the globals out from under the first
// sheet's own destroyed().
test('the blob defaults to z 1002', async (t) => {
	const trigger = makeTrigger();
	const { sheet, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});
	flyOpen(sheet, morphEngines, { reveal: false, settle: false });
	assert.equal(morphEngines[0].options.zIndex, 1002);
});

test('blobZIndex overrides the blob stacking level', async (t) => {
	const trigger = makeTrigger();
	const { sheet, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger, blobZIndex: 1500 },
	});
	flyOpen(sheet, morphEngines, { reveal: false, settle: false });
	assert.equal(morphEngines[0].options.zIndex, 1500);
});

test('the trigger return pop uses the configured duration and easing', async (t) => {
	const trigger = makeTrigger();
	const { sheet } = await mountSheet(t, {
		open: false,
		props: {
			morphTrigger: trigger,
			triggerReturnDuration: 320,
			triggerReturnEasing: 'linear',
		},
	});

	sheet.__testEngine().emit('triggerreturn', { trigger });

	assert.equal(trigger.animations.length, 1);
	assert.equal(trigger.animations[0].options.duration, 320);
	assert.equal(trigger.animations[0].options.easing, 'linear');
	assert.equal(trigger.animations[0].options.fill, 'both');
	assert.equal(trigger.animations[0].keyframes[0].opacity, 0);
});

test('a zero return duration creates no animation at all', async (t) => {
	const trigger = makeTrigger();
	const { sheet } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger, triggerReturnDuration: 0 },
	});

	sheet.__testEngine().emit('triggerreturn', { trigger });

	assert.deepEqual(trigger.animations, [], 'opt-out and reduced motion are one path');
	assert.equal(sheet.__testTriggerReturn(), null);
});

test('re-arming the same trigger clears its return pop first', async (t) => {
	const trigger = makeTrigger();
	const { sheet, morphEngines } = await mountSheet(t, {
		open: false,
		props: { morphTrigger: trigger },
	});

	// getComputedStyle reflects WAAPI values, so a live pop reads back its own
	// `from: 0` opacity — which the arm gate would take for a trigger the page
	// had hidden, silently dropping the morph on a rapid reopen.
	sheet.__testEngine().emit('triggerreturn', { trigger });
	const pop = trigger.animations[0];

	flyOpen(sheet, morphEngines, { reveal: false, settle: false });

	assert.equal(pop.cancelled, true);
	assert.equal(sheet.__testTriggerReturn(), null);
	assert.equal(morphEngines.length, 1, 'and the morph still armed');
});
