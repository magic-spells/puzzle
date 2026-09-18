/**
 * WCAG 2.2 AA over every palette × every mode, measured from the CSS the
 * browser actually paints (test/lib/parse-theme.mjs splits the `light-dark()`
 * pairs and lays the medium block over the dark half).
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
 * Also here: THE MEDIUM RULE, measured — the frame-to-panel step in OKLCH
 * lightness must be smaller in medium than in dark and in light, so medium is
 * "soft dark" and not a black rail against a lit sheet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROLES } from './lib/roles.mjs';
import { SCHEMES, MODES, fileFor, resolvedModes } from './lib/parse-theme.mjs';
import { contrastRatio, flatten, parseColor, toOklch } from './lib/color.mjs';

const FLATTEN_OVER = '--color-surface';

for (const scheme of SCHEMES) {
	const modes = resolvedModes(scheme);

	for (const mode of MODES) {
		test(`${scheme} / ${mode}: every declared pair clears AA`, () => {
			const values = modes[mode];
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

	test(`${scheme}: medium is soft dark — its frame-to-panel step is the smallest of the three`, () => {
		const step = (mode) => {
			const frame = toOklch(modes[mode].get('--color-surface-frame'));
			const panel = toOklch(modes[mode].get('--color-surface-panel'));
			return Math.abs(frame.l - panel.l);
		};
		const steps = { light: step('light'), medium: step('medium'), dark: step('dark') };
		assert.ok(steps.medium < steps.dark, `${scheme}: medium frame step ${steps.medium.toFixed(3)} is not below dark's ${steps.dark.toFixed(3)}`);
		assert.ok(steps.medium < steps.light, `${scheme}: medium frame step ${steps.medium.toFixed(3)} is not below light's ${steps.light.toFixed(3)}`);
	});

	test(`${scheme}: medium grounds sit between dark's and light's`, () => {
		for (const prop of ['--color-page', '--color-surface', '--color-surface-frame']) {
			const l = (mode) => toOklch(modes[mode].get(prop)).l;
			assert.ok(l('dark') < l('medium'), `${scheme}: ${prop} medium (${l('medium').toFixed(2)}) is not lighter than dark (${l('dark').toFixed(2)})`);
			assert.ok(l('medium') < 0.45, `${scheme}: ${prop} medium (${l('medium').toFixed(2)}) is too light to read as dark`);
		}
	});
}
