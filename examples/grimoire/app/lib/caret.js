// Selection / Range helpers for a contenteditable element treated as PLAIN
// TEXT. Every block's [data-block-text] is a DOM island (D44): the browser owns
// its subtree, so the editor works in terms of a flat text offset rather than
// the framework's vnode tree. These functions translate between "caret position
// as a character offset" and the live Selection API, walking whatever text
// nodes the browser has left behind (typing, paste, and merges can leave one,
// many, or none).

/** The element's text as the user sees it — all text nodes concatenated. */
export function textOf(el) {
  return el ? el.textContent : '';
}

/**
 * The caret's start offset as a plain-text index into `el`. Works across
 * multiple text nodes: we measure the length of a range spanning from the start
 * of `el` up to the caret. Returns 0 when there is no selection or the caret is
 * outside `el`.
 */
export function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Place the caret at `offset` characters into `el`. The offset is clamped to
 * the text length; `-1` (the default) means "end". Focuses `el` first so the
 * selection actually lands. Handles the empty-element case (no text node) and
 * walks text nodes to resolve the global offset to a (node, localOffset) pair.
 */
export function setCaret(el, offset = -1) {
  if (!el) return;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;

  const total = textOf(el).length;
  const pos = offset < 0 ? total : Math.min(Math.max(offset, 0), total);

  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  if (!node) {
    // Empty island — no text node to point into; collapse inside the element.
    range.selectNodeContents(el);
    range.collapse(true);
  } else {
    let remaining = pos;
    let target = node;
    let targetOffset = node.nodeValue.length;
    while (node) {
      const len = node.nodeValue.length;
      if (remaining <= len) {
        target = node;
        targetOffset = remaining;
        break;
      }
      remaining -= len;
      const next = walker.nextNode();
      if (!next) {
        // Ran past the end (clamped offset shouldn't, but be safe): land at the
        // tail of the last text node.
        target = node;
        targetOffset = len;
        break;
      }
      node = next;
    }
    range.setStart(target, targetOffset);
    range.collapse(true);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

/** Caret sits at the very start of `el` with nothing selected. */
export function atStart(el) {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed) return false;
  return caretOffset(el) === 0;
}

/** Caret sits at the very end of `el` with nothing selected. */
export function atEnd(el) {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed) return false;
  return caretOffset(el) === textOf(el).length;
}

/**
 * Insert plain `text` at the caret inside the active contenteditable. Prefers
 * execCommand('insertText'): it inserts at the caret AND fires an `input`
 * event, so an island's @input store-sync runs for free — returns `true` to
 * signal the caller need not sync. When execCommand is unavailable it splices a
 * text node in manually and returns `false`, telling the caller to sync the
 * store itself (no input event fires on the manual path).
 */
export function insertText(text) {
  if (typeof document.execCommand === 'function') {
    try {
      if (document.execCommand('insertText', false, text)) return true;
    } catch {
      // fall through to manual insertion
    }
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return false;
}
