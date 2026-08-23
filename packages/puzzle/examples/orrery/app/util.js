// Small shared helpers used by the view, the canvas, and the reset flow.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// h: 0–360, s/l: 0–100 → '#rrggbb'. Used so spawned planets get a proper hex
// color the <input type="color"> in the panel can display and edit.
export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function randomPlanetColor() {
  return hslToHex(Math.floor(Math.random() * 360), 70, 62);
}

// A speed in deg/sec, occasionally retrograde (negative).
export function randomSpeed() {
  const magnitude = 8 + Math.random() * 37; // 8–45
  return (Math.random() < 0.2 ? -1 : 1) * magnitude;
}

export function randomSize() {
  return 3 + Math.random() * 6; // 3–9
}

// Next unused "Planet N" name. Scans existing names so it survives deletes
// without colliding. Called from event handlers (not a tracking scope), so the
// findMany here does not add a subscription.
export function nextPlanetName(store) {
  const bodies = store.findMany('body');
  let max = bodies.length;
  for (const b of bodies) {
    const m = /^Planet (\d+)$/.exec(b.name || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Planet ${max + 1}`;
}
