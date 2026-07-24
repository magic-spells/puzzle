/**
 * Router — client-side navigation for Puzzle SPAs (nested routes, v1.3 / D30).
 *
 * Implements the D19 navigation state machine (constellation/doc/DOC-DECISIONS.md D19/D28/D30,
 * constellation/doc/DOC-VIEW-LIFECYCLE.md §4, constellation/doc/DOC-APP-ANATOMY.md §5) generalized from a
 * flat "one view + optional layout" model to a **route CHAIN of arbitrary depth**.
 *
 * Route compilation (flatten()): route definitions may nest via `children`; the
 * tree is flattened at construction into one Entry PER LEAF —
 *   { chain: [node0..nodeN], fullPaths, regex, paramNames, layout } —
 * where `chain` is the root→leaf list of definition objects, `fullPaths[i]` is
 * the accumulated path PATTERN at level i (used as the vnode KEY at that level),
 * `regex`/`paramNames` come from the leaf's full path, and `layout` is inherited
 * from the ROOT node only (layouts are root gates/shells; children share them).
 * Child paths are RELATIVE (`/settings` + `profile` → `/settings/profile`); an
 * index child (`path: ''`) composes to exactly the parent's path. A parent WITH
 * children but NO index child does not match its bare path (falls to catch-all).
 * Matching is depth-first in declaration order (first match wins), the same
 * contract flat routes had. Flat routes are chains of length 1 — byte-for-byte
 * today's behavior.
 *
 * Contract highlights:
 * - COMMIT is atomic and ordered (D19 + D61): every FRESH view's preload() AND
 *   every REUSED ancestor's refresh() (routed content, so AWAITED — it gates the
 *   commit) resolve FIRST; THEN, inside #swap's synchronous #committing window,
 *   #commitLocation (URL + memory stack + title/head, D84) runs immediately before the
 *   mount/patch + #commitState — location, DOM and #state all land TOGETHER. In
 *   SEQUENTIAL mode that window opens only AFTER the outgoing unit's out animation
 *   settles and both #swap token checks pass, so a push superseded or failed
 *   during the out touches neither URL nor view (D61 — closes the phantom-history-
 *   entry and URL/view-divergence holes D19's early commit left open). A push
 *   whose loads reject or is superseded changes neither URL nor view. A reused
 *   ROOT LAYOUT is chrome, not routed content: its refresh stays POST-commit
 *   (#refreshLogged, logged).
 *   Skeleton exemption (v1.8, D39): a FRESH instance declaring a
 *   <puzzle-skeleton> (renderSkeleton) does NOT gate — its preload starts but is
 *   not awaited, the commit proceeds, its mount renders the skeleton, and the
 *   real render patches in when data() commits (rejections are logged; the URL
 *   has already moved). Reused ancestors always gate.
 * - Route snapshot (v1.15, D47): every gated preload/refresh (and the layout's
 *   post-commit #refreshLogged) carries this navigation's frozen `to` object
 *   ({ path, pathname, query, hash, route, params, chain } — the shape of
 *   `current`); views read it as `this.route`, giving data() the navigation it
 *   is GATING — the only route source that is correct pre-commit
 *   (current/location still hold the old route there) and in all three modes. A
 *   reused layout's post-commit refresh now runs AFTER #commitState, so it also
 *   reads a fresh `current`.
 * - Parsed URL state + replace() (v1.49, D83): the snapshot adds `pathname`
 *   (path minus query/hash — base-free, trailing slash kept byte-for-byte; the
 *   MATCHING normalization stays on stripPath/stripTrailingSlash), `query` (a
 *   FROZEN null-prototype object with URLSearchParams decoding semantics:
 *   single value → string, repeated key → frozen array in source order, a
 *   valueless key → ''), and `hash` ('' or the raw fragment INCLUDING the
 *   leading '#'). Parsed ONCE per navigation (parseLocation) and stored on
 *   #state at commit, so the `current` getter never reparses. Query never
 *   merges into `params`; matching is untouched. `router.replace(path)` runs
 *   the SAME match/load/cancellation/atomic-commit pipeline as push() — a
 *   failed or superseded replace touches nothing — but #commitLocation swaps
 *   the CURRENT entry in place: history.replaceState (hash mode '#'-encoded,
 *   base-prefixed like push) with the existing __puzzleScrollKey preserved (no
 *   #savePosition, no new entry key — the entry keeps its identity), or in
 *   memory mode an in-place stack[#index] overwrite (no truncate, no append,
 *   no index move). Default scroll on a replace is LEAVE-ALONE (a
 *   filter-typing keystroke must not jump to top); an explicit `#anchor` on the
 *   replace target still lands like push's, and a custom scrollBehavior
 *   (savedPosition null) still overrides. The same-path no-op, the #committing
 *   commit-window deferral (via the { path, replace } #pendingPush slot), and
 *   pending-memory-pop supersession all mirror push() exactly.
 * - pushState fires for push()/link clicks ONLY, now via #commitLocation inside the
 *   synchronous commit window (D61) — never on the initial navigation or popstate
 *   (the browser already moved the URL).
 * - Rapid navigations cancel via a monotonic token; the loser's fresh instances
 *   are destroyed without mounting (last one wins).
 * - keep = shared chain PREFIX length by node object identity. Reused ancestors
 *   (views[0..keep-1]) and a matching-class layout are kept; fresh views
 *   (views[keep..N]) and a diverging layout are built new. keep === chain length
 *   is the params-only degenerate case (whole chain refreshes, zero new instances).
 *
 * Composition (constellation/doc/DOC-APP-ANATOMY.md §5): the chain is preloaded off-DOM, then
 * the WHOLE chain is assembled LEAF-UP into nested keyed component vnodes and
 * handed to the topmost host (layout, or the surviving root view) — each parent
 * hosts the next level at its <Slot/>, and the keyed patch cascades to the
 * divergence level. Rebuilding ALL levels (not just the fresh sub-chain) keeps
 * every host's slot content consistent with the new chain; swapping only at the
 * survivor would leave ancestors holding stale vnodes that a later re-render
 * (store change, setData) would push back down, reverting the swap.
 * Keys: a reused level keeps its COMMITTED key (tag+key match → patchComponent
 * reuses the instance, pushes children through, no data() re-run); a fresh level
 * gets its fullPaths PATTERN (never runtime params) stamped with the navigation
 * token — patchComponent ignores a preattached .instance on a key match, so a
 * fresh level must never collide with any old key, including the same pattern
 * re-entering after an interrupted teardown (sibling leaves sharing one view
 * class still swap correctly).
 *
 * View transitions (constellation/doc/DOC-SPEC.md §12, D28 generalized by D30): after the
 * gated loads resolve, the swap runs ASYNC and SEQUENTIAL in #swap(), and location
 * + title/head + mount + #state commit TOGETHER inside its #committing window (D61 —
 * #commitLocation, no longer split ahead of the swap; in sequential mode that is
 * AFTER the out animation). ONE ANIMATOR PER TRANSITION,
 * the **topmost swapped instance**; every fresh view BELOW it has its enter
 * SUPPRESSED (skipEnter — each nested mount auto-chains a playIn that must not
 * fire). By case:
 * - initial nav → the topmost view plays in exactly once (via the ViewManager's
 *   slot-child chain under a layout, or directly when bare); a layout never
 *   animates on first paint; deeper views skipEnter.
 * - layout swap (chain diverges at depth 0) → only the LAYOUT animates as a unit:
 *   the outgoing layout (or bare root view) plays out then destroys (cascading to
 *   its inner views, no inner hooks), and the WHOLE fresh chain skipEnters.
 * - reused layout / mid-chain swap (keep ≥ 0) → the topmost SWAPPED view
 *   (cur.views[keep]) plays out then destroys (cascade kills deeper old views);
 *   the fresh full chain then cascades from the topmost host, the new
 *   views[keep] plays in via the auto-chain, deeper fresh views skipEnter.
 * A newer navigation cancels an in-flight out (destroy() cancels the WAAPI
 * animation) and proceeds immediately. The pending-out unit and everything under
 * it is DOOMED: the winner clamps its reuse prefix so it never rebuilds on
 * instances inside that subtree (pendingOut === cur.layout → nothing survives;
 * cur.views[j] → keep ≤ j). Because an interrupted out may also be DEEPER than
 * the winner's own old-animator, on interruption we destroy #pendingOut AND, if
 * the winner's computed old-animator is a different still-live instance, destroy
 * it synchronously too (skip its out). The superseded transition drops its fresh
 * instances without mounting (#token guard, #abandon — never the reused prefix).
 *
 * Overlap transitions (v1.24, D56, constellation/doc/DOC-SPEC.md §26): opt in with
 * `{ transitionMode: 'overlap' }` (default `'sequential'` — byte-identical to
 * everything above). In overlap mode #swap does NOT await the out before the IN
 * phase: it PINS the outgoing animator's root in place with inline styles only
 * (position:fixed at its measured getBoundingClientRect, margin:0,
 * pointer-events:none — D28's no-wrapper rule holds, `fixed` needs no injected
 * ancestor), STARTS playOut() without awaiting, and proceeds straight to
 * mount/patch + #commitState (the D19 commit point is unchanged — data() was
 * already awaited pre-swap; the commit just no longer waits on the out). The
 * leaver is destroyed when its out (and morph-leave, D55) settles: #pendingOut
 * holds it for the overlap window and the settle-handler clears it (guarded on
 * still-pointing-here) + destroy()s it. On the reused-layout / mid-chain path the
 * keyed patch's own unmount() → destroyAnimated() drives the SAME memoised
 * playOut(), so the router's settle-handler and the patch path converge on one
 * idempotent destroy() — the pin (set BEFORE the patch mounts the incoming view
 * into the slot) keeps the leaver out of flow so leavingEls never needs it as an
 * insertion ref. Interruption is unchanged: a navigation arriving mid-overlap
 * tears the still-fading #pendingOut leaver down synchronously via the skipOut
 * path (at most two route elements ever coexist), and the stale leaver's own
 * settle-handler can't double-free or clear the newer nav's #pendingOut (the
 * === guard). Hooks in the window: willHide at out-start, then the new view's
 * mounted()/viewWillShow() during the fade; didHide/didShow as each settles, in
 * unspecified relative order. Unchanged in overlap mode: initial navigation (no
 * cur, no pin), params-only navigations (never reach #swap), reduced-motion
 * (zeroed durations → effectively instant), failure recovery (the out only ever
 * starts inside #swap, after preload succeeded — a doomed navigation never pins).
 *
 * Per-route / per-view transition mode (v1.30, D65, constellation/doc/DOC-SPEC.md §33):
 * `transitionMode` is resolvable at three tiers, most specific first —
 * (1) a `transitionMode` field on a route/child-route definition, nearest-defined
 * walking the DESTINATION chain leaf → root (#resolveTransitionMode, the same
 * walk #syncHead's resolveHead uses per meta head field); (2) a `transitionMode` field on the
 * incoming animator's VIEW or LAYOUT class (colocated with `animations` — layouts
 * qualify too, they are PuzzleView subclasses); (3) this constructor's
 * `transitionMode` option as the app-level default. Resolution is
 * DESTINATION-ONLY: for a navigation A→B only B's config is ever consulted,
 * never A's — "the card coming in" always controls the transition, so B→A
 * (leaving B) is resolved independently and may play differently. This was a
 * deliberate amendment to D56's app-only surface: D56 rejected a per-view
 * override because a transition spans two DIFFERENT instances with no shared
 * owner (whose field would win?) — resolving it directionally (destination
 * only) removes the ambiguity by construction, since it is never a live
 * negotiation between the two sides, only a lookup on the side being entered.
 * An app that sets none of this is byte-identical to v1.24–v1.28.
 *
 * Scroll behavior (v1.5, D33; anchors + persistence v1.10, D41): the router owns
 * window scroll across navigations. Default: push → top; back/forward → the
 * position that entry was at when left (saved under a per-entry key stamped into
 * history.state; the browser restoration is switched to 'manual' between
 * start()/stop()). Initial navigation never touches scroll. The landing happens
 * inside #commitState — synchronously after mount, before paint. Configure via
 * the Router options / PuzzleApp config: `scrollBehavior: false` disables it;
 * `(to, from, savedPosition) => {x,y}|null` customizes it (falsy return = leave
 * scroll alone).
 *
 * Anchor targets (v1.10, D41): a `#anchor` suffix on a PUSH target refines the
 * default landing — the window lands at document.getElementById(anchor) (id
 * decodeURIComponent-ed), falling back to top when no such element is in the
 * committed DOM (including a v1.8 skeleton view whose target hasn't rendered —
 * never re-applied when the real template lands). Element position can't be
 * computed off-DOM, so #resolveScroll returns a { anchor } SENTINEL pre-commit
 * that #commitState resolves AFTER mount (rect top/left + current scroll offsets).
 * A pop's saved position still wins over an anchor; a custom scrollBehavior still
 * wins over everything (the anchor rides verbatim in to.path). The history-mode
 * link interceptor now preserves url.hash (previously dropped); hash mode carries
 * the anchor inside the fragment (`#/docs#faq`), intercepted by the existing `#/`
 * rule, parsed by #currentPath into the path-shaped `/docs#faq`.
 *
 * Position persistence (v1.10, D41): the in-memory #positions Map stays the source
 * of truth, but every #savePosition mirrors the whole map to a single
 * sessionStorage key ('__puzzleScroll', a JSON object of key → {x,y}) and start()
 * hydrates the map from it before adopting the entry key. Because the per-entry
 * __puzzleScrollKey rides in history.state — which survives reloads — restore
 * lines up across a full reload. The map is capped at 50 entries (oldest evicted,
 * insertion order; a re-save re-inserts as newest). ALL storage access is
 * try/catch-wrapped — quota, disabled storage, or file:// oddities degrade to the
 * v1.5 in-memory behavior. `scrollBehavior: false` touches no storage.
 *
 * Hash mode (v1.6, D34): opt in with `{ mode: 'hash' }` (default `'history'`) to
 * carry the route in `location.hash` (`/#/user/123`) instead of the pathname —
 * for static hosts with no server-side rewrite. It touches THREE seams only:
 * reading the URL (#currentPath parses `#/...`), writing it on push (pushState
 * gets `'#' + path`), and the click interceptor (`#/...` hrefs are intercepted,
 * bare `#anchor` hrefs fall through). The public API stays PATH-SHAPED in both
 * modes — push('/user/123'), current.path === '/user/123' — so views and route
 * defs never mention the '#'. We listen on popstate ONLY (never hashchange):
 * fragment navigations fire popstate in supported browsers, the same bet Vue
 * Router 4 makes. A popstate whose hash is a NON-route fragment (`#section2`, an
 * in-page anchor) is ignored — the rendered view is left alone.
 *
 * Memory mode (v1.11, D34 reserved the slot, D42 built it): opt in with
 * `{ mode: 'memory' }` to keep the route ENTIRELY in router state — `location`
 * and `history` are never read or written. For tests (no jsdom history fakery)
 * and embedded/iframe apps that must not touch the host page's URL. An in-memory
 * entry stack (`#stack` of `{ path }` + `#index`) replaces `history`: push()
 * truncates any forward entries and appends (browser semantics); the initial nav
 * is seeded from the `initialPath` option (default `'/'` — there is no URL to
 * read). The FULL D19/D28/D30 pipeline runs unchanged (atomic commit, cancellation
 * tokens, sequential transitions, nested chains); only the URL side effects vanish.
 * Deliberate differences (D42): NO document-level side effects — no popstate
 * listener is registered and #syncHead is a no-op (an embed must not rename the
 * host tab or edit the host <head>, D84); scroll is a NO-OP (#scrollEnabled() returns false → no window.scrollTo,
 * no sessionStorage, no scrollRestoration touch); the click interceptor STAYS ACTIVE
 * (same-origin pathname links route in memory, exactly the history-mode path — the
 * hash-specific `#/` rules never apply, so a bare `#anchor` href falls through to
 * the browser as in history mode). The public API stays PATH-SHAPED and
 * mode-agnostic. Programmatic history — go(n)/back()/forward() — is added in ALL
 * modes here (§9): history/hash delegate to history.go(n) (the popstate path runs
 * the pipeline); memory mode moves #index and runs the pipeline as a POP, index
 * moving ONLY at commit (a superseded pop leaves it put — D19). Out-of-range n is
 * a silent no-op (browser history.go semantics).
 *
 * Base path (v1.19, D51): `{ base: '/myapp' }` serves the app under a sub-path.
 * Applied at the path-shape boundary, mode-agnostically — the SAME three seams
 * the mode uses: READ (#currentPath strips the base after the mode-specific raw
 * read), WRITE (the #navigate pushState site prefixes the base before the mode-
 * specific encoding — history url = base + path, hash url = '#' + base + path),
 * and the click interceptor (#handleClick takes only URLs under the base and
 * pushes the base-stripped path; outside-base same-origin links fall through to
 * the browser — a real navigation away). The app-facing surface stays base-free:
 * push(), matching, current, params, this.route never see the base — only the URL
 * (and <a href>, a real document URL) carries it. Normalization + config throw in
 * normalizeBase(): '', '/', undefined → no base (byte-identical to today); a base
 * with '#'/'?' throws. Inert in memory mode (no URL). The D41 anchor convention
 * composes untouched — the base rides ahead of the whole path-shaped fragment
 * ('#/myapp/docs#faq' → strip base → '/docs#faq' → existing anchor split) — and
 * scroll keys (D41) are unaffected: they ride history.state, not the URL.
 */

