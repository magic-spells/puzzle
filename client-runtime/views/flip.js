/**
 * flip.js — FLIP (First, Last, Invert, Play) animation for keyed reorders
 * (constellation/doc/DOC-SPEC.md §12, constellation/doc/DOC-DECISIONS.md D85).
 *
 * Enter/leave animations (animate.js) cover elements that APPEAR or VANISH; a
 * keyed reorder does neither — the same DOM node stays mounted and jumps to a
 * new position instantly. `flip` on the keyed row root opts that row into a
 * position transition: measure the old rect BEFORE the patch (First), let the
 * existing keyed reconciliation move the node UNCHANGED, measure again (Last),
 * then play a transform from the old position back to rest (Invert + Play).
 * No wrapper elements, no vnode changes — the moved element animates itself.
 *
 * `flip` is a framework directive like `key`/`island`/`ref`: it never reaches
 * the DOM (viewManager setAttr/removeAttr) or SSG markup (ssg/serialize).
 * Bare `flip` (compiled to `true`) takes the defaults; `flip={ { duration,
 * easing } }` overrides them. `false`/null/undefined mean "no flip" — the same
 * absent-attribute semantics setAttr gives falsy values — so a conditional
 * `flip={enabled && {...}}` disables cleanly. A malformed spec falls back to
 * the defaults silently: it is optional motion config, not a template error.
 *
 * Hard rules, shared with animate.js:
 * - Never throw. Missing WAAPI (jsdom), a refused keyframe, a mid-patch
 *   replaced element — every failure degrades to "no animation", per element.
 * - Zero cost when unused. The caller (patchKeyedChildren) only invokes
 *   beginFlip() when some new child actually carries a `flip` attr, and
 *   beginFlip bails before ANY measurement when there are no retained
 *   candidates, when the OS prefers reduced motion, or when WAAPI is absent.
 * - Own only our animations. Interrupted flips are cancelled through the
 *   element→Animation WeakMap below — never via getAnimations(), which would
 *   kill author-owned animations running on the same element.
 */

import { prefersReducedMotion } from './animate.js';

// D85 defaults: a snappy standard-curve slide. Overridable per row via the
// `flip` attr object; anything malformed silently falls back here.
const DEFAULT_DURATION = 250;
const DEFAULT_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

// Sub-pixel deltas are layout noise (zoom/DPR rounding), not moves — skip them.
const MIN_DELTA = 0.5;

/**
 * The Puzzle-owned FLIP animation currently running on an element. A rapid
 * second reorder must cancel the in-flight flip (after re-measuring — the
 * mid-flight rect IS the correct new First position) so the transforms don't
 * stack; tracking our own animations in a WeakMap keeps author animations on
 * the same element untouched. Entries clear on finish/cancel; WeakMap so an
 * entry can never outlive its element either way.
 */
const activeFlips = new WeakMap();

// `flip` on a row that fell back to positional diffing (null key) animates
// nothing — FLIP needs the identity a key provides. Warn at most once per
// session (a bounded global, like viewManager's warnDuplicateKey).
let warnedUnkeyedFlip = false;
function warnUnkeyedFlip() {
	if (warnedUnkeyedFlip) return;
	warnedUnkeyedFlip = true;
	console.warn(
		'[puzzle] `flip` requires a keyed row — this list child has no usable key, so it ' +
			'diffs positionally and cannot FLIP-animate; add key={ … } to the row root.'
	);
}

/**
 * FIRST phase: collect retained flip candidates from the keyed patcher's
 * [oldChild|null, newChild] pairs and measure their pre-patch rects. Called by
 * patchKeyedChildren BEFORE its removal loop (removals reflow the survivors —
 * measuring after them would record wrong First positions).
 *
 * A candidate is a RETAINED keyed row opting in: old counterpart exists, key
 * is non-null, `flip` is enabled, and the old vnode holds a live element.
 * Fresh mounts (no oldChild) keep the enter path; removed rows never appear in
 * `pairs` at all — both exclusions fall out by construction.
 *
 * Rects are measured BEFORE cancelling any in-flight flip on the same element:
 * getBoundingClientRect includes active transforms, so a mid-flight rect is
 * exactly where the user SEES the row — the correct start for the next flip.
 * Cancelling first would snap the row to its layout position and make the
 * follow-up animation jump.
 *
 * @param {Array<[object|null, object]>} pairs the keyed patcher's first-pass output
 * @returns {Array<{el: Element, newChild: object, spec: *, first: DOMRect}>|null}
 *   the flip session playFlip() consumes, or null when there is nothing to do
 */
