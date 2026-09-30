#!/usr/bin/env node
/**
 * Per-release benchmark history.
 *
 *   npm run bench:history          headline ops across every snapshot in history/
 *   npm run bench:history -- --all every op the snapshots share, not just the headline
 *   npm run bench:snapshot         copy baseline.json to history/<version>.json
 *
 * A snapshot is `baseline.json` as it stood at a release, frozen: same shape,
 * `{ meta, ops }`. The release step is `npm run bench:update` on the clean
 * release tree, then `npm run bench:snapshot`.
 *
 * Rows are comparable ONLY because every snapshot was measured on the same
 * machine and browser. The table prints both per column so a snapshot from
 * anywhere else is visible at a glance rather than quietly compared.
 */

import fs from 'node:fs';
import path from 'node:path';

import config from '../playwright.benchmark.config.js';
import { ROOT, machineName } from './harness-lib.mjs';
import { fmtMs, renderTable } from './report.mjs';

const HISTORY_DIR = path.join(ROOT, 'benchmarks/history');

/**
 * The ops quoted across releases: the full-DOM list at its largest size, the
 * windowed create at the same size, and the async census. `async-waterfall`
 * has no script time; its paint column is wall time around 20 serialized cells.
 */
const HEADLINE = [
	'keyed-list/create/50000',
	'keyed-list/update-every-10th/50000',
	'keyed-list/swap-rows/50000',
	'keyed-list/clear/50000',
	'virtual-list/create/50000',
	'async-waterfall/remount/20',
];

/** '0.10.0' sorts after '0.9.0'. */
const byVersion = (a, b) => {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
	return 0;
};

function readSnapshots() {
	if (!fs.existsSync(HISTORY_DIR)) return [];
	return fs
		.readdirSync(HISTORY_DIR)
		.filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f))
		.map((f) => f.slice(0, -'.json'.length))
		.sort(byVersion)
		.map((version) => ({ version, ...JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${version}.json`), 'utf8')) }));
}

const cell = (op) => {
	if (!op) return '—';
	const census = op.counters?.maxInFlight !== undefined ? ` (${op.counters.maxInFlight}/${op.counters.cells} in flight)` : '';
	return `${fmtMs(op.scriptMs ?? NaN)} / ${fmtMs(op.paintMs ?? NaN)}${census}`;
};

function printHistory({ all }) {
	const snaps = readSnapshots();
	if (!snaps.length) {
		console.log('\n  No snapshots in benchmarks/history/. Run `npm run bench:update`, then `npm run bench:snapshot`.\n');
		return 0;
	}

	const shared = Object.keys(snaps[snaps.length - 1].ops).filter((id) => snaps.every((s) => s.ops[id]));
	const ids = all ? shared : HEADLINE.filter((id) => shared.includes(id));
	const missing = all ? [] : HEADLINE.filter((id) => !shared.includes(id));

	const out = ['', '  PUZZLE BENCHMARK HISTORY  (median script ms / paint ms, production build)', ''];
	const meta = (label, fn) => [label, ...snaps.map((s) => fn(s.meta ?? {}))];
	const rows = [
		...ids.map((id) => [id, ...snaps.map((s) => cell(s.ops[id]))]),
		meta('bundle KB', (m) => String(m.bundleKb ?? '—')),
		['ops measured', ...snaps.map((s) => String(Object.keys(s.ops).length))],
		meta('commit', (m) => `${m.commit ?? '—'}${m.dirty ? ' (dirty)' : ''}`),
		meta('measured', (m) => (m.builtAt ?? '—').slice(0, 10) + (m.retroactive ? ' *' : '')),
		meta('chromium', (m) => m.browserVersion ?? '—'),
		meta('machine', (m) => m.machine ?? m.platform ?? '—'),
	];
	out.push(renderTable(['op', ...snaps.map((s) => s.version)], rows, ['l', ...snaps.map(() => 'r')]));
	out.push('');

	if (snaps.some((s) => s.meta?.retroactive)) {
		out.push('  * measured after the release, from the tag\'s own harness (see that snapshot\'s meta.note).');
	}
	if (missing.length) out.push(`  Not in every snapshot, so not compared: ${missing.join(', ')}.`);
	const machines = new Set(snaps.map((s) => `${s.meta?.machine ?? s.meta?.platform}|${s.meta?.browserVersion}`));
	if (machines.size > 1) {
		out.push('  WARNING: these snapshots were not all measured on the same machine and browser. Columns');
		out.push('  from different machines or browsers are not comparable; compare only like with like.');
	}
	out.push('');
	console.log(out.join('\n'));
	return 0;
}

function snapshot() {
	const baselinePath = path.join(ROOT, config.report.baselinePath);
	const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
	const version = baseline.meta?.version ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

	// A snapshot is the release's number of record. One measured over uncommitted
	// changes describes no release at all.
	if (baseline.meta?.dirty) {
		console.error(`\n  REFUSING: ${config.report.baselinePath} was measured on a dirty tree (commit ${baseline.meta.commit}). Commit, re-run \`npm run bench:update\`, then snapshot.\n`);
		return 1;
	}

	// Older baselines predate meta.version / meta.machine; the runner records both now.
	const meta = { version, machine: machineName(), ...baseline.meta };
	fs.mkdirSync(HISTORY_DIR, { recursive: true });
	const out = path.join(HISTORY_DIR, `${version}.json`);
	fs.writeFileSync(out, JSON.stringify({ meta, ops: baseline.ops }, null, '\t') + '\n');
	console.log(`  ${path.relative(ROOT, out)} written (${Object.keys(baseline.ops).length} ops, commit ${meta.commit})`);
	return 0;
}

const argv = process.argv.slice(2);
for (const a of argv) {
	if (!['--snapshot', '--all'].includes(a)) {
		console.error(`unknown flag "${a}"`);
		process.exit(1);
	}
}
process.exit(argv.includes('--snapshot') ? snapshot() : printHistory({ all: argv.includes('--all') }));