import { ViewNode } from '../views/ViewNode.js';
import { cancelAnimations } from '../views/animate.js';
import { resolveHead, syncHead } from '../head.js';

// sessionStorage mirror of the scroll-position map (v1.10, D41). One JSON blob of
// { entryKey: {x,y} } under a single key; capped so a long session can't grow it
// without bound. All access is fail-soft (see #persistPositions / #hydratePositions).
const SCROLL_STORE_KEY = '__puzzleScroll';
const SCROLL_MAX_ENTRIES = 50;

export class Router {
	#routes = []; // compiled leaf Entries, in declaration order (depth-first)
	#catchAll = null; // synthetic single-node Entry for path:'*' (matched last)
	#container = null;
	#ctx = null;
	// { path, entry, params, views: [v0..vN], layout, layoutClass } | null
	#state = null;
	#token = 0;
	// The rawPath of the navigation that currently owns the token and has NOT yet
	// committed or terminated (null when idle). push() reads it so a SECOND click on
	// the active link WHILE its navigation is still in flight (data() slow) is a
	// same-nav-key no-op instead of a supersession: the committed #state still names
	// the OLD route pre-commit, so #state alone can't catch the double-click. Set at
	// #navigate's token bump, cleared at #commitState (commit) and in
	// #recoverFailedNavigation (block/failure); a newer navigation to a DIFFERENT path
	// overwrites it and still supersedes normally.
	#pendingNavPath = null;
	// Guard redirects re-enter the normal pipeline through replace(), so every
	// destination gets its own inherited guard chain and the denied URL never
	// commits. A bad pair/cycle could otherwise recurse forever without reaching
	// #commitState; count guard-owned redirects and reset at the START of each
	// externally-initiated navigation — NOT only at commit, because a redirect to the
	// already-current path is a same-path replace() no-op that never commits, so a
	// commit-only reset would let the count accumulate across INDEPENDENT user
	// navigations and spuriously trip the limit (D87).
	#guardRedirectCount = 0;
	// True only for the synchronous entry of a #navigate that is a guard-redirect
	// re-entry (set around the replace() call in #navigate's redirect branch, consumed
	// at #navigate's token bump). Distinguishes those re-entries from externally-
	// initiated navigations so the #guardRedirectCount reset skips them.
	#guardRedirecting = false;
	// The instance an in-flight transition is currently animating OUT (or null).
	// A newer navigation reads this to cancel the running out and proceed
	// immediately (constellation/doc/DOC-SPEC.md §12 interruption rule).
	#pendingOut = null;

	// ---- shared-element morph handler (v1.23, D55) ---------------------------
	// A narrow, morph-agnostic slot the /morph module fills via enableMorph(app).
	// enter(el, { initial }) fires synchronously after every committed swap
	// mounts (pre-paint, so a pairing can hide its elements before the browser
	// paints the plain mount); leave(el) fires as the outgoing unit's out phase
	// starts and may return a promise the router awaits (alongside playOut)
	// BEFORE destroying that unit. Null ⇒ every code path is byte-identical to
	// the handler-less router.
	#morphHandler = null;

	// ---- commit-window guard (redirect-from-mounted) ------------------------
	// While the router is inside the SYNCHRONOUS commit/mount section of a
	// navigation — the region where a fresh view's mounted() (and viewWillShow)
	// fire BEFORE #commitState has recorded the just-committed chain as
	// #state/current — a push() from one of those hooks must NOT re-enter
	// #navigate: it would read the stale #state as `cur`, compute its reuse
	// prefix against the OLD chain, and double-mount the shared layout (the
	// pyramid-puzzle redirect-from-mounted bug). Such a push is DEFERRED — its
	// target recorded as { path, replace } (last-wins, single slot — a replace()
	// arriving in the window shares the slot, D83) and re-dispatched the instant
	// the in-flight commit completes and #state is consistent. No await runs
	// inside the window, so only a synchronous reentrant push can land while the
	// flag is set; a push arriving during the async LOAD or out-animation phases
	// (flag off) keeps today's interruption semantics.
	#committing = false;
	#pendingPush = null;

	#onClick;
	#onPopState;

	// ---- routing mode (v1.6, D34; memory v1.11, D42) ------------------------
	// 'history' (default) carries the route in location.pathname; 'hash' carries
	// it in location.hash ('#/path'); 'memory' carries it entirely in router state
	// (#stack/#index below) and never reads or writes location/history. Only the
	// read/write/interceptor seams differ — the path-shaped API (push,
	// current.path) is mode-agnostic across all three.
	#mode;

	// ---- transition mode (v1.24, D56; per-route/per-view override v1.30, D65) ----
	// 'sequential' (default) ⇒ #swap awaits the out before mounting the incoming
	// chain — byte-identical to v1.23. 'overlap' ⇒ #swap pins the leaver in place
	// and starts its out WITHOUT awaiting, so old-out and new-in play concurrently
	// (constellation/doc/DOC-SPEC.md §26). #defaultTransitionMode is the constructor
	// option — the FALLBACK tier once nothing more specific applies (#resolveTransitionMode
	// below): a route-chain node's own `transitionMode` field wins first (nearest-
	// defined, leaf→root, same walk as #syncHead's per-field meta head resolution),
	// then the incoming animator VIEW/LAYOUT instance's own `transitionMode` field, then this default.
	// Resolution is DESTINATION-ONLY — the outgoing view/route is never consulted
	// (D65): the card coming in always controls the transition. Gates ONLY the
	// #swap out/in sequencing — every other path (matching, commit, interruption,
	// failure recovery) is shared.
	#defaultTransitionMode = 'sequential';
	// One-shot-per-class warn guard for an invalid view/layout-level transitionMode
	// (D65) — a bad value there warns and falls through to the next resolution tier
	// rather than throwing, so one misconfigured view can't crash navigation.
	#warnedBadViewTransitionMode = new Set();

	// ---- base path (v1.19, D51) ---------------------------------------------
	// Serve the app under a sub-path. Normalized to '' (no base) or a leading-'/'
	// no-trailing-'/' prefix. Applied at the SAME path-shape boundary as the mode
	// (constellation/doc/DOC-SPEC.md §23): READ strips it after the mode-specific raw read
	// (#currentPath), WRITE prefixes it before the mode-specific encoding (the
	// #navigate pushState site), and the click interceptor (#handleClick) only
	// takes URLs under it. The app-facing surface — push(), matching, current,
	// params, this.route — never sees the base; only the URL (and <a href>) carry
	// it. Inert in memory mode (no URL exists), like scrollBehavior. '' ⇒ every
	// seam is byte-identical to the base-less router.
	#base;
	// One-shot guard for the "loaded outside the configured base" warning (D51):
	// history mode passes a non-base pathname through un-stripped (→ catch-all,
	// visible not silent) but warns only ONCE per router instance so a noisy path
	// can't spam the console on every #currentPath read.
	#warnedOutsideBase = false;

	// ---- in-memory history (v1.11, D42) -------------------------------------
	// Memory mode only. #stack is the entry list ({ path } each) and #index the
	// current position; push() truncates forward entries and appends, go/back/
	// forward move #index. Both move ONLY at commit (D19). Null in history/hash
	// mode. #initialPath seeds the first entry (default '/'); a non-null value in
	// history/hash mode is a constructor throw (the URL is the initial path there).
	#stack = null;
	#index = -1;
	// Memory mode only (v1.11, D42): the TARGET index of the most recent in-flight
	// go()/back()/forward() pop, or null when no pop is pending. #index moves only at
	// commit (D19), so two SYNCHRONOUS back() calls would otherwise both read the same
	// #index and compute the same target, collapsing into one move. go() computes its
	// base from `#pendingIndex ?? #index` so a chain of synchronous pops advances by
	// one each; it is cleared at every commit (#commitLocation) and on the failure path
	// when this nav is still latest, and reset by any push (which supersedes a pending
	// pop and truncates forward entries). Always null in history/hash mode.
	#pendingIndex = null;
	#initialPath;

	// ---- scroll behavior (v1.5, D33; persistence v1.10, D41) ----------------
	// `false` disables scroll management; a function customizes it; undefined =
	// the default (top on push, restore on back/forward). Positions are kept
	// in-memory, keyed by a per-history-entry key stamped into history.state —
	// #scrollKey mirrors the CURRENT entry's key so the outgoing position can be
	// saved even on popstate, when history.state has already moved to the target
	// entry. The map is ALSO mirrored to sessionStorage (#SCROLL_STORE_KEY) on
	// every save and hydrated from it in start(), so back/forward restore survives
	// a full reload — the per-entry key in history.state, which itself survives
	// reloads, is what makes the restore line up (D41).
	#scrollBehavior;
	#positions = new Map(); // entry key → { x, y }
	#scrollKey = null; // key of the entry the window currently shows
	#keySeq = 0;
	#prevScrollRestoration = null;

	/**
	 * @param {Array<{path,name,view,layout,meta,guard,transitionMode,children}>} routes route definitions
	 * @param {object} [options]
	 * @param {false|Function} [options.scrollBehavior] `false` to leave scroll
	 *   alone; `(to, from, savedPosition) => {x,y}|null` to customize; omit for
	 *   the default (top on push, saved position on back/forward). D33.
	 * @param {('history'|'hash'|'memory')} [options.mode] URL carrier: `'history'`
	 *   (default, pathname), `'hash'` (`location.hash`, for static hosts, D34), or
	 *   `'memory'` (router state only, no URL — for tests/embeds, D42).
	 * @param {string} [options.initialPath] memory mode only (D42): the first
	 *   route, default `'/'`. A non-null value in history/hash mode is a throw (the
	 *   URL is the initial path there; a silently ignored field would hide a bug).
	 * @param {string} [options.base] serve the app under a sub-path (v1.19, D51):
	 *   `'/myapp'` (leading '/' ensured, trailing '/' trimmed; `''`/`'/'` = no
	 *   base, the default). Carried on the URL only — app code stays base-free. A
	 *   base containing `'#'` or `'?'` is a constructor throw. Inert in memory mode.
	 * @param {('sequential'|'overlap')} [options.transitionMode] app-level DEFAULT
	 *   transition feel (v1.24, D56): `'sequential'` (default — old `out` fully
	 *   plays and the leaver is destroyed BEFORE the new view mounts, byte-identical
	 *   to v1.23) or `'overlap'` (old `out` and new `in` play concurrently via
	 *   fixed-pin positioning; constellation/doc/DOC-SPEC.md §26). Since v1.30 (D65)
	 *   this is only the FALLBACK: a route's own `transitionMode` field, or the
	 *   destination view/layout's own `transitionMode` field, both take precedence
	 *   when set — see `#resolveTransitionMode`.
	 */
	constructor(
		routes = [],
		{ scrollBehavior, mode = 'history', initialPath = null, base = '', transitionMode = 'sequential' } = {}
	) {
		if (mode !== 'history' && mode !== 'hash' && mode !== 'memory') {
			throw new Error(
				`[puzzle] unknown router mode: "${mode}" (expected 'history', 'hash', or 'memory')`
			);
		}
		// transitionMode validation mirrors the unknown-mode throw above (same
		// config-error posture, D56): only the two known values are accepted.
		if (transitionMode !== 'sequential' && transitionMode !== 'overlap') {
			throw new Error(
				`[puzzle] unknown transitionMode: "${transitionMode}" (expected 'sequential' or 'overlap')`
			);
		}
		this.#defaultTransitionMode = transitionMode;
		// initialPath is memory-only: fail fast if set in a URL-carrying mode (D42).
		if (initialPath != null && mode !== 'memory') {
			throw new Error(
				`[puzzle] "initialPath" is only valid in memory mode (got mode "${mode}") — the URL is the initial path in history/hash mode`
			);
		}
		this.#mode = mode;
		this.#initialPath = initialPath ?? '/';
		// Normalize + validate the base at construction (D51, config-error posture
		// like the unknown-mode throw above): '#'/'?' in a base is a hard error, and
		// '', '/', and a trailing '/' all collapse to the canonical form.
		this.#base = normalizeBase(base);
		this.#scrollBehavior = scrollBehavior;
		for (const route of routes) {
			if (route.path === '*') {
				// catch-all: a flat single-node chain, matched last regardless of
				// position (D19). Its fullPaths key '*' is unique and never a regex.
				validateTransitionMode(route.transitionMode, 'the catch-all route');
				validateGuard(route.guard, 'the catch-all route');
				this.#catchAll = {
					chain: [route],
					fullPaths: ['*'],
					regex: null,
					paramNames: [],
					layout: route.layout ?? null,
					guards: route.guard ? [route.guard] : [],
				};
				continue;
			}
			flatten(route, [], [], this.#routes);
		}
		// Bind once so start()/stop() add and remove the SAME reference — the
		// prototype bound at addEventListener time and leaked (CODE_REVIEW §2.5).
		this.#onClick = this.#handleClick.bind(this);
		this.#onPopState = this.#handlePopState.bind(this);
	}

