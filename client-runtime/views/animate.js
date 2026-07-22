/**
 * animate.js — the runtime animation engine (constellation/doc/DOC-SPEC.md §12,
 * constellation/doc/DOC-SPEC.md §4 reserved `animations` field).
 *
 * A single entry point, playAnimation(), wraps the Web Animations API so the
 * rest of the runtime never touches WAAPI directly. The field shape (SPEC §4)
 * is `animations = { in?: {from, to, duration, easing?, delay?}, out?: {...} }`;
 * each spec maps to `el.animate([from, to], {duration, easing, delay, fill})`.
 *
 * Three hard rules from the plan:
 * - Never throw. A missing WAAPI (jsdom), a malformed spec, or a browser that
 *   rejects the keyframes all degrade to an INSTANT finish, never to breakage.
 * - Cancellation resolves. `Animation.cancel()` rejects WAAPI's finished
 *   promise (AbortError); our returned `finished` swallows that so callers can
 *   always `await` it once and continue (nav interruptions, destroy-during-out).
 * - Reduced motion zeroes durations/delays but STILL resolves asynchronously,
 *   so hook ordering is identical whether or not motion is reduced.
 *
 * Scroll-triggered enter (v1.40, D73): `paused: true` creates the animation and
 * immediately `.pause()`s it at time 0 — with `fill: 'both'` the element renders
 * in its `from` keyframe (no flash of natural-state content) until the caller
 * calls the returned handle's `play()` when the element scrolls into view. A
 * failed pause() degrades to an unpaused/instant reveal (the same never-throw,
 * never-strand-hidden posture): the element still ends visible.
 */

// Warn-once bookkeeping: one warning per malformed spec OBJECT (WeakSet), plus a
// single global flag for the rare non-object spec that can't key a WeakSet.
const warnedSpecs = new WeakSet();
let warnedNonObject = false;

// Extended per-spec warnings (v1.40, D73): a spec-keyed set of message keys so
// the D73 trigger/triggerOffset warnings fire at most once per spec OBJECT each,
// independent of the malformed-spec warning above. WeakMap so specs GC freely.
const specExtraWarnings = new WeakMap();

/**
 * Play `spec` on `el` and hand back a cancel handle plus a `finished` promise
 * that ALWAYS resolves (never rejects), whether the animation completed, was
 * cancelled, was skipped for reduced motion, or degraded to an instant finish.
 *
 * @param {Element} el the animation target (the instance's existing root — no
 *   wrapper, per the no-wrapper rule)
 * @param {{from:object,to:object,duration:number,easing?:string,delay?:number}} spec
 * @param {{reducedMotion?:boolean, release?:boolean, paused?:boolean}} [options]
 *   release: give the element back when done — on completion the animation is
 *   cancelled so its `fill` stops owning the animated properties and the element
 *   returns to stylesheet-driven state (hover transitions, the element's own CSS
 *   animations work again). Used for ENTER animations; the contract is that an
 *   enter's `to` keyframe equals the element's natural styled state, so the
 *   handback is invisible. Leave animations skip it — the element is removed
 *   at finish, so ownership never matters.
 *   paused: create the animation and hold it at time 0 (from-state) via pause()
 *   — the scroll-trigger hold (D73). The returned handle's `play()` starts it;
 *   until then `finished` stays pending. A pause() failure degrades to an
 *   unpaused/instant reveal (never throw, never strand hidden).
 * @returns {{finished: Promise<void>, cancel: () => void, play: () => void}}
 */
export function playAnimation(el, spec, { reducedMotion = false, release = false, paused = false } = {}) {
	// Malformed spec → warn once, instant-finish. Rendering must never break.
	if (!isValidSpec(spec)) {
		warnOnce(spec);
		return instantFinish();
	}

	// No WAAPI (jsdom, ancient browsers) → instant-finish, never throw.
	if (typeof el?.animate !== 'function') {
		return instantFinish();
	}

	const duration = reducedMotion ? 0 : spec.duration;
	const delay = reducedMotion ? 0 : Number(spec.delay) || 0;

	let animation;
	try {
		animation = el.animate([spec.from, spec.to], {
			duration,
			delay,
			easing: spec.easing || 'linear',
			fill: 'both',
		});
	} catch {
		// A browser that refuses the keyframes must not take the render down.
		return instantFinish();
	}

	if (paused) {
		// Hold at the `from` keyframe (fill: 'both' keeps it painted) until play().
		// A browser that refuses pause() just leaves the animation running — the
		// reveal is instant instead of held, which is a graceful degrade, not a bug.
		try {
			animation.pause();
		} catch {
			/* degrade to unpaused/instant reveal */
		}
	}

	// WAAPI's finished promise REJECTS on cancel(); swallow that so our finished
	// resolves in every case. `.then(noop)` normalises the resolved value to
	// undefined so callers never see the Animation object.
	const finished = animation.finished.then(noop, noop);

	if (release) {
		// Runs after completion OR cancellation (both resolve `finished`);
		// cancelling an already-cancelled/finished animation is a no-op, so this
		// is safe in every ordering.
		finished.then(() => {
			try {
				animation.cancel();
			} catch {
				/* ignore */
			}
		});
	}

	return {
		finished,
		cancel() {
			try {
				animation.cancel();
			} catch {
				/* already finished/cancelled — ignore */
			}
		},
		play() {
			// Start a paused (held) animation. A no-op on an already-running one, and
			// never throws. If play() DOES throw, cancel the animation so the element
			// returns to its natural (visible) stylesheet state rather than staying
			// stranded at the hidden fill:'both' from-state — content must never be
			// left invisible (SPEC §39). cancel() is itself guarded and idempotent.
			try {
				animation.play();
			} catch {
				try {
					animation.cancel();
				} catch {
					/* already finished/cancelled — ignore */
				}
			}
		},
	};
}

