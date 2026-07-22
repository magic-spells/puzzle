# Puzzle Chat Example

An AI-assistant chat UI — conversations sidebar on the left, thread on the
right, in a Claude-chat-inspired theme: dark, warm-neutral (near-black brown)
chrome with one terracotta accent. The "assistant" is a **fully local fake**:
it answers questions about the Puzzle framework itself from a small canned
knowledge base and streams its replies word by word. No network, no API keys,
no dependencies beyond the framework and Tailwind. A quiet model selector in
the composer picks one of three local fake models — the choice only changes the
streaming cadence (and puzzle-max appends one closing line) and is stamped onto
each assistant reply.

Where `examples/mission-control/` shows off animations and `examples/stays/`
leans into store reactivity, this demo exists for **feature coverage**: it is
the one example that exercises the v1.5–v1.8 grammar and router additions
together — skeleton loading, `{#case}`/`{#unless}`, event modifiers, nested
routes, and store-driven streaming.

## Run it

```bash
puzzle dev examples/chat        # from the repo root: go run ./compiler/cmd/puzzle dev examples/chat
```

Then open the dev server URL. To produce a production bundle instead:

```bash
go run ./compiler/cmd/puzzle build examples/chat
```

## What each piece demonstrates

Every checklist feature maps to a specific file:

| # | Feature | Where |
| - | ------- | ----- |
| 1 | **`<puzzle-skeleton>` loading template** (v1.8, SPEC §16) | `app/views/Thread.pzl` — ghost header + `{#for 1...3}` ghost bubbles; the first `data()` per conversation is delayed ~500ms so the skeleton is actually visible |
| 2 | **`{#case}` / `{:when}` / `{:else}`** (v1.7, SPEC §6) | `app/components/MessageBubble.pzl` — switches on `message.role` (user / assistant / system / error) |
| 3 | **`{#unless}`** (v1.7, SPEC §6) | `app/views/Thread.pzl` — the empty-thread state |
| 4 | **Event modifiers** (v1.7, SPEC §5) | `@submit:prevent` + `@keydown:escape` in `app/components/Composer.pzl`; `@click:stop` on the delete button in `app/components/ConversationItem.pzl`; `@click:once` on the suggestion cards in `app/views/Welcome.pzl` |
| 5 | **`{#for … , i}` loop counter** (v1.2) | `app/views/Shell.pzl` — the sidebar list; the index drives each `ConversationItem`'s staggered enter-animation delay |
| 6 | **Nested routes + `<Slot />`** (v1.3) | `app/routes.js` + `app/views/Shell.pzl` — the Shell parent hosts a Welcome index child (`''`) and a Thread child (`c/:id`) at `<Slot />` |
| 7 | **`animations = { in, out }`** (v1.1) | view transitions in every view; message/list-item enters in `MessageBubble.pzl`, `ConversationItem.pzl`, `TypingIndicator.pzl` |
| 8 | **Built-in `timeago` + one custom formatter** | `timeago` on `conversation.updatedAt` in `ConversationItem.pzl`; the custom `clock` formatter is registered in `app/app.js` and used on message timestamps in `MessageBubble.pzl` |
| 9 | **Two-way binding `value={ draft }`** | `app/components/Composer.pzl` |
| 10 | **Store reactivity spanning views** | `app/views/Thread.pzl` — streaming tokens `record.update()` the message *through the store*, which re-renders the thread AND bumps `conversation.updatedAt`, reordering the sidebar (`Shell.pzl` subscribes to the conversation collection) |

### App wiring
- **app/app.js** — `PuzzleApp` config (target, routes, models, formatters), the
  custom `clock` formatter, and a post-mount `seed(store)` call.
- **app/routes.js** — one top-level route with `children`: `''` → Welcome,
  `c/:id` → Thread. `layout` stays top-level-only; the catch-all is `'*'`.
- **app/lib/assistant.js** — `streamReply(prompt, { onToken, onDone, model })`
  returns a `cancel()`; keyword-matches a knowledge base about Puzzle, splits the
  answer into words, and drips them via a self-scheduling `setTimeout`. `model`
  picks the token cadence (nano fastest → max slowest; max also appends one
  closing sentence). No callback fires after `cancel()`.
- **app/lib/seed.js** — seeds two finished conversations with staggered
  timestamps; the first includes a `system` and an `error` message so all four
  `{#case}` branches render from real data.

### Models (`app/models/`)
- **conversation.js** — `id`/`title`/`createdAt`/`updatedAt`; `displayTitle`
  getter. No adapter (in-memory only).
- **message.js** — `conversationId`, `role`, `content`, `pending` flag,
  `model` (which fake model produced an assistant reply), `createdAt`.

### Views (`app/views/`)
- **Shell.pzl** — the persistent sidebar-plus-pane frame and nested-route
  parent; renders its matched child at `<Slot />`.
- **Welcome.pzl** — the index child: hero + suggestion cards that create a
  conversation and hand off to the thread.
- **Thread.pzl** — the centerpiece: skeleton, message list, typing indicator,
  "Stop generating", the composer, and the streaming state machine.
- **NotFound.pzl** — the `'*'` catch-all.

### Components (`app/components/`)
- **ConversationItem.pzl** — a sidebar row; `select`/`delete` callback props,
  staggered `get animations()`.
- **MessageBubble.pzl** — role-styled bubble with a blinking streaming caret.
- **Composer.pzl** — the input, styled as an AI-chat input card (text row +
  controls row). Local `draft` **and** `model` state (both via `setData`, not
  `data()`); a quiet `<select>` model picker (puzzle-nano / puzzle-core /
  puzzle-max); callback `send` prop that passes a single `{ text, model }`
  object (the parent's `@send={ sendMessage(event) }` binding only forwards the
  first arg, D16). The model sets the streaming cadence in `assistant.js` and is
  stamped onto the assistant message record.
- **TypingIndicator.pzl** — three bouncing dots (CSS keyframes).

## Pattern: subscribe children to their own records

Store records mutate **in place**, and a child's `data()` re-runs on prop
change only when props **shallow-differ** (SPEC §4). Pass a record as a prop
and update it, and the child never sees the change — the reference is equal
every render. So `MessageBubble` and `ConversationItem` re-query by id inside
`data()`:

```javascript
data(params, props) {
  // findOne subscribes THIS component to its own record key — every update()
  // to the record re-renders exactly this bubble, nothing else.
  return {
    message: this.ctx.store.findOne('message', props.message.id) ?? props.message,
  };
}
```

That record-key subscription is what makes streaming work: each token is an
`update()` on one message record, and only that bubble re-renders. **Props
carry identity; the store carries live data.**

One more shape rule worth copying: the "Stop generating" button's `{#if}` sits
inside an always-rendered wrapper `<div>` in `Thread.pzl`. Unkeyed siblings
patch by index, so letting a conditional block appear/disappear directly above
the `<Composer/>` would shift its index and remount it — wiping the draft
mid-typing.
