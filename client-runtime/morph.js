/**
 * Shared-element morph route transitions (v1.23 D55; v1.35 D68) — the
 * puzzle-owned convention over @magic-spells/morph-engine.
 *
 * Mark any two elements with the same `data-puzzle-morph` value and the router
 * morphs between them across a navigation. One line activates it:
 *
 *   import { enableMorph } from '@magic-spells/puzzle/morph';
 *   enableMorph(app);
 *
 * Two shapes, one handler, resolved per transition:
 *
 * 1. COEXISTING LIVE PAIRS (D55). A nested-route dialog: the source card stays
 *    mounted while the dialog swaps into its Slot. Both elements are live DOM at
 *    the same instant, so we pair them directly — a spring blob grows from the
 *    source into the freshly mounted target on enter, and flies BACK on leave
 *    (including via the browser back button) when the round trip is intact. This
 *    path always wins when a live counterpart exists.
 *
 * 2. SIBLING-SWAP CAPTURE FLIGHTS (D68). A sibling view swap (Library → Album)
 *    destroys the source view — and its card — BEFORE the destination mounts, so
 *    there is never a pairing moment. We bridge it with a CLONE: leave() (element
 *    still measurable) snapshots every morph element in the outgoing subtree, and
 *    enter() flies a position:fixed clone from the snapshot rect into the newly
 *    mounted counterpart. One-shot in each direction — a back/forward pop captures
 *    the same way from the leaving side, so Album → Library flies the header art
 *    back into its grid card. Automatic, default-on, both directions, no options.
 *    A pre-fade PINNED clone (armed from the click that started the navigation)
 *    makes the art visually hold still while the old view animates out.
 *
 * Three attributes share ONE id namespace, derived from the configured base
 * (default `data-puzzle-morph`; `options.attribute` overrides all three):
 *
 *   - `data-puzzle-morph="id"` (plain) — launches AND receives. Symmetric pairs
 *     (dialogs). The original D55/D68 behavior.
 *   - `data-puzzle-morph-trigger="id"` (D69) — launches ONLY: eligible as a leave
 *     snapshot, a click-pin, and a D55 live-pair SOURCE, but NEVER a landing
 *     (excluded from every enter-side receive scan). The back-nav that renders
 *     plainly.
 *   - `data-puzzle-morph-target="id"` (D69) — receives ONLY: the landing, PREFERRED
 *     over a plain same-id element when ids collide; never launches anything.
 *
 * An element carrying more than one is undefined behavior — the read precedence is
 * plain → target → trigger (morphId), first wins, no warning.
 *
 * The router only exposes the narrow setMorphHandler slot (enter after a committed
 * swap mounts, pre-paint; leave awaited before an outgoing unit is destroyed).
 * Everything morph-shaped lives here, so apps that never import this subpath bundle
 * none of it (the engine is an optional peer dep). The initial navigation never
 * morphs (deep links show the view plainly) and `prefers-reduced-motion` disables
 * both paths entirely.
 *
 * Rules for morph elements (see the engine's own docs for the full list):
 * - No transform-based positioning and no stylesheet `opacity` on the target —
 *   the engine drives inline transform/opacity during the reveal. Center with
 *   flex or `inset: 0; margin: auto`.
 * - No CHANGING dynamic `style={}` binding on either element — the patcher
 *   rewrites the whole style attribute and would clobber the engine's frames.
 * - Route-mounted targets need no resting `visibility: hidden` — the engine
 *   hides both elements synchronously at show(), before the browser paints.
 */

import { MorphEngine } from '@magic-spells/morph-engine';

const ATTRIBUTE = 'data-puzzle-morph';

// A clicked candidate is a live hint for at most this long (an abandoned click
// that never navigates simply ages out and pins nothing).
const CLICK_TTL_MS = 5000;
// A pinned/snapshot clone whose target never arrives fades and drops after this.
const CAPTURE_TTL_MS = 2000;
// Fade duration for discarding an unclaimed clone.
const FADE_MS = 150;

