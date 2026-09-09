/**
 * Pure slider helpers — no DOM access, no state, no dependencies. Shared by the
 * Slider and Fader pieces so the value math has exactly one definition: both
 * controls quantize, clamp and position identically, and a fix here fixes both.
 *
 * Everything takes a `cfg` built by `configFrom(props)`:
 *
 *   { min, max, step, dec }
 *
 * `step` is either a positive number or the STRING `'any'` (continuous) — never
 * do arithmetic on it without checking, `'any' * 2` is NaN. `dec` is the decimal
 * precision implied by the step, min AND max, used to round float drift out of
 * computed values (0.1 + 0.2 must not surface as 0.30000000000000004). `max`
 * counts because a bound off the step grid (max 2.5 with step 1) is a legal
 * value the clamp can return — rounding it to the step's precision would push
 * it back past the bound.
 *
 * The percent helpers are the bridge to CSS: a value becomes a 0–100 percent
 * that the piece drops straight into a `left:`/`width:` style string.
 */

/** Desired tick-interval count when `tickStep` is not supplied. */
const AUTO_TICK_TARGET = 25;

/** Hard ceiling on generated tick marks, whatever the caller asks for. */
const MAX_TICKS = 200;

/**
 * Interval multipliers for auto-coarsening a tick grid. All INTEGERS on purpose:
 * a generated interval is always a whole multiple of the step, so ticks can
 * never land between detents (a 2.5x multiplier on step=1 would put marks at
 * 2.5, 7.5, … which the thumb can never reach).
 */
const NICE_MULTIPLES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Decimal places in a raw step/min value, capped at 6. @param {*} raw */
function decimalsOf(raw) {
	if (raw == null) return 0;
	const s = String(raw);
	const dot = s.indexOf('.');
	return dot === -1 ? 0 : Math.min(s.length - dot - 1, 6);
}

/**
 * Builds the `cfg` every other helper takes, from a piece's raw props. Bounds
 * default to 0–100 and step to 1; a non-positive or unparseable step falls back
 * to 1 rather than producing a division by zero downstream.
 * @param {{min?: *, max?: *, step?: *}} props
 * @returns {{ min: number, max: number, step: number|'any', dec: number }}
 */
export function configFrom(props) {
	const min = Number.isFinite(Number(props.min)) ? Number(props.min) : 0;
	const max = Number.isFinite(Number(props.max)) ? Number(props.max) : 100;
	const stepAny = props.step === 'any';
	const stepNum = Number(props.step);
	const step = stepAny ? 'any' : Number.isFinite(stepNum) && stepNum > 0 ? stepNum : 1;
	const dec = stepAny
		? 2
		: Math.max(decimalsOf(props.step), decimalsOf(props.min), decimalsOf(props.max));
	return { min, max, step, dec };
}

/** Snap a value onto the step grid, measured FROM `min` (not from zero). */
export function quantize(v, cfg) {
	if (cfg.step === 'any') return v;
	return cfg.min + Math.round((v - cfg.min) / cfg.step) * cfg.step;
}

/** Clamp into `[min, max]`. */
export function clampBounds(v, cfg) {
	return Math.max(cfg.min, Math.min(v, cfg.max));
}

/** Round to the precision the step implies, stripping float drift. */
export function round(v, cfg) {
	return parseFloat(v.toFixed(cfg.dec));
}

/**
 * Quantize → clamp to bounds → crossover-clamp against the opposing thumb →
 * round. Deterministic: `normalize(normalize(x)) === normalize(x)`, which is what
 * lets the pieces guard their update loops on value EQUALITY instead of flags.
 *
 * `thumb` is 'min' | 'max' | 'single'. Single-thumb callers can pass an empty
 * `committed` — neither crossover branch fires.
 * @param {number} value
 * @param {'min'|'max'|'single'} thumb
 * @param {object} cfg
 * @param {{valueMin?: number, valueMax?: number}} committed
 */
export function normalize(value, thumb, cfg, committed) {
	let v = Number.isFinite(value) ? value : cfg.min;
	v = clampBounds(quantize(v, cfg), cfg);
	if (thumb === 'min') v = Math.min(v, committed.valueMax);
	if (thumb === 'max') v = Math.max(v, committed.valueMin);
	return round(v, cfg);
}

/**
 * Value → 0–100 percent along the track, clamped. Rounded to 3 decimals so the
 * style strings it feeds stay short and diff-stable.
 */
export function valueToPercent(value, cfg) {
	const range = cfg.max - cfg.min;
	if (range <= 0) return 0;
	const pct = ((value - cfg.min) / range) * 100;
	return Math.round(Math.max(0, Math.min(100, pct)) * 1000) / 1000;
}

/** Percent along the track → raw value. Not quantized — feed it to `normalize`. */
export function percentToValue(percent, cfg) {
	return cfg.min + (percent / 100) * (cfg.max - cfg.min);
}

