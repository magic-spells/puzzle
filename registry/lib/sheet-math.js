/**
 * Pure bottom-sheet helpers — no DOM access, no state, no dependencies. Shared
 * snap, velocity, resistance, and spring-unit math lives here so BottomSheet
 * and the future Sheet replacement resolve gestures identically.
 */

// Sitting exactly on a snap leaves sub-pixel noise in the measured height, so
// "strictly past" needs a little room or a flick from a snap resolves to itself.
export const SNAP_EPSILON = 1;

/** Default tuning for @magic-spells/physics-engine snap settles. */
export const SPRING_DEFAULTS = { attraction: 0.065, friction: 0.3 };

/**
 * The engine's velocity reference interval. Its velocity is expressed as units
 * per 16.66ms — a FIXED standard, not per rendered frame. The integrator scales
 * real elapsed time against this baseline, so displacement per actual frame
 * halves on a 120Hz display while the velocity number keeps its meaning; the
 * spring is refresh-rate independent. Every consumer converts its own native
 * unit into this one, which is all seedVelocity() below does.
 */
export const FRAME_MS = 16.66;

/** Taste adjustment for a finger already decelerating into release. */
export const VELOCITY_BOOST = 1.1;

/**
 * Parses snap points into a sorted list of dvh percentages.
 * @param {string|Array|null|undefined} value
 * @returns {number[]} Ascending, deduped percentages; empty when nothing parses
 */
export function parseSnapPoints(value) {
  if (!value) return [];

  const tokens = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  const seen = new Set();
  for (const token of tokens) {
    if (token === '') continue;

    const parsed = Number(token);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) continue;

    seen.add(parsed);
  }

  return [...seen].sort((a, b) => a - b);
}

/**
 * Chooses the snap a released gesture should land on. A flick steps exactly one
 * snap in its own direction; anything slower lands on whichever snap is nearest.
 * @param {Object} options
 * @param {number} options.currentPx - Panel height at release
 * @param {number} options.velocityY - Release velocity in px/ms, positive down
 * @param {number[]} options.snapsPx - Ascending snap heights in pixels
 * @param {number} options.flickVelocity - Speed that counts as a flick
 * @returns {number|null} Target height in pixels, or null to dismiss
 */
export function resolveSnapTarget({ currentPx, velocityY, snapsPx, flickVelocity }) {
  if (!snapsPx.length) return null;

  // Stepping from the current position rather than from the snap the gesture
  // started at — otherwise dragging 40 past 90 and flicking up targets 70.
  if (velocityY > flickVelocity) {
    const below = snapsPx.filter((px) => px < currentPx - SNAP_EPSILON);
    // Running out of snaps below is what dismisses the sheet.
    return below.length ? below[below.length - 1] : null;
  }

  if (velocityY < -flickVelocity) {
    const above = snapsPx.find((px) => px > currentPx + SNAP_EPSILON);
    return above ?? snapsPx[snapsPx.length - 1];
  }

  return snapsPx.reduce((best, px) =>
    Math.abs(px - currentPx) < Math.abs(best - currentPx) ? px : best
  );
}

/**
 * Maps a visible extent onto dismissal progress, which is what the scrim tracks.
 *
 * One clamp covers every case. `restExtent` is the sheet's resting extent — the
 * SHORTEST snap on a snapping sheet, the panel height on a binary one — so any
 * position at or above rest saturates at exactly 1, and only travel below it
 * maps [rest -> off screen] onto [1 -> 0]. That is what leaves snap-to-snap
 * travel and upward rubber-band overscroll alone without a single branch: a
 * resize is not a dismissal, and only the gesture past the shortest snap is.
 *
 * A degenerate rest extent returns 1, not 0. This DIVERGES from
 * sheet-engine.js's dismissalZoneProgress on purpose, and the mismatch is not a
 * bug to reconcile: the engine always holds a measured extent, while this can be
 * asked mid-gesture on a dialog that has not laid out, and blanking the scrim
 * over a plainly visible sheet is a far worse answer than leaving it alone.
 * @param {number} visibleExtent - On-screen height along the dismiss axis, in pixels
 * @param {number} restExtent - Resting height in pixels
 * @returns {number} Progress in [0, 1]; 1 means fully on screen
 */
export function dismissProgress(visibleExtent, restExtent) {
  if (!Number.isFinite(restExtent) || restExtent <= 0) return 1;
  if (!Number.isFinite(visibleExtent)) return 1;

  return Math.min(1, Math.max(0, visibleExtent / restExtent));
}

/**
 * Rolling release-velocity tracker. Velocity is px/ms, positive downward.
 *
 * REFRESH-RATE INDEPENDENT BY CONSTRUCTION, and it must stay that way. Δy and Δt
 * are both read off the SAME pointer events, so the quotient is a rate. Never
 * rewrite this to average per-event deltas: a delta is not a rate, and the same
 * finger speed produces ~5px deltas at 8.33ms (120Hz) versus ~10px at 16.66ms
 * (60Hz) — averaging them makes the reading track the display, so a flick that
 * dismisses on one screen fails the threshold on another. Measured on the two
 * streams above: 99% apart as averaged deltas, 0.33% apart as px/ms.
 */
export class VelocityTracker {
  #samples = [];
  #windowMs;

  constructor(windowMs = 100) {
    this.#windowMs = windowMs;
  }

  add(y, t) {
    this.#samples.push({ y, t });

    const cutoff = t - this.#windowMs;
    while (this.#samples.length > 2 && this.#samples[0].t < cutoff) {
      this.#samples.shift();
    }
  }

  get velocity() {
    const samples = this.#samples;
    if (samples.length < 2) return 0;

    const last = samples[samples.length - 1];

    // Walk back from the newest sample and stop at the first reversal.
    // Averaging the whole window instead would keep reporting the direction
    // a gesture came from. Zero-length steps are skipped rather than treated
    // as a turn because slow drags quantise to them constantly.
    let direction = 0;
    let start = samples.length - 1;
    while (start > 0) {
      const step = Math.sign(samples[start].y - samples[start - 1].y);
      if (step !== 0) {
        if (direction === 0) direction = step;
        else if (step !== direction) break;
      }
      start--;
    }

    const first = samples[start];
    const deltaTime = last.t - first.t;

    return deltaTime === 0 ? 0 : (last.y - first.y) / deltaTime;
  }

  reset() {
    this.#samples = [];
  }
}

/** Square-root rubber-band resistance. */
export function applyResistance(v) {
  return Math.sqrt(v) * 10 * 0.1;
}

/**
 * Adapts the tracker's native unit into the engine's: px/ms becomes px per
 * FRAME_MS. The sign flips because velocityY is positive DOWNWARD while the
 * spring drives HEIGHT, which grows upward — so a downward release must seed a
 * shrinking height. Getting the FRAME_MS factor wrong fails silently: the spring
 * still runs, just ~17x off.
 */
export function seedVelocity(velocityY) {
  return -velocityY * FRAME_MS * VELOCITY_BOOST;
}
