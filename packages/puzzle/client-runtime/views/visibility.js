/**
 * visibility.js — a shared IntersectionObserver registry for scroll-triggered
 * enter animations (constellation/doc/DOC-SPEC.md §39, D73).
 *
 * A view with `animations.in.trigger === 'visible'` holds its enter animation
 * paused until its root (or a `triggerAnchor` ancestor) scrolls into view;
 * PuzzleView.#deferredEnter arms an observation here. Rather than spin up one
 * IntersectionObserver per element, every observation with the SAME rootMargin
 * shares ONE IO instance (a page-worth of scroll-revealed cards is one observer,
 * not hundreds). The registry is keyed by the rootMargin string; the entry's
 * target Map routes intersection callbacks and doubles as the live-count — when
 * its last target disarms, the IO is disconnected and the entry dropped.
 *
 * An element may carry MULTIPLE callbacks (D73 triggerAnchor: five cards all
 * anchored to one `.section` observe that same element), so each target maps to
 * a Set<callback>, not a single callback. All callbacks for an intersecting
 * element fire in one delivery (error-isolated per callback); an element is
 * unobserved only when its Set empties, and the IO disconnected only when the
 * whole bucket empties. observeVisible's signature is unchanged — each call adds
 * its callback and its disarm removes only that one.
 *
 * Same hard discipline as animate.js: NEVER throw. A missing IntersectionObserver
 * global (jsdom, ancient browsers) makes observeVisible return null so the caller
 * degrades to mount-trigger behavior — content is never stranded hidden. A
 * throwing observe()/construct/callback is swallowed and logged, never breakage.
 */

// rootMargin string → { io, targets: Map<Element, Set<callback>> }. Module-global
// so every view shares observers by margin. Entries self-delete when empty.
const registry = new Map();

/**
 * Observe `el` and invoke `callback` the FIRST time it intersects the viewport
 * (threshold 0, offset baked into `rootMargin`). Returns a `disarm()` that stops
 * the observation and reclaims the shared IO when it was the last target — or
 * `null` when IntersectionObserver is unavailable or the element/observer can't
 * be set up, signalling the caller to fall back to immediate (mount) behavior.
 *
 * The callback is delivered at most as the registry sees intersections; the
 * CALLER owns once-only semantics by calling disarm() from inside its callback
 * (PuzzleView reveals once, then disarms). Delivering only on `isIntersecting`
 * keeps a leaving-viewport entry from firing. Multiple callbacks may share one
 * `el` (D73 triggerAnchor group reveals) — each is tracked separately, all fire
 * on the same intersection, and each disarm removes only its own.
 *
 * @param {Element} el the element to watch (the view's root, or a triggerAnchor)
 * @param {string} rootMargin a fully-resolved IO rootMargin (e.g.
 *   '0px 0px -100px 0px'); observations sharing a margin share one IO instance
 * @param {() => void} callback invoked on the first intersection
 * @returns {(() => void) | null} disarm fn, or null if observation is unsupported
 */
export function observeVisible(el, rootMargin, callback) {
	if (typeof IntersectionObserver !== 'function') return null;
	if (!el || el.nodeType !== 1 /* ELEMENT_NODE */) return null;

	let entry = registry.get(rootMargin);
	if (!entry) {
		let io;
		try {
			io = new IntersectionObserver(makeHandler(rootMargin), { rootMargin, threshold: 0 });
		} catch {
			// A browser that rejects the margin string must not take the render down.
			return null;
		}
		entry = { io, targets: new Map() };
		registry.set(rootMargin, entry);
	}

	let callbacks = entry.targets.get(el);
	const firstForEl = !callbacks;
	if (firstForEl) {
		callbacks = new Set();
		entry.targets.set(el, callbacks);
	}
	callbacks.add(callback);

	// Observe the element only the FIRST time it joins a bucket — a later callback
	// sharing the element rides the existing observation (observe() is idempotent
	// anyway, but this keeps the failure-undo below scoped to a genuinely new el).
	if (firstForEl) {
		try {
			entry.io.observe(el);
		} catch {
			// observe() failed — undo the bookkeeping and let the caller reveal now.
			entry.targets.delete(el);
			if (entry.targets.size === 0) {
				try {
					entry.io.disconnect();
				} catch {
					/* ignore */
				}
				registry.delete(rootMargin);
			}
			return null;
		}
	}

	let armed = true;
	return () => {
		if (!armed) return; // idempotent — a double disarm is a no-op
		armed = false;
		disarm(rootMargin, el, callback);
	};
}

// ---- internals ---------------------------------------------------------------

/** The IO callback for one rootMargin bucket: fire each intersecting target's cbs. */
function makeHandler(rootMargin) {
	return (entries) => {
		const bucket = registry.get(rootMargin);
		if (!bucket) return;
		for (const ioEntry of entries) {
			if (!ioEntry.isIntersecting) continue;
			const callbacks = bucket.targets.get(ioEntry.target);
			if (!callbacks) continue;
			// Each callback disarms its own target (once-only reveal), which mutates
			// the Set — iterate a snapshot so a mid-delivery disarm can't skip a
			// sibling. Never let one callback's throw abort delivery to the others,
			// or to other targets in this batch.
			for (const cb of [...callbacks]) {
				try {
					cb();
				} catch (err) {
					console.error('[puzzle] visibility callback failed:', err);
				}
			}
		}
	};
}

/**
 * Remove `callback` from `el`'s Set in `rootMargin`'s bucket; unobserve `el` when
 * its Set empties, and reclaim the IO when the whole bucket empties. Other
 * callbacks anchored to the same `el` stay armed.
 */
function disarm(rootMargin, el, callback) {
	const entry = registry.get(rootMargin);
	if (!entry) return;
	const callbacks = entry.targets.get(el);
	if (!callbacks) return;
	callbacks.delete(callback);
	// Still other callbacks on this element (a group reveal, some destroyed early)
	// → keep observing it for them.
	if (callbacks.size > 0) return;
	entry.targets.delete(el);
	try {
		entry.io.unobserve(el);
	} catch {
		/* ignore */
	}
	// Last target gone → disconnect the shared observer and drop the bucket so a
	// later observation with this margin builds a fresh one.
	if (entry.targets.size === 0) {
		try {
			entry.io.disconnect();
		} catch {
			/* ignore */
		}
		registry.delete(rootMargin);
	}
}

export default observeVisible;
