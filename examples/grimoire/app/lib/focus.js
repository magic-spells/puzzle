// A tiny module-level focus router. Structural edits (split / merge / add) and
// boundary arrow keys all need the caret to land in a DIFFERENT block than the
// one that handled the key — often a block that is about to mount, or one that
// won't re-render at all. Because block components mount asynchronously (a
// child mount is a microtask after the parent's patch), the target's island DOM
// may not exist yet when the edit is issued. So we park ONE pending request and
// resolve it two ways:
//
//   - consumePendingFocus(id): the fast path. A Block calls it in mounted() and
//     afterUpdate() with its own id; if the pending request is for that block it
//     sets the caret on its own island there and then.
//   - flushFocus(): the fallback sweep. Doc calls it after issuing an edit and
//     in afterUpdate(); it finds the target island by querying the DOM and
//     retries across a few animation frames (covering both freshly-mounted
//     blocks and navigation targets that never re-render), then gives up.

import { setCaret } from './caret.js';

// At most one request is ever pending — the last edit wins.
let pending = null;

/** Park a caret request: focus `blockId`'s island at `offset` (-1 = end). */
export function requestFocus(blockId, offset = -1) {
  pending = { blockId, offset };
}

/**
 * Fast path for a re-rendering Block: if the pending request targets `blockId`,
 * clear it and return the offset so the caller can place the caret on its own
 * island element. Returns null when nothing is pending for this block.
 */
export function consumePendingFocus(blockId) {
  if (pending && pending.blockId === blockId) {
    const { offset } = pending;
    pending = null;
    return offset;
  }
  return null;
}

/**
 * Fallback sweep: resolve the pending request by finding its island in the DOM.
 * A newly created block's DOM lands a frame or two late (async child mounts), so
 * we retry across `retries` animation frames before giving up silently. A no-op
 * when nothing is pending or the fast path already consumed it.
 */
export function flushFocus(retries = 6) {
  if (!pending) return;
  const { blockId, offset } = pending;
  const el = document.querySelector(
    '[data-block-id="' + blockId + '"] [data-block-text]'
  );
  if (el) {
    pending = null;
    setCaret(el, offset);
    return;
  }
  if (retries > 0) {
    requestAnimationFrame(() => flushFocus(retries - 1));
  } else {
    pending = null; // target never appeared — abandon quietly
  }
}
