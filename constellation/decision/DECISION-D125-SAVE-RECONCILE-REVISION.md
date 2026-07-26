---
name: >-
  D125 — a save response never overwrites a field edited while its request was in flight
  (per-field mutation revisions)
status: built
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D21-ADAPTER-READ-PATH
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC-DATA
  - FILE-STORE
  - FILE-PUZZLE-MODEL
---

# D125 — a save response never overwrites a field edited while its request was in flight

Amends the [[DECISION-D50-ADAPTER-WRITE-SYNC]] reconciliation contract (SPEC §22).
A 2xx JSON-object response still merges via the exempt upsert path, but the merge is
now **per-field conditional**: a field whose local value changed after the request was
dispatched keeps the local value. Every other field — including server-computed ones
the client never touched — merges exactly as before.

## The behavior this replaces

The request body was serialized before the `await`, and the only post-await guard was
identity-only (`map.get(requestKey) !== record`). Nothing compared field values, so the
echo of the request's own body overwrote anything the user typed during the round trip:

```
before response : B          (user kept typing)
body sent       : {"text":"A"}
after response  : A          <-- the edit is gone
_synced         : true       <-- and the record is marked clean
```

**This did not require the save queue.** One `save()` plus one keystroke during the
round trip lost the keystroke. The per-record chain escalated local loss into
*persisted* loss, because a queued save's `record.toJSON()` runs after the previous
response has already mutated the record — so the stale value was sent back to the
server as the user's next write.

The exposed shapes were the ordinary ones: debounced autosave on a text input
(notes app, comment box, inline title edit), and optimistic toggles that save per
click (star, complete, quantity steppers) where two clicks inside one round trip
left the second undone and unpersisted. The only escape was an API returning
204/empty on write, which skips the merge — at the cost of server-computed fields.

## Why this is an amendment and not a new feature

SPEC §22 lists **conflict resolution** among the still-deferred items, which reads at
first glance like a sanction for the old behavior. It is not. That entry sits beside
*offline queueing* and *automatic write-through* — the company it keeps makes it
multi-client, server-side conflict: two actors disagreeing about one record. What this
card fixes is a single tab erasing its **own** uncommitted keystrokes with the echo of
its **own** earlier request. No second actor is involved, and no policy question is
being answered.

§22 has already taken one amendment — §35 added two in-flight reconciliation guards
(destroy-wins, and first-save pk-collision refusal) — so in-flight reconciliation is an
established, amendable surface rather than a frozen one. Both of those guards remain
untouched; this adds a third that operates on field values rather than identity.

## Mechanism

Per-field mutation revisions live in a module-private `WeakMap` in `model.js`, keyed by
record. They are deliberately **not** part of the record shape: nothing is added to
`toJSON()`, storage blobs, or the record's own enumerable keys, and the state is
released with the record.

- `safeAssign` (the path every `update()` takes) advances one revision per call and
  stamps every field in that patch.
- `_saveRecordNow` captures `recordMutationRevision(record)` beside the serialized body,
  so the revision and the bytes on the wire are taken at the same instant.
- `safeMerge(record, src, throughRevision)` skips any field whose stamped revision is
  greater than `throughRevision`. The third argument is optional — every other merge
  site (`loadAll`/`loadOne` upserts, storage hydration) omits it and stays
  server-authoritative, byte-for-byte as before.

All four response branches reconcile through it: the normal merge, the
mismatched-pk and null-pk `rest` branches, and pk adoption. Pk adoption forces the
server-assigned primary key through **unconditionally** — that is the one sanctioned
identity change (§22) and it is not a user-editable field — then reconciles every other
field against the captured revision.

The queued save needs no ordering change. It re-serializes after the previous response
settles, and because reconciliation no longer clobbers the local edit, the value it
reads is already the newer one.

## `_synced` still flips to true on divergence

Rejected: clearing `_synced` when a field was preserved, to give the app a retry signal.

`_synced` is a **provenance** bit, not a clean/dirty bit — it selects POST versus PUT.
The request genuinely succeeded and the record genuinely now has server provenance.
Clearing it would make a queued follow-up save **POST a duplicate record** instead of
PUT-ing the update, trading silent data loss for silent data duplication.

The consequence is accepted deliberately: after a divergent reconcile the record holds
a local edit that is not yet persisted and carries no dirty marker. That matches D50's
local-first posture, where saving is always an explicit verb — the app decides when to
call `save()` again. A dirty-field API is a separate, larger design question and is not
answered here.

## Alternative rejected

Snapshotting the dispatched body and applying response fields only where the local
value still equals what was sent. It needs no new record state, but it is weaker for
nested or mutable object fields, where equality is unreliable and in-place mutation is
invisible. Revisions record *that* a field changed rather than inferring it from a
value comparison.

## Notes

- The D95 mock adapter's default `PUT endpoint/:id` does "merge (200)", i.e. the
  merging path, and its latency is ~0 — which is precisely why this bug survived a
  fully green suite for so long. Mock-backed tests could not open the window.
- The D91 `beforeRequest` hook could never have been a workaround: `method` and `body`
  are re-stamped from the original init after the hook runs, specifically so §22's
  identity checks stay valid.
