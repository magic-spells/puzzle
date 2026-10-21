/**
 * puzzle-pieces appearance — the runtime half of the theme system.
 *
 * Import it as
 *   import * as appearance from '@magic-spells/puzzle-pieces/appearance';
 * or copy the file into your app (the pieces demo keeps it at app/lib/).
 *
 * TWO AXES, NOT ONE. `scheme` picks a PALETTE (default | cool | warm | void);
 * `mode` picks the STYLE — how much of the window is lit (dark | dim | mixed |
 * light). They are independent — every palette ships all four styles — so a
 * picker offers them as two controls rather than sixteen themes. The field is
 * still called `mode` (stored JSON, `data-default-mode`, the picker's prop):
 * `style` would collide with the HTML attribute on a component tag.
 *
 * HOW IT IS APPLIED. Two attributes on <html> and one inline style, exactly
 * what themes/pre-paint.js writes before first paint:
 *
 *   data-scheme  the palette, ABSENT for the default
 *   data-theme   the style
 *   colorScheme  `light` for light and mixed, `dark` for dim and dark —
 *                written inline so form controls, scrollbars and <dialog>
 *                backdrops follow without a class list (mixed's dark frame is
 *                drawn by tokens; the panel is the light one)
 *
 * A mode of `null` means "follow the OS": both are removed and the
 * stylesheet's `:root { color-scheme: light dark }` decides between light and
 * dark. Dim and mixed are never chosen by the OS.
 *
 * STORAGE. One localStorage key (default `puzzle:appearance`), one JSON object
 * `{ scheme, mode }`, written atomically. The key and the empty-store fallback
 * come from pre-paint.js's `data-key` / `data-default-*` attributes when it ran;
 * `configure({ storageKey, fallback })` overrides both. Reading is lenient: a stored `theme`
 * field is accepted as `scheme` (Pyramid's shape), the old `dim` palette reads
 * as `cool` (renamed 0.9.0) and the old `medium` mode reads as `dim` — the same
 * three aliases pre-paint.js applies. CHANGE THEM THERE AND CHANGE THEM HERE.
 */

/** The palettes, in picker order. */
export const SCHEMES = [
	{ value: 'default', label: 'Default', description: 'Tasteful dark grey with a slight blue tint and an indigo accent.' },
	{ value: 'cool', label: 'Cool', description: 'A little more blue — blue-black grounds and periwinkle type, a lit-blue accent.' },
	{ value: 'warm', label: 'Warm', description: 'Browns and oranges — ivory and tan, brown-black, a clay accent.' },
	{ value: 'void', label: 'Void', description: 'Very black, dark greys and white type — monochrome, high contrast.' },
];

/** The styles (the `mode` field), in picker order — darkest first. */
export const MODES = [
	{ value: 'dark', label: 'Dark', description: 'Everything dark, the frame a step darker than the panel.' },
	{ value: 'dim', label: 'Dim', description: 'Between light and dark — lower contrast, more subtle.' },
	{ value: 'mixed', label: 'Mixed', description: 'The darker sidebar with a white main panel.' },
	{ value: 'light', label: 'Light', description: 'Everything lit — a light-grey frame with a white panel on it.' },
];

export const SCHEME_VALUES = SCHEMES.map((s) => s.value);
export const MODE_VALUES = MODES.map((m) => m.value);

/** The default palette carries no attribute — the `@theme` block IS its values. */
export const DEFAULT_SCHEME = 'default';

export const DEFAULT_STORAGE_KEY = 'puzzle:appearance';

/** Legacy spellings accepted on read (0.8.x names). */
const SCHEME_ALIASES = { dim: 'cool' };
const MODE_ALIASES = { medium: 'dim' };

const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key);

// pre-paint.js leaves its <script> parameters on `window.__puzzleAppearance`
// ({ key, scheme, mode }). Seeding from them is what keeps boot() from wiping
// the default it painted, or reading another key than the one it read.
const seed = globalThis.__puzzleAppearance;

const config = {
	storageKey: (typeof seed?.key === 'string' && seed.key) || DEFAULT_STORAGE_KEY,
	fallback: { scheme: normalizeScheme(seed?.scheme) || DEFAULT_SCHEME, mode: normalizeMode(seed?.mode) },
};

/** @type {{ scheme: string, mode: string|null }} the choice last applied */
let live = { ...config.fallback };

const listeners = new Set();

/**
 * App-level settings. Call it once, before `boot()`.
 *   storageKey  the localStorage key (Pyramid: `pyramid:appearance`)
 *   fallback    what an empty store means — `{ scheme, mode }`; a `mode` of
 *               null follows the OS. Pyramid passes `{ mode: 'dark' }`.
 */
