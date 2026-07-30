/**
 * One rule for "does the content scroll, or does the sheet move?" on the touch
 * path.
 *
 * The rule is stated in FINGER space, which is what makes it
 * position-independent. A finger moving in some direction drags the content the
 * opposite way, so the content consumes the gesture while it can still scroll
 * opposite-of-finger on the sheet's dismiss axis; the sheet claims the moment
 * that room runs out:
 *
 *   fingerDelta < 0 (up, or left)  → the scroll position must be able to GROW
 *   fingerDelta > 0 (down, or right) → the scroll position must be able to SHRINK
 *
 * Nothing here knows which edge the sheet sits on. Touch deltas are already
 * finger motion. Writing the rule per profile instead is how the left and right
 * branches ended up mirrored into each other and stayed that way.
 *
 * Metrics are plain snapshots rather than live elements so the policy stays
 * DOM-free and node-testable.
 */

// A box with nothing to scroll rarely measures exactly flush — a fractional
// device pixel ratio alone puts scrollHeight a hair above clientHeight — so the
// far edge needs a pixel of slack or the sheet never claims there. The near
// edge is a hard zero and needs none.
const SCROLL_EDGE_TOLERANCE = 1;

/**
 * Recovers finger motion from an away-signed drag direction.
 *
 * The inverse of sheet-engine's awayOffset on the dismiss axis, and the only
 * place the two spaces meet on the touch path. A left sheet is the one profile
 * dismissed toward SMALLER coordinates, so its away sign is the finger's
 * inverted; bottom and right already agree with their axis. Getting exactly
 * this backwards for one profile is the bug the shared policy exists to end, so
 * it is a named, tested function rather than a ternary at the call site.
 * @param {'bottom'|'left'|'right'} position - Sheet edge.
 * @param {number} awayDirection - Signed motion toward dismissal.
 * @returns {number} The same motion in finger space on the dismiss axis.
 */
function fingerFromAway(position, awayDirection) {
  return position === 'left' ? -awayDirection : awayDirection;
}

/**
 * Normalizes a horizontal scroll offset into the monotonic 0..max range
 * canScrollFurther assumes. Modern RTL scrollers report 0 at their start
 * (right) edge and negative values leftward; shifting by the scrollable
 * extent restores [0, max] while preserving the physical relationship —
 * scrolling content left still grows the value.
 * @param {number} scrollLeft - Raw scrollLeft as the browser reported it.
 * @param {number} scrollWidth - Total scrollable width.
 * @param {number} clientWidth - Visible width.
 * @param {boolean} rtl - True when the scroller's computed direction is rtl.
 * @returns {number} Offset in [0, scrollWidth - clientWidth].
 */
function normalizeScrollLeft(scrollLeft, scrollWidth, clientWidth, rtl) {
  if (!rtl) return scrollLeft;
  return scrollLeft + Math.max(0, scrollWidth - clientWidth);
}

/**
 * Whether one scrollable still has somewhere to go in a scroll direction.
 * @param {Object} metrics - Snapshot of one element's scroll geometry.
 * @param {number} metrics.scrollTop - Current vertical scroll offset.
 * @param {number} metrics.scrollLeft - Current horizontal scroll offset.
 * @param {number} metrics.scrollHeight - Total scrollable height.
 * @param {number} metrics.scrollWidth - Total scrollable width.
 * @param {number} metrics.clientHeight - Visible height.
 * @param {number} metrics.clientWidth - Visible width.
 * @param {'x'|'y'} axis - Dismiss axis to test.
 * @param {number} scrollSign - Positive asks whether the scroll position can
 *   still increase, negative whether it can still decrease.
 * @returns {boolean} True while that direction has room left.
 */
