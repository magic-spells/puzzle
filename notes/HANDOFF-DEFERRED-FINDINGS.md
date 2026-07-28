# Deferred findings — verified, deliberately not fixed in 0.4.0

> **Update 2026-07-27:** M1 and I14 were re-verified and FIXED on
> `fix/grok2-runtime` (commit `1fe7bd3`, together with the D139 focus-ring
> work). I14 became decision card D140 — restoration-on-rejection was chosen
> over the DocumentFragment swap recommended below, because `mounted()` runs
> against connected DOM by contract. Only I12, M3, and the M12/M15/M16 group
> remain deferred; the bundle items remain post-0.4.0. D139 and D140 are now
> claimed — the next free decision number is D141.

Handoff brief for the tail of the Grok pass-2 review. Everything here was checked
against source and is **real**; each was deferred for a stated reason. Each entry
gives the location, the actual failure, the recommendation, and the trigger that
should reopen it.

Also included at the end: findings that were **refuted**. Those must not be
re-funded — they cost real time to disprove.

---

## I12 — a push deferred by the commit window resolves before it runs

**Location:** `client-runtime/router/router.js:785-792` (`push`), and the matching
branch in `replace`.

```js
push(path) {
    path = normalizeRoutePath(path);
    if (this.#committing) {
        this.#pendingPush = { kind: 'push', path };  // last-wins, single slot
        return Promise.resolve();                     // ← resolves immediately
    }
```

**The failure:** a view's `mounted()` hook doing `await this.ctx.router.push('/login')`
continues on the next microtask, while the redirect has not started. Code after
the `await` runs against the old route.

**Why deferred:** documented as deliberate at router.js:785-788, and the
neighboring in-flight-double-click branch (router.js:826-828) shows the codebase
already knows the difference — it deliberately returns the *in-flight navigation's*
promise there so `await` means "landed". So the deferral case is a knowing
exception, not an oversight.

**Recommendation:** fix it eventually, for consistency with the double-click
branch. Store a deferred promise alongside `#pendingPush` and resolve it when
`#runPendingPush` settles. The wrinkle is the last-wins single slot: if a second
push overwrites the first, the first promise needs a defined settlement — resolve
it (the navigation was superseded, same as any superseded nav) rather than reject.

**Trigger to reopen:** any bug report where a post-`await router.push()`
redirect reads stale route state. This is an API semantics change, so it needs a
decision card and belongs in a minor, not a patch.

---

## I14 — prerendered markup is cleared before a mount that can still fail

**Locations:**
- `client-runtime/router/router.js:1877` — `#takeoverSSG`, hybrid mode
- `client-runtime/static/index.js:114` — `mountStatic`, static mode

Both do the same thing:

```js
this.#container.replaceChildren();       // prerendered content gone
this.#container.removeAttribute('data-puzzle-ssg');
topView.skipEnter();
// ... mount happens after
```

**The failure:** between the `replaceChildren()` and a successful mount, the page
is blank. If the mount throws, it *stays* blank — the prerendered content that was
already correct and visible is destroyed, and there is no recovery path. For a
hybrid page this is the SEO-relevant content; for static it is the entire page.

**Why deferred:** the window is narrow and requires a mount failure. The hybrid
path additionally awaits the initial chain's preload before reaching this line
(router.js:1290-1315), so a `data()` rejection follows the initial-nav gate-failure
path and never reaches the swap — the prerendered DOM survives that case. What is
left exposed is a *render or mounted()* throw.

**Recommendation:** mount into a `DocumentFragment` first, then swap in one
operation:

```js
const frag = document.createDocumentFragment();
mount(topVnode, frag, null, ctx);         // may throw — container untouched
targetEl.replaceChildren(frag);           // single atomic swap
```

This is the same load-then-atomically-commit posture the router already uses for
navigation, applied to first paint. Verify that nothing in the mount path needs
`isConnected` or measures layout during mount — a fragment is not in the document,
so an animation or focus call during mount would misbehave. `skipEnter()` is
already called on every instance here, which removes the main risk.

**Trigger to reopen:** worth doing before any release that markets static/hybrid
output for SEO, since a blank page is the worst possible failure there.

---

## M1 — `@event:once` never detaches its listener

**Location:** `client-runtime/views/viewManager.js:1088-1113` (`withModifiers`).

```js
if (mods.includes('once')) {
    if (listeners[spentKey]) return;
    listeners[spentKey] = true;
}
```

