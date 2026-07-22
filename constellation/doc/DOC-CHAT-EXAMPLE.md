---
name: Puzzle Chat (examples/chat) — AI-assistant demo app
kind: reference-app
status: verified
verified_at: '2026-07-22T00:04:05.040Z'
connections:
  - DOC-STAYS-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - FILE-EXAMPLES-CHAT-APP-APP
  - FILE-EXAMPLES-CHAT-APP-ROUTES
  - FILE-EXAMPLES-CHAT-APP-VIEWS-THREAD
  - FILE-EXAMPLES-CHAT-APP-COMPONENTS-MESSAGEBUBBLE
  - FILE-EXAMPLES-CHAT-APP-LIB-ASSISTANT
  - FILE-EXAMPLES-CHAT-README
notes:
  - kind: verified
    text: >-
      Verified end-to-end. Evidence: `puzzle build examples/chat` green (21.6 KB gzip
      incl. app); npm test 275/275; 26-check Playwright drive against `puzzle dev`, twice
      consecutively all-green — seeded sidebar + Welcome hero, skeleton visible on first open (4
      pulse nodes at +180ms) with URL committed immediately, token streaming visible in the DOM with
      live sidebar reorder, stop-generating halts (caret gone, composer re-enabled), @keydown:escape
      clears the draft, @submit:prevent sends without reload, all four {#case} role bubbles from
      seed data, clock + timeago formatters, @click:stop delete without navigation, active-thread
      delete returns home, catch-all 404, zero console/page errors. Full-height shell confirmed
      (sidebar 800/800px viewport).
  - kind: gotcha
    text: >-
      Controlled <select>: the vdom assigns the select's `value` property during attr-patching
      BEFORE the <option> children are appended, so an initial value silently falls back to the
      first option. Mark the default option with the `selected` attribute for first render and keep
      value={ state } for re-renders (Composer.pzl does both). Also: component callback props
      forward only the FIRST argument (the parent binding compiles to `(event) => handler(event)`,
      D16) — pass one object ({ text, model }) for multi-value callbacks.
  - kind: verified
    text: >-
      Re-verified after the Claude-style restyle (warm near-black + terracotta) and the
      AI composer card with model picker: 31-check Playwright drive all-green twice (26 prior checks
      + controlled select defaults to puzzle-core, selection sticks across re-renders, chosen model
      stamped on the reply meta, seeded meta variety). Build 22.3 KB gzip.
---

# Puzzle Chat (examples/chat)

A fully local AI-assistant-style demo with conversation navigation, streaming
fake replies, a model selector, skeleton loading, and store-driven updates.
`examples/chat/README.md` owns the file inventory.

## Framework coverage

- nested shell/thread routes;
- first-load `<puzzle-skeleton>`;
- `{#case}`, `{#unless}`, loop counters, and stacked event modifiers;
- component callback props carrying one structured payload;
- token-by-token `record.update()` streaming;
- live collection and per-record subscriptions;
- cancellation during component teardown.

## Durable patterns

Records mutate in place, so a record prop remains shallow-reference-equal.
Message and conversation child components receive identity, then call
`findOne(type, id)` inside their own `data()` to subscribe to live changes.

Conditional controls live inside stable wrapper elements so toggling them does
not change the surrounding child shape or remount the composer.

The first thread load shares one memoized gate promise across any immediate
store-triggered reevaluation. This keeps the skeleton visible until the real
load resolves.

The assistant stream returns a cancel function. `destroyed()` invokes it so
no delayed token mutates records after the routed thread is gone.

Component callbacks forward one argument; the composer therefore sends a
single `{ text, model }` object.