	/**
	 * Begin routing: register listeners and run navigation #0 from the current
	 * URL (initial paint is just a navigation with no pushState — APP_ANATOMY §3).
	 */
	async start(container, ctx) {
		this.#container = container;
		this.#ctx = ctx;
		document.addEventListener('click', this.#onClick);
		// Memory mode registers NO popstate listener — location/history are never
		// touched, so there is nothing to hear (D42). The click interceptor stays.
		if (this.#mode !== 'memory') {
			window.addEventListener('popstate', this.#onPopState);
		}

		// Scroll management (D33): take over from the browser — its automatic
		// restoration fires on popstate BEFORE the old view has swapped out, which
		// scrolls the wrong content. We restore ourselves after the new view
		// mounts. The current entry gets its position key here; entries created
		// outside the router (or before it) get theirs lazily in #handlePopState.
		if (this.#scrollEnabled() && typeof history.scrollRestoration === 'string') {
			this.#prevScrollRestoration = history.scrollRestoration;
			history.scrollRestoration = 'manual';
		}
		// Hydrate persisted positions BEFORE adopting the entry key (D41): a reload
		// lands us on some entry whose __puzzleScrollKey rode through history.state,
		// and its saved position must already be in the map for a later back/forward
		// to restore it. Kept behind the same gate — `scrollBehavior: false` reads
		// no storage.
		if (this.#scrollEnabled()) {
			this.#hydratePositions();
			this.#scrollKey = this.#adoptEntryKey();
		}

		// Memory mode (D42): there is no URL to read. Seed the in-memory stack with
		// the initial entry and run nav #0 to initialPath (push:false — the seed is
		// the entry, no extra push). #scrollEnabled() is false above, so none of the
		// scroll/storage/scrollRestoration setup ran.
		if (this.#mode === 'memory') {
			this.#stack = [{ path: this.#initialPath }];
			this.#index = 0;
			await this.#navigate(this.#initialPath, { push: false });
			return this;
		}

		// Initial nav reads the current URL for our mode; a hash-mode app loaded at
		// a non-route fragment (or none) routes '/' (#currentPath → null).
		await this.#navigate(this.#currentPath() ?? '/', { push: false });
		return this;
	}

	/**
	 * The current route path for this mode, path-shaped (pathname+search style)
	 * and BASE-STRIPPED (v1.19, D51) — the app-facing surface never sees the base.
	 * history: `location.pathname + location.search`. hash: parse `location.hash`
	 * — `''`/`'#'` → `'/'`; `'#/...'` → the fragment minus the '#' (keeping any
	 * `?query` that lives inside it); anything else (a bare `#anchor`) → `null`,
	 * meaning "not a route fragment" so the caller leaves the view alone. D34.
	 *
	 * With a base configured (D51): the base is stripped AFTER the mode-specific
	 * raw read. history: `pathname === base` → `'/'`; `pathname` under `base + '/'`
	 * → sliced; a pathname NOT under the base warns once and passes through
	 * un-stripped (→ catch-all — visible, not silent misrouting). hash: the base
	 * rides in-fragment, so `'#' + base` → `'/'`, `'#' + base + '/...'` → sliced,
	 * and any OTHER fragment (including a `'#/...'` outside the base) → `null`
	 * (non-route). A bare `''`/`'#'` still → `'/'` (the host root maps to the app
	 * root). No base ⇒ every branch is byte-identical to today.
	 */
	#currentPath() {
		if (this.#mode === 'hash') {
			const hash = location.hash;
			if (hash === '' || hash === '#') return '/';
			if (this.#base) {
				if (hash === '#' + this.#base) return '/';
				// A query directly after the base with no trailing slash ('#'+base+'?...')
				// is the app ROOT carrying that query — mirror history mode below, where
				// pathname===base returns '/'+location.search. Without this branch the
				// fragment matched neither the exact-base nor the base+'/' case and fell
				// to null, so #currentPath dropped the query (start() → '/', popstate
				// ignored). D51/D83.
				if (hash.startsWith('#' + this.#base + '?')) {
					return '/' + hash.slice(1 + this.#base.length);
				}
				if (hash.startsWith('#' + this.#base + '/')) return hash.slice(1 + this.#base.length);
				return null; // '#/...' outside the base is a non-route fragment (D51)
			}
			if (hash.startsWith('#/')) return hash.slice(1);
			return null;
		}
		const pathname = location.pathname;
		if (this.#base) {
			if (pathname === this.#base) return '/' + location.search;
			if (pathname.startsWith(this.#base + '/')) {
				return pathname.slice(this.#base.length) + location.search;
			}
			// Loaded outside the configured base (D51): pass the pathname through
			// un-stripped (→ catch-all) and warn once so a misconfigured deploy is
			// debuggable rather than silently misrouting.
			this.#warnOutsideBaseOnce(pathname);
			return pathname + location.search;
		}
		return pathname + location.search;
	}

	/** One-shot "loaded outside the configured base" warning (D51). */
	#warnOutsideBaseOnce(pathname) {
		if (this.#warnedOutsideBase) return;
		this.#warnedOutsideBase = true;
		console.warn(
			`[puzzle] path "${pathname}" is outside the configured router base "${this.#base}" — passing it through un-stripped`
		);
	}

	/**
	 * Full router teardown — idempotent, safe to call twice or before start().
	 * Invalidates any in-flight navigation, cancels a pending out-animation,
	 * destroys the mounted view chain (which cascades through the ViewManager to
	 * nested routed views hosted at <Slot/> and every component, firing their
	 * destroyed() hooks and dropping store subscriptions — PuzzleView.destroy),
	 * clears router state + the references the router holds, removes listeners,
	 * and restores the browser's scrollRestoration. Leaves no live view or
	 * subscription behind; PuzzleApp.unmount() does the final DOM clear.
	 */
	stop() {
		// 1. Invalidate any pending preload/transition FIRST: a late data()
		//    resolution or an awaiting #navigate/#swap sees a bumped token and
		//    abandons without mounting into the (about-to-be-detached) container.
		this.#token++;

		// 2. Cancel + destroy an in-flight out-animation instance. destroy()
		//    cancels its WAAPI animation so a concurrent playOut() await resolves,
		//    and fires its destroyed() / drops its subscriptions.
		if (this.#pendingOut) {
			const out = this.#pendingOut;
			this.#pendingOut = null;
			out.destroy();
		}

		// 3. Destroy the top-level mounted owner. PuzzleView.destroy() cascades
		//    through the ViewManager: the root layout hosts the routed view chain
		//    at its <Slot/> (and each view hosts its nested child at its own
		//    <Slot/>), so destroying the layout — or the root view when there is
		//    no layout — tears the WHOLE chain + components down and fires every
		//    destroyed() hook. Idempotent per instance (destroy() no-ops if run).
		if (this.#state) {
			const owner = this.#state.layout ?? this.#state.views[0];
			owner?.destroy();
		}

		// 4. Clear router state + bookkeeping so a leaked reference can't keep a
		//    destroyed view (or the container/ctx) alive, and so a repeated stop()
		//    finds nothing to redo. The sessionStorage scroll mirror is left alone
		//    (a later mount hydrates from it); only the in-memory map is cleared.
		this.#state = null;
		this.#container = null;
		this.#ctx = null;
		this.#stack = null;
		this.#index = -1;
		this.#pendingIndex = null;
		this.#guardRedirectCount = 0;
		this.#guardRedirecting = false;
		this.#pendingNavPath = null;
		this.#positions.clear();
		this.#scrollKey = null;
		// Drop any deferred push and clear the commit-window flag (defensive: the
		// flag is finally-cleared per commit, and #pendingPush is consumed
		// synchronously right after being set, so both are normally already idle).
		this.#committing = false;
		this.#pendingPush = null;

		// 5. Remove listeners + restore scrollRestoration (both no-ops on a second
		//    call — removeEventListener is idempotent, #prevScrollRestoration is
		//    nulled after the restore).
		document.removeEventListener('click', this.#onClick);
		window.removeEventListener('popstate', this.#onPopState);
		if (this.#prevScrollRestoration != null) {
			history.scrollRestoration = this.#prevScrollRestoration;
			this.#prevScrollRestoration = null;
		}
		return this;
	}

	/**
	 * Register the shared-element morph handler (v1.23, D55) — the narrow slot
	 * `enableMorph(app)` (@magic-spells/puzzle/morph) fills. The router stays
	 * morph-agnostic: it only knows WHEN (enter after every committed swap
	 * mounts, pre-paint; leave as an outgoing unit's out phase starts, awaited
	 * before destroy) — the handler decides IF and HOW. Pass null to unregister.
	 *
	 * @param {{ enter(el: Element|null, meta: { initial: boolean }): void,
	 *           leave(el: Element|null): Promise<unknown>|null } | null} handler
	 */
	setMorphHandler(handler) {
		this.#morphHandler = handler ?? null;
	}

	/**
	 * Programmatic navigation (also the link-click path). Returns the nav promise.
	 * A push arriving inside the commit window (e.g. from a view's mounted()) is
	 * DEFERRED to run right after the in-flight commit — see #committing; it
	 * returns a resolved promise since the deferred nav has not started yet.
	 */
	push(path) {
		if (this.#committing) {
			this.#pendingPush = { path, replace: false }; // last-wins, single slot (no queue)
			return Promise.resolve();
		}
		// v-next same-path no-op: a push whose target matches the COMMITTED state's
		// path is a no-op — no history entry, no data() re-run, no scroll change (Vue
		// Router parity; double-clicking the ACTIVE nav link must not pile duplicate
		// entries onto the back stack). The compare is byte-identical on the query +
		// hash portions (so the anchor form still counts: `/docs#faq` twice = no-op;
		// `/docs#faq` while at `/docs` = a real navigation), but a single trailing
		// slash on the PATHNAME is insignificant — the same rule #match uses (D67).
		// Without that, a page loaded at the SSG directory URL '/docs/' keeps the
		// slash in #state.path, and a nav link push('/docs') would be treated as a
		// real navigation on every click. We read the COMMITTED #state, exactly as
		// the params-only branch reads `cur`: a navigation still in flight has not
		// committed, so it never moves this reference, and a DIFFERENT path on the
		// same route (`/user/1` → `/user/2`) still runs its params-only refresh.
		// Memory mode shares the semantics (#state.path is set there too).
		const key = sameNavKey(path);
		if (this.#state && key === sameNavKey(this.#state.path)) {
			return Promise.resolve();
		}
		// In-flight double-click guard: the COMMITTED #state check above misses a
		// second click on the active link WHILE its navigation is still loading — the
		// old route is still committed there. Without this, that second push bumps the
		// token and SUPERSEDES the first: fresh view instances, data() runs twice, the
		// first nav discarded. #pendingNavPath names the target of the navigation that
		// owns the token but has not committed, so a same-key push here no-ops; a push
		// to a DIFFERENT path mid-flight has a different key and still supersedes.
		if (this.#pendingNavPath != null && key === sameNavKey(this.#pendingNavPath)) {
			return Promise.resolve();
		}
		return this.#navigate(path, { push: true });
	}

	/**
	 * Programmatic navigation that REPLACES the current history entry (v1.49,
	 * D83). Runs the SAME match/load/cancellation/atomic-commit pipeline as
	 * push() — a failed or superseded replace touches neither URL nor view nor
	 * stack (D19/D61 inherited) — but #commitLocation swaps the entry in place:
	 * history.replaceState (hash mode '#'-encoded, base-prefixed like push) with
	 * the CURRENT entry's __puzzleScrollKey preserved, or in memory mode an
	 * in-place stack overwrite (length + index unchanged). Scroll is left alone
	 * by default (see #resolveScroll). Mirrors push()'s guards exactly: the
	 * same-path no-op (byte-identical query+hash, trailing-slash-insensitive
	 * pathname) and the commit-window deferral (a replace from a mounted() hook
	 * — the auth-redirect case that must not leave the aborted page in history).
	 */
	replace(path) {
		if (this.#committing) {
			this.#pendingPush = { path, replace: true }; // last-wins, shared slot with push
			return Promise.resolve();
		}
		// Same-path no-op, exactly push()'s guard: replacing the committed entry
		// with itself would re-run data() and rewrite an identical URL for nothing.
		if (this.#state && sameNavKey(path) === sameNavKey(this.#state.path)) {
			return Promise.resolve();
		}
		return this.#navigate(path, { push: false, replace: true });
	}

	/**
	 * Run a push/replace deferred during the commit window, now that
	 * #state/current are consistent (the just-committed chain is recorded).
	 * Fire-and-forget: the caller has already finished its own commit. Single
	 * slot — last writer wins.
	 */
	#runPendingPush() {
		if (this.#pendingPush == null) return;
		const { path, replace } = this.#pendingPush;
		this.#pendingPush = null;
		// Re-dispatch through push()/replace(), NOT straight into #navigate: by now
		// the outer finally has cleared #committing and #commitState recorded the
		// just-committed #state, so the normal entry point applies the same-path
		// no-op guard. Without this, an auth guard in mounted()/viewWillShow that
		// redirects to the very path being committed (landing on '/login' and
		// pushing '/login') would run a full redundant navigation + duplicate
		// history entry. #pendingPush carries { path, replace } (the sole argument
		// plus which verb to re-dispatch, D83), so nothing is lost. Fire-and-forget.
		if (replace) {
			this.replace(path);
		} else {
			this.push(path);
		}
	}

	/**
	 * Programmatic history (v1.11, D42), all modes. Move `n` entries — negative =
	 * back, positive = forward. History/hash mode delegate to `history.go(n)`: the
	 * browser moves the URL and fires popstate, which the existing listener turns
	 * into a pop navigation (the whole pipeline). Memory mode moves #index and runs
	 * the pipeline as a POP to the target entry's path; the index advances ONLY at
	 * commit (see #navigate), so a superseded pop leaves it put (D19). Out-of-range
	 * `n` is a silent no-op (browser `history.go` semantics).
	 */
	go(n) {
		if (this.#mode !== 'memory') {
			// go(0) reloads the page in browsers; delegating preserves that parity.
			history.go(n);
			return;
		}
		// Before start() (or after stop()) the in-memory stack is null (D42) — degrade
		// silently, matching how history/hash go() no-ops when there is nothing to move.
		if (!this.#stack) return;
		// Base off the PENDING pop target when one is in flight, not #index (which
		// only moves at commit, D19). Without this two synchronous back() calls both
		// read #index and target the same entry, collapsing into a single move; here
		// the second sees #pendingIndex and steps once further. `target === base` (so
		// go(0), or a forward that exactly undoes the pending back) is a no-op.
		const base = this.#pendingIndex ?? this.#index;
		const target = base + n;
		// Out of range → no-op. go(0) is also a no-op here: a browser would reload,
		// which memory mode has no notion of (D42).
		if (target < 0 || target >= this.#stack.length || target === base) return;
		this.#pendingIndex = target;
		return this.#navigate(this.#stack[target].path, { push: false, pop: true, memoryIndex: target });
	}

	/** Go back one entry (v1.11, D42). Equivalent to go(-1). */
	back() {
		return this.go(-1);
	}

	/** Go forward one entry (v1.11, D42). Equivalent to go(1). */
	forward() {
		return this.go(1);
	}

	/**
	 * Render-time inverse of the click interceptor / #currentPath parsing (v1.46,
	 * D79): a path-shaped route in, a mode-encoded href out — history `base + path`,
	 * hash `'#' + base + path`, memory the path unchanged (no URL carrier). The #base
	 * is used exactly as stored (D51 already normalized it — no re-normalization). A
	 * string NOT starting with '/' is returned unchanged: the deliberate pass-through
	 * for external URLs, `mailto:`/`tel:`, bare `#anchor` fragments, an already-encoded
	 * `'#/x'`, and `''`. Query strings and `#anchor` suffixes inside a path survive
	 * for free — this is pure prefixing and never parses them.
	 */
	url(path) {
		if (typeof path !== 'string') {
			throw new Error(`[puzzle] router.url(path) expects a string path (got ${typeof path})`);
		}
		if (path[0] !== '/') return path;
		if (this.#mode === 'memory') return path;
		if (this.#mode === 'hash') return '#' + this.#base + path;
		return this.#base + path;
	}

	/**
	 * Current route info: { path, pathname, query, hash, route, params, chain }
	 * — null before the first nav. `route` is the LEAF node (back-compat shape);
	 * `chain` is the full root→leaf node list (v1.3 additive). `pathname`/
	 * `query`/`hash` (v1.49, D83) are the parts parseLocation split off `path`
	 * at navigation time — read straight off #state, never reparsed here.
	 */
	get current() {
		if (!this.#state) return null;
		const { path, pathname, query, hash, entry, params } = this.#state;
		return {
			path,
			pathname,
			query,
			hash,
			route: entry.chain[entry.chain.length - 1],
			params,
			chain: entry.chain,
		};
	}

	// ---- navigation pipeline (D19 / D30) ------------------------------------

	/**
	 * Run the destination's inherited guard chain root→leaf, sequentially (D87).
	 * Every guard is awaited even when it returns synchronously, then the token is
	 * checked BEFORE another guard may observe a superseded navigation. No view or
	 * layout exists yet, so a losing guard phase has no fresh instance teardown.
	 *
	 * @returns {Promise<true|false|string|null>} allow, block/failure, redirect,
	 *   or superseded (`null`)
	 */
	async #runGuards(entry, to, from, token) {
		for (const guard of entry.guards) {
			let verdict;
			try {
				verdict = await guard({ to, from, ctx: this.#ctx });
			} catch (err) {
				// Rejection is still the completion of an await: a newer
				// navigation makes it stale and therefore silent.
				if (token !== this.#token) return null;
				console.error('[puzzle] navigation guard failed:', err);
				return false;
			}

			// A newer navigation owns the router now. Stop before the next ancestor/
			// child guard; the caller also checks after awaiting this method.
			if (token !== this.#token) return null;
			if (verdict === false) return false;
			if (typeof verdict === 'string') {
				// Ten redirects may run without a commit; the eleventh is the cycle
				// boundary. Same-path replace remains its normal no-op, but still
				// counts because the guard initiated it and no commit reset occurred.
				if (this.#guardRedirectCount >= 10) {
					console.error(
						'[puzzle] navigation guard redirect limit exceeded (10) — staying on the current route'
					);
					return false;
				}
				this.#guardRedirectCount++;
				return verdict;
			}
		}
		return true;
	}

	/**
	 * A latest navigation that stops before #swap must restore any older
	 * transition it superseded and clear a memory-pop target, exactly like the
	 * data()-failure path. Guard blocks/failures use this before any fresh view
	 * exists; data failures call it after destroying their fresh instances.
	 */
	#recoverFailedNavigation(token) {
		if (token !== this.#token) return;
		if (this.#pendingOut) {
			const stalled = this.#pendingOut;
			this.#pendingOut = null;
			cancelAnimations(stalled.element);
		}
		this.#pendingIndex = null;
		// This navigation terminated without committing (guard block/failure, data
		// failure, or a same-path redirect no-op) and still owns the token: clear the
		// in-flight target so a later push to that path is not wrongly no-op'd.
		this.#pendingNavPath = null;
	}

	/**
	 * Restore the committed URL after a guard refused a POPSTATE (D87). The browser
	 * had already moved the address bar to the guarded entry before the guard ran,
	 * but the mounted tree stayed on the committed route — a share/bookmark would
	 * capture the wrong URL, violating the router's "URL and mounted tree commit
	 * together" invariant. Rewrite the entry the browser popped to back to `path`.
	 *
	 * We do NOT history.go(delta) back to the pre-pop entry: history/hash mode keeps
	 * no browser-history index (only memory mode tracks #index/#stack), so the delta
	 * is unknowable. replaceState instead COLLAPSES the guarded entry — trading the
	 * exact back/forward stack shape for the URL/tree invariant (the guarded forward
	 * entry is lost). Because replaceState fires no popstate there is no echo
	 * navigation to suppress and the guard cannot re-run — the very reason a
	 * history.go revert (which would echo a popstate targeting `path`) was avoided.
	 * The URL is re-encoded exactly as #commitLocation writes it (shared #encodedUrl:
	 * base prefix, plain in history mode / '#'-encoded in hash mode); history.state rides through
	 * untouched so the entry keeps whatever __puzzleScrollKey #handlePopState settled
	 * on it. Memory mode has no browser URL (and no popstate listener); its #index
	 * already stayed on the committed entry (the blocked pop cleared #pendingIndex
	 * without moving #index), so there is nothing to repair.
	 */
	#restoreCommittedUrl(path) {
		if (this.#mode === 'memory') return;
		history.replaceState(history.state, '', this.#encodedUrl(path));
	}

	/**
	 * The one write-side URL encoder: base prefixed before the mode-specific
	 * encoding (v1.19, D51), then plain in history mode / '#'-prefixed in hash
	 * mode (D34). Every writer (#commitLocation, #restoreCommittedUrl) must go
	 * through here so committed and restored URLs stay byte-identical.
	 */
	#encodedUrl(path) {
		return this.#mode === 'hash' ? '#' + this.#base + path : this.#base + path;
	}

	async #navigate(
		rawPath,
		{ push, pop = false, replace = false, savedPosition = null, memoryIndex = null }
	) {
		const matchPath = stripPath(rawPath);
		const matched = this.#match(matchPath);

		if (!matched) {
			console.warn('[puzzle] no route matched:', matchPath);
			return; // stay put, URL untouched — and no token bump (below)
		}

		// The cancellation token is bumped only once this navigation is REAL
		// (matched) — an unmatched push/pop is a warn-and-no-op that must not
		// invalidate an in-flight navigation. A bump before the match check would
		// make that navigation's post-playOut token check #abandon: the outgoing
		// unit sits fully played out (held invisible by the out animation's fill)
		// with nothing mounted to replace it, until some LATER navigation cleans it
		// up. Nothing above reads the token (stripPath/#match/current are pure over
		// their inputs), so the bump commutes down safely.
		const token = ++this.#token;
		// This navigation is now REAL (matched) and owns the token: record its target
		// so a same-key push() arriving mid-flight no-ops instead of superseding (the
		// double-click guard in push()), and reset the guard-redirect budget UNLESS
		// this #navigate is itself a guard redirect re-entering via replace() — that
		// re-entry continues one logical navigation and must keep the count (D87). The
		// flag is consumed here so it only tags the immediately-following re-entry.
		//
		// Track the target ONLY for genuine pushes: the double-click guard must NOT
		// suppress a push that SUPERSEDES an in-flight pop/replace to the same path —
		// memory-mode back()-then-push('/same') is push-vs-pop (truncate+append vs
		// index move), a real navigation despite the shared path. A pop/replace/initial
		// nav starting here clears the slot for that reason.
		this.#pendingNavPath = push ? rawPath : null;
		const guardReentry = this.#guardRedirecting;
		this.#guardRedirecting = false;
		if (!guardReentry) this.#guardRedirectCount = 0;
		// A real push supersedes any in-flight memory pop and truncates forward
		// entries (D42), so the pending pop target is moot — reset it here (at the
		// point supersession becomes real) so a go() arriving before this push commits
		// bases off #index, not a stale pop target. No-op in history/hash mode and for
		// pops (which set #pendingIndex in go()). (Fix 3 / D42.) A replace supersedes
		// a pending pop the same way (D83) — it targets the CURRENT entry, not the
		// pop's.
		if (push || replace) this.#pendingIndex = null;
		const current = this.current;
		// Guard `from` is the same top-level-frozen route snapshot shape as `to`;
		// nav #0 has no committed route and therefore receives null (D87).
		const from = current == null ? null : Object.freeze(current);
		// Departure scroll, captured NOW — synchronously at navigation start, while
		// the outgoing page still has its full height. #commitLocation persists this
		// captured value instead of reading window.scrollY at commit time: by then
		// #swap has destroyed the outgoing view, the page has collapsed, and a real
		// browser clamps scrollY to 0 — so every saved position was {0,0} and
		// back-navigation restored to the top (caught by the Playwright suite; jsdom
		// does no layout, so the vitest suite can't see the clamp). D61 atomicity
		// holds: a superseded/failed nav never reaches #commitLocation, so the
		// captured value is simply discarded.
		const departScroll =
			typeof window !== 'undefined'
				? { x: window.scrollX || 0, y: window.scrollY || 0 }
				: null;

		const { entry, params } = matched;
		const cur = this.#state;

		// The route snapshot for THIS navigation (v1.15, D47): same shape as
		// `current`, built pre-commit and threaded through guards, every gated
		// preload/refresh, and scrollBehavior. Frozen so no consumer can mutate the
		// shared snapshot. parseLocation (v1.49, D83) runs ONCE here — before guard
		// execution and, critically, before any view/layout construction (D87).
		const loc = parseLocation(rawPath);
		const to = Object.freeze({
			path: rawPath,
			pathname: loc.pathname,
			query: loc.query,
			hash: loc.hash,
			route: entry.chain[entry.chain.length - 1],
			params,
			chain: entry.chain,
		});

		// Preserve the old unguarded pipeline's synchronous path to construction:
		// an empty chain adds no await/microtask. Guarded routes await each guard.
		if (entry.guards.length) {
			const guardVerdict = await this.#runGuards(entry, to, from, token);
			// Supersession is silent: no fresh view exists to destroy.
			if (token !== this.#token || guardVerdict === null) return;
			if (guardVerdict === false) {
				this.#recoverFailedNavigation(token);
				if (cur == null) {
					// Initial navigation refused with nothing yet committed (D87): there is
					// no prior route to fall back to, so the app container stays empty — a
					// silent blank page. There is deliberately no 404 surface, so KEEP the
					// no-mount outcome but make it loud and actionable — an entry guard that
					// blocks first paint should redirect, not dead-end.
					console.error(
						`[puzzle] an entry guard blocked the initial navigation to "${rawPath}" by ` +
							'returning false, so nothing was rendered — the app container is empty. ' +
							"Entry guards should return a redirect path (e.g. '/login') instead of " +
							'false so first paint always has a route to render.'
					);
				} else if (pop) {
					// A blocked POPSTATE: the browser already moved the address bar to the
					// guarded entry before the guard ran, but the tree stayed on `cur`. Put
					// the URL back so URL and mounted tree stay consistent. A plain push never
					// moved the URL (pushState fires only at commit) and staying silently put
					// is its correct outcome (D87), so only pops repair here.
					this.#restoreCommittedUrl(cur.path);
				}
				return;
			}
			if (typeof guardVerdict === 'string') {
				// Re-enter through the public replace() seam: same-path no-op,
				// commit-window behavior, matching, guards, and D61 atomicity all stay
				// centralized. Await it so awaiting the denied navigation observes the
				// final redirect commit. If replace was a same-path/unmatched no-op, no
				// newer token owns cleanup, so restore a transition we superseded.
				// Mark the re-entry so replace()'s #navigate keeps the redirect budget
				// (Fix 2); clear unconditionally after the await in case replace() was a
				// no-op that never re-entered #navigate to consume the flag.
				this.#guardRedirecting = true;
				const redirected = await this.replace(guardVerdict);
				this.#guardRedirecting = false;
				this.#recoverFailedNavigation(token);
				// A redirect that no-op'd (its target is already the committed route, or is
				// unmatched) left #state and the URL untouched, so after a POPSTATE the
				// browser still sits on the guarded entry — repair it exactly like the block
				// case. A redirect that COMMITTED already rewrote the URL through
				// #commitLocation (#state moved off `cur`), and a push never moved the URL,
				// so both skip this. `cur` is non-null on any pop (pops follow a commit).
				if (pop && cur && this.#state === cur) this.#restoreCommittedUrl(cur.path);
				return redirected;
			}
		}

		// keep = shared chain PREFIX length by node object identity. Reused
		// ancestors keep their instances; everything from `keep` down is fresh.
		let keep = 0;
		if (cur) {
			const a = cur.entry.chain;
			const b = entry.chain;
			const max = Math.min(a.length, b.length);
			while (keep < max && a[keep] === b[keep]) keep++;
		}

		// An interrupted transition is still animating an outgoing unit; that unit
		// and everything under it is DOOMED (#swap destroys it on entry). The reuse
		// plan must not include instances inside it: if the pending out is the old
		// LAYOUT, nothing survives (fresh layout, keep 0); if it is cur.views[j],
		// clamp keep to j so levels j.. are rebuilt fresh.
		let pendingLayoutOut = false;
		if (this.#pendingOut && cur) {
			if (this.#pendingOut === cur.layout) {
				keep = 0;
				pendingLayoutOut = true;
			} else {
				const j = cur.views.indexOf(this.#pendingOut);
				if (j !== -1 && j < keep) keep = j;
			}
		}

		const reusedViews = cur ? cur.views.slice(0, keep) : [];
		const freshViews = [];
		for (let i = keep; i < entry.chain.length; i++) {
			freshViews.push(new entry.chain[i].view(this.#ctx));
		}

		// Layout is ROOT-only: reuse the instance iff its class matches (a shared
		// root ⇒ same layout class ⇒ always reused) — unless the old layout is the
		// pending-out unit, in which case it is doomed and a fresh one is built.
		const reuseLayout = !!(
			cur &&
			cur.layout &&
			!pendingLayoutOut &&
			cur.layoutClass === entry.layout
		);
		const layout = reuseLayout
			? cur.layout
			: entry.layout
				? new entry.layout(this.#ctx)
				: null;

		// LOAD (pre-commit, parallel, D19 gate). Fresh views preload (created +
		// data off-DOM); reused ancestors refresh with the new params and are
		// AWAITED (routed content gates the URL); a fresh layout preloads. A reused
		// layout is NOT loaded here — it re-runs data() post-commit (#refreshLogged).
		//
		// Skeleton exemption (v1.8, D39): a FRESH instance that declares a
		// <puzzle-skeleton> (compiled renderSkeleton) opts out of the gate — its
		// preload is STARTED here but not awaited, the commit proceeds, and the
		// preloaded mount renders the skeleton until data() commits. The D19
		// failure guarantee narrows for these: the URL has already moved when a
		// skeleton view's data() rejects (logged; the skeleton stays up — surfacing
		// load errors is the view's job). Reused ancestors always gate: they show
		// real content, which must never regress mid-navigation.
		//
		// SSG takeover (v1.33, D67) exception: on navigation #0 of a prerendered app
		// (no `cur` AND the container still carries the `data-puzzle-ssg` marker
		// #takeoverSSG detects), the skeleton exemption must NOT apply. The takeover
		// replaceChildren()s the fully-rendered prerendered markup and mounts the
		// fresh SPA tree in its place; if a skeleton view committed unawaited, that
		// mount would draw renderSkeleton() OVER the real content — a content →
		// skeleton → content flash on every static page load (worse with a D52
		// min-duration hold). So we AWAIT the initial chain's preload(s) like any
		// non-skeleton view: the commit + replaceChildren then happen with real data,
		// and #renderNow (loaded === true after the awaited preload) draws the real
		// template — the prerendered content is replaced by identical real content in
		// ONE synchronous swap, no skeleton shown (so #shouldHold's D52 hold never
		// engages either — it needs a skeleton to have actually rendered). Scoped
		// TIGHTLY to nav #0 + marker present; a data() rejection here follows the
		// normal initial-nav gate-failure path (catch below: stay put, URL untouched,
		// prerendered DOM left intact). All other D39 behavior — SPA cold boot with a
		// skeleton, subsequent client-side navigations to skeleton views — is
		// byte-identical (isSSGTakeover false ⇒ skeletonExempt is the old check).
		const isSSGTakeover =
			!cur && this.#container != null && this.#container.hasAttribute('data-puzzle-ssg');
		try {
			const loads = [];
			const hasSkeleton = (v) =>
				!isSSGTakeover && typeof v.renderSkeleton === 'function';
			const start = (v) => {
				const p = v.preload({ params, props: {}, route: to });
				if (hasSkeleton(v)) {
					p.catch((err) => console.error('[puzzle] skeleton view data() failed:', err));
				} else {
					loads.push(p);
				}
			};
			// GATED loads start first, skeleton-exempt preloads LAST. An async
			// data() holds the store's tracking scope open for its whole await
			// (Store.withTracking serializes evaluations), so a skeleton view's
			// un-awaited preload must open its scope only after every gated load
			// has started — otherwise the gate queues behind the skeleton's own
			// fetch and the commit (and the skeleton paint) waits on the very
			// load the exemption exists to skip.
			for (const v of freshViews) if (!hasSkeleton(v)) start(v);
			for (const v of reusedViews) loads.push(v.refresh({ params, route: to }));
			if (layout && !reuseLayout && !hasSkeleton(layout)) start(layout);
			for (const v of freshViews) if (hasSkeleton(v)) start(v);
			if (layout && !reuseLayout && hasSkeleton(layout)) start(layout);
			await Promise.all(loads);
		} catch (err) {
			console.error('[puzzle] navigation data() failed:', err);
			for (const v of freshViews) v.destroy();
			if (layout && !reuseLayout) layout.destroy();
			// Strand recovery: our token bump doomed any transition still animating
			// out (its post-playOut check will #abandon against our newer token), but
			// by failing here we never reach #swap — the only place that destroys a
			// stalled #pendingOut. Left alone, that outgoing unit sits fully played
			// out (held invisible by the out animation's `fill`) over an UNCHANGED
			// #state that still claims it as the current view. Restore it: cancel the
			// out animation (WAAPI cancel clears the effect, finished-and-filling
			// included — and resolves a still-parked playOut await, so the doomed
			// navigation abandons promptly) and clear #pendingOut. Only when WE are
			// still the latest navigation — a newer one owns the cleanup via its own
			// clamp + #swap skipOut path. The restored unit's playOut memo stays
			// spent: a later navigation away swaps it out instantly, no second out
			// animation.
			this.#recoverFailedNavigation(token);
			return; // stay put, no history entry (reused ancestors kept — soft-violation)
		}

		// A newer navigation started while we awaited — discard this one.
		if (token !== this.#token) {
			for (const v of freshViews) v.destroy();
			if (layout && !reuseLayout) layout.destroy();
			return;
		}

		// LOCATION is NOT committed here anymore (D61): URL + memory stack + title/head (D84) all
		// move into #commitLocation, called inside the synchronous #committing window
		// — the params-only branch below and #swap's commit block — so they land
		// ATOMICALLY with the mount/#state, one out-animation LATER in sequential mode.
		// #resolveScroll STAYS here (it is pure over its arguments — reads only
		// #scrollEnabled()/#scrollBehavior, never #scrollKey/#positions/history): the
		// resolved { anchor } sentinel / {x,y} is threaded down to #commitState, which
		// applies it after the new content is on screen.

		const views = [...reusedViews, ...freshViews];

		// Where the window should land once the new view is on screen (null =
		// leave it alone). Resolved here, applied in #commitState. A `#anchor` suffix
		// on the pushed path refines the default landing (D41): read off the fragment
		// parseLocation already split (D83 — stripPath dropped it for matching).
		const anchor = loc.hash ? loc.hash.slice(1) : null;
		const scroll = this.#resolveScroll({ to, from, push, pop, replace, savedPosition, anchor });

		// Params-only degenerate case: keep === chain length ⇒ no fresh views, the
		// whole chain was refreshed pre-commit. Just record state + refresh the
		// reused layout (chrome). (Replaces the old dedicated params-only branch.)
		if (keep === entry.chain.length) {
			// No animation is involved on a params-only refresh, so the atomic commit
			// (D61) is just these two adjacent synchronous calls: location (URL/title/
			// memory stack) immediately before #state. Timing is unchanged from the
			// old inline commit block.
			this.#commitLocation({ rawPath, entry, push, replace, memoryIndex, departScroll });
			this.#commitState({
				rawPath,
				pathname: loc.pathname,
				query: loc.query,
				hash: loc.hash,
				entry,
				params,
				views,
				keys: cur.keys,
				layout,
				scroll,
			});
			if (layout) this.#refreshLogged(layout, params, to);
			return;
		}

		// Assemble the FULL chain LEAF-UP into nested keyed component vnodes — all
		// levels, not just the fresh ones, so every host along the path (layout and
		// reused ancestors alike) receives slot content whose descendants describe
		// the NEW chain. Swapping only at the divergence level and leaving ancestors
		// holding their old vnodes would let any later ancestor re-render (store
		// change, setData) push the stale sub-chain back down and revert the swap.
		//
		// Keys: a REUSED level keeps its committed key, so the keyed patch reuses
		// the instance (children pushed through, no data() re-run — props are just
		// the key). A FRESH level gets its fullPaths pattern stamped with this nav's
		// token: patchComponent adopts by tag+key and ignores a preattached
		// .instance, so a fresh level must NEVER collide with an old key — not even
		// re-entering the same path pattern whose previous instance was destroyed by
		// an interrupted transition (the clamp above).
		const keys = entry.chain.map((_, i) =>
			i < keep ? cur.keys[i] : entry.fullPaths[i] + '\x00' + token
		);
		let childVnode = null;
		for (let i = entry.chain.length - 1; i >= 0; i--) {
			const vnode = new ViewNode(
				entry.chain[i].view,
				{ key: keys[i] },
				childVnode ? [childVnode] : []
			);
			if (i >= keep) vnode.instance = views[i]; // adopt, don't construct
			childVnode = vnode;
		}
		const rootVnode = childVnode; // vnode for chain level 0

		await this.#swap(token, cur, {
			rawPath,
			// The parsed URL parts (v1.49, D83) — #commitState records them on
			// #state so the `current` getter never reparses.
			pathname: loc.pathname,
			query: loc.query,
			hash: loc.hash,
			entry,
			params,
			views,
			keys,
			layout,
			reuseLayout,
			keep,
			rootVnode,
			scroll,
			to,
			// D61: #commitLocation (run as the first statement inside #swap's commit
			// window) reads these to move the URL/memory stack; null memoryIndex on a
			// push/initial nav, set only for a memory-mode go/back/forward pop;
			// replace (D83) selects the entry-swapping commit instead of a push.
			// departScroll: the departure position captured at nav start, before the
			// outgoing view's teardown collapsed the page (see #navigate).
			push,
			replace,
			memoryIndex,
			departScroll,
		});
	}

	/**
	 * Commit this navigation's LOCATION side effects — URL + memory stack + title/head (D84) —
	 * inside the synchronous commit window, ATOMICALLY with the mount/#commitState
	 * that follow (D61). Moved out of #navigate's post-gate block so that, in
	 * SEQUENTIAL mode, it runs only AFTER the outgoing unit's out animation settles
	 * and BOTH #swap token checks pass: a navigation superseded or failed during the
	 * out never reaches here and so never touches the URL (the phantom-history-entry
	 * and URL/view-divergence holes D19's early commit left open). Overlap mode and
	 * params-only navigations have no await between the out-start and this call, so
	 * their timing is byte-equivalent to before; the initial navigation (no cur)
	 * never awaits either.
	 *
	 * On PUSH the OUTGOING entry's scroll position is saved under its key the instant
	 * before pushState replaces it (D33) — a pop saves earlier, in #handlePopState,
	 * where the browser has already moved the entry (a consequence: the outgoing
	 * position is now captured at swap time, not click time). Memory mode moves the
	 * in-memory stack/index instead of the URL; the initial navigation and pops never
	 * pushState but still set the title.
	 *
	 * On REPLACE (v1.49, D83) the current entry is swapped IN PLACE — see the
	 * branch below: history.replaceState with the entry's identity (its
	 * __puzzleScrollKey) preserved, or a memory-mode stack overwrite. No position
	 * save, no new entry key, no stack growth or index move.
	 *
	 * @param {{ rawPath: string, entry: object, push: boolean, replace?: boolean, memoryIndex: ?number, departScroll: ?{x:number,y:number} }} next
	 */
	#commitLocation(next) {
		const { rawPath, entry, push, replace, memoryIndex } = next;
		// The URL written for this path (#encodedUrl — the write half of the
		// path-shape boundary). rawPath stays path-shaped (base-free) for
		// #state/current either way. Unused in memory mode (no URL carrier);
		// shared by push + replace.
		const url = this.#encodedUrl(rawPath);
		if (push) {
			if (this.#mode === 'memory') {
				// In-memory stack (D42): truncate any forward entries, append the new
				// one, advance the index. This is the commit point — a failed or
				// superseded nav never reaches here, so the stack tracks committed
				// navigations only (D19/D61). No pushState, no scroll key.
				this.#stack.length = this.#index + 1;
				this.#stack.push({ path: rawPath });
				this.#index = this.#stack.length - 1;
			} else {
				if (this.#scrollEnabled()) {
					// Persist the position captured at nav start (#navigate's departScroll):
					// at commit time the outgoing view is already destroyed and the collapsed
					// page clamps window.scrollY to 0 in a real browser.
					this.#savePosition(next.departScroll);
					this.#scrollKey = this.#newEntryKey();
					history.pushState({ __puzzleScrollKey: this.#scrollKey }, '', url);
				} else {
					history.pushState({}, '', url);
				}
			}
		} else if (replace) {
			// replace() commit (v1.49, D83) — the D19/D61 atomicity is inherited: a
			// failed or superseded replace never reaches here, so this only ever
			// runs for the winning navigation, inside the commit window.
			if (this.#mode === 'memory') {
				// In-place overwrite of the current entry: NO truncate, NO append, NO
				// index move — stack length and position are invariants of a replace.
				this.#stack[this.#index] = { path: rawPath };
			} else {
				// The entry keeps its IDENTITY on a replace: no #savePosition, no
				// #newEntryKey — the replacement state re-carries the existing
				// __puzzleScrollKey, so a later pop restores whatever position was saved
				// under this entry as if it were never rewritten (v1.49, D83).
				if (this.#scrollEnabled()) {
					history.replaceState({ __puzzleScrollKey: this.#scrollKey }, '', url);
				} else {
					history.replaceState({}, '', url);
				}
			}
		} else if (this.#mode === 'memory' && memoryIndex != null) {
			// Memory-mode go/back/forward (D42): the pop advances #index at THIS commit
			// point — a superseded pop never reaches here, so the index tracks committed
			// navigations only, exactly like the push branch.
			this.#index = memoryIndex;
		}
		// Any in-flight memory pop has now landed (or been superseded by this commit):
		// clear its pending target so the next go() bases off the freshly-committed
		// #index (Fix 3 / D42). Already null in history/hash mode.
		this.#pendingIndex = null;
		this.#syncHead(entry);
	}

	/**
	 * The async view transition. It animates the outgoing unit out, tears it down,
	 * COMMITS location/title-head/memory-stack (#commitLocation, the FIRST statement
	 * inside the #committing window — D61, so a superseded/failed out never moves
	 * the URL), mounts the (preloaded) incoming sub-chain, and animates the animator
	 * in — enforcing the one-animator rule documented in the file header
	 * (constellation/doc/DOC-SPEC.md §12, D30). SEQUENTIAL by default (out awaited before
	 * the IN phase — location commits AFTER it); in OVERLAP mode (v1.24, D56, §26)
	 * the out is pinned + started but NOT awaited, so the IN phase (and #commitLocation)
	 * runs concurrently and the leaver tears down on its own out-settle.
	 *
	 * @param {number} token this navigation's monotonic token
	 * @param {object|null} cur the previous committed #state
	 * @param {object} next { rawPath, entry, params, views, layout, reuseLayout, keep, rootVnode, scroll, to, push, memoryIndex }
	 */
	async #swap(token, cur, next) {
		const { entry, params, views, layout, reuseLayout, keep, rootVnode } = next;

		// The outgoing unit this transition animates out: the OLD layout when a
		// fresh layout replaces it (layout swap, keep=0), otherwise the topmost
		// SWAPPED old view cur.views[keep] (its destroy cascades to deeper views).
		let oldAnimator = null;
		if (cur) {
			oldAnimator = !reuseLayout && cur.layout ? cur.layout : cur.views[keep];
		}

		// The incoming unit — same shape as oldAnimator, computed once and reused
		// below both for transition-mode resolution and morph pairing (D65/D55).
		const newAnimator = entry.layout && !reuseLayout && cur ? layout : views[keep];
		// This navigation's transition mode (D65): destination-only resolution —
		// the outgoing view/route is never consulted, so "the card coming in"
		// always controls the transition, per #resolveTransitionMode below.
		const overlap = this.#resolveTransitionMode(entry, newAnimator) === 'overlap';

		// A previous transition is still animating its outgoing element. Cancel it
		// (destroy() cancels the WAAPI animation + removes the DOM) and skip our own
		// out phase. #pendingOut is that stalled transition's outgoing element; when
		// it is a DIFFERENT instance than OUR old-animator (e.g. a deep pending out
		// interrupted by a shallow nav), our old-animator is still live — tear it
		// down synchronously too, skipping its out (constellation/doc/DOC-SPEC.md §12 / D30).
		let skipOut = false;
		if (this.#pendingOut) {
			const stalled = this.#pendingOut;
			this.#pendingOut = null;
			stalled.destroy();
			if (oldAnimator && oldAnimator !== stalled) oldAnimator.destroy();
			skipOut = true;
		}

		// ---- OUT phase: animate + tear down the outgoing unit --------------------
		// OVERLAP (v1.24, D56): pin the leaver and start its out WITHOUT awaiting,
		// then fall straight through to the IN phase so old-out and new-in play
		// concurrently. The leaver tears down on its own out-settle (#startOverlapLeave).
		// SEQUENTIAL (default): fully play the out and destroy BEFORE the IN phase —
		// byte-identical to v1.23.
		if (!skipOut && cur && oldAnimator) {
			if (overlap) {
				this.#startOverlapLeave(oldAnimator);
			} else {
				this.#pendingOut = oldAnimator;
				// Morph-leave (v1.23, D55): starts synchronously alongside the WAAPI out.
				// Keeping the outgoing unit in the DOM until the blob lands back on its
				// counterpart is the WINNER's obligation ONLY (see the two token checks
				// below). Swallow any rejection at creation so a superseded transition
				// that walks away from the promise never raises an unhandled rejection; a
				// throwing handler is logged. Morph must never wedge navigation.
				let morphOut = null;
				if (this.#morphHandler) {
					try {
						const p = this.#morphHandler.leave(oldAnimator.element);
						if (p) morphOut = Promise.resolve(p).catch(() => {});
					} catch (err) {
						console.error('[puzzle] morph leave handler threw', err);
					}
				}
				// A user viewWillHide()/viewDidHide() hook can throw, rejecting playOut().
				// Guard it: log and CONTINUE as if the out settled. Unguarded, the
				// rejection propagates out of #swap → out of #navigate (whose try/catch
				// wraps only the LOAD phase) into the un-awaited push() promise (an
				// unhandled rejection) AND strands the preloaded incoming instances —
				// they are never mounted (the mount below is skipped) and never destroyed,
				// leaking live store subscriptions that even router.stop() can't release
				// (stop only tears down #state + #pendingOut). Mirrors the codebase
				// posture: destroyAnimated() (PuzzleView.js) and #startOverlapLeave both
				// catch here — "a rejected leave must never strand...". Continuing means
				// the two token checks, the morphOut await, the #pendingOut clear, and
				// destroy() below all proceed exactly as on the success path.
				try {
					await oldAnimator.playOut();
				} catch (err) {
					console.error('[puzzle] leave hook failed during navigation:', err);
				}
				// Superseded while the outgoing unit was still animating out: bail NOW,
				// BEFORE awaiting the fly-back. The loser must not be held hostage by its
				// own morphOut — a never-settling engine promise (e.g. hide() on the unit
				// the winner just cancelled) would otherwise strand (leak) the loser's
				// fresh instances. #pendingOut stays set to oldAnimator so the WINNING
				// navigation destroys the outgoing unit via its own #swap skipOut path.
				if (token !== this.#token) return this.#abandon(next);
				// WINNER only: hold the outgoing unit on screen until the blob lands.
				if (morphOut) await morphOut;
				// Superseded during the fly-back: leave the outgoing unit for the winner
				// rather than tearing it down out from under a mid-flight morph.
				if (token !== this.#token) return this.#abandon(next);
				this.#pendingOut = null;
				oldAnimator.destroy(); // cascades to inner/deeper old instances
			}
		}

		// ---- IN phase: mount the preloaded incoming sub-chain, play it in --------
		// Suppress enter on every fresh view BELOW the animator (each nested mount
		// auto-chains a playIn that must not fire — the one-animator rule). The
		// enter of the animator itself is FIRE-AND-FORGET (the router never blocks
		// the nav on it, matching the reused-layout slot-child chain and the boot).
		const topView = views[keep];
		for (let i = keep + 1; i < views.length; i++) views[i].skipEnter();

		// Enter the commit window: #commitLocation (URL + memory stack + title/head) runs
		// FIRST, ATOMICALLY with the mount/#commitState below (D61). In sequential
		// mode the out-phase already settled and BOTH token checks above passed, so a
		// superseded or failed navigation never reaches this line and never touches
		// the URL (the phantom-entry / URL-divergence fix). The mount/patch below then
		// fires mounted() (and, via #playInLogged, viewWillShow) SYNCHRONOUSLY before
		// #commitState records #state, so a push() from one of those hooks defers
		// instead of re-entering #navigate against the stale #state (see #committing).
		// No await runs in this block — the out-phase already completed — so only a
		// synchronous reentrant push can arrive with the flag set; an async interrupt
		// lands with the flag off and interrupts as before. try/finally so a render
		// throw can never strand the flag and wedge all future pushes.
		// OUTER try/finally guarantees #runPendingPush runs on BOTH the success path
		// AND a SYNCHRONOUS commit-block throw (see the finally below). The INNER
		// try/finally owns the #committing flag exactly as before.
		this.#committing = true;
		try {
			try {
				this.#commitLocation(next);
				if (!entry.layout) {
					// No root layout: chain level 0 occupies the container.
					if (keep === 0) {
						// Mounted directly (the ViewManager does not auto-play it in) → the
						// router plays it in as the animator.
						this.#takeoverSSG(topView);
						this.#observeMount(
							topView.mount(this.#container, { children: rootVnode.children, preloaded: true })
						);
						this.#commitState(next);
						this.#playInLogged(topView);
					} else {
						// The root view survives: hand it the new full sub-chain as its slot
						// content. The keyed patch cascades level by level — reused levels
						// match their committed key (children pushed through, no data() rerun),
						// the divergence level swaps and adopts topView, whose playIn
						// auto-chains (topView is the animator).
						views[0].applyParentUpdate({ children: rootVnode.children });
						this.#commitState(next);
					}
				} else if (reuseLayout) {
					// Reused root layout: hand it the fresh FULL-chain vnode and let the
					// keyed patch cascade down to the divergence level, which swaps and
					// adopts topView (its playIn auto-chains — topView is the animator; the
					// layout instance never animates on a view swap). Cascading from the top
					// keeps every host's slot content consistent with the new chain, so the
					// layout's own post-commit data() re-run (chrome, D19) — or any later
					// ancestor re-render — cannot push stale content back down.
					layout.applyParentUpdate({ children: [rootVnode] });
					// Commit BEFORE the chrome refresh (v1.15, D47) — matching the
					// params-only branch — so the layout's post-commit data() reads a
					// fresh router.current. Safe: applyParentUpdate patched the DOM
					// above, so #commitState's mount-first invariant holds.
					this.#commitState(next);
					this.#refreshLogged(layout, params, next.to);
				} else {
					// Fresh root layout (keep === 0): layout swap OR initial nav.
					if (cur) {
						// Layout SWAP: the LAYOUT is the animator — suppress the whole fresh
						// chain (topView + deeper) so the subtree does not double-animate.
						topView.skipEnter();
						this.#observeMount(
							layout.mount(this.#container, { children: [rootVnode], preloaded: true })
						);
						this.#commitState(next);
						this.#playInLogged(layout);
					} else {
						// INITIAL nav: a layout does NOT animate on first paint — the topmost
						// view plays in exactly once via the ViewManager's slot-child chain.
						this.#takeoverSSG(topView);
						this.#observeMount(
							layout.mount(this.#container, { children: [rootVnode], preloaded: true })
						);
						this.#commitState(next);
					}
				}
			} finally {
				this.#committing = false;
			}
			// Morph-enter (v1.23, D55): pair the freshly mounted subtree against the
			// surviving DOM — synchronously post-commit, PRE-PAINT, so a match hides
			// its elements before the browser ever paints the plain mount. The
			// animator is the scan root; the initial navigation (no `cur`) never
			// morphs, which is what keeps deep links plain. A synchronous commit throw
			// above SKIPS this (it belongs to the succeeded-commit path).
			if (this.#morphHandler) {
				try {
					this.#morphHandler.enter(newAnimator?.element ?? null, { initial: !cur });
				} catch (err) {
					console.error('[puzzle] morph enter handler threw', err);
				}
			}
		} finally {
			// Commit fully done and #state consistent — run any push a mounted() hook
			// deferred during the window (redirect-from-mounted). Fire-and-forget.
			// In the OUTER finally so it runs on BOTH the success path AND a SYNCHRONOUS
			// commit-block throw (an applyParentUpdate/#commitState render-or-afterUpdate
			// throw): the flag is already cleared by the inner finally above, so a
			// deferred redirect runs as a normal navigation instead of being stranded
			// until the next successful commit. Composes with #observeMount (the mount
			// .catch): those rejections are ASYNC, so the only way into this finally
			// with #pendingPush stranded was a sync throw here. Success-path ordering is
			// unchanged — morph-enter above still runs before this.
			this.#runPendingPush();
		}
	}

	/**
	 * Observe a router-owned mount() promise. mount() is async, so a SYNCHRONOUS
	 * render()/mounted() throw inside it surfaces as a REJECTED promise (not a sync
	 * throw — the commit block keeps running, no rollback: D19/D61). Left
	 * unobserved that becomes an unhandled rejection; log it once here instead. The
	 * failed view is still committed to #state, so a later navigation replaces and
	 * destroys it normally. (Child views mounted through the ViewManager's keyed
	 * patch are already observed there — '[puzzle] child mount failed:'; this covers
	 * the three mounts the router drives directly: bare root view, layout swap,
	 * initial-nav layout.)
	 */
	#observeMount(p) {
		Promise.resolve(p).catch((err) =>
			console.error('[puzzle] view mount failed after commit:', err)
		);
	}

	/**
	 * SSG takeover (M2): when the container was server-prerendered, the SSG step
	 * stamped `data-puzzle-ssg` on it and filled it with the rendered markup. The
	 * marker is present only on navigation #0 of an SSG app; this runs immediately
	 * before an initial-nav mount into the container (the no-layout keep-0 branch
	 * and the initial-nav layout branch). Clear the prerendered content so the fresh
	 * mount doesn't append alongside it (duplicating the page), drop the marker (a
	 * later re-mount is a normal SPA mount), and suppress the incoming top view's
	 * ENTER animation so content the user is already reading doesn't re-animate.
	 * `topView` is views[keep] — the view the ViewManager auto-plays in (behind a
	 * layout) or the router plays in directly (no layout). A non-SSG app has no
	 * marker, so this is a no-op and behavior is byte-identical.
	 */
	#takeoverSSG(topView) {
		if (!this.#container.hasAttribute('data-puzzle-ssg')) return;
		this.#container.replaceChildren();
		this.#container.removeAttribute('data-puzzle-ssg');
		topView.skipEnter();
	}

	/**
	 * Overlap mode (v1.24, D56, constellation/doc/DOC-SPEC.md §26): start the
	 * outgoing unit's out phase and return IMMEDIATELY so #swap proceeds straight
	 * to the IN phase — old `out` and new `in` play concurrently (cross-fade).
	 *
	 * PIN before anything mounts: the leaver's root is fixed in place (#pinLeaver)
	 * so the incoming chain can take the layout slot in the SAME synchronous block
	 * without in-flow content stacking or jumping — and, critically, so that on the
	 * reused-layout / mid-chain path (where the keyed patch's own unmount() →
	 * destroyAnimated() drives removal off the SAME memoised playOut()) the element
	 * is already out of flow when the patch mounts the incoming view into the slot,
	 * and never gets used as a leavingEls insertion ref.
	 *
	 * #pendingOut holds the leaver for the overlap window (a newer navigation reads
	 * it and tears the leaver down synchronously via #swap's skipOut path). The
	 * settle-handler destroys the leaver when its out (and morph-leave) resolves and
	 * clears #pendingOut ONLY if it still points here — an interrupting navigation
	 * has already nulled #pendingOut (and may have set its own), so the === guard
	 * prevents a double-free and a stale clear of the newer nav's slot. destroy() is
	 * idempotent, so this converges safely with the reused-layout patch's own
	 * destroyAnimated() teardown. Morph-leave keeps its D55 contract: the returned
	 * promise is awaited alongside playOut before the leaver is removed; a throwing
	 * handler is logged and never wedges navigation.
	 */
	#startOverlapLeave(oldAnimator) {
		this.#pendingOut = oldAnimator;
		this.#pinLeaver(oldAnimator.element);
		// Morph-leave (v1.23, D55): same posture as the sequential path — start it
		// alongside the WAAPI out, swallow rejections, log a throwing handler.
		let morphOut = null;
		if (this.#morphHandler) {
			try {
				const p = this.#morphHandler.leave(oldAnimator.element);
				if (p) morphOut = Promise.resolve(p).catch(() => {});
			} catch (err) {
				console.error('[puzzle] morph leave handler threw', err);
			}
		}
		// Fire-and-forget: the out runs concurrently with the incoming in. On settle
		// destroy the leaver (idempotent — converges with a reused-layout patch's own
		// destroyAnimated) and release #pendingOut only if this leaver still owns it.
		// A rejecting playOut (a throwing viewWillHide/viewDidHide user hook) is
		// LOGGED and still cleaned up — the navigation already committed, so unlike
		// the sequential path (where a pre-commit hook throw rejects the nav) the
		// leaver must never be stranded on screen (#playInLogged's never-throw
		// posture, applied to the leave side).
		Promise.all([oldAnimator.playOut(), morphOut])
			.catch((err) => console.error('[puzzle] leave hook failed mid-overlap:', err))
			.then(() => {
				if (this.#pendingOut === oldAnimator) this.#pendingOut = null;
				oldAnimator.destroy(); // cascades to inner/deeper old instances
			});
	}

	/**
	 * Pin a leaving animator's root in place for an overlap transition (v1.24,
	 * D56): INLINE styles only (D28's no-wrapper rule) — `position: fixed` at the
	 * measured getBoundingClientRect(), `margin: 0`, `pointer-events: none` so
	 * mid-fade clicks land on the live view beneath. `fixed` positions against the
	 * viewport, so no injected wrapper or positioned ancestor is needed (the app
	 * must keep the container chain transform/filter/contain-free — the §26
	 * containing-block constraint). Measured BEFORE the incoming mount reflows the
	 * container. A missing element / getBoundingClientRect degrades to a no-op.
	 */
	#pinLeaver(el) {
		if (!el || el.nodeType !== 1 /* ELEMENT_NODE */ || !el.style) return;
		let rect;
		try {
			rect = el.getBoundingClientRect();
		} catch {
			return;
		}
		const s = el.style;
		s.position = 'fixed';
		s.top = rect.top + 'px';
		s.left = rect.left + 'px';
		s.width = rect.width + 'px';
		s.height = rect.height + 'px';
		s.margin = '0';
		s.pointerEvents = 'none';
	}

	/**
	 * Fire an instance's enter sequence without blocking the navigation, logging
	 * (never throwing) a user-hook error — mirrors the ViewManager's auto-chained
	 * slot-child playIn() so router-mounted animators behave identically.
	 */
	#playInLogged(instance) {
		Promise.resolve(instance.playIn()).catch((err) =>
			console.error('[puzzle] view enter animation failed:', err)
		);
	}

	/** Record the freshly-mounted navigation as the current committed state. */
	#commitState(next) {
		this.#state = {
			path: next.rawPath,
			// The parsed URL parts (v1.49, D83), split ONCE by #navigate's
			// parseLocation — the `current` getter reads these, never reparses.
			pathname: next.pathname,
			query: next.query,
			hash: next.hash,
			entry: next.entry,
			params: next.params,
			views: next.views,
			keys: next.keys,
			layout: next.layout,
			layoutClass: next.entry.layout,
		};
		// A real commit ends any redirect chain. Blocks, failures, unmatched
		// targets, and same-path redirect no-ops intentionally do not reset it.
		this.#guardRedirectCount = 0;
		// The in-flight navigation just committed (only the token owner reaches
		// #commitState): clear its pending target — #state now names it.
		this.#pendingNavPath = null;
		this.#warnMissingSlots(next.views);
		// Scroll lands here — synchronously after the new content is in the DOM
		// (every #commitState call site mounts/patches first) and before the next
		// paint, so restore/top never flashes the old offset (D33). An { anchor }
		// sentinel (a push to `/path#id`, D41) is resolved NOW that the target may
		// be on screen: its element rect + current scroll offsets, or top when the
		// element is absent from the committed DOM. Non-anchor landings keep the
		// byte-identical {x,y} path.
		if (next.scroll) {
			const pos =
				next.scroll.anchor !== undefined
					? this.#resolveAnchorPosition(next.scroll.anchor)
					: next.scroll;
			window.scrollTo(pos.x, pos.y);
		}
	}

	/**
	 * Resolve a push `#anchor` to a window position, AFTER mount (D41): the target
	 * element's rect top/left plus the current scroll offsets (rect is
	 * viewport-relative), falling back to top {0,0} when the id is not in the
	 * committed DOM — a skeleton view whose target hasn't rendered lands at top and
	 * is never re-scrolled when the real template patches in. A malformed
	 * `decodeURIComponent` is treated as "no such element" (→ top).
	 */
	#resolveAnchorPosition(anchor) {
		let el = null;
		try {
			el = document.getElementById(decodeURIComponent(anchor));
		} catch {
			el = null; // malformed percent-encoding → fall back to top
		}
		if (!el || typeof el.getBoundingClientRect !== 'function') return { x: 0, y: 0 };
		const rect = el.getBoundingClientRect();
		return { x: rect.left + (window.scrollX || 0), y: rect.top + (window.scrollY || 0) };
	}

	// ---- scroll behavior (v1.5, D33) ----------------------------------------

	#scrollEnabled() {
		// Memory mode: scroll is a NO-OP (D42). There are no history entries to key
		// restoration off, and an embed shares the window with a host page the router
		// has no claim on — so this gates out ALL scroll bookkeeping (window.scrollTo,
		// sessionStorage, scrollRestoration). scrollBehavior is accepted but inert.
		if (this.#mode === 'memory') return false;
		return this.#scrollBehavior !== false && typeof window.scrollTo === 'function';
	}

	/**
	 * Decide where the window goes for a committing navigation. `null` = leave
	 * scroll alone. Defaults: pop → the entry's saved position (top when none
	 * survived, e.g. after a reload cleared the in-memory map); push → the
	 * `#anchor` target when one is present (a { anchor } sentinel resolved after
	 * mount in #commitState, D41), else top; replace → LEAVE ALONE unless the
	 * target carries an explicit `#anchor` (v1.49, D83); initial navigation →
	 * untouched (the browser owns first paint). A custom
	 * scrollBehavior(to, from, savedPosition) overrides the defaults — including
	 * the anchor, which still rides in to.path; a falsy return leaves scroll
	 * alone; errors are logged and treated as falsy.
	 */
	#resolveScroll({ to, from, push, pop, replace, savedPosition, anchor }) {
		if (!this.#scrollEnabled()) return null;
		if (!push && !pop && !replace) return null; // initial navigation

		if (typeof this.#scrollBehavior === 'function') {
			try {
				const pos = this.#scrollBehavior(to, from, pop ? savedPosition : null);
				return pos ? { x: pos.x ?? 0, y: pos.y ?? 0 } : null;
			} catch (err) {
				console.error('[puzzle] scrollBehavior failed:', err);
				return null;
			}
		}
		// Replace (v1.49, D83): leave scroll alone by default — a query-tweaking
		// replace (a filter keystroke rewriting `?q=`) must not jump the window to
		// top. An EXPLICIT `#anchor` on the replace target is still a stated intent
		// to land somewhere, so it resolves exactly like push's anchor sentinel.
		if (replace) return anchor ? { anchor } : null;
		// Pop restores a saved position and beats any anchor (the user is returning
		// to where they were); the anchor refines PUSH landings only (D41). The
		// element position cannot be computed until after mount, so hand back a
		// sentinel that #commitState resolves against the committed DOM.
		if (pop) return savedPosition || { x: 0, y: 0 };
		if (anchor) return { anchor };
		return { x: 0, y: 0 };
	}

	/**
	 * Save the CURRENT window position under the entry key the window shows, then
	 * mirror the map to sessionStorage (D41). Delete-then-set so a re-saved key
	 * moves to newest in insertion order; evict the oldest past the cap.
	 */
	/**
	 * Record the outgoing entry's scroll position. `captured` (when given) is the
	 * position measured at navigation start, BEFORE the outgoing view's teardown
	 * collapsed the page — reading window live at commit time yields a clamped
	 * {0,0} in real browsers. The argless form (popstate save) still reads live:
	 * there the page is intact when it runs.
	 */
	#savePosition(captured = null) {
		if (this.#scrollKey == null) return;
		const pos = captured ?? { x: window.scrollX || 0, y: window.scrollY || 0 };
		this.#positions.delete(this.#scrollKey);
		this.#positions.set(this.#scrollKey, pos);
		while (this.#positions.size > SCROLL_MAX_ENTRIES) {
			// Map iteration is insertion order → the first key is the oldest.
			this.#positions.delete(this.#positions.keys().next().value);
		}
		this.#persistPositions();
	}

	/**
	 * Mirror the whole #positions map to a single sessionStorage blob (D41).
	 * Fail-soft: quota, disabled storage, or a missing sessionStorage silently
	 * degrades to the in-memory-only behavior.
	 */
	#persistPositions() {
		try {
			const obj = {};
			for (const [k, v] of this.#positions) obj[k] = v;
			sessionStorage.setItem(SCROLL_STORE_KEY, JSON.stringify(obj));
		} catch {
			// no persistence this session — the in-memory map still works.
		}
	}

	/**
	 * Load the persisted position blob into #positions on start() (D41). Fail-soft:
	 * missing/garbage storage leaves the map empty (= exactly the v1.5 behavior).
	 * Insertion order is preserved from the JSON object so the cap evicts oldest.
	 */
	#hydratePositions() {
		try {
			const raw = sessionStorage.getItem(SCROLL_STORE_KEY);
			if (!raw) return;
			const obj = JSON.parse(raw);
			if (!obj || typeof obj !== 'object') return;
			for (const [k, v] of Object.entries(obj)) {
				if (v && typeof v.x === 'number' && typeof v.y === 'number') {
					this.#positions.set(k, { x: v.x, y: v.y });
				}
			}
		} catch {
			// unreadable storage — start with an empty map.
		}
	}

	#newEntryKey() {
		return Date.now().toString(36) + '.' + ++this.#keySeq;
	}

	/**
	 * Read the current history entry's position key, stamping one (replaceState,
	 * preserving any foreign state) onto entries the router has not seen — the
	 * initial entry at start(), or entries pushed before the router existed.
	 */
	#adoptEntryKey() {
		const existing = history.state && history.state.__puzzleScrollKey;
		if (existing != null) return existing;
		const key = this.#newEntryKey();
		history.replaceState({ ...(history.state || {}), __puzzleScrollKey: key }, '');
		return key;
	}

	/**
	 * Dev aid (D30 edge): a non-leaf view whose routed child never landed has no
	 * <Slot/> in its template. Its child was preloaded but never mounted, so the
	 * child instance has no ViewManager and reports a null element. A parent
	 * still showing its skeleton (v1.8, D39 — not `loaded` yet) is skipped: its
	 * child legitimately mounts later, when the real template (and its <Slot/>)
	 * lands.
	 */
	#warnMissingSlots(views) {
		for (let i = 0; i < views.length - 1; i++) {
			if (views[i] && !views[i].loaded) continue;
			if (views[i + 1] && views[i + 1].element == null) {
				console.warn(
					'[puzzle] a routed child did not mount — does the parent view template include a <Slot/>?'
				);
			}
		}
	}

	/**
	 * Superseded mid-transition: drop the instances THIS navigation built but never
	 * put on screen — the fresh sub-chain (views[keep..]) and a fresh layout. Reused
	 * ancestors and a reused layout belong to the surviving state and are never
	 * destroyed; the outgoing element is left for the winning navigation.
	 */
	#abandon(next) {
		for (let i = next.keep; i < next.views.length; i++) next.views[i]?.destroy();
		if (next.layout && !next.reuseLayout) next.layout.destroy();
	}

	#match(pathname) {
		// A single trailing '/' is not significant: '/docs/' matches the '/docs'
		// route (and a ':param' capture never swallows it). Static hosts serve the
		// SSG output at directory URLs ('/components/badge/' → …/badge/index.html),
		// so the prerendered pages' own load paths must match their routes.
		pathname = stripTrailingSlash(pathname);
		for (const entry of this.#routes) {
			const m = pathname.match(entry.regex);
			if (!m) continue;
			// Guard the param decode: a malformed capture (`/%zz` → URIError) makes
			// this entry a NON-MATCH so a later entry / the catch-all can still take
			// the URL, instead of throwing out of the whole navigation.
			const params = {};
			let ok = true;
			for (let i = 0; i < entry.paramNames.length; i++) {
				try {
					params[entry.paramNames[i]] = decodeURIComponent(m[i + 1]);
				} catch {
					ok = false;
					break;
				}
			}
			if (!ok) continue;
			return { entry, params };
		}
		if (this.#catchAll) return { entry: this.#catchAll, params: {} };
		return null;
	}

	/**
	 * Post-commit refresh whose failure must not escape the pipeline — the view is
	 * already committed; a layout data() error is logged, never thrown into an
	 * un-awaited push() (e.g. from the click interceptor).
	 */
	#refreshLogged(view, params, route) {
		try {
			const p = view.refresh({ params, route });
			if (p && typeof p.catch === 'function') {
				p.catch((err) => console.error('[puzzle] layout refresh failed:', err));
			}
		} catch (err) {
			console.error('[puzzle] layout refresh failed:', err);
		}
	}

	/**
	 * This navigation's transition mode (D65), destination-only — the outgoing
	 * view/route is never consulted. Three tiers, most specific first:
	 *   1. Nearest-defined `transitionMode` walking the DESTINATION chain
	 *      leaf → root (same walk as #syncHead's per-field head resolution) — lets a parent
	 *      route (e.g. a `/settings` shell) set it once for every child.
	 *   2. The incoming animator's (view or layout instance) own `transitionMode`
	 *      field, colocated with `animations` on the class.
	 *   3. #defaultTransitionMode, the app-level constructor default.
	 * A bad value at tier 2 (a view/layout field outside the two known values)
	 * warns once per offending class and falls through rather than throwing —
	 * route-level values are already validated at construction (validateTransitionMode).
	 */
	#resolveTransitionMode(entry, newAnimator) {
		for (let i = entry.chain.length - 1; i >= 0; i--) {
			const mode = entry.chain[i].transitionMode;
			if (mode != null) return mode;
		}
		const viewMode = newAnimator?.transitionMode;
		if (viewMode != null) {
			if (viewMode === 'sequential' || viewMode === 'overlap') return viewMode;
			const label = newAnimator.constructor?.name ?? '(anonymous view)';
			if (!this.#warnedBadViewTransitionMode.has(label)) {
				this.#warnedBadViewTransitionMode.add(label);
				console.warn(
					`[puzzle] ${label}: unknown transitionMode "${viewMode}" (expected 'sequential' or 'overlap') — falling back to the app default`
				);
			}
		}
		return this.#defaultTransitionMode;
	}

	/**
	 * Managed head sync (D84, v1.50 — subsumes the pre-D84 #setTitle): resolve
	 * the four reserved meta fields (title/description/canonical/socialImage)
	 * from the destination chain — head.js resolveHead, the same nearest-defined
	 * leaf→root walk #setTitle performed for meta.title alone — and sync
	 * document.title + the `data-puzzle-head`-marked tags (head.js syncHead:
	 * update in place / create / remove-when-unresolved). Runs inside
	 * #commitLocation, so D61 atomicity covers the head exactly as it covered the
	 * title: a failed or superseded navigation never touches it. On hybrid
	 * takeover the SSG-emitted tags carry the SAME identities, so navigation #0
	 * adopts them in place — never duplicates. Title semantics stay byte-
	 * compatible: only a non-null resolved title assigns document.title (see
	 * resolveHead's asymmetry note on explicit null).
	 */
	#syncHead(entry) {
		// Memory mode performs NO document work (D42): an embedded widget must not
		// rename the host page's tab or edit the host <head> — document-level side
		// effects like the URL.
		if (this.#mode === 'memory') return;
		syncHead(resolveHead(entry.chain));
	}

	#handlePopState() {
		// URL already moved — run the pipeline but never pushState (D19 asymmetry).
		// In hash mode a popstate whose hash is a NON-route fragment (an in-page
		// anchor traversal, #currentPath → null) is not ours: return immediately,
		// before any scroll bookkeeping, leaving the rendered view alone (D34).
		const path = this.#currentPath();
		if (path == null) return;
		// Scroll bookkeeping happens NOW, not at commit: the browser has already
		// switched history entries, but #scrollKey still names the entry the
		// window is showing — save the outgoing position under it, then adopt the
		// target entry's key. This runs even if the navigation later fails or is
		// superseded: the URL really moved, so the key must track it (the same
		// soft violation D19 already accepts for a failed popstate load).
		let savedPosition = null;
		if (this.#scrollEnabled()) {
			this.#savePosition();
			this.#scrollKey = this.#adoptEntryKey();
			savedPosition = this.#positions.get(this.#scrollKey) || null;
		}
		this.#navigate(path, { push: false, pop: true, savedPosition });
	}

	/**
	 * hash-mode click interception, shared by #handleClick's relative-href and
	 * absolute-URL branches (D34/D51): given the fragment to test (a relative href
	 * starting with '#', or an absolute same-page URL's `.hash`), route it if it
	 * names an in-app fragment and return true. With a base the fragment must be
	 * exactly '#' + base (→ '/') or under '#' + base + '/'; base-less, any '#/...'
	 * is a route. A bare '#anchor' matches nothing → returns false (browser handles
	 * it). preventDefault is called HERE, before push (its placement in the original
	 * inlined cascades), so the return value is advisory.
	 */
	#tryHashFragment(fragment, e) {
		if (this.#base) {
			if (fragment === '#' + this.#base) {
				e.preventDefault();
				this.push('/');
				return true;
			}
			if (fragment.startsWith('#' + this.#base + '/')) {
				e.preventDefault();
				this.push(fragment.slice(1 + this.#base.length));
				return true;
			}
			return false;
		}
		if (fragment.startsWith('#/')) {
			e.preventDefault();
			this.push(fragment.slice(1));
			return true;
		}
		return false;
	}

	/**
	 * Intercept in-app <a> clicks. Falls through to the browser for anything that
	 * isn't a plain left-click on a same-origin navigational link (D19).
	 */
	#handleClick(e) {
		if (e.defaultPrevented) return;
		if (e.button !== 0) return; // non-left
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // modified

		const a = e.target.closest && e.target.closest('a');
		if (!a) return;
		if (a.hasAttribute('target')) return;
		if (a.hasAttribute('download')) return;

		const href = a.getAttribute('href');
		if (!href) return;
		if (href.startsWith('#')) {
			// history mode: any '#'-href is an in-page anchor, left to the browser.
			// hash mode: '#/...' IS a route — intercept it; a bare '#anchor' is still
			// an in-page anchor, left alone (D34). With a base (D51) both the exact
			// '#' + base (→ '/') and '#' + base + '/...' fragments are routes (push
			// base-stripped, symmetric with #currentPath); any other '#/...' falls
			// through to the browser like a non-route fragment.
			if (this.#mode === 'hash') this.#tryHashFragment(href, e);
			return;
		}
		if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

		let url;
		try {
			url = new URL(a.href, location.href);
		} catch {
			return;
		}
		if (url.origin !== location.origin) return; // external

		if (this.#mode === 'hash') {
			// hash mode: a same-page URL carrying a '#/...' fragment is an in-app
			// route; a differing pathname is a real navigation away from the app
			// shell — never push its pathname. Fall through to the browser otherwise.
			// With a base (D51) the fragment must be the exact '#' + base (→ '/') or
			// under '#' + base + '/', mirroring the relative-href branch above.
			if (url.pathname === location.pathname) this.#tryHashFragment(url.hash, e);
			return;
		}

		// history mode: with a base (D51) intercept ONLY same-origin URLs UNDER the
		// base (=== base or under base + '/') and push the base-STRIPPED path; a
		// same-origin link outside the base is a real navigation away from the app
		// and falls through to the browser (more correct than intercept-everything).
		// Memory mode keeps the base inert — the interceptor stays active but never
		// strips (there is no URL to prefix), so it behaves exactly as the base-less
		// history path.
		if (this.#base && this.#mode === 'history') {
			if (url.pathname !== this.#base && !url.pathname.startsWith(this.#base + '/')) {
				return; // outside the app base — let the browser navigate away
			}
			const stripped = url.pathname === this.#base ? '/' : url.pathname.slice(this.#base.length);
			e.preventDefault();
			this.push(stripped + url.search + url.hash);
			return;
		}

		// Preserve url.hash (D41): a `/docs#faq` link carries its anchor into the
		// pushed path so the default landing can target the element. A bare
		// `#anchor` href never reaches here — it took the href.startsWith('#')
		// branch above and fell through to the browser.
		e.preventDefault();
		this.push(url.pathname + url.search + url.hash);
	}
}

// ---- route compilation (nested → flat leaf Entries) -------------------------

/**
 * Depth-first flatten of a route node into one Entry PER LEAF, appended to
 * `entries` in declaration order. `ancestors`/`fullPaths` are the root→parent
 * node list and their accumulated path patterns. A node WITH children is not a
 * leaf itself — each child recurses (an index child `path:''` re-matches the
 * parent's exact path); a node without children emits an Entry.
 *
 * Fail-fast config errors (throw at construction): a child path with a leading
 * '/', a `layout` on a non-root node, `path:'*'` inside children, a duplicate
 * `:param` name within one chain, an unknown `transitionMode` value (D65), and
 * a non-function `guard` (D87) on any node (root or child).
 */
function flatten(node, ancestors, fullPaths, entries) {
	const isRoot = ancestors.length === 0;

	if (!isRoot) {
		if (typeof node.path === 'string' && node.path.startsWith('/')) {
			throw new Error(
				`[puzzle] child route path must be relative (no leading "/"): "${node.path}"`
			);
		}
		if (node.layout != null) {
			throw new Error(
				`[puzzle] "layout" is only allowed on a top-level route (found on child "${node.path}")`
			);
		}
		if (node.path === '*') {
			throw new Error('[puzzle] "*" catch-all is not allowed inside children');
		}
	}
	validateTransitionMode(node.transitionMode, `route "${node.path}"`);
	validateGuard(node.guard, `route "${node.path}"`);

	const parentPath = isRoot ? null : fullPaths[fullPaths.length - 1];
	const fullPath = isRoot ? node.path : joinPath(parentPath, node.path);
	const chain = [...ancestors, node];
	const paths = [...fullPaths, fullPath];

	if (node.children && node.children.length) {
		for (const child of node.children) {
			flatten(child, chain, paths, entries);
		}
	} else {
		entries.push(makeEntry(chain, paths));
	}
}

/** Build a leaf Entry: compile the leaf's full path to a matcher + merged params. */
function makeEntry(chain, fullPaths) {
	const leafPath = fullPaths[fullPaths.length - 1];
	const paramNames = [];
	// Compile ONE '/'-segment at a time: a segment that is a complete `:name`
	// becomes a single-segment capture group; EVERY other segment is regex-escaped
	// in full, so static path text with regex metacharacters ('.', '+', '(', '[',
	// …) matches LITERALLY (`/docs.v1` matches only `/docs.v1`, not `/docsXv1`).
	// The '/' separators are structural, re-joined below — never escaped. The
	// top-level catch-all '*' never reaches here (handled in the constructor; a '*'
	// inside children throws in flatten), so '*' is escaped like any other literal.
	const regexPath = leafPath
		.split('/')
		.map((seg) => {
			if (seg.length > 1 && seg[0] === ':') {
				const name = seg.slice(1);
				if (paramNames.includes(name)) {
					throw new Error(`[puzzle] duplicate route param ":${name}" in "${leafPath}"`);
				}
				paramNames.push(name);
				return '([^/]+)';
			}
			return escapeRegExp(seg);
		})
		.join('/');
	return {
		chain,
		fullPaths,
		regex: new RegExp('^' + regexPath + '$'),
		paramNames,
		layout: chain[0].layout ?? null,
		guards: chain.map((node) => node.guard).filter(Boolean),
	};
}

/** Escape every regex metacharacter so a static path segment matches literally. */
function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fail fast (D65) on a route-level transitionMode outside the two known values. */
function validateTransitionMode(value, label) {
	if (value != null && value !== 'sequential' && value !== 'overlap') {
		throw new Error(
			`[puzzle] unknown transitionMode: "${value}" on ${label} (expected 'sequential' or 'overlap')`
		);
	}
}

/** Fail fast (D87) when an optional route guard is present but not callable. */
function validateGuard(value, label) {
	if (value != null && typeof value !== 'function') {
		throw new Error(`[puzzle] guard on ${label} must be a function (got ${typeof value})`);
	}
}

/**
 * Join a parent path pattern with a relative child path. An index child (`''`)
 * composes to exactly the parent path; otherwise a single '/' joins them
 * (parent's trailing slash trimmed): '/' + 'a' → '/a', '/settings' + 'x' →
 * '/settings/x'.
 */
function joinPath(parentPath, childPath) {
	if (childPath === '') return parentPath;
	return parentPath.replace(/\/$/, '') + '/' + childPath;
}

/**
 * Normalize + validate a router base (v1.19, D51). `''`/`'/'`/undefined → `''`
 * (no base — the default; every seam stays byte-identical to the base-less
 * router). Otherwise a leading '/' is ensured and every trailing '/' trimmed, so
 * `'myapp'`, `'/myapp'`, and `'/myapp/'` all normalize to `'/myapp'`; multi-
 * segment bases (`'/a/b'`) work. A base containing `'#'` or `'?'` is a
 * constructor throw (config-error posture, like an unknown mode) — those
 * characters would corrupt the mode-specific URL encoding.
 */
function normalizeBase(base) {
	if (!base) return '';
	if (base.includes('#') || base.includes('?')) {
		throw new Error(`[puzzle] router base must not contain "#" or "?": "${base}"`);
	}
	let b = base[0] === '/' ? base : '/' + base;
	b = b.replace(/\/+$/, ''); // trim trailing slash(es); '/' → ''
	return b;
}

/** Reduce a full path to the pathname used for matching (drop query + hash). */
function stripPath(rawPath) {
	const path = rawPath.split('?')[0].split('#')[0];
	return path || '/';
}

/**
 * Split a raw path-shaped navigation target into the snapshot's URL parts
 * (v1.49, D83): `pathname` (query + hash dropped; base-free like rawPath, any
 * trailing slash kept BYTE-FOR-BYTE — matching alone normalizes, via
 * stripPath/stripTrailingSlash), `query` (a FROZEN null-prototype object), and
 * `hash` ('' or the raw fragment INCLUDING the leading '#'). The hash is split
 * FIRST, so a '?' inside the fragment never starts a query — the same
 * precedence stripPath's split order and the URL grammar give it.
 *
 * Query decoding is delegated to URLSearchParams (application/x-www-form-
 * urlencoded semantics: '+' is a space, percent-escapes decode): a single
 * value → string, a repeated key → a frozen array in source order, a valueless
 * key (`?debug`) → ''. URLSearchParams never throws on malformed percent input
 * (it leaves undecodable bytes verbatim), so navigation can never fail here.
 * The null prototype keeps `'toString' in query` false for absent keys — and
 * makes a hostile `?__proto__=x` key an ordinary own property.
 */
function parseLocation(rawPath) {
	const hashIdx = rawPath.indexOf('#');
	const hash = hashIdx === -1 ? '' : rawPath.slice(hashIdx);
	const beforeHash = hashIdx === -1 ? rawPath : rawPath.slice(0, hashIdx);
	const queryIdx = beforeHash.indexOf('?');
	const pathname = queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx);
	const query = Object.create(null);
	if (queryIdx !== -1) {
		for (const [key, value] of new URLSearchParams(beforeHash.slice(queryIdx + 1))) {
			const prev = query[key];
			if (prev === undefined) query[key] = value;
			else if (Array.isArray(prev)) prev.push(value);
			else query[key] = [prev, value];
		}
		// Freeze repeat-key arrays only after the collection loop finished growing
		// them; the top-level object freezes last.
		for (const key of Object.keys(query)) {
			if (Array.isArray(query[key])) Object.freeze(query[key]);
		}
	}
	// `'' || '/'` mirrors stripPath's empty-path fallback (a bare '?q' / '#f'
	// target still names the root).
	return { pathname: pathname || '/', query: Object.freeze(query), hash };
}

/**
 * Drop a single trailing '/' from a PATHNAME, never the root '/'. Shared by
 * #match (so SSG directory URLs like '/docs/' match the '/docs' route) and the
 * push() same-path no-op guard (via sameNavKey), so both agree on when a
 * trailing slash is insignificant (D67 / v1.33).
 */
function stripTrailingSlash(pathname) {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Comparison key for the push() same-path no-op guard: the raw path with a
 * single trailing slash trimmed from its PATHNAME portion only — query + hash
 * are still compared byte-for-byte (so `/docs#faq` twice = no-op, `/docs#faq`
 * while at `/docs` = a real navigation, unchanged). Uses the same
 * stripTrailingSlash rule #match applies, so a nav link push('/docs') is a
 * no-op on a page loaded at the SSG directory URL '/docs/' (which #state.path
 * keeps verbatim) instead of piling a duplicate history entry.
 */
function sameNavKey(rawPath) {
	const cut = rawPath.search(/[?#]/);
	if (cut === -1) return stripTrailingSlash(rawPath);
	return stripTrailingSlash(rawPath.slice(0, cut)) + rawPath.slice(cut);
}

export default Router;