function canScrollFurther(metrics, axis, scrollSign) {
  if (!metrics || !scrollSign) return false;
  const horizontal = axis === 'x';
  const position = (horizontal ? metrics.scrollLeft : metrics.scrollTop) || 0;
  if (scrollSign < 0) return position > 0;
  const visible = (horizontal ? metrics.clientWidth : metrics.clientHeight) || 0;
  const extent = (horizontal ? metrics.scrollWidth : metrics.scrollHeight) || 0;
  return position + visible < extent - SCROLL_EDGE_TOLERANCE;
}

/**
 * Whether the scrollable chain under the pointer should keep a gesture instead
 * of handing it to the sheet.
 *
 * Any single member with room left answers for the whole chain, so a nested
 * horizontal carousel inside the content scrolls on its own until it reaches
 * its edge.
 * @param {Object[]} chain - Scroll metrics, innermost first, ending with the
 *   sheet content itself.
 * @param {'x'|'y'} axis - Dismiss axis to test.
 * @param {number} fingerDelta - Finger motion on that axis; negative is up or
 *   left. Zero never consumes.
 * @returns {boolean} True while the content still has scroll to give.
 */
function scrollChainConsumes(chain, axis, fingerDelta) {
  if (!fingerDelta || !chain) return false;
  const scrollSign = fingerDelta < 0 ? 1 : -1;
  for (const metrics of chain) {
    if (canScrollFurther(metrics, axis, scrollSign)) return true;
  }
  return false;
}

// Movement, in pixels on the dismiss axis, below which an unclaimed content
// gesture stays unclaimed. Mirrors DragGesture's tap slop: the first pixel or
// two of finger settle is jitter, not intent, and claiming on it steals the
// scroll gesture that follows.
const CLAIM_SLOP = 5;

/**
 * Resolves whether an unclaimed content gesture may claim on this move.
 *
 * Stateless per move, so it is always the LIVE offset that answers — a gesture
 * that reverses while unclaimed asks the new direction's question, never a
 * latched first sample's.
 * @param {Object[]} chain - Scroll metrics, innermost first.
 * @param {'x'|'y'} axis - Dismiss axis.
 * @param {'bottom'|'left'|'right'|'center'} position - Sheet edge.
 * @param {number} awayOffset - Live away-signed offset on the dismiss axis.
 * @param {number} [slop=CLAIM_SLOP] - Minimum offset magnitude to claim.
 * @returns {number} Away-signed claim direction, or 0 to keep waiting.
 */
function contentClaimDirection(chain, axis, position, awayOffset, slop = CLAIM_SLOP) {
  if (Math.abs(awayOffset) <= slop) return 0;
  const direction = Math.sign(awayOffset);
  const fingerDelta = fingerFromAway(position, direction);
  return scrollChainConsumes(chain, axis, fingerDelta) ? 0 : direction;
}

export {
  canScrollFurther,
  contentClaimDirection,
  fingerFromAway,
  normalizeScrollLeft,
  scrollChainConsumes,
  CLAIM_SLOP,
  SCROLL_EDGE_TOLERANCE,
};

const SIMPLE_LENGTH = /^(-?\d*\.?\d+)(px|vh|dvh|svh|lvh|vw|rem|%)?$/i;

// Sitting exactly on a snap leaves sub-pixel noise in the measured size, so
// "strictly past" needs a little room or a flick from a snap resolves to itself.
const SNAP_EPSILON = 1;

/**
 * Resolves a space-separated snap-point list into ascending pixel values.
 * A custom measure callback lets the component delegate arbitrary CSS lengths
 * such as calc() to the browser while tests can stay DOM-free.
 *
 * @param {string} value - Space-separated CSS lengths.
 * @param {Object} metrics - Viewport and font metrics.
 * @param {number} metrics.viewportHeight - Viewport height in pixels.
 * @param {number} [metrics.viewportWidth] - Viewport width in pixels.
 * @param {number} [metrics.rootFontSize=16] - Root font size in pixels.
 * @param {number} [metrics.percentageBase] - Base used for percentages.
 * @param {Function} [metrics.measure] - Browser measurement callback.
 * @returns {number[]} Sorted unique positive pixel values.
 */
