// Renders the golden apps (app.js) through a given runtime and returns every
// output file plus the summary, keyed by a stable relative name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EN, MANIFEST, SHELL, goldenConfig } from './app.js';

/**
 * @param {{ prerenderToDir: Function, PuzzleView: any, ViewNode: any, SLOT_TAG: any }} runtime
 * @returns {Promise<Record<string, string>>}
 */
export async function renderGolden(runtime) {
	const out = {};
	for (const mode of ['static', 'hybrid']) {
		for (const i18n of [true, false]) {
			const name = `${mode}-${i18n ? 'i18n' : 'plain'}`;
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzle-golden-'));
			fs.writeFileSync(path.join(dir, 'index.html'), SHELL);
			const summary = await runtime.prerenderToDir(goldenConfig(runtime, { i18n }), {
				outDir: dir,
				shellPath: path.join(dir, 'index.html'),
				mode,
				...(i18n ? { i18n: { manifest: MANIFEST, table: EN } } : {}),
			});
			const rel = (file) => path.relative(dir, file).split(path.sep).join('/');
			for (const page of summary.written) {
				if (fs.existsSync(page.file)) out[`${name}/${rel(page.file)}`] = fs.readFileSync(page.file, 'utf8');
			}
			out[`${name}/summary.json`] = JSON.stringify(
				{ ...summary, outDir: '', written: summary.written.map((w) => ({ ...w, file: rel(w.file) })) },
				null,
				1
			);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
	return out;
}
