/**
 * WCAG 2.2 AA over every palette × every style, measured from the CSS the
 * browser actually paints (test/lib/parse-theme.mjs splits the `light-dark()`
 * pairs and lays the dim block over the dark half, the mixed block over the
 * light half).
 *
 * WHAT IS MEASURED — test/lib/roles.mjs declares it per role: text roles (ink,
 * body, muted, label-ink) ≥ 4.5:1 on every ground (page, surface, sunken,
 * raised, base, panel, card); bar-ink / bar-muted on the bar and its hover;
 * rail-ink / rail-muted on the rail and its active row; brand-ink on brand and
 * brand-dark; danger-ink on danger and danger-dark; the on-tint inks on their
 * tint; the status colours as TEXT on page and surface; and ≥ 3:1 for the
 * non-text roles — ring, border-dashed and a solid brand fill.
 *
 * WHAT IS NOT. `faint` is the disabled role (exempt, SC 1.4.3). `border` and
 * `border-strong` are decorative hairlines on surfaces that already differ from
 * their ground; the visible-boundary role is `border-dashed`. Chart slots carry
 * their own note in pieces.css. A translucent GROUND (Void's borders, a tint)
 * is flattened over `--color-surface` first, as Pyramid's test does.
 *
 * Also here: THE DIM RULE, measured — dim's grounds sit between dark's and
 * light's, and its type is softer than dark's (lower ink-on-panel contrast), so
 * dim is "between light and dark — lower contrast, more subtle". And THE MIXED
 * RULE — the frame is the dark style's frame and the panel the light style's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROLES } from './lib/roles.mjs';
import { SCHEMES, STYLES, fileFor, resolvedStyles } from './lib/parse-theme.mjs';
import { contrastRatio, flatten, parseColor, toOklch } from './lib/color.mjs';

const FLATTEN_OVER = '--color-surface';

for (const scheme of SCHEMES) {
	const styles = resolvedStyles(scheme);

	for (const style of STYLES) {
		test(`${scheme} / ${style}: every declared pair clears AA`, () => {
			const values = styles[style];
			const failures = [];
			let measured = 0;

			for (const role of ROLES) {
				if (!role.contrast) continue;
				for (const ground of role.contrast.on) {
					const fg = values.get(role.prop);
					let bg = values.get(ground);
					assert.ok(fg, `${fileFor(scheme)} declares no ${role.prop}`);
					assert.ok(bg, `${fileFor(scheme)} declares no ${ground}`);
					const parsed = parseColor(bg);
					if (parsed && parsed.a < 1) bg = flatten(bg, values.get(FLATTEN_OVER));
					const ratio = contrastRatio(fg, bg);
					measured += 1;
					assert.ok(Number.isFinite(ratio), `${role.prop} (${fg}) on ${ground} (${bg}) did not measure`);
					if (ratio < role.contrast.min) {
						failures.push(`${role.prop} (${fg}) on ${ground} (${bg}) — ${ratio.toFixed(2)}:1, needs ${role.contrast.min}:1`);
					}
				}
			}

			assert.ok(measured > 40, 'the pair list looks truncated');
			assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
		});
	}

	// THE QUIET BUTTONS (Cory, 2026-10-22). Button's primary is `bg-ink
	// text-page hover:bg-ink/85`; secondary is `bg-ink/6 text-ink
	// hover:bg-ink/10`, and outline/ghost hover on the same 6% tint. The tints
	// are translucent, so each is flattened over every ground a button sits on.
	// The page colour must read on solid ink and its hover at 4.5:1; ink must
	// read on the tint at 4.5:1; and the 6% tint must be a visible step off the
	// ground — at least 1.08:1 and 0.03 OKLCH lightness — so secondary never
	// vanishes the way surface-sunken did in dark.
	for (const style of STYLES) {
		test(`${scheme} / ${style}: the quiet button fills read on page, surface and raised`, () => {
			const values = styles[style];
			const ink = values.get('--color-ink');
			const page = values.get('--color-page');
			const over = (alpha, ground) => flatten({ ...parseColor(ink), a: alpha }, values.get(ground));
			const failures = [];
			const atLeast = (label, ratio, min) => {
				if (!(ratio >= min)) failures.push(`${label} — ${ratio.toFixed(2)}, needs ${min}`);
			};
			atLeast('page on ink (primary)', contrastRatio(page, ink), 4.5);
			for (const ground of ['--color-page', '--color-surface', '--color-surface-raised']) {
				const g = values.get(ground);
				atLeast(`page on ink/85 over ${ground} (primary hover)`, contrastRatio(page, over(0.85, ground)), 4.5);
				atLeast(`ink on ink/6 over ${ground} (secondary)`, contrastRatio(ink, over(0.06, ground)), 4.5);
				atLeast(`ink on ink/10 over ${ground} (secondary hover)`, contrastRatio(ink, over(0.1, ground)), 4.5);
				atLeast(`ink/6 against ${ground} (secondary step)`, contrastRatio(over(0.06, ground), g), 1.08);
				atLeast(`ink/6 against ${ground} (secondary lightness step)`, Math.abs(toOklch(over(0.06, ground)).l - toOklch(g).l), 0.03);
			}
			assert.deepEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
		});
	}

	test(`${scheme}: dim grounds sit between dark's and light's, and read as dark`, () => {
		for (const prop of ['--color-page', '--color-surface', '--color-surface-panel', '--color-surface-frame']) {
			const l = (style) => toOklch(styles[style].get(prop)).l;
			assert.ok(l('dark') < l('dim'), `${scheme}: ${prop} dim (${l('dim').toFixed(2)}) is not lighter than dark (${l('dark').toFixed(2)})`);
			assert.ok(l('dim') < 0.45, `${scheme}: ${prop} dim (${l('dim').toFixed(2)}) is too light to read as dark`);
		}
	});

	test(`${scheme}: dim is lower contrast than dark — ink on the panel measures less`, () => {
		const ratio = (style) => contrastRatio(styles[style].get('--color-ink'), styles[style].get('--color-surface-panel'));
		assert.ok(ratio('dim') < ratio('dark'), `${scheme}: dim ink/panel ${ratio('dim').toFixed(2)}:1 is not below dark's ${ratio('dark').toFixed(2)}:1`);
	});

	test(`${scheme}: mixed is the dark frame around the light panel`, () => {
		for (const prop of ['--color-surface-frame', '--color-bar', '--color-rail', '--color-bar-ink', '--color-rail-active']) {
			assert.equal(styles.mixed.get(prop), styles.dark.get(prop), `${scheme}: mixed ${prop} is not the dark frame's`);
		}
		for (const prop of ['--color-page', '--color-surface', '--color-surface-panel', '--color-surface-card', '--color-ink', '--color-brand']) {
			assert.equal(styles.mixed.get(prop), styles.light.get(prop), `${scheme}: mixed ${prop} is not the light panel's`);
		}
	});
}
