# @magic-spells/puzzle 0.4.0

## Breaking: capitalized composition markers (D134)

The composition markers are now capitalized: `<Children/>` (component default
content), `<Slot name="x"/>` (named slot), `<Slot/>` (router outlet). The
lowercase spellings are positioned compile errors, and **each error names its
replacement** — the compiler is the migration guide.

| Before | After |
|---|---|
| `<children/>` | `<Children/>` |
| `<slot/>` in a component | `<Children/>` |
| `<slot/>` in a routed view/layout | `<Slot/>` |
| `<slot name="x"/>` | `<Slot name="x"/>` |

The call-site `slot="x"` attribute is unchanged. Capitalization now uniformly
means "the framework resolves this tag": components from your imports, markers
from the grammar.

## New: marker fallback bodies (D141)

Markers accept a paired form whose body is fallback content, rendered only
when nothing fills that position — supplied content replaces it entirely:

```html
<Children>Save</Children>                        <!-- default call-site content -->
<Slot name="footer"><button>OK</button></Slot>   <!-- named-slot fallback -->
<Slot>No page selected</Slot>                    <!-- outlet: no child route -->
```

Fallback bodies are ordinary template content — formatters, `{#if}`/`{#for}`,
components, `{#svg}` — and self-closing markers simply have no fallback.

## Highlights

- **Hybrid prerender renders real route state (D142):** `router.current` is
  the page's route snapshot during prerender, so active-nav classes and
  `current.*` reads are correct in the shipped HTML — crawlers and no-JS
  visitors see the same state the live app renders.
- **Prerendered pages survive a failed takeover (D140):** if the client mount
  throws, the prerendered content and marker are restored — never a blank page.
- **Focus without the ring (D139):** the router's transient focus stamp
  suppresses both focus-ring channels (`outline` + `box-shadow`) for its
  lifetime, so keyboard navigation no longer draws a ring around the whole view.
- **`@event:once` detaches on spend** — including `:outside:once`'s
  document-level listener; zero listener cost after the single fire.
- **Lifecycle hardening (D135–D138):** params-only `replace()` no longer yanks
  focus per keystroke; enter animations and `mounted()` ordering converge on
  the anchor-race path; `loadAll`/`loadOne` guard server records without
  primary keys and merge through the per-field revision gate so a background
  poll can't wipe in-flight edits.
- **`mounted()` throw contract (D143):** component-owned views destroy and
  remount on the next patch; router-owned views stay mounted on their
  committed route; each console message names its outcome.
- **Performance round:** profiler instrumentation (dev-only, zero production
  bytes — D121/D131), serialized async `data()`, persistence write batching,
  Intl formatter caching, and a benchmark harness (`benchmarks/`).

## Upgrading

1. `npm install @magic-spells/puzzle@0.4.0` (never 0.3.0 — it shipped without
   platform binaries).
2. Recompile; fix each marker error the compiler reports — every message names
   the replacement spelling.
3. If a component relied on slot fallback under 0.1–0.2 grammar, move the
   default content into the marker's body (fallback bodies are back and better
   defined).
4. `puzzle upgrade skills` refreshes the embedded agent skill.