**The failure:** the fire-count is correct — the handler runs exactly once ever,
and the spent flag survives the per-patch handler swap (a fresh closure is bound
every render, which is why the flag lives on the element's LISTENERS object rather
than in the closure). But the **listener is never removed**. Every subsequent
event of that type still dispatches, walks into the wrapper, and returns early.

For `@event:once` on a normal element this is a small waste. For
**`@event:outside:once`** it is worse: that listener lives on `document` in the
capture phase (viewManager.js:971-982), so a spent one-shot outside-handler keeps
receiving *every* event of that type on the page, forever, for the element's whole
lifetime.

**Why deferred:** correctness is fine; this is cost and lifetime, not behavior.
The comment at line 1089 documents "fires once EVER" accurately.

**Recommendation:** detach on spend. The removal logic already exists — the patch
path at viewManager.js:1041-1047 knows how to remove both plain and `outside`
listeners, including the `OUTSIDE_OPTS` capture flag:

```js
if (mods.includes('outside')) document.removeEventListener(event, listeners[name], OUTSIDE_OPTS);
```

Factor that into a helper and call it from the spend branch. **Keep setting the
spent flag** even after detaching — D38's note at line 989 and 1046 explains that
the flag must persist so a later patch re-adding the same `@event:once` does not
resurrect it. Removing the listener without keeping the flag would reintroduce
exactly that bug.

**Trigger to reopen:** any app with many `:outside:once` bindings, or a
performance profile showing document-capture listener churn.

---

## M3 — string ↔ vnode children transition

**Location:** the children-patching path in `viewManager.js`.

**Status:** confirmed as a code-level gap but **unreachable from compiled output** —
the compiler never emits a children list that transitions between a bare string and
a vnode array. It can only be hit by hand-written render functions.

**Recommendation:** leave it. Fixing unreachable paths adds patch-path cost for no
user-visible benefit, which cuts against this project's compiler-over-runtime-bytes
rule.

**Trigger to reopen:** if hand-authored render functions ever become a supported
public API.

---

## M12, M15, M16 — documented limitations

- **M12** — a JSON round-trip limitation in serialized state; documented, with a
  trivial recovery. Not deep-verified beyond confirming the documentation exists.
- **M15** — enter animation plays on the skeleton **root**, which persists across
  the skeleton→loaded swap. Only actually wrong when the skeleton root differs from
  the template root, which the compiler discourages. Partial finding.
- **M16** — by-design behavior with a documented workaround.

**Recommendation:** no code changes. If any of these recurs in a future review,
the right response is a SPEC sentence making the limitation explicit, not a fix.

---

## Bundle-size items

The review's bundle table was **not re-verified** — it aligns with the D130/D131
work already done. These are opportunities, not defects:

- Establish an esbuild **metafile baseline** first. Nothing here should be
  attempted without a before/after measurement; the whole point is bytes.
- Candidate extractions: `encodeURL` / `normalizeBase` are duplicated between the
  router and the static/SSG stubs.
- Candidate DCE gating: animation and overlap-mode code behind build defines, the
  same pattern `__PUZZLE_TAKEOVER__` and `__PUZZLE_HAS_FLIP__` already use.

**Recommendation:** post-0.4.0, measurement-first. Per the project's standing rule,
prefer moving complexity into the compiler when it shrinks `app.js`; golden-file
churn is an acceptable cost.

---

## Refuted — do not re-fund

These were investigated and are **not bugs**. Each cost real verification time;
re-filing them wastes it again.

- **M13 — "route guards don't gate hybrid prerendered markup."** Correct as
  described, and explicitly documented: guards are *"never a secrecy boundary"*.
  The prerenderer emits a warning for exactly this case
  (`ssg/index.js:207-211`) and `prerender: false` anywhere in the chain is the
  documented opt-out.
- **M14 — "a non-object `data()` return keeps the stale model."** Deliberate,
  documented in `#commit`.
- **I9's premise — "the SPA does not navigate on an unintercepted hash click."**
  Wrong. It does navigate, via `popstate`, with pop semantics. The underlying gap
  in `#tryHashFragment` was real and **was fixed** in commit `38773d8`; only the
  stated reasoning was incorrect.

---

## Verification, for any work in this file

```bash
npx vitest run              # 1462 passing at the fix/grok2-runtime tip
cd compiler && go test ./...
npx constellation lint      # 349 cards, 0 errors
```

Anything here that changes documented behavior (I12, I14) needs a decision card
and a `DOC-DECISIONS.md` entry. Next free number after D138 is **D139** — check
`DOC-DECISIONS.md` before claiming it, since I7 and I13 may take it first.
