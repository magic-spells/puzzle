/**
 * Pure chart helpers — no DOM access, no dependencies. Everything here is plain
 * arithmetic and SVG-path string building so the chart pieces (Sparkline,
 * StatCard, and the larger line/bar/donut pieces) can compute their geometry
 * inside a view's `data()` and hand finished path strings straight to the
 * template.
 *
 * Coordinate convention: callers work in SVG user space where y grows DOWNWARD.
 * The scale helpers don't know about that — you pick the range endpoints, so an
 * inverted y-axis is just `linearScale(dataMin, dataMax, chartHeight, 0)`.
 *
 * Numbers baked into path strings are rounded to 3 decimals to keep the output
 * compact and diff-stable; the rounding is cosmetic and sub-pixel.
 *
 * @typedef {[number, number]} Point  An [x, y] pair in SVG user space.
 */

/** Round to 3 decimals and stringify, dropping a trailing ".0". @param {number} v */
function fmt(v) {
	const r = Math.round(v * 1000) / 1000;
	return String(r);
}

/** Drop trailing zeros (and a bare trailing dot) from a fixed-decimal string. */
function stripZeros(s) {
	return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
}

/**
 * Min and max of a numeric series, skipping null / undefined / NaN entries.
 * Returns `[0, 1]` when nothing usable is present so downstream scales never
 * divide by an empty range.
 * @param {Array<number | null | undefined>} values
 * @returns {[number, number]} `[min, max]`
 */
export function extent(values) {
	let min = Infinity;
	let max = -Infinity;
	if (Array.isArray(values)) {
		for (const v of values) {
			if (v == null || typeof v !== 'number' || Number.isNaN(v)) continue;
			if (v < min) min = v;
			if (v > max) max = v;
		}
	}
	if (min === Infinity || max === -Infinity) return [0, 1];
	return [min, max];
}

/**
 * Heckbert "nice number" — the closest 1/2/5×10ⁿ value to `range`. With
 * `round`, snaps to the nearest nice number; otherwise rounds up so the result
 * is always ≥ `range`.
 * @param {number} range
 * @param {boolean} round
 * @returns {number}
 */
function niceNum(range, round) {
	const exp = Math.floor(Math.log10(range));
	const frac = range / Math.pow(10, exp);
	let niceFrac;
	if (round) {
		if (frac < 1.5) niceFrac = 1;
		else if (frac < 3) niceFrac = 2;
		else if (frac < 7) niceFrac = 5;
		else niceFrac = 10;
	} else {
		if (frac <= 1) niceFrac = 1;
		else if (frac <= 2) niceFrac = 2;
		else if (frac <= 5) niceFrac = 5;
		else niceFrac = 10;
	}
	return niceFrac * Math.pow(10, exp);
}

/**
 * Snaps a raw `[min, max]` data range to a rounded axis domain with evenly
 * spaced "nice" ticks (steps of 1/2/5×10ⁿ). Aims for roughly `count` ticks.
 *
 * A single-sign magnitude range is baselined at zero — all-positive data pins
 * `min` to 0, all-negative data pins `max` to 0 — so bar and area charts sit on
 * a real baseline. A zero-width range (all values equal, or empty) is expanded
 * so the axis still spans a usable interval.
 * @param {number} min
 * @param {number} max
 * @param {number} [count] desired tick count (default 5)
 * @returns {{ min: number, max: number, ticks: number[] }}
 */
export function niceDomain(min, max, count = 5) {
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		min = 0;
		max = 1;
	}
	if (min > max) {
		const t = min;
		min = max;
		max = t;
	}
	// Baseline single-sign magnitude data at zero.
	if (min > 0) min = 0;
	else if (max < 0) max = 0;
	// Degenerate zero-width range (only reachable at 0 after the baseline step).
	if (min === max) max = min + 1;

	const step = niceNum(niceNum(max - min, false) / Math.max(1, count - 1), true);
	const niceMin = Math.floor(min / step) * step;
	const niceMax = Math.ceil(max / step) * step;
	// Decimal places implied by the step, so ticks read cleanly (no 0.30000004).
	const decimals = Math.max(0, -Math.floor(Math.log10(step)));
	const round = (v) => {
		const p = Math.pow(10, decimals);
		return Math.round(v * p) / p;
	};

	const ticks = [];
	for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(round(v));
	return { min: niceMin, max: niceMax, ticks };
}