// app → its live teardown, so a second enableMorph on the same app disposes the
// first (never stacking a duplicate document click listener), and app.unmount()
// can reach the teardown through the handler object. WeakMap: a discarded app and
// its teardown closure GC together.
const installedMorphs = new WeakMap();

/**
 * Create a MorphEngine and register it as the app router's morph handler.
 * Call once, after `new PuzzleApp(...)` — before or after mount() both work
 * (the handler is only consulted during swaps).
 *
 * @param {import('./app.js').PuzzleApp} app
 * @param {object} [options] MorphEngine options (attraction, friction,
 *   revealAt, zIndex, ...) plus `attribute` to override the base morph attribute
 *   (all three roles — plain / `-trigger` / `-target` — derive from it).
 * @returns {MorphEngine} the engine, for live tuning and events
 */
export function enableMorph(app, options = {}) {
	// Double-install guard: tear down any prior enableMorph on this same app first,
	// so calling it twice never leaves a duplicate document click listener behind.
	installedMorphs.get(app)?.();

	const { attribute = ATTRIBUTE, ...engineOptions } = options;
	// One id namespace, three roles derived from the base (D69): plain launches AND
	// receives; `-trigger` launches only (never a landing); `-target` receives only
	// (the preferred landing on an id collision, never launches). See the file header.
	const triggerAttribute = `${attribute}-trigger`;
	const targetAttribute = `${attribute}-target`;
	// Role-scoped selectors: launch-eligible = plain + trigger; receive-eligible =
	// plain + target. querySelectorAll dedupes and returns document order.
	const launchSelector = `[${attribute}], [${triggerAttribute}]`;
	const receiveSelector = `[${attribute}], [${targetAttribute}]`;
	const engine = new MorphEngine({ attraction: 0.1, friction: 0.32, ...engineOptions });

	// The currently shown (or in-flight) LIVE pairing. `id` is the attribute value
	// at show() time — a later params-only navigation can re-point the same mounted
	// view at new content, which changes the attribute WITHOUT a swap; leave()
	// compares against this to refuse flying back to the wrong counterpart. Clone
	// flights never set this — they are one-shot (the reverse trip is a fresh
	// capture from the next leave, never engine.hide()).
	let pair = null;
	// The most recent click that could start a navigation: { el, time } or null.
	// Recorded with ZERO DOM writes — only leave() acts on it. Lets leave() pin a
	// clone pre-fade so the clicked surface holds still during the out phase.
	let lastClicked = null;
	// Snapshots taken at leave time for a pending sibling-swap flight:
	// { pinned: { id, clone, rect, ttl } | null, snapshots: Map<id,{el,rect}> } | null.
	let captures = null;
	// A deferred-target watcher (skeleton views mount the real template a beat late):
	// { observer, ttl } | null.
	let crossFlight = null;

	// Warn-once misuse guard (the D43 formatter / D58 null-key posture): one flag,
	// fired at most once per enableMorph call, unconditional (production strips
	// console.*). Warning only — it never changes morph behavior.
	let warnedDuplicateId = false;

	// Read an element's morph id across the three roles — plain, else `-target`, else
	// `-trigger` (an element carrying more than one is undefined behavior: first in
	// this precedence wins, no warning). The single id read behind every scan.
	const morphId = (el) =>
		el.getAttribute(attribute) ?? el.getAttribute(targetAttribute) ?? el.getAttribute(triggerAttribute);

	// A duplicate id among launch-eligible (or plain receive-eligible) elements flies
	// the wrong element unless disambiguated — targets drop out of the launch maps, so
	// this only fires for multiple untagged/`-trigger` sources sharing a value. Fires
	// from both id-collecting scans (leave snapshots, live-pair counterparts); capped.
	const warnDuplicateId = (id) => {
		if (warnedDuplicateId) return;
		warnedDuplicateId = true;
		console.warn(
			`[puzzle] duplicate ${attribute} id "${id}" — first match in document order wins ` +
				`as the source (a real click picks the clicked one); use ${targetAttribute}="${id}" ` +
				`on the intended destination to prioritize it, and interpolate record ids if this ` +
				`is a repeated component`
		);
	};

	const now = () =>
		typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

	const reducedMotion = () =>
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	const measurable = (el) => !!el && el.getClientRects && el.getClientRects().length > 0;

	// Elements matching `selector` inside `root` (root itself counts), in document
	// order — the one scan behind every subtree walk. `launchElements` (plain +
	// trigger) drives leave snapshots and live-pair sources; `receiveElements` (plain
	// + target) drives the enter-side landing scans.
	const scan = (root, selector) => {
		const out = [];
		if (root.matches(selector)) out.push(root);
		for (const e of root.querySelectorAll(selector)) out.push(e);
		return out;
	};
	const launchElements = (root) => scan(root, launchSelector);
	const receiveElements = (root) => scan(root, receiveSelector);

	// Clone `el` into a position:fixed stand-in pinned over `rect`. The clone must
	// NEVER match a scan/observer/counterpart lookup, so ALL THREE role attributes are
	// stripped; z below the engine's blob, pointer-events off so it can't trap clicks.
	const pinClone = (el, rect) => {
		const clone = el.cloneNode(true);
		clone.removeAttribute(attribute);
		clone.removeAttribute(triggerAttribute);
		clone.removeAttribute(targetAttribute);
		clone.style.cssText =
			`position:fixed; top:${rect.top}px; left:${rect.left}px; width:${rect.width}px; ` +
			`height:${rect.height}px; margin:0; z-index:55; pointer-events:none;`;
		document.body.appendChild(clone);
		return clone;
	};

	// Fade a clone out over 150ms, then remove it (art-morph's TTL recipe).
	const fadeRemove = (clone) => {
		if (!clone || !clone.isConnected) return;
		clone.style.transition = `opacity ${FADE_MS}ms`;
		clone.style.opacity = '0';
		setTimeout(() => {
			if (clone.isConnected) clone.remove();
		}, FADE_MS);
	};

	// Drop a pending capture: fade any unclaimed pinned clone, clear its TTL and
	// the snapshots. Idempotent.
	const discardCaptures = () => {
		if (!captures) return;
		if (captures.pinned) {
			clearTimeout(captures.pinned.ttl);
			fadeRemove(captures.pinned.clone);
		}
		captures = null;
	};

	// Disarm a pending deferred-target watcher (observer + its TTL). Idempotent.
	const disarmCrossFlight = () => {
		if (!crossFlight) return;
		if (crossFlight.observer) crossFlight.observer.disconnect();
		if (crossFlight.ttl) clearTimeout(crossFlight.ttl);
		crossFlight = null;
	};

	// Fly a one-shot clone into `target`, then unwind exactly like art-morph:
	// always drop the clone; call engine.stop() ONLY on a true settle with a
	// non-idle engine — a false settle means a newer flight superseded this one and
	// may already own the engine, so stopping then would abort ITS morph.
	const runCloneFlight = async (clone, target) => {
		const settled = await engine.show({ from: clone, to: target });
		if (clone.isConnected) clone.remove();
		if (settled && engine.state !== 'idle') engine.stop();
	};

	// Claim the capture for `id` and fly it into `target`. Reuses the pre-armed
	// pinned clone when it matches (cancelling its TTL); otherwise mints one NOW
	// from the detached snapshot at its captured rect — enter is pre-paint, so the
	// clone appears the same frame as the new view's first paint.
	const flyCapture = (id, target) => {
		let clone;
		if (captures.pinned && captures.pinned.id === id) {
			clearTimeout(captures.pinned.ttl);
			clone = captures.pinned.clone;
			captures.pinned = null;
		} else {
			const snap = captures.snapshots.get(id);
			clone = pinClone(snap.el, snap.rect);
		}
		// Any remaining capture (a pinned clone for a different id) is now dead.
		discardCaptures();
		runCloneFlight(clone, target);
	};

	// Entering morph element to fly a captured clone INTO — receive-eligible (plain +
	// target; triggers are excluded, so they never receive), measurable, AND matching
	// a snapshot. Landing preference (D69): a `-target` element is the declared
	// destination, so it wins over a plain same-id element regardless of document order
	// (the artist's header art beats a plain re-feature card lower on the page).
	const tryCapturePath = (root) => {
		const candidates = receiveElements(root).filter(
			(t) => measurable(t) && captures.snapshots.has(morphId(t))
		);
		const target = candidates.find((t) => t.hasAttribute(targetAttribute)) || candidates[0];
		if (!target) return false;
		flyCapture(morphId(target), target);
		return true;
	};

	// Watch `root` for a deferred target (skeleton → real template swap). On each
	// mutation batch retry the capture path; a 2s TTL drops the capture if the
	// target never lands (failed nav, wrong route, not-found).
	const armDeferred = (root) => {
		const observer = new MutationObserver(() => {
			if (!captures) {
				disarmCrossFlight();
				return;
			}
			if (tryCapturePath(root)) disarmCrossFlight();
		});
		observer.observe(root, { childList: true, subtree: true });
		const ttl = setTimeout(() => {
			disarmCrossFlight();
			discardCaptures();
		}, CAPTURE_TTL_MS);
		crossFlight = { observer, ttl };
	};

	// Snapshot the leaving subtree for a possible sibling-swap flight, and (if the
	// click that started this nav landed inside it) pin a clone pre-fade so the
	// clicked art holds still while the old view animates out.
	const captureFromLeaving = (el) => {
		// The previous navigation's capture never got claimed — drop it now.
		discardCaptures();
		disarmCrossFlight();

		// Launch-eligible only (plain + trigger; targets never launch). Detached refs
		// stay cloneable after the view is destroyed; first id wins.
		const snapshots = new Map();
		for (const e of launchElements(el)) {
			if (e.getClientRects().length === 0) continue;
			const id = morphId(e);
			if (snapshots.has(id)) {
				if (snapshots.get(id).el !== e) warnDuplicateId(id); // guard: same id, different element
				continue;
			}
			snapshots.set(id, { el: e, rect: e.getBoundingClientRect() });
		}

		if (snapshots.size === 0) {
			captures = null;
			return;
		}
		captures = { pinned: null, snapshots };

		// A fresh click on a launch-eligible element inside the leaving subtree pins a
		// clone NOW — appears the same frame, so the surface never blinks during the
		// fade. `-target` elements are excluded (they never launch), so a clicked target
		// pins nothing.
		if (lastClicked && now() - lastClicked.time < CLICK_TTL_MS) {
			const c = lastClicked.el;
			if (
				c &&
				c.nodeType === 1 &&
				c.isConnected &&
				el.contains(c) &&
				c.matches(launchSelector) &&
				c.getClientRects().length > 0
			) {
				const id = morphId(c);
				const rect = c.getBoundingClientRect();
				const clone = pinClone(c, rect);
				const ttl = setTimeout(() => {
					fadeRemove(clone);
					if (captures && captures.pinned && captures.pinned.clone === clone) captures.pinned = null;
				}, CAPTURE_TTL_MS);
				captures.pinned = { id, clone, rect, ttl };
				lastClicked = null; // consumed
			}
		}
	};

	// Zero-write click hint: record WHICH launch-eligible element a click targeted (the
	// card itself, or the launch element nested inside the clicked link/button) so
	// leave() can pin exactly it. Only plain + trigger elements are candidates — a
	// clicked `-target` records nothing. Clicks that never navigate cost nothing.
	// Guarded for SSG — enableMorph runs under node during prerender, no document.
	const onDocumentClick = (event) => {
		const t = event.target;
		if (!t || t.nodeType !== 1) return;
		let candidate = t.closest(launchSelector);
		if (!candidate) {
			const trigger = t.closest('a, button, [role="button"]');
			candidate = trigger ? trigger.querySelector(launchSelector) : null;
		}
		if (candidate) lastClicked = { el: candidate, time: now() };
	};
	const hasDocument = typeof document !== 'undefined';
	if (hasDocument) document.addEventListener('click', onDocumentClick, true);

	// Measurable launch-eligible (plain + trigger) elements OUTSIDE `excludeRoot`,
	// first-per-id — the live-pair SOURCE candidates. Targets are absent from the
	// selector, so a `-target` element can never become a source. Collected ONCE per
	// enter (a busy grid can hold ~50 elements) so the live-pair scan is a map lookup.
	const collectCounterparts = (excludeRoot) => {
		const map = new Map();
		for (const candidate of document.querySelectorAll(launchSelector)) {
			if (excludeRoot.contains(candidate)) continue;
			if (candidate.getClientRects().length === 0) continue;
			const id = morphId(candidate);
			if (map.has(id)) {
				if (map.get(id) !== candidate) warnDuplicateId(id); // guard: same id, different element
				continue;
			}
			map.set(id, candidate);
		}
		return map;
	};

	// Teardown: drop the document click listener, release the (possibly detached)
	// lastClicked ref, cancel any in-flight capture / deferred-target observer /
	// engine work, and forget this app. Idempotent. Reached two ways: app.unmount()
	// calls it through the handler's `dispose` below, and a second enableMorph on
	// this app calls it via the double-install guard. engine.stop() (not destroy())
	// leaves the engine reusable; re-enabling morph after unmount means calling
	// enableMorph again, which is safe.
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		if (hasDocument) document.removeEventListener('click', onDocumentClick, true);
		lastClicked = null;
		discardCaptures();
		disarmCrossFlight();
		if (engine.state !== 'idle') engine.stop();
		installedMorphs.delete(app);
	};
	engine.dispose = dispose;
	installedMorphs.set(app, dispose);

	app.setMorphHandler({
		enter(el, { initial }) {
			// An interrupted transition (skipped out phase, abandoned commit) can
			// strand a run — every enter starts from a clean engine no matter what.
			if (engine.state !== 'idle') engine.stop();
			pair = null;
			disarmCrossFlight();

			if (initial || !el || el.nodeType !== 1 || reducedMotion()) {
				discardCaptures();
				return;
			}

			// Receive-eligible entering elements (plain + target; triggers never receive,
			// so a trigger is never picked as a live-pair TARGET).
			const entering = receiveElements(el);

			// Live-pair path (D55) — must win: an entering element with a live counterpart
			// OUTSIDE the entering subtree flies the real source→target. Same landing
			// preference as the capture path — a `-target` element is the declared
			// destination, so it wins over a plain same-id one regardless of document order.
			const counterparts = collectCounterparts(el);
			const matches = [];
			for (const target of entering) {
				const source = counterparts.get(morphId(target));
				if (source) matches.push({ id: morphId(target), source, target });
			}
			const match = matches.find((m) => m.target.hasAttribute(targetAttribute)) || matches[0];
			if (match) {
				pair = match;
				engine.show({ from: match.source, to: match.target });
				discardCaptures();
				return;
			}

			// Capture path (D68) — a sibling swap left snapshots behind.
			if (!captures) return;
			if (tryCapturePath(el)) return;

			// Deferred-target path: the counterpart hasn't mounted yet (skeleton view).
			armDeferred(el);
		},

		leave(el) {
			const validEl = !!el && el.nodeType === 1;

			// D55 fly-back — byte-equivalent to the pre-D68 behaviour. Fly back only
			// when the round trip is intact: the leaving subtree holds our target, the
			// target still shows the id we paired on (params-only task switches change
			// it in place), and the source survives OUTSIDE the leaving subtree (a
			// whole-chain teardown takes the card with it — an instant close, not a
			// morph into a dying element). Anything off → stop(), instant restore.
			let result = null;
			if (pair && validEl) {
				const { id, source, target } = pair;
				pair = null;
				const intact =
					engine.state !== 'idle' &&
					el.contains(target) &&
					morphId(target) === id &&
					source.isConnected &&
					!el.contains(source) &&
					!reducedMotion();
				if (!intact) {
					engine.stop();
				} else {
					result = engine.hide();
				}
			}

			// Capture the leaving subtree for a sibling-swap flight on the next enter
			// (both push and pop reach here). Must not change what leave returns.
			if (validEl && !reducedMotion()) captureFromLeaving(el);

			return result;
		},

		// Carried on the handler so app.unmount() can tear morph down (the router
		// only reads enter/leave — this extra field is inert to it).
		dispose,
	});

	return engine;
}
