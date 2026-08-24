# Grok code review — client runtime size and simplification

Date: 2026-08-24
Branch: `release/0.7.0`
Scope: JavaScript client runtime under `client-runtime/`. Read-only; nothing was changed.

This is a size and simplification review of the production SPA kernel, not a “make more features optional” pass. Unused features already sit behind subpath exports, `__PUZZLE_*__` DCE defines, and the formatter manifest. The question was whether leftover bloat, duplication, or over-engineering still ships after those gates.

Claims about shipped bytes were checked against `examples/hello-world/dist/app.js` (64.7 KB minified; no models, no `| raw`, no adapter).

---

## Scope Summary

Reviewed the JavaScript client runtime under `client-runtime/` (~20k lines, 40+ files), with the production SPA kernel as the size target: `app.js`, `router/router.js`, `views/*`, `datastore/store.js`, `model.js`, `formatters.js`, `head.js`, `errors.js`. Opt-in subpaths (`/adapter`, `/morph`, `/ssg`, `/static`, `/testing`, `/fixtures`) and `__PUZZLE_DEV__` modules were checked for duplication *into* that kernel, not as extra import-split candidates.

## Architecture Overview

`PuzzleApp.mount()` always wires Store + FormatterRegistry + Router into a three-service `ctx`. Path routing is inlined; hash/memory live in `/router-modes`. Views own two-layer state, ViewManager owns DOM patch, the store owns records and subscriptions. Adapter, morph, SSG, static kernel, fixtures, and the DevTools/profiler/HMR trio are already off the default graph. Production `__PUZZLE_DEV__ === false` plus `dropConsole` is supposed to strip diagnostics. The remaining size problem is not “too many features in one file.” It is leftovers those gates do not see: class identity that pins unused constructors, and `reportError` rest-args that are not `console.*` arguments.

## Findings

No critical findings.

### Important

#### 1. `instanceof FieldBuilder` keeps the unused schema DSL in every SPA

- **Location:** `client-runtime/model.js` — `FieldBuilder` / `RelationshipBuilder`; `PuzzleModel.normalizedSchema` / `relationshipDefs` (~698–724)
- **Fix effort:** Contained
- **Confidence:** 90

**What.** `Store` always imports `PuzzleModel`. Schema walking uses class identity:

```js
static normalizedSchema() {
	const schema = this.schema || {};
	const out = {};
	for (const [field, value] of Object.entries(schema)) {
		if (value instanceof RelationshipBuilder) continue;
		out[field] = value instanceof FieldBuilder ? value.def : value;
	}
	return out;
}
```

Hello-world never imports `Puzzle` and passes no models. The `Puzzle.string()` factories *do* tree-shake (`new FieldBuilder(` is absent from dist). The two `instanceof` checks do not. Dist still contains the full builder class (`primary`, `required`, `default`, `min`, `max`, `oneOf`, `validate`) plus `RelationshipBuilder`.

**Why it matters.** This is not “extract models into a subpath.” Same-module DCE already works for the factories. The only live reference left is `instanceof` on a class `PuzzleModel` cannot shake. Hello-world pays ~700 minified bytes of DSL it never constructs. The validation strings (`is required`, `must be a number`, …) are a *different* keep (`Store._instantiate` → `_collectErrors`) and would remain.

**Suggested approach.** Duck-type the descriptor. `FieldBuilder.def` has `type` + `validate` and no `kind`; `RelationshipBuilder.def` has `kind`. Unwrap `.def` on that shape, pass plain descriptors through as today. No new module, no new define. Confirm a hand-written `{ type: 'string' }` schema still works (it already takes the `: value` branch).

---

#### 2. `reportError` rest-args survive `dropConsole`, so dead diagnostic strings ship

- **Location:** `client-runtime/errors.js` `reportError` (~32–52); catch sites in `app.js`, `router/router.js`, `views/PuzzleView.js`
- **Fix effort:** Refactor
- **Confidence:** 90

**What.** The funnel takes console prefixes as extra arguments:

```js
export function reportError(ctx, error, info, ...consoleArgs) {
	const handler = ctx && CONFIG.get(ctx)?.handler;
	const stableInfo = Object.freeze({
		phase: info.phase,
		view: info.view ?? null,
		route: info.route ?? null,
	});
	if (!handler) {
		if (consoleArgs.length) console.error(...consoleArgs);
		return stableInfo;
	}
```

Production `dropConsole` empties the `console.error` *inside* `reportError`. Dist becomes `if (!i) return r.length, s` — the `r.length` read keeps `...r` live, so every call-site string stays. Direct `console.error` strings *are* stripped (`onError hook failed`, `unknown formatter`, `did you mean`). Wrapper arguments are not.

Hello-world (no `onError`) still contains ~30 unique dead prefixes, including:

| String | Copies in dist |
|---|---|
| `data() failed after a bound write:` | 4 |
| `layout refresh failed:` | 2 |
| `morph leave handler threw` | 2 |
| `mounted hook error:` | 2 |

`onError` still only receives `(error, info)` — it never sees these strings. Roughly 1.5–2 KB uncompressed of prefixes that cannot print under default production settings. Same class of leak D43 already fixed for Levenshtein (logic ran *outside* a stripped `console.error`).

**Why it matters.** `dropConsole` was sold as a size win. It does not apply to this funnel, which is the runtime’s main diagnostic path. gzip will fold the repeated `[puzzle] …` shape, but this is still in the same ballpark as the dropConsole save itself, and the copies (bind write ×4, morph leave ×2) are the bill for inlined `try`/`catch` pairs that each pass the same literal twice.

**Suggested approach.** Stop passing console strings into `reportError`. Have the funnel log from `info.phase` (one `console.error` that dropConsole *can* strip), or wrap extra args in the inline `__PUZZLE_DEV__` probe at each site. Then delete the rest-args. Do not leave `r.length` as a liveness root. Throw messages (`new Error('[puzzle] …')`) stay — those are not this finding.

---

### Minor

#### 3. SPA title sync still walks four head fields

- **Location:** `client-runtime/head.js` `HEAD_FIELDS` / `resolveHead` (~26–56); `router/router.js` `#syncHead` (~2691–2696)
- **Fix effort:** Contained

**What.** Dist still has `["title","description","canonical","socialImage"]`. The router does `syncTitle(resolveHead(entry.chain))`; `syncTitle` reads only `.title`. D111 already made description/canonical/socialImage build-time-only. SSG’s import of `resolveHead` is a different graph and does not pin those strings in `app.js`.

**Why it matters.** Three interned names plus three extra `meta` walks per navigation, including hello-world, which has no `meta` at all. On the order of ~80–120 B minified — below the size-banner quantum, which is why this is minor.

**Suggested approach.** `syncTitle(chain)` should call the existing `resolveField(chain, 'title')`. Leave `resolveHead` / `HEAD_FIELDS` for the Node prerenderer. Do not write a second walk.

## Strengths

This runtime has already been through real size work, and it shows.

- **Exclusion is structural, not hoped-for.** Adapter, morph, fixtures, hash/memory, `headTags.js`, and SSG/static kernels stay out of hello-world by not being imported. D157/D159/D98/D111 hold in dist (`PuzzleAdapterError` and settle-loop strings are absent).
- **DCE probes are empirical.** Inline `typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` in class methods is verbose on purpose; a shared `const DEV` was measured to leave dead guards. Dev warnings live at module scope so they can actually shake. Formatter did-you-mean is gone from production. Bind-diagnostic *logic* is gone too — the Maps never allocate.
- **The hot classes are dense with load-bearing comments, not TODOs.** Zero `TODO`/`FIXME`/`HACK` in `client-runtime/`. Router `#navigate` looks huge because of the D19/D61/D146 trail; a lot of that is comments, which minify out.
- **Copy that looks mergeable often isn’t.** Sequential vs overlap morph-leave, params-only vs `#swap`, `__showErrorView` vs `__retryErrorView`, and `safeAssign` vs `safeMerge` skip sets were checked and have tests pinning the split. Collapsing those would re-open old bugs.

The kernel is not sloppy. The two Important items are leftovers *after* that discipline.

## Open Questions

- Duck-typing `FieldBuilder` needs a discriminant that a hand-written schema object will not trip. `def.kind` vs `def.validate` looks right for the two builder shapes plus `{ type: 'string' }` plain descriptors — worth one test that a custom descriptor with a stray `.def` still behaves.
- Finding 2’s call-site sweep is large. If you only do one half, delete the rest-args from `reportError` itself (so `r.length` dies) *and* stop passing strings at the duplicated bind/layout/morph sites first; those are the copies that show up twice in dist.

## Verdict

**Ready with fixes.**

## Summary

The production SPA kernel is already small in the ways this project cares about: unused features are out of the graph, not hidden behind more imports. The two Important leftovers are a class-identity pin and a diagnostic funnel `dropConsole` cannot see.

Do the FieldBuilder duck-type first — one file, no API change, hello-world drops a constructor it never calls. Then cut `reportError` rest-args so default production stops shipping ~30 dead `[puzzle] …` prefixes (the bind-write string alone appears four times). The four-field head walk is worth doing if you are already in `head.js`; it will not move the banner on its own.

Do not spend a cycle extracting more modules, gating `animate.js`/`visibility.js`, or folding sequential/overlap leave into one helper. Those were looked at; they are either already decided or they are two machines that happen to share a 15-line prefix.
