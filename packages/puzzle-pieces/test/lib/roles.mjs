/**
 * THE TOKEN CONTRACT — every colour variable a Puzzle app shares, by name.
 *
 * The four files in registry/theme/ are the source of truth for VALUES; this
 * list is the source of truth for NAMES, so a token cannot be dropped from all
 * four files at once and a new file cannot ship without a frame. Names are
 * frozen: they are exactly what Pyramid and Sites use today, so those apps can
 * switch imports without touching a class string. The demo carries the same
 * list in demo/app/lib/tokenNames.js; themes.test.mjs fails if the two drift.
 *
 * Each role: prop, group, kind (color | alpha | shadow) and an optional
 * contrast check `{ on: [grounds], min }` — 4.5 is body text, 3 is non-text.
 */
const color = (name, group, extra = {}) => ({ prop: `--color-${name}`, name, group, kind: 'color', ...extra });
const alpha = (name, group) => ({ ...color(name, group), kind: 'alpha' });
const shadow = (name, group) => ({ prop: `--${name}`, name, group, kind: 'shadow' });

const TEXT_GROUNDS = [
	'--color-page',
	'--color-surface',
	'--color-surface-sunken',
	'--color-surface-raised',
	'--color-surface-base',
	'--color-surface-panel',
	'--color-surface-card',
];

export const GROUPS = ['text', 'surfaces', 'brand', 'status', 'lines', 'charts', 'shell', 'alpha', 'shadows'];

export const ROLES = [
	color('ink', 'text', { contrast: { on: TEXT_GROUNDS, min: 4.5 } }),
	color('body', 'text', { contrast: { on: TEXT_GROUNDS, min: 4.5 } }),
	color('muted', 'text', { contrast: { on: TEXT_GROUNDS, min: 4.5 } }),
	color('faint', 'text'), // disabled role — exempt (SC 1.4.3)
	color('label-ink', 'text', { contrast: { on: TEXT_GROUNDS, min: 4.5 } }),

	color('page', 'surfaces'),
	color('surface', 'surfaces'),
	color('surface-sunken', 'surfaces'),
	color('surface-raised', 'surfaces'),
	color('surface-base', 'surfaces'),

	color('brand', 'brand', { contrast: { on: ['--color-page', '--color-surface'], min: 3 } }),
	color('brand-dark', 'brand'),
	color('brand-tint', 'brand'),
	color('brand-ink', 'brand', { contrast: { on: ['--color-brand', '--color-brand-dark'], min: 4.5 } }),
	color('brand-on-tint', 'brand', { contrast: { on: ['--color-brand-tint'], min: 4.5 } }),

	color('danger', 'status', { contrast: { on: ['--color-page', '--color-surface'], min: 4.5 } }),
	color('danger-dark', 'status'),
	color('danger-tint', 'status'),
	color('danger-ink', 'status', { contrast: { on: ['--color-danger', '--color-danger-dark'], min: 4.5 } }),
	color('danger-on-tint', 'status', { contrast: { on: ['--color-danger-tint'], min: 4.5 } }),
	color('success', 'status', { contrast: { on: ['--color-page', '--color-surface'], min: 4.5 } }),
	color('success-tint', 'status'),
	color('warning', 'status', { contrast: { on: ['--color-page', '--color-surface'], min: 4.5 } }),
	color('warning-tint', 'status'),

	color('border', 'lines'), // decorative hairline — see contrast.test.mjs
	color('border-strong', 'lines'),
	color('border-dashed', 'lines', { contrast: { on: ['--color-page', '--color-surface', '--color-surface-sunken'], min: 3 } }),
	color('ring', 'lines', { contrast: { on: ['--color-page', '--color-surface'], min: 3 } }),

	...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => color(`chart-${n}`, 'charts')),

	color('surface-frame', 'shell'),
	color('frame-light', 'shell'),
	color('bar', 'shell'),
	color('bar-ink', 'shell', { contrast: { on: ['--color-bar', '--color-bar-hover'], min: 4.5 } }),
	color('bar-muted', 'shell', { contrast: { on: ['--color-bar', '--color-bar-hover'], min: 4.5 } }),
	color('bar-hover', 'shell'),
	color('bar-line', 'shell'),
	color('surface-panel', 'shell'),
	color('surface-card', 'shell'),
	color('rail', 'shell'),
	color('rail-ink', 'shell', { contrast: { on: ['--color-rail', '--color-rail-active'], min: 4.5 } }),
	color('rail-muted', 'shell', { contrast: { on: ['--color-rail', '--color-rail-active'], min: 4.5 } }),
	color('rail-active', 'shell'),
	color('rail-edge', 'shell'),
	alpha('edge-highlight', 'shell'),
	alpha('edge-highlight-strong', 'shell'),
	alpha('panel-edge', 'shell'), // an opaque hairline in light, the highlight lip in dark
	alpha('shadow-contact', 'shell'),

	alpha('well', 'alpha'),
	alpha('well-strong', 'alpha'),
	alpha('well-deep', 'alpha'),
	alpha('well-deepest', 'alpha'),
	alpha('scrim', 'alpha'),
	alpha('scrim-strong', 'alpha'),
	alpha('shadow-soft', 'alpha'),
	alpha('shadow-glow', 'alpha'),
	alpha('shadow-drop', 'alpha'),
	alpha('shadow-popover', 'alpha'),
	alpha('shadow-inset', 'alpha'),
	alpha('text-shadow', 'alpha'),

	shadow('shadow-float', 'shadows'),
	shadow('shadow-contact', 'shadows'),
	shadow('shadow-panel', 'shadows'),
	shadow('shadow-card', 'shadows'),
	shadow('shadow-popover', 'shadows'),
];

export const PROPS = ROLES.map((r) => r.prop);
export const ROLE_BY_PROP = new Map(ROLES.map((r) => [r.prop, r]));

/**
 * The tokens a medium block MUST re-declare: the grounds and the type that
 * define "soft dark". A palette whose medium block skips one of these has no
 * real medium mode — it is dark with a few colours moved.
 */
export const MEDIUM_REQUIRED = [
	'--color-ink',
	'--color-body',
	'--color-muted',
	'--color-page',
	'--color-surface',
	'--color-surface-sunken',
	'--color-surface-raised',
	'--color-surface-base',
	'--color-surface-frame',
	'--color-bar-ink',
	'--color-bar-hover',
	'--color-bar-line',
	'--color-surface-panel',
	'--color-surface-card',
];
