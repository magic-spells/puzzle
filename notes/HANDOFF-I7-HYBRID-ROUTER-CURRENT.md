# I7 — `router.current` is null through the entire hybrid prerender

Handoff brief. Designed but not implemented; needs a go-ahead before an agent
starts. Small, contained, well-tested surface.

## The finding

In `output: 'hybrid'`, every page is prerendered against a **memory Router that is
never started**. An unstarted Router has no committed state, so `router.current`
is `null` for the whole build. Any view that reads it renders its
nothing-is-current branch into the shipped HTML, then corrects itself after the
SPA takes over.

The classic casualty is nav highlighting:

```js
// renders as "not active" in the prerendered HTML, then flips after takeover
const isActive = this.ctx.router.current?.path === '/docs';
```

Consequences, in order of how much they matter:

1. **Crawlers and no-JS visitors only ever see the wrong state.** They never reach
   takeover, so the nav is permanently unhighlighted for them.
2. **A visible flash** for real users between first paint and takeover.
3. Any `current.params` / `current.route.name` read has the same problem, and
   `current?.` guards make it fail silently rather than loudly.

**Static mode already gets this right.** `output: 'static'` threads a real route
snapshot through `makeRouterStub`, so `current` is the page's snapshot. Hybrid is
the odd one out, and the mismatch between the two prerender modes is the actual
defect.

## Why it is this way today

`client-runtime/ssg/index.js:441-464` explains itself at length. The short version:
hybrid deliberately keeps a **real, unstarted memory Router** because the SPA boots
over it and takes over, at which point `current` becomes real on its own. Only
`url()` was shadowed, because a memory router returns unprefixed paths and a
based app would otherwise prerender broken hrefs.

The comment states the constraint that shapes the whole fix:

> *(Wrapping the instance is not an option: `current` reads private fields, so a
> delegating facade would throw.)*

So `current` cannot be fixed by proxying the Router. It has to be shadowed on the
instance, exactly as `url()` already is at line 463:

```js
router.url = (path) => encodeURL(path, routerMode, base);
```

This is a **documented, test-locked tradeoff**, not an oversight — which is why it
was demoted from the review round rather than fixed inline. Changing it means
changing the documented design, so it carries a decision card.

## The fix

Three edits, all in files that already do the work.

### 1. Build the snapshot for hybrid too

`client-runtime/ssg/index.js:134` currently gates the snapshot on static mode:

```js
const route = isStatic && entry ? makeRouteSnapshot(entry) : null;
```

Drop the `isStatic &&` gate. `makeRouteSnapshot` (in
`client-runtime/ssg/assemble.js:83-94`) is DOM-free, mode-agnostic, and already
returns a frozen `{ path, pathname, query, hash, route, params, chain }`. It needs
no changes.

### 2. Shadow `current` on the hybrid memory router

In the `else` branch at `ssg/index.js:452-463`, alongside the existing `url()`
shadow:

```js
router.url = (path) => encodeURL(path, routerMode, base);
if (route) {
    // Own property shadows the prototype getter — the same instance-shadowing
    // trick url() uses above, and for the same reason: `current` reads private
    // fields, so a delegating facade would throw. The takeover replaces the whole
    // instance, so this never outlives the prerender.
    Object.defineProperty(router, 'current', { value: route, enumerable: true, configurable: true });
}
```

`configurable: true` matters — leave the property redefinable so nothing downstream
is wedged if the router is reused.

The compiled route table and every other Router internal stay untouched, which is
what the SSG takeover expects.

### 3. Parity test

The valuable test is not "current is non-null" — it is that **both prerender modes
and the live client agree**. Add to `tests/static-prerender.test.js`: render the
same template through hybrid prerender, through static prerender, and against a
started live Router, and assert the three markup outputs match.

That test would have caught this class of bug on its own, and it guards the
hybrid/static divergence going forward.

## The test that must be flipped

`tests/static-prerender.test.js:524-528` currently **pins the buggy behavior**:

```js
it('hybrid mode still uses the unstarted memory router — url() unprefixed, current null', async () => {
    const cfg = { target: '#app', routes: [{ path: '/', name: 'home', view: Linked }] };
    const { pages } = await prerender(cfg); // hybrid default, history-mode
    expect(pages[0].html).toContain('href="/next"');
    expect(pages[0].html).toContain('>NULL</a>'); // memory router unstarted → current null
});
```

Rewrite it to assert `>/</a>` and rename it, mirroring the static-mode test three
lines above at 518-522, which already reads:

```js
it('static prerender router.current is the page snapshot, not null (a view can read current.path)', ...)
```

**Do not delete the `href="/next"` assertion** — it pins the separate `url()`
shadow, which this change must not disturb.

## Scope guardrails

- Do **not** start the memory router. Starting it would run guards, hooks, and
  scroll logic in a DOM-free build. The snapshot shadow is the whole fix.
- Do **not** touch the static branch at line 450 — it is already correct.
- Do **not** replace the memory Router with `makeRouterStub` in hybrid. Hybrid
  needs the real Router's compiled route table for the takeover; the stub throws
  on every navigation method.
- Expect **golden/snapshot churn** in prerender tests whose fixtures read
  `current`. Churn is expected; assert the new values are right rather than
  regenerating blindly.

## Verification

```bash
npx vitest run                      # 1462 passing at the branch tip
cd compiler && go test ./...
```

Then build an example in hybrid mode and confirm the prerendered HTML carries the
active-nav state before any JS runs — view source, not devtools, since devtools
shows the post-takeover DOM.

## Constellation obligations

This changes documented, test-locked behavior, so it needs a card:

- New decision card **D139** (next free after D138):
  `constellation/decision/DECISION-D139-HYBRID-ROUTE-SNAPSHOT.md`. Record that
  hybrid now shadows `current` with the page snapshot, that instance-shadowing is
  used because a delegating facade would throw on private-field reads, and that
  starting the memory router was rejected.
- Entry in `constellation/doc/DOC-DECISIONS.md`.
- Amend the §51-adjacent prerender prose in the SPEC where hybrid's router facade
  is described, and update the long explanatory comment at `ssg/index.js:441-464`
  so it stops describing the null as intentional.