/**
 * Builds a linear mapping from data range `[d0, d1]` onto output range
 * `[r0, r1]`. The returned function does NOT clamp — values outside `[d0, d1]`
 * extrapolate past the range ends. A zero-width domain maps everything to the
 * range midpoint.
 * @param {number} d0
 * @param {number} d1
 * @param {number} r0
 * @param {number} r1
 * @returns {(v: number) => number}
 */
export function linearScale(d0, d1, r0, r1) {
	const span = d1 - d0;
	if (span === 0) {
		const mid = (r0 + r1) / 2;
		return () => mid;
	}
	const m = (r1 - r0) / span;
	return (v) => r0 + (v - d0) * m;
}

/**
 * A d3-style band scale for categorical axes (bars, grouped columns). Splits
 * `[r0, r1]` into `count` equal bands separated by `paddingInner` (fraction of
 * each step) and framed by `paddingOuter` on both ends; bands are centred within
 * the range (align 0.5).
 * @param {number} count number of bands
 * @param {number} r0 range start
 * @param {number} r1 range end
 * @param {number} [paddingInner] gap between bands, 0–1 (default 0.2)
 * @param {number} [paddingOuter] outer margin, 0–1 (default 0.1)
 * @returns {{ bandwidth: number, position: (i: number) => number }}
 *   `bandwidth` is each band's width; `position(i)` is the LEFT edge of band `i`.
 */
export function bandScale(count, r0, r1, paddingInner = 0.2, paddingOuter = 0.1) {
	const n = Math.max(0, count);
	const width = r1 - r0;
	const step = width / Math.max(1, n - paddingInner + paddingOuter * 2);
	const bandwidth = step * (1 - paddingInner);
	const start = r0 + (width - step * (n - paddingInner)) * 0.5;
	return {
		bandwidth,
		position(i) {
			return start + step * i;
		},
	};
}

/**
 * SVG path (`M…L…`) through a list of points. A `null` entry (or a point with a
 * non-finite coordinate) is a gap: the path lifts the pen and starts a fresh
 * `M` subpath at the next real point, so missing data leaves a break rather than
 * a straight jump across it.
 *
 * A run of exactly ONE point (a single-value series, or a value marooned between
 * two gaps) closes with a zero-length `L` back to itself. A bare `M` paints
 * nothing at all, so without that the point is simply invisible; the degenerate
 * segment renders as a dot — which requires the consuming `<path>` to carry
 * `stroke-linecap="round"` (a butt cap still paints nothing). Multi-point runs
 * are emitted exactly as before.
 * @param {Array<Point | null>} pts
 * @returns {string} the path `d` string ("" for no drawable points)
 */
export function linePath(pts) {
	if (!Array.isArray(pts)) return '';
	let d = '';
	let run = 0;
	let lastX = 0;
	let lastY = 0;
	const closeRun = () => {
		if (run === 1) d += `L${fmt(lastX)} ${fmt(lastY)}`;
	};
	for (const p of pts) {
		if (p == null || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
			closeRun();
			run = 0;
			continue;
		}
		d += `${run > 0 ? 'L' : 'M'}${fmt(p[0])} ${fmt(p[1])}`;
		lastX = p[0];
		lastY = p[1];
		run += 1;
	}
	closeRun();
	return d;
}

/**
 * Like {@link linePath} but each contiguous run of points is closed down to the
 * horizontal baseline `y0`, producing a fillable area. Gaps split the series
 * into separate closed regions so a fill never bridges missing data.
 * @param {Array<Point | null>} pts
 * @param {number} y0 baseline y coordinate (in SVG user space)
 * @returns {string}
 */
export function areaPath(pts, y0) {
	if (!Array.isArray(pts)) return '';
	let d = '';
	let seg = [];
	const flush = () => {
		if (seg.length === 0) return;
		d += `M${fmt(seg[0][0])} ${fmt(seg[0][1])}`;
		for (let i = 1; i < seg.length; i += 1) d += `L${fmt(seg[i][0])} ${fmt(seg[i][1])}`;
		d += `L${fmt(seg[seg.length - 1][0])} ${fmt(y0)}`;
		d += `L${fmt(seg[0][0])} ${fmt(y0)}Z`;
		seg = [];
	};
	for (const p of pts) {
		if (p == null || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
			flush();
			continue;
		}
		seg.push(p);
	}
	flush();
	return d;
}

/**
 * Point on a circle centred at `(cx, cy)`, using the chart angle convention:
 * angles in RADIANS, 0 at 12 o'clock, increasing CLOCKWISE.
 * @returns {Point}
 */