export function configure({ storageKey, fallback } = {}) {
	if (typeof storageKey === 'string' && storageKey) config.storageKey = storageKey;
	if (fallback && typeof fallback === 'object') {
		config.fallback = {
			scheme: normalizeScheme(fallback.scheme) || DEFAULT_SCHEME,
			mode: fallback.mode === null ? null : normalizeMode(fallback.mode),
		};
	}
	return { ...config, fallback: { ...config.fallback } };
}

/** A palette name the UI has a row for — with `dim` mapped to `cool` — or null. */
export function normalizeScheme(value) {
	const mapped = own(SCHEME_ALIASES, value) ? SCHEME_ALIASES[value] : value;
	return SCHEME_VALUES.includes(mapped) ? mapped : null;
}

/** A style the UI has a row for — with `medium` mapped to `dim` — or null. */
export function normalizeMode(value) {
	const mapped = own(MODE_ALIASES, value) ? MODE_ALIASES[value] : value;
	return MODE_VALUES.includes(mapped) ? mapped : null;
}

/**
 * The stored choice, normalised. Never throws and never returns a value the UI
 * has no row for — junk reads as the fallback.
 *
 * @returns {{ scheme: string, mode: string|null }}
 */
export function read() {
	let stored = null;
	try {
		stored = JSON.parse(globalThis.localStorage?.getItem(config.storageKey) || 'null');
	} catch {
		// Unreadable store (private mode, quota, hand-edited junk).
	}
	const scheme = normalizeScheme(stored?.scheme) || normalizeScheme(stored?.theme);
	// An explicit `mode: null` in the store is a choice ("follow the OS"); an
	// absent or unknown mode is not, and reads as the fallback.
	const followsOs = !!stored && typeof stored === 'object' && stored.mode === null;
	return {
		scheme: scheme || config.fallback.scheme,
		mode: normalizeMode(stored?.mode) ?? (followsOs ? null : config.fallback.mode),
	};
}

/** Persist a whole choice. Never throws. */
export function persist(choice) {
	try {
		globalThis.localStorage?.setItem(config.storageKey, JSON.stringify(choice));
	} catch {
		// A session that cannot persist still gets to change its appearance.
	}
}

/**
 * Write a choice onto <html>. Idempotent, and safe before the DOM exists
 * (Node, prerender) — it records the choice and no-ops on the document. This
 * is the ONLY function that writes the attributes.
 *
 * @param {{ scheme?: string, mode?: string|null }} choice
 * @returns {{ scheme: string, mode: string|null }} the choice actually applied
 */
export function apply(choice) {
	const followsOs = !!choice && choice.mode === null;
	live = {
		scheme: normalizeScheme(choice?.scheme) || config.fallback.scheme,
		mode: followsOs ? null : (normalizeMode(choice?.mode) ?? config.fallback.mode),
	};

	const root = typeof document !== 'undefined' ? document.documentElement : null;
	if (root) {
		if (live.scheme !== DEFAULT_SCHEME) root.setAttribute('data-scheme', live.scheme);
		else root.removeAttribute('data-scheme');

		if (live.mode) {
			root.setAttribute('data-theme', live.mode);
			root.style.colorScheme = resolveColorScheme(live.mode);
		} else {
			root.removeAttribute('data-theme');
			root.style.colorScheme = '';
		}
	}

	for (const fn of listeners) fn({ ...live });
	return { ...live };
}

/** Persist a partial choice and apply it. Returns the full resulting choice. */
export function set(patch) {
	const next = apply({ ...live, ...patch });
	persist(next);
	return next;
}

/** The whole choice currently in force. */
export function current() {
	return { ...live };
}

/** The `color-scheme` a style resolves to: light for light and mixed, dark for dim and dark. */
export function resolveColorScheme(mode) {
	return mode === 'light' || mode === 'mixed' ? 'light' : 'dark';
}

/**
 * Hear every apply() — including one caused by another tab writing the store —
 * and, while `mode` is null, every OS light/dark flip (the choice re-resolves
 * even though nothing on <html> changed). Returns the unsubscribe function.
 */
export function subscribe(fn) {
	listeners.add(fn);
	ensureStorageListener();
	return () => listeners.delete(fn);
}

let storageListening = false;
function ensureStorageListener() {
	if (storageListening || typeof window === 'undefined') return;
	storageListening = true;
	window.addEventListener('storage', (event) => {
		if (event.key === config.storageKey) apply(read());
	});
	// Following the OS is a live choice: when the system flips between light
	// and dark while `mode` is null, nothing on <html> changes (there is no
	// attribute to change) but every subscriber that resolved the effective
	// mode through matchMedia needs to hear about it.
	if (typeof window.matchMedia === 'function') {
		const query = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			if (live.mode !== null) return;
			for (const fn of listeners) fn({ ...live });
		};
		if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
		else if (typeof query.addListener === 'function') query.addListener(onChange);
	}
}

/**
 * Apply the stored choice synchronously at startup. Call it first thing in
 * app.js: pre-paint.js has already painted this exact choice, and boot() is
 * what makes the module agree with the document.
 */
export function boot() {
	return apply(read());
}