export function beginFlip(pairs) {
	let candidates = null;
	for (const [oldChild, newChild] of pairs) {
		const spec = newChild.attrs.flip;
		if (spec == null || spec === false) continue; // absent/disabled — setAttr's falsy semantics
		if (newChild.key == null) {
			warnUnkeyedFlip();
			continue;
		}
		if (!oldChild || !oldChild.el || oldChild.el.nodeType !== 1) continue; // fresh mount / no live element
		(candidates ??= []).push({ el: oldChild.el, newChild, spec, first: null });
	}
	if (!candidates) return null;

	// Bail BEFORE any measurement: reduced motion skips the whole feature, and a
	// runtime without WAAPI (jsdom, ancient browsers) could never play — probing
	// the first candidate's element covers the environment, not just one node.
	if (prefersReducedMotion()) return null;
	if (typeof candidates[0].el.animate !== 'function') return null;

	// Measure ALL candidates first, THEN cancel in-flight flips — cancel drops
	// the transform, and later candidates must still measure their mid-flight rects.
	for (const c of candidates) {
		try {
			c.first = c.el.getBoundingClientRect();
		} catch {
			/* degrade: a candidate without a First rect is skipped in playFlip */
		}
	}
	for (const c of candidates) cancelTrackedFlip(c.el);
	return candidates;
}

/**
 * LAST + INVERT + PLAY phase: called by patchKeyedChildren after its second
 * pass — every retained element has patched and moved into final position.
 * Measures each candidate's post-patch rect, skips sub-pixel deltas, and plays
 * a WAAPI transform from the old position to rest.
 *
 * The from-transform composes the inverted translate BEFORE the element's
 * pre-existing computed base transform (v1 keeps this simple: read
 * getComputedStyle().transform; a non-'none' matrix rides along in both
 * keyframes so a statically-transformed row — scale, rotate — slides without
 * losing its transform). No `fill`: the animation releases at finish and the
 * element returns to stylesheet-driven state, exactly the ownership-handback
 * posture animate.js's release option exists for.
 *
 * @param {ReturnType<typeof beginFlip>} candidates a non-null beginFlip session
 */
export function playFlip(candidates) {
	for (const c of candidates) {
		// Re-resolve the element from the PATCHED vnode: patch() transferred the
		// old el onto newChild for a retained row, so this is normally the same
		// node measured in beginFlip — but guard everything (replaced el, missing
		// First rect, absent animate mid-list) and degrade per element, never throw.
		const el = c.newChild.el;
		if (!c.first || !el || el.nodeType !== 1 || typeof el.animate !== 'function') continue;

		let last;
		try {
			last = el.getBoundingClientRect();
		} catch {
			continue;
		}
		const dx = c.first.left - last.left;
		const dy = c.first.top - last.top;
		if (Math.abs(dx) < MIN_DELTA && Math.abs(dy) < MIN_DELTA) continue; // didn't move

		const { duration, easing } = resolveFlipOptions(c.spec);
		const translate = `translate(${dx}px, ${dy}px)`;
		let base = 'none';
		try {
			base = getComputedStyle(el).transform || 'none';
		} catch {
			/* no computed style (detached/odd host) — treat as untransformed */
		}
		const from = base !== 'none' ? `${translate} ${base}` : translate;
		const to = base !== 'none' ? base : 'none';

		let animation;
		try {
			animation = el.animate([{ transform: from }, { transform: to }], { duration, easing });
		} catch {
			continue; // a refused keyframe must not take the patch down
		}
		activeFlips.set(el, animation);
		// Clear the tracking entry on finish OR cancel — but only if it still
		// points at THIS animation: a rapid re-flip already replaced the entry,
		// and the superseded animation's settling must not evict its successor.
		const done = () => {
			if (activeFlips.get(el) === animation) activeFlips.delete(el);
		};
		try {
			animation.finished.then(done, done);
		} catch {
			/* partial Animation impl without `finished` — WeakMap entry GCs with the element */
		}
	}
}

/** Cancel the Puzzle-owned flip on `el`, if any. Never touches other animations. */
function cancelTrackedFlip(el) {
	const prior = activeFlips.get(el);
	if (!prior) return;
	activeFlips.delete(el); // evict first so prior's settle-callback can't race the new entry
	try {
		prior.cancel();
	} catch {
		/* already finished/cancelled — ignore */
	}
}

/**
 * Resolve `{ duration, easing }` from a row's flip spec. `true` (bare attr)
 * and any malformed shape take the defaults — silently, per the optional-config
 * contract. Unknown keys are ignored.
 */
function resolveFlipOptions(spec) {
	let duration = DEFAULT_DURATION;
	let easing = DEFAULT_EASING;
	if (spec && typeof spec === 'object') {
		if (typeof spec.duration === 'number' && Number.isFinite(spec.duration) && spec.duration > 0) {
			duration = spec.duration;
		}
		if (typeof spec.easing === 'string' && spec.easing !== '') {
			easing = spec.easing;
		}
	}
	return { duration, easing };
}