function arcPoint(cx, cy, r, angle) {
	return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

/**
 * Donut / pie segment path. Angles are in RADIANS with 0 at 12 o'clock and
 * increasing clockwise. Pass `rInner = 0` for a solid wedge to the centre;
 * a positive `rInner` cuts the donut hole. Arcs wider than a half-circle set the
 * SVG large-arc flag automatically.
 *
 * A full 360° segment cannot be expressed as a single SVG arc (start and end
 * coincide) — split it into two segments, or draw a plain `<circle>` for a lone
 * 100% slice.
 * @param {number} cx centre x
 * @param {number} cy centre y
 * @param {number} rOuter outer radius
 * @param {number} rInner inner radius (0 = wedge to centre)
 * @param {number} a0 start angle (radians)
 * @param {number} a1 end angle (radians)
 * @returns {string}
 */
export function arcPath(cx, cy, rOuter, rInner, a0, a1) {
	const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
	const sweep = a1 >= a0 ? 1 : 0;
	const [ox0, oy0] = arcPoint(cx, cy, rOuter, a0);
	const [ox1, oy1] = arcPoint(cx, cy, rOuter, a1);

	if (!rInner || rInner <= 0) {
		return (
			`M${fmt(cx)} ${fmt(cy)}` +
			`L${fmt(ox0)} ${fmt(oy0)}` +
			`A${fmt(rOuter)} ${fmt(rOuter)} 0 ${large} ${sweep} ${fmt(ox1)} ${fmt(oy1)}Z`
		);
	}

	const [ix1, iy1] = arcPoint(cx, cy, rInner, a1);
	const [ix0, iy0] = arcPoint(cx, cy, rInner, a0);
	const innerSweep = sweep ? 0 : 1;
	return (
		`M${fmt(ox0)} ${fmt(oy0)}` +
		`A${fmt(rOuter)} ${fmt(rOuter)} 0 ${large} ${sweep} ${fmt(ox1)} ${fmt(oy1)}` +
		`L${fmt(ix1)} ${fmt(iy1)}` +
		`A${fmt(rInner)} ${fmt(rInner)} 0 ${large} ${innerSweep} ${fmt(ix0)} ${fmt(iy0)}Z`
	);
}

/**
 * Cumulative stack bounds for a set of series. For each row (an object) the
 * `keys` are stacked in order: the first key sits on 0, each subsequent key
 * starts where the previous ended. Cells are coerced with `Number()` first —
 * the chart pieces normalize the same way, so a numeric STRING (`'30'`, a very
 * common shape for JSON/CSV-sourced rows) stacks exactly like the number it
 * spells. Missing / non-numeric / non-finite cells count as 0.
 * @param {Array<Record<string, number>>} rows
 * @param {string[]} keys series keys, drawn bottom → top in this order
 * @returns {Record<string, Array<[number, number]>>} per-key `[y0, y1]` pairs,
 *   one entry per row, aligned to `rows`.
 */
export function stackSeries(rows, keys) {
	const out = {};
	const keyList = Array.isArray(keys) ? keys : [];
	for (const key of keyList) out[key] = [];
	const list = Array.isArray(rows) ? rows : [];
	for (const row of list) {
		let acc = 0;
		for (const key of keyList) {
			const raw = row ? row[key] : 0;
			const n = Number(raw);
			const v = Number.isFinite(n) ? n : 0;
			out[key].push([acc, acc + v]);
			acc += v;
		}
	}
	return out;
}

/**
 * Compact axis-tick / KPI number formatting. Thousands become `k`, millions
 * `M`, billions `B`, each to one decimal with a trailing ".0" trimmed. Integers
 * below 1000 pass through untouched; smaller fractions render at up to two
 * decimals.
 *
 *   formatTick(1234)    // "1.2k"
 *   formatTick(5600000) // "5.6M"
 *   formatTick(42)      // "42"
 *   formatTick(0.42)    // "0.42"
 * @param {number} n
 * @returns {string}
 */
export function formatTick(n) {
	if (!Number.isFinite(n)) return '';
	const abs = Math.abs(n);
	if (abs >= 1e9) return stripZeros((n / 1e9).toFixed(1)) + 'B';
	if (abs >= 1e6) return stripZeros((n / 1e6).toFixed(1)) + 'M';
	if (abs >= 1e3) return stripZeros((n / 1e3).toFixed(1)) + 'k';
	if (Number.isInteger(n)) return String(n);
	return stripZeros(n.toFixed(2));
}