function resolveSnapPoints(
  value,
  {
    viewportHeight,
    viewportWidth = viewportHeight,
    rootFontSize = 16,
    percentageBase = viewportHeight,
    measure,
  }
) {
  const tokens = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pixels = tokens
    .map((token) => {
      if (measure) return measure(token);
      const match = token.match(SIMPLE_LENGTH);
      if (!match) return NaN;
      const number = Number(match[1]);
      const unit = (match[2] || 'px').toLowerCase();
      if (unit === 'px') return number;
      if (unit === 'vw') return (number / 100) * viewportWidth;
      if (unit === 'rem') return number * rootFontSize;
      if (unit === '%') return (number / 100) * percentageBase;
      return (number / 100) * viewportHeight;
    })
    .filter((number) => Number.isFinite(number) && number > 0)
    .map((number) => Math.round(number * 100) / 100)
    .sort((a, b) => a - b);

  return [...new Set(pixels)];
}

/**
 * Resolves an initial snap index, defaulting to the largest snap.
 * @param {string|number|null} value - Requested index.
 * @param {number[]} snaps - Resolved snap points.
 * @returns {number} A valid index, or -1 for an empty list.
 */
function resolveInitialSnap(value, snaps) {
  if (!snaps.length) return -1;
  if (value === null || value === undefined || value === '') return snaps.length - 1;
  const index = Number.parseInt(value, 10);
  if (!Number.isFinite(index)) return snaps.length - 1;
  return Math.min(snaps.length - 1, Math.max(0, index));
}

/**
 * Chooses the snap index a released gesture should land on. A flick steps
 * exactly one snap in its own direction; anything slower lands on the nearest
 * snap, with the closed edge participating as a dismissal target.
 * @param {Object} options - Release geometry.
 * @param {number} options.currentSize - Visible panel size at release, in pixels.
 * @param {number} options.velocityAway - Release velocity in px/ms, positive toward dismissal.
 * @param {number[]} options.snaps - Ascending snap sizes in pixels.
 * @param {number} options.flickVelocity - Speed that counts as a flick.
 * @returns {number|null} Target snap index, or null to dismiss.
 */
function resolveSnapTarget({ currentSize, velocityAway, snaps, flickVelocity }) {
  if (!snaps.length) return null;

  // Inward overscroll is a visual affordance, not a position in the snap range:
  // the component rubber-bands an overpull to `maximum + 2*sqrt(overpull)`,
  // which clears SNAP_EPSILON as soon as the overpull passes a quarter of a
  // pixel. Stepping from that unclamped size made a downward flick from
  // the top resolve to the top — the snap it was already on — so the flick did
  // nothing. Clamping first is what keeps "one snap in the flick's direction"
  // true from anywhere the panel can actually be dragged to.
  currentSize = Math.min(currentSize, snaps[snaps.length - 1]);

  // Step from the live position rather than the snap where the gesture began.
  // Otherwise dragging from 20vh past 88vh and flicking up targets 55vh.
  if (velocityAway > flickVelocity) {
    let below = null;
    for (let index = 0; index < snaps.length; index++) {
      if (snaps[index] >= currentSize - SNAP_EPSILON) break;
      below = index;
    }
    // Running out of snaps below is what dismisses the sheet.
    return below;
  }

  if (velocityAway < -flickVelocity) {
    const above = snaps.findIndex((size) => size > currentSize + SNAP_EPSILON);
    return above === -1 ? snaps.length - 1 : above;
  }

  let nearest = null;
  let nearestDistance = Math.abs(currentSize);
  for (let index = 0; index < snaps.length; index++) {
    const distance = Math.abs(snaps[index] - currentSize);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export { resolveInitialSnap, resolveSnapPoints, resolveSnapTarget, SNAP_EPSILON };
