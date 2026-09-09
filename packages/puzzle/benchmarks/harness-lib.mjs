/**
 * The build + serve plumbing both benchmark drivers stand on.
 *
 * `runner.mjs` (production timings) and `probe.mjs` (development counters) do
 * exactly the same two mechanical things before they diverge: stage a copy of
 * `examples/stress` and build it with `puzzle build --mode <mode>`, then serve
 * the emitted `dist/` over a minimal static server that refuses a busy port.
 * Both halves lived twice, and the copies had already drifted — the probe's MIME
 * table was missing the `.mjs` entry the runner grew, so any `.mjs` asset the
 * probe served would have gone out as `application/octet-stream` and been
 * refused by the module loader. One copy, no drift.
 *
 * What is deliberately NOT shared is each driver's assertion about the bundle it
 * just built, because that assertion IS the difference between them: the runner
 * proves a production build carries none of the development machinery, the probe
 * proves a development build still carries the `__PUZZLE_PERF__` sentinel it
 * exists to read. `buildStaged()` hands back the bundle source and lets the
 * caller decide what it must contain.
 */

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../playwright.benchmark.config.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The one directory either driver ever builds into.
 *
 * Both modes stage HERE, which is why a `--no-build` reuse cannot infer the
 * build mode from the path and has to read the bytes — see runner.mjs.
 */
export const stagedDistDir = () => path.join(ROOT, config.build.stageSrcDir, 'dist');

/**
 * Byte-level evidence that a bundle came out of a DEVELOPMENT build.
 *
 * Production defines `__PUZZLE_DEV__` as false and esbuild removes the DevTools
 * bridge, the HMR client and devstate outright, so none of these three strings
 * can survive a real production build. Their presence is proof, not a heuristic.
 */
export const DEV_MARKERS = ['__PUZZLE_DEVTOOLS_HOOK__', 'import.meta.hot', 'puzzle:hmr'];

/** Which dev markers `source` carries (empty for a genuine production bundle). */
export const findDevMarkers = (source) => DEV_MARKERS.filter((m) => source.includes(m));

// ──────────────────────────────────────────────────────────────── build ────

/**
 * Copy the example's SOURCE into the benchmark's own scratch tree and build
 * THERE. `examples/stress/dist` is never written, read, or served.
 *
 * `puzzle build` has no output-dir flag, so it always emits `<appdir>/dist`.
 * Building the example in place therefore clobbers the bundle a human's
 * `puzzle dev` session is serving — and because a production build strips the
 * DevTools bridge, it silently kills their Performance panel. Copying the
 * source is the cheap way to make the benchmark's writes provably its own.
 *
 * @param {string} mode           'production' | 'development'
 * @param {object} opts
 * @param {string} opts.label     names the driver in a build-failure message
 * @param {Function} [opts.log]   optional line sink for the go-fallback notice
 * @returns {{dir: string, source: string, bundleKb: number, usingBin: boolean, mode: string}}
 */
export function buildStaged(mode, { label, log } = {}) {
	const srcRoot = path.join(ROOT, config.build.example);
	const stageSrc = path.join(ROOT, config.build.stageSrcDir);

	fs.rmSync(stageSrc, { recursive: true, force: true });
	fs.mkdirSync(stageSrc, { recursive: true });
	for (const entry of config.build.copyEntries) {
		const from = path.join(srcRoot, entry);
		if (!fs.existsSync(from)) continue;
		fs.cpSync(from, path.join(stageSrc, entry), { recursive: true });
	}

	const binPath = path.join(ROOT, config.build.bin);
	const usingBin = fs.existsSync(binPath);
	const cmd = usingBin ? binPath : config.build.goFallback[0];
	const target = path.relative(ROOT, stageSrc);
	const argv = usingBin
		? ['build', target, '--mode', mode]
		: [...config.build.goFallback.slice(1), 'build', target, '--mode', mode];

	if (!usingBin && log) {
		log(`BUILD  ${config.build.bin} is missing; fell back to \`go run\`, which cold-compiles the compiler first.`);
	}

	const res = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8' });
	if (res.status !== 0) {
		throw new Error(`${label} build failed (exit ${res.status})\n${res.stdout || ''}${res.stderr || ''}`);
	}

	const dir = path.join(stageSrc, 'dist');
	const appJs = path.join(dir, 'app.js');
	if (!fs.existsSync(appJs)) {
		throw new Error(`build produced no app.js in ${path.relative(ROOT, dir)}`);
	}

	const source = fs.readFileSync(appJs, 'utf8');
	return { dir, source, bundleKb: +(source.length / 1024).toFixed(1), usingBin, mode };
}

// ─────────────────────────────────────────────────────────────── server ────

export const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.map': 'application/json; charset=utf-8',
};

/**
 * Minimal static server with SPA fallback. No dev server, no live reload, no
 * extra dependency.
 *
 * `busyHint` is the driver-specific tail of the EADDRINUSE message: neither
 * driver kills a process it did not start, so the error has to tell the caller
 * which knob to turn — and the two drivers have different knobs.
 */
export function serveStatic(dir, { host = '127.0.0.1', port, busyHint = '' }) {
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${host}:${port}`);
		let file = path.join(dir, decodeURIComponent(url.pathname));
		if (!file.startsWith(dir)) {
			res.writeHead(403).end('forbidden');
			return;
		}
		if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			const indexed = path.join(file, 'index.html');
			file = fs.existsSync(indexed) ? indexed : path.join(dir, 'index.html');
		}
		if (!fs.existsSync(file)) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, {
			'content-type': MIME[path.extname(file)] || 'application/octet-stream',
			'cache-control': 'no-store',
		});
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve, reject) => {
		server.once('error', (err) => {
			// Someone else's server is on this port. Fail with an instruction
			// rather than killing a process the harness did not start — this
			// repo's dev servers live on 3000, 4173, 4174 and 4190.
			if (err.code === 'EADDRINUSE') {
				reject(new Error(`port ${port} is already in use. ${busyHint}`));
				return;
			}
			reject(err);
		});
		server.listen(port, host, () => resolve(server));
	});
}