/**
 * Picks a tick interval that keeps the mark count near `target`, by scaling
 * `base` (normally the step) up through `NICE_MULTIPLES`. Falls back to an even
 * division of the span when no multiple is coarse enough.
 * @param {number} span  max - min
 * @param {number} base  the smallest legal interval — usually cfg.step
 * @param {number} target desired number of INTERVALS (marks are target + 1)
 */
export function autoTickStep(span, base, target) {
	if (!(span > 0)) return 1;
	if (!(base > 0)) return span / target;
	for (const m of NICE_MULTIPLES) {
		if (span / (base * m) <= target) return base * m;
	}
	return span / target;
}

/**
 * Resolves a `ticks` prop into an ascending list of tick descriptors.
 *
 * `spec` accepts, and MIXES, three forms so a caller never has to pick one:
 *   true                                   → a generated grid (see below)
 *   [0, 25, 50]                            → explicit values
 *   [{ value: 90, class: 'bg-danger' }]    → explicit values with per-tick styling
 *   [0, { value: 90, label: 'Max' }]       → both at once
 *
 * Explicit values are used VERBATIM (never re-rounded to the step grid — a tick
 * at 0.5 on a step-1 slider is a legal annotation, and rounding would silently
 * move it) but are dropped if they fall outside `[min, max]`. Repeated values
 * MERGE rather than fighting, so `[0, 50, { value: 0, label: 'Off' }]` keeps the
 * label instead of letting the bare 0 that came first discard it.
 *
 * A generated grid uses `tickStep` when it is a positive number, otherwise it
 * auto-coarsens from the step so `ticks={true}` on a 0–100 step-1 slider yields
 * 21 marks rather than 101. An explicit `tickStep` finer than `MAX_TICKS` allows
 * is coarsened too — a fine step must never render ten thousand nodes.
 *
 * @param {object} cfg from `configFrom`
 * @param {boolean|Array} spec the raw `ticks` prop
 * @param {*} [tickStep] the raw `tickStep` prop
 * @returns {{value: number, label?: string, class?: string, labelClass?: string}[]}
 */
export function tickValues(cfg, spec, tickStep) {
	if (!spec) return [];

	if (Array.isArray(spec)) {
		const byValue = new Map();
		for (const raw of spec) {
			const entry = raw && typeof raw === 'object' ? raw : { value: raw };
			const value = Number(entry.value);
			if (!Number.isFinite(value)) continue;
			if (value < cfg.min || value > cfg.max) continue;
			const prev = byValue.get(value) || { value };
			// Later entries fill in fields the earlier ones left undefined, so a
			// bare duplicate can never blank out a richer descriptor.
			if (entry.label !== undefined) prev.label = entry.label;
			if (entry.class !== undefined) prev.class = entry.class;
			if (entry.labelClass !== undefined) prev.labelClass = entry.labelClass;
			byValue.set(value, prev);
		}
		return [...byValue.values()].sort((a, b) => a.value - b.value);
	}

	const span = cfg.max - cfg.min;
	if (!(span > 0)) return [{ value: cfg.min }];

	// A continuous slider has no step to scale, so derive a base from the span.
	const base = cfg.step === 'any' ? span / AUTO_TICK_TARGET : cfg.step;
	let interval = Number(tickStep);
	if (!Number.isFinite(interval) || interval <= 0) {
		interval = autoTickStep(span, base, AUTO_TICK_TARGET);
	} else if (span / interval > MAX_TICKS) {
		interval = autoTickStep(span, interval, MAX_TICKS);
	}

	// Round against the INTERVAL's precision, not the step's: a tickStep of 2.5
	// on a step-1 slider has more decimals than cfg.dec and would be mangled.
	const dec = Math.min(Math.max(cfg.dec, decimalsOf(interval)), 6);
	const snap = (v) => parseFloat(v.toFixed(dec));

	const out = [];
	const count = Math.floor(span / interval + 1e-9);
	for (let i = 0; i <= count; i++) out.push({ value: snap(cfg.min + i * interval) });
	// The grid rarely lands exactly on max; the end of the track always gets a mark.
	if (out[out.length - 1].value < cfg.max - 1e-9) out.push({ value: snap(cfg.max) });
	return out;
}

/**
 * Horizontal shift for a mark or label centred at `percent`, as a value for the
 * CSS `translate` PROPERTY. Interior marks centre on their position; the two
 * endpoints sit flush inside the track ends instead of hanging half-off it.
 *
 * Returned for `translate:`, never `transform:` — Tailwind's `-translate-x-1/2`
 * also writes the `translate` property, so anything using `transform` here would
 * COMPOSE with a stray utility and double-shift. Emit `translate:${shift} 0` and
 * a stray utility is simply overridden.
 * @param {number} percent
 * @returns {'0%'|'-50%'|'-100%'}
 */
export function edgeShift(percent) {
	if (percent <= 0) return '0%';
	if (percent >= 100) return '-100%';
	return '-50%';
}
