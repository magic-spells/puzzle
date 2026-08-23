// Pure geometry + store helpers for Puzzle Studio.
//
// NO framework imports — everything here is a plain function so it stays trivial
// to unit-test and reason about. Phase 2 (pointer drag / resize / marquee) will
// extend THIS file with hit-testing and box math; keep it dependency-free.

// The full set of persisted element fields (everything but `id`). Used to
// snapshot a live record into a plain object for duplication.
const FIELDS = [
  'type', 'name', 'frameId', 'x', 'y', 'w', 'h', 'z', 'fill', 'opacity',
  'radius', 'shadowBlur', 'shadowY', 'text', 'fontSize', 'layout', 'gap',
  'padding',
];

const TYPE_LABELS = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  text: 'Text',
  frame: 'Frame',
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

// placeChildren(frame, children) -> [{ el, x, y }]
// Positions are relative to the frame's border box.
//   free    -> each child keeps its own stored x/y
//   stack-v -> single column: x = padding, y flows down by (h + gap)
//   stack-h -> single row:    y = padding, x flows right by (w + gap)
export function placeChildren(frame, children) {
  const ordered = children.slice().sort((a, b) => a.z - b.z);
  const layout = frame.layout || 'free';

  if (layout === 'free') {
    return ordered.map((el) => ({ el, x: el.x, y: el.y }));
  }

  const pad = frame.padding || 0;
  const gap = frame.gap || 0;

  if (layout === 'stack-v') {
    let y = pad;
    return ordered.map((el) => {
      const placed = { el, x: pad, y };
      y += el.h + gap;
      return placed;
    });
  }

  if (layout === 'stack-h') {
    let x = pad;
    return ordered.map((el) => {
      const placed = { el, x, y: pad };
      x += el.w + gap;
      return placed;
    });
  }

  return ordered.map((el) => ({ el, x: el.x, y: el.y }));
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

// elementCss(el, x, y) -> full inline `style` string for the node.
export function elementCss(el, x, y) {
  const parts = [
    `left:${x}px`,
    `top:${y}px`,
    `width:${el.w}px`,
    `height:${el.h}px`,
  ];

  if (el.type === 'text') {
    parts.push(`color:${el.fill}`);
    parts.push(`font-size:${el.fontSize}px`);
    parts.push('line-height:1.3');
  } else {
    parts.push(`background:${el.fill}`);
  }

  if (el.type === 'ellipse') {
    parts.push('border-radius:50%');
  } else if (el.type === 'rect' || el.type === 'frame') {
    parts.push(`border-radius:${el.radius}px`);
  }

  parts.push(`opacity:${el.opacity / 100}`);

  if (el.shadowBlur > 0) {
    parts.push(`box-shadow:0 ${el.shadowY}px ${el.shadowBlur}px rgba(0,0,0,0.45)`);
  }

  return parts.join(';') + ';';
}

// boundsCss(bounds) -> inline `style` string for a stage-absolute box overlay.
export function boundsCss(bounds) {
  return (
    `left:${bounds.x}px;top:${bounds.y}px;` +
    `width:${bounds.w}px;height:${bounds.h}px;`
  );
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

// absolutePosition(el, elements) -> { x, y } in stage coordinates.
// Children of a stack frame use their PLACED position (layout-computed), not the
// stored x/y. Recurses through parent frames.
export function absolutePosition(el, elements) {
  if (!el.frameId) return { x: el.x, y: el.y };

  const parent = elements.find((e) => e.id === el.frameId);
  if (!parent) return { x: el.x, y: el.y };

  let localX = el.x;
  let localY = el.y;

  if (parent.layout === 'stack-v' || parent.layout === 'stack-h') {
    const siblings = elements.filter((e) => e.frameId === parent.id);
    const placed = placeChildren(parent, siblings).find((p) => p.el.id === el.id);
    if (placed) {
      localX = placed.x;
      localY = placed.y;
    }
  }

  const parentAbs = absolutePosition(parent, elements);
  return { x: parentAbs.x + localX, y: parentAbs.y + localY };
}

// selectionBounds(ids, elements) -> { x, y, w, h } stage-absolute union box.
export function selectionBounds(ids, elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  ids.forEach((id) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    const { x, y } = absolutePosition(el, elements);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + el.w);
    maxY = Math.max(maxY, y + el.h);
  });

  if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------------------------------------------------------------------------
// Hit-testing / intersection (Phase 2: drag / drop / marquee)
// ---------------------------------------------------------------------------

// cloneElement(el, overrides) -> a plain, framework-free copy of a record with
// the given field overrides applied. Used to feed EPHEMERAL geometry (a live
// resize box) through the pure layout helpers without writing to the store.
export function cloneElement(el, overrides) {
  const out = {
    id: el.id, type: el.type, name: el.name, frameId: el.frameId,
    x: el.x, y: el.y, w: el.w, h: el.h, z: el.z, fill: el.fill,
    opacity: el.opacity, radius: el.radius, shadowBlur: el.shadowBlur,
    shadowY: el.shadowY, text: el.text, fontSize: el.fontSize,
    layout: el.layout, gap: el.gap, padding: el.padding,
  };
  return Object.assign(out, overrides || {});
}

// frameAt(sx, sy, elements, excludeIds) -> the TOP-MOST top-level frame (highest
// z) whose stage-absolute box contains the point, or null. `excludeIds` (Set or
// array) skips the dragged elements so a frame never counts itself as a target.
export function frameAt(sx, sy, elements, excludeIds) {
  const excl = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const frames = elements
    .filter((e) => e.type === 'frame' && e.frameId === '' && !excl.has(e.id))
    .slice()
    .sort((a, b) => b.z - a.z);

  for (const f of frames) {
    const abs = absolutePosition(f, elements);
    if (sx >= abs.x && sx <= abs.x + f.w && sy >= abs.y && sy <= abs.y + f.h) {
      return f;
    }
  }
  return null;
}

// stackInsertionIndex(frame, siblings, sx, sy, elements) -> the 0..n index at
// which a dragged child should insert, by comparing the pointer (in frame-local
// coords) against each placed sibling's midpoint. `siblings` must already EXCLUDE
// the dragged element. stack-v compares Y; stack-h compares X.
export function stackInsertionIndex(frame, siblings, sx, sy, elements) {
  const frameAbs = absolutePosition(frame, elements);
  const localX = sx - frameAbs.x;
  const localY = sy - frameAbs.y;
  const placed = placeChildren(frame, siblings);
  const horizontal = frame.layout === 'stack-h';

  let index = 0;
  placed.forEach((p) => {
    const mid = horizontal ? p.x + p.el.w / 2 : p.y + p.el.h / 2;
    const coord = horizontal ? localX : localY;
    if (coord > mid) index += 1;
  });
  return index;
}

// pointInFrame(sx, sy, frame, elements) -> is the stage point inside the frame's
// absolute box?
export function pointInFrame(sx, sy, frame, elements) {
  const abs = absolutePosition(frame, elements);
  return sx >= abs.x && sx <= abs.x + frame.w && sy >= abs.y && sy <= abs.y + frame.h;
}

// boxesIntersect(a, b) -> AABB overlap test for two {x,y,w,h} boxes.
export function boxesIntersect(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// ---------------------------------------------------------------------------
// Naming / ids
// ---------------------------------------------------------------------------

// nextName(elements, type) -> "Rectangle 3", "Ellipse 1", ...
export function nextName(elements, type) {
  const label = TYPE_LABELS[type] || 'Element';
  const count = elements.filter((e) => e.type === type).length;
  return `${label} ${count + 1}`;
}

// newId() -> short random element id.
export function newId() {
  return 'el-' + Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Store mutations
// ---------------------------------------------------------------------------

function snapshot(el) {
  const out = {};
  FIELDS.forEach((key) => {
    out[key] = el[key];
  });
  return out;
}

// deleteElements(store, ids) -> destroys records; a deleted frame also destroys
// its children.
export function deleteElements(store, ids) {
  const all = store.findMany('element');

  ids.forEach((id) => {
    const el = store.findOne('element', id);
    if (!el) return;

    if (el.type === 'frame') {
      all
        .filter((e) => e.frameId === id)
        .forEach((child) => {
          const rec = store.findOne('element', child.id);
          if (rec) rec.destroy();
        });
    }

    const rec = store.findOne('element', id);
    if (rec) rec.destroy();
  });
}

// duplicateElements(store, ids) -> duplicates the given top-level/element ids
// (new ids, name + ' copy', +16 offset for top-level/free); a frame duplicates
// its children into the new frame. Returns the new top-level ids.
export function duplicateElements(store, ids) {
  const all = store.findMany('element');
  const newIds = [];
  // A selected frame duplicates its children itself — don't ALSO duplicate a
  // child that happens to be in the selection alongside its frame.
  const idSet = new Set(ids);

  ids.forEach((id) => {
    const original = store.findOne('element', id);
    if (original && original.frameId && idSet.has(original.frameId)) return;
    const el = store.findOne('element', id);
    if (!el) return;

    const nid = newId();
    const data = snapshot(el);
    data.id = nid;
    data.name = `${el.name} copy`;

    // Only top-level (or otherwise free-positioned) elements get the visual
    // nudge — stack children are layout-placed, so an offset would be ignored.
    if (el.frameId === '') {
      data.x = el.x + 16;
      data.y = el.y + 16;
    }

    store.createRecord('element', data);
    newIds.push(nid);

    if (el.type === 'frame') {
      all
        .filter((e) => e.frameId === id)
        .forEach((child) => {
          const childData = snapshot(child);
          childData.id = newId();
          childData.name = `${child.name} copy`;
          childData.frameId = nid;
          store.createRecord('element', childData);
        });
    }
  });

  return newIds;
}

// reorder(store, el, direction) -> bring forward (+1) / send backward (-1) among
// siblings sharing the same frameId. Swaps z with the neighbor and normalizes
// the whole sibling group to 0..n-1.
export function reorder(store, el, direction) {
  const all = store.findMany('element');
  const siblings = all
    .filter((e) => e.frameId === el.frameId)
    .slice()
    .sort((a, b) => a.z - b.z);

  const idx = siblings.findIndex((e) => e.id === el.id);
  if (idx === -1) return;

  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= siblings.length) {
    // Nothing to swap with — still normalize for tidiness.
    siblings.forEach((s, i) => {
      const rec = store.findOne('element', s.id);
      if (rec && rec.z !== i) rec.update({ z: i });
    });
    return;
  }

  const tmp = siblings[idx];
  siblings[idx] = siblings[swapIdx];
  siblings[swapIdx] = tmp;

  siblings.forEach((s, i) => {
    const rec = store.findOne('element', s.id);
    if (rec && rec.z !== i) rec.update({ z: i });
  });
}