/**
 * Cancel every WAAPI animation currently affecting `el`, handing the element
 * back to its stylesheet-driven state — Animation.cancel() clears the effect,
 * INCLUDING a finished-but-still-filling one (which is how a completed out
 * animation holds an element invisible under `fill: 'both'`). The router's
 * navigation-failure recovery uses this to RESTORE an outgoing unit whose out
 * animation ran for a navigation that never completed: #state is unchanged, so
 * that unit is still the committed view and must come back on screen. Root
 * element only (the one-animator rule puts the out animation on the animator's
 * root — never on descendants). Same hard rules as playAnimation: never throw;
 * no getAnimations (jsdom, old browsers) degrades to a no-op.
 *
 * @param {Element|null} el the animator's root element
 */
export function cancelAnimations(el) {
	if (!el || typeof el.getAnimations !== 'function') return;
	let animations;
	try {
		animations = el.getAnimations();
	} catch {
		return;
	}
	for (const animation of animations) {
		try {
			animation.cancel();
		} catch {
			/* already finished/cancelled — ignore */
		}
	}
}

/**
 * Detect the OS "reduce motion" setting. Guarded for environments without
 * matchMedia (jsdom by default) — those report "no preference" (false).
 * @returns {boolean}
 */
export function prefersReducedMotion() {
	if (typeof matchMedia !== 'function') return false;
	try {
		return matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

// ---- internals ---------------------------------------------------------------

/**
 * A resolved handle: an animation that already "finished" and can't cancel.
 * `play` is a no-op so the paused-handle shape (D73) is uniform even when a
 * degraded/instant handle is returned — a caller can always call play().
 */
function instantFinish() {
	return { finished: Promise.resolve(), cancel: noop, play: noop };
}

/**
 * A spec is animatable only with both keyframes and a numeric, finite duration.
 * Anything else is treated as malformed (warn once, skip). Exported so PuzzleView
 * can gate the D73 visible-trigger branch on a valid spec (a malformed spec must
 * take the normal warn/skip path — no hold, no defer).
 */
export function isValidSpec(spec) {
	return (
		!!spec &&
		typeof spec === 'object' &&
		!!spec.from &&
		!!spec.to &&
		typeof spec.duration === 'number' &&
		Number.isFinite(spec.duration)
	);
}

/** Warn at most once per spec object (or once globally for non-object specs). */
function warnOnce(spec) {
	if (spec && typeof spec === 'object') {
		if (warnedSpecs.has(spec)) return;
		warnedSpecs.add(spec);
	} else {
		if (warnedNonObject) return;
		warnedNonObject = true;
	}
	console.warn(
		'[puzzle] ignoring malformed animation spec (need { from, to, duration:number }):',
		spec
	);
}

/**
 * Warn at most once per spec OBJECT for a given `message` (v1.40, D73). Used for
 * the extended enter-spec diagnostics — an unknown `trigger` value and an invalid
 * `triggerOffset` — so each fires once per spec even across repeated playIn()
 * attempts. Keyed by (spec, message); a non-object spec warns unconditionally
 * (it can't key a WeakMap, and such specs are already malformed-warned upstream).
 *
 * @param {object} spec the animation spec the message concerns
 * @param {string} message the warning text (already caller-composed)
 */
export function warnOnceForSpec(spec, message) {
	if (!spec || typeof spec !== 'object') {
		console.warn('[puzzle] ' + message);
		return;
	}
	let seen = specExtraWarnings.get(spec);
	if (!seen) {
		seen = new Set();
		specExtraWarnings.set(spec, seen);
	}
	if (seen.has(message)) return;
	seen.add(message);
	console.warn('[puzzle] ' + message);
}

function noop() {}

export default playAnimation;
