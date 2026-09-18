// The theme token list the demo's colour cards are built from — a STATIC list
// of names, grouped as registry/theme/pieces.css groups them. Values are never
// written here: each card reads its colour from the live computed style
// (`getComputedStyle(...).getPropertyValue('--color-ink')`) in the scheme and
// mode it is scoped to, so the cards can never disagree with the stylesheet.
//
// test/themes.test.mjs asserts this list equals the package's token contract
// (test/lib/roles.mjs), so a token added to the CSS shows up here or the build
// fails. `ground` names the surface a text/foreground token is measured on for
// the AA chip; `min` is the WCAG bar (4.5 body text, 3 non-text).

const TEXT_GROUNDS = ['page', 'surface', 'surface-sunken', 'surface-raised', 'surface-base', 'surface-panel', 'surface-card'];

export const TOKEN_GROUPS = [
	{
		id: 'text',
		title: 'Text',
		description: 'Ink ladders, strongest to faintest. Measured on every ground.',
		tokens: [
			{ name: 'ink', role: 'Headings, control labels, strong text', on: TEXT_GROUNDS, min: 4.5 },
			{ name: 'body', role: 'Default body text', on: TEXT_GROUNDS, min: 4.5 },
			{ name: 'muted', role: 'Secondary text, placeholders, hints', on: TEXT_GROUNDS, min: 4.5 },
			{ name: 'faint', role: 'Disabled text, separators (exempt from AA)' },
			{ name: 'label-ink', role: 'Ink mixed into user-coloured label chips', on: TEXT_GROUNDS, min: 4.5 },
		],
	},
	{
		id: 'surfaces',
		title: 'Surfaces',
		description: 'The stacked grounds content sits on.',
		tokens: [
			{ name: 'page', role: 'App background — the deepest layer' },
			{ name: 'surface', role: 'Cards, inputs, panels, popovers' },
			{ name: 'surface-sunken', role: 'Wells, tracks, secondary-button fills' },
			{ name: 'surface-raised', role: 'Dialogs, popovers — one step above surface' },
			{ name: 'surface-base', role: 'Between page and surface — the board ground' },
		],
	},
	{
		id: 'brand',
		title: 'Brand',
		description: 'The one accent everything keys off.',
		tokens: [
			{ name: 'brand', role: 'Primary actions, active states, links', on: ['page', 'surface'], min: 3 },
			{ name: 'brand-dark', role: 'Hover / active' },
			{ name: 'brand-tint', role: 'Selected rows, ghost hover, soft chips' },
			{ name: 'brand-ink', role: 'Text / icons on solid brand', on: ['brand', 'brand-dark'], min: 4.5 },
			{ name: 'brand-on-tint', role: 'Text / icons on brand-tint', on: ['brand-tint'], min: 4.5 },
		],
	},
	{
		id: 'status',
		title: 'Status',
		description: 'Danger, success and warning — solid, tinted, and as text.',
		tokens: [
			{ name: 'danger', role: 'Destructive actions, invalid states', on: ['page', 'surface'], min: 4.5 },
			{ name: 'danger-dark', role: 'Hover / active' },
			{ name: 'danger-tint', role: 'Soft error backgrounds' },
			{ name: 'danger-ink', role: 'Text / icons on solid danger', on: ['danger', 'danger-dark'], min: 4.5 },
			{ name: 'danger-on-tint', role: 'Text / icons on danger-tint', on: ['danger-tint'], min: 4.5 },
			{ name: 'success', role: 'Positive deltas, "up is good"', on: ['page', 'surface'], min: 4.5 },
			{ name: 'success-tint', role: 'Soft positive backgrounds' },
			{ name: 'warning', role: 'Caution band — meters, gauges, alerts', on: ['page', 'surface'], min: 4.5 },
			{ name: 'warning-tint', role: 'Soft caution backgrounds' },
		],
	},
	{
		id: 'lines',
		title: 'Lines & focus',
		description: 'Hairlines, the dashed outline and the focus ring.',
		tokens: [
			{ name: 'border', role: 'Default hairlines (decorative)' },
			{ name: 'border-strong', role: 'Hover borders, pressed outlines' },
			{ name: 'border-dashed', role: 'The dashed "add" outline — a visible boundary', on: ['page', 'surface', 'surface-sunken'], min: 3 },
			{ name: 'ring', role: 'Focus rings', on: ['page', 'surface'], min: 3 },
		],
	},
	{
		id: 'charts',
		title: 'Charts',
		description: 'Eight categorical slots in fixed order, never cycled.',
		tokens: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `chart-${n}`, role: `Series slot ${n}` })),
	},
	{
		id: 'shell',
		title: 'Shell',
		description: 'The frame, the bar, the rail, the panel and the card.',
		tokens: [
			{ name: 'surface-frame', role: 'The window ground — bar and rail are one flat L on it' },
			{ name: 'frame-light', role: 'The light-mode frame grey (equals surface-frame in light)' },
			{ name: 'bar', role: 'The top bar (= surface-frame)' },
			{ name: 'bar-ink', role: 'Type on the bar', on: ['bar', 'bar-hover'], min: 4.5 },
			{ name: 'bar-muted', role: 'Quiet type on the bar', on: ['bar', 'bar-hover'], min: 4.5 },
			{ name: 'bar-hover', role: 'A hovered / selected chip on the bar or rail' },
			{ name: 'bar-line', role: 'Hairlines on the frame' },
			{ name: 'surface-panel', role: 'The work panel set down inside the frame' },
			{ name: 'surface-card', role: 'A card on the panel' },
			{ name: 'rail', role: 'The side rail (= surface-frame)' },
			{ name: 'rail-ink', role: 'Type on the rail (= bar-ink)', on: ['rail', 'rail-active'], min: 4.5 },
			{ name: 'rail-muted', role: 'Quiet type on the rail (= bar-muted)', on: ['rail', 'rail-active'], min: 4.5 },
			{ name: 'rail-active', role: 'The selected rail row (= bar-hover)' },
			{ name: 'rail-edge', role: 'The rail’s hairline (= bar-line)' },
			{ name: 'edge-highlight', role: 'The 1px lip along the top of a floating surface', alpha: true },
			{ name: 'edge-highlight-strong', role: 'The panel’s lip, a step stronger', alpha: true },
			{ name: 'panel-edge', role: 'The panel’s top border colour — hairline in light, lip in dark', alpha: true },
			{ name: 'shadow-contact', role: 'The tight contact shadow that seats a surface', alpha: true },
		],
	},
	{
		id: 'alpha',
		title: 'Alpha family',
		description: 'Wells, scrims and shadow colours — translucent, they tint whatever they land on.',
		tokens: [
			{ name: 'well', role: 'Inset well', alpha: true },
			{ name: 'well-strong', role: 'Deeper well', alpha: true },
			{ name: 'well-deep', role: 'Deeper still', alpha: true },
			{ name: 'well-deepest', role: 'The deepest well', alpha: true },
			{ name: 'scrim', role: 'Modal scrim', alpha: true },
			{ name: 'scrim-strong', role: 'Heavier scrim', alpha: true },
			{ name: 'shadow-soft', role: 'The large soft cast', alpha: true },
			{ name: 'shadow-glow', role: 'Glow-weight shadow', alpha: true },
			{ name: 'shadow-drop', role: 'Drop-weight shadow', alpha: true },
			{ name: 'shadow-popover', role: 'The wide cast under a popover', alpha: true },
			{ name: 'shadow-inset', role: 'Inset vignette', alpha: true },
			{ name: 'text-shadow', role: 'Under white pill labels', alpha: true },
		],
	},
	{
		id: 'shadows',
		title: 'Shadows',
		description: 'Composed box-shadow values (shadow-panel, shadow-card, …), built from the colours above.',
		tokens: [
			{ name: 'shadow-float', role: 'The soft float', prop: '--shadow-float', shadow: true },
			{ name: 'shadow-contact', role: 'The contact seat', prop: '--shadow-contact', shadow: true },
			{ name: 'shadow-panel', role: 'The work panel', prop: '--shadow-panel', shadow: true },
			{ name: 'shadow-card', role: 'A card', prop: '--shadow-card', shadow: true },
			{ name: 'shadow-popover', role: 'A popover', prop: '--shadow-popover', shadow: true },
		],
	},
].map((group) => ({
	...group,
	tokens: group.tokens.map((t) => ({
		...t,
		prop: t.prop || `--color-${t.name}`,
		on: (t.on || []).map((g) => `--color-${g}`),
	})),
}));

/** Every custom property the demo reads, in order. */
export const TOKEN_PROPS = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.prop));

export const SCHEMES = ['default', 'dim', 'warm', 'void'];
export const MODES = ['light', 'medium', 'dark'];
