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
