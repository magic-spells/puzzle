# I13 — two different reactions to a post-paint `mounted()` throw

Handoff brief. **A decision is owed before any code is written.** Both current
behaviors are intentional in isolation; the problem is that they disagree, and
which one is right is a framework-owner call, not an implementation detail.

## The asymmetry

`mounted()` is invoked from one place —
`client-runtime/views/PuzzleView.js:428`, inside `#completeMount()`:

```js
#completeMount() {
    if (this.#mounted || this.#destroyed) return;
    this.#mounted = true;
    if (typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__) registerView(this);
    this.mounted();          // ← a throw here goes two very different ways
}
```

What happens next depends entirely on **who owns the view's lifetime**.

### Path A — ViewManager children: torn down

`mountComponent` in `client-runtime/views/viewManager.js` attaches a rejection
handler to the child's mount promise (lines 409-426):

```js
const placeholder = plantFailedMountPlaceholder(child);
child.destroy();                       // release partial subscriptions
if (placeholder) {
    vnode.el = placeholder;
    child.__failedPlaceholder = placeholder;   // patch() finds it and remounts fresh
}
vnode.component = null;
vnode.instance  = null;
```

The component is destroyed, replaced by a comment placeholder, and the **next
parent patch creates a fresh instance**. This is the D115 mount-failure recovery
contract, and it is deliberate: a view whose `mounted()` threw is presumed to have
half-initialized state, so it is discarded rather than left running.

### Path B — router-preloaded views: logged and left running

The router mounts its chain with `preloaded: true` and wraps each mount in
`#observeMount` (`client-runtime/router/router.js:1850`):

```js
#observeMount(p) {
    Promise.resolve(p).catch((err) =>
        console.error('[puzzle] view mount failed after commit:', err)
    );
}
```

That is the entire handler. Call sites: router.js:1758, 1793, 1802. The view stays
mounted, stays subscribed, and keeps rendering — with a `mounted()` hook that
threw partway through.

This too is deliberate. The router has already committed: URL, history, title,
head, and scroll all moved atomically. Tearing the view down here would leave the
URL pointing at a route with **nothing mounted** — the exact partial-commit state
the whole load-then-atomic-commit design exists to prevent. Comments at
router.js:1107 and 1831 both flag this reasoning.

`PuzzleView.js:580-582` states the boundary explicitly:

> *Router-preloaded views never set `#pendingMountHook`: preload() resolves before
> their synchronous mount, so Router ownership remains untouched.*

## Why this is a policy question, not a bug

Neither path is wrong on its own terms. They optimize for different invariants:

- **Path A** protects *component state integrity* — never keep a half-initialized
  component.
- **Path B** protects *the atomic-commit contract* — never leave a committed route
  with no mounted tree.

The defect is that an app author cannot predict which one they get. The same
`mounted()` throw, in the same view class, behaves differently depending on
whether that view was reached as a route or nested as a component. That is a real
surprise and worth resolving — but resolving it means choosing which invariant
wins.

## The three options

### Option 1 — Log everywhere (make Path B the rule)

Downgrade the ViewManager path to logging; nothing is ever torn down for a
post-paint hook throw.

- **For:** simple, predictable, never destroys user-visible content, matches how
  most frameworks treat lifecycle-hook errors.
- **Against:** abandons the D115 recovery contract, which was written in response
  to a real failure. Half-initialized components stay on screen with no recovery
  path — the next patch reuses the broken instance instead of replacing it.
- **Cost:** rewrite D115's decision card, delete the recovery machinery
  (`plantFailedMountPlaceholder`, `__failedPlaceholder`, the patch-side remount).

### Option 2 — Tear down everywhere (make Path A the rule)

Give the router the same placeholder-and-destroy treatment.

- **For:** one consistent rule, D115 preserved and generalized.
- **Against:** directly contradicts the atomic-commit contract. A routed view that
  throws in `mounted()` would leave the user on a committed URL staring at an
  empty container with no navigation in flight to fix it. The router has no
  "re-patch later" step that a ViewManager parent has, so nothing would ever
  remount it.
- **Cost:** high, and it re-opens a design the router was explicitly built around.

### Option 3 — Keep both, document the boundary (recommended)

Leave the behavior as-is; make the rule explicit and discoverable.

- Document in `DOC-VIEW-LIFECYCLE.md` and the SPEC's lifecycle section: *a
  `mounted()` throw destroys a component-owned view and is logged for a
  router-owned view, because the router has already committed the URL.*
- Make the two log messages name their outcome so the difference is visible in the
  console rather than only in the source:
  - router: `[puzzle] view mount failed after commit — the view stays mounted (router owns its lifetime):`
  - viewManager: `[puzzle] component mount failed — the component was destroyed and will remount on the next patch:`
- Add a test per path pinning the behavior, so neither drifts.

**Why I recommend this:** both behaviors are individually correct for their
owner, and the two invariants they protect genuinely conflict — there is no
single rule that satisfies both. Forcing consistency would mean sacrificing one
real guarantee to fix a surprise that better logging and documentation address
directly. It is also the only option that does not churn a shipped contract
during a release round.

## If Option 3 is chosen — the work

1. Two log-message edits: `router.js:1850-1853`, `viewManager.js:409-426`.
2. SPEC + `DOC-VIEW-LIFECYCLE.md` amendment stating the ownership rule.
3. Two tests: a routed view whose `mounted()` throws stays mounted and logs; a
   nested component whose `mounted()` throws leaves a placeholder and remounts on
   the next patch.
4. A short decision card (**D139** or later, depending on whether I7 claims it)
   recording that the asymmetry is intentional and why — so the next reviewer
   finds the reasoning instead of re-filing it. This is the main deliverable;
   without a card this comes back every review round.

If Option 1 or 2 is chosen instead, stop and write the plan against D115 first —
both are substantially larger than they look, and both invalidate a shipped
decision card.

## Verification

```bash
npx vitest run
cd compiler && go test ./...
npx constellation lint
```

## Related cards

- `DECISION-D115` — the mount-failure recovery contract (Path A's origin)
- `DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE` — the anchor-race containments that
  share `plantFailedMountPlaceholder`
- `constellation/doc/DOC-VIEW-LIFECYCLE.md` §3 and §4
