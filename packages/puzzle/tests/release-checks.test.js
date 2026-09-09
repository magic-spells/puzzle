// The release scripts run by hand, once per release, on one machine — the worst
// possible place to discover a check does not work. These are their pure
// predicates, exercised against the REAL strings and report shapes they read in
// production so a reworded Go notice or a changed npm report is a red test rather
// than a silently-passing release gate.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piecesFallbackNotice, packedBinaryProblem } from '../scripts/release-checks.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('piecesFallbackNotice', () => {
	// Verbatim from compiler/internal/pieces/npm.go, with the format verbs filled
	// in the way the CLI fills them.
	const NOTICE =
		'note: no @magic-spells/puzzle-pieces release matches puzzle 0.7.0 (0.7.x is not published yet) ' +
		'— using 0.6.0, the newest compatible release. Pin an exact one with --pieces-version.';

	it('detects the fallback notice on its own', () => {
		expect(piecesFallbackNotice(NOTICE)).toBe(NOTICE);
	});

	it('detects it inside a wall of other CLI output', () => {
		const output = ['✓ badge', NOTICE, '  app/pieces/badge/Badge.pzl', ''].join('\n');
		expect(piecesFallbackNotice(output)).toBe(NOTICE);
	});

	it('does not fire on a clean add', () => {
		const output = [
			'✓ added badge from npm:@magic-spells/puzzle-pieces@0.7.0',
			'  app/pieces/badge/Badge.pzl',
		].join('\n');
		expect(piecesFallbackNotice(output)).toBeNull();
	});

	// The HARD-ERROR message shares this notice's opening clause. It is a
	// different failure with a different remedy (nothing compatible exists at
	// all), and it already exits non-zero, so the detector must not claim it.
	it('does not fire on the no-compatible-release hard error', () => {
		const hardError =
			'no @magic-spells/puzzle-pieces release matches puzzle 0.7.0 (need 0.7.x; published: 0.5.0, 0.4.0)';
		expect(piecesFallbackNotice(hardError)).toBeNull();
	});

	it('tolerates empty and missing input', () => {
		expect(piecesFallbackNotice('')).toBeNull();
		expect(piecesFallbackNotice(undefined)).toBeNull();
	});

	// The detector is a copy of a Go format string, which is exactly the kind of
	// duplication that rots. Read the real one and assert the two still agree.
	it('matches the notice the compiler actually formats', () => {
		const src = readFileSync(join(repoRoot, 'compiler/internal/pieces/npm.go'), 'utf8');
		const format = src.match(/"(note: no %s release matches puzzle[^"]*)"/);
		expect(format, 'the fallback notice format string moved or was reworded').not.toBeNull();
		const rendered = format[1]
			.replace(/%s/g, 'X')
			.replace(/%d\.%d/g, '0.7')
			.replace(/\\n$/, '');
		expect(piecesFallbackNotice(rendered)).not.toBeNull();
	});
});

describe('packedBinaryProblem', () => {
	const files = [
		{ path: 'package.json', size: 612 },
		{ path: 'LICENSE.txt', size: 1069 },
		{ path: 'bin/puzzle', size: 12_345_678 },
	];

	it('passes a pack that carries a non-empty binary', () => {
		expect(
			packedBinaryProblem({ pkgName: 'p', binaryPath: 'bin/puzzle', files })
		).toBeNull();
	});

	it('accepts the package/-prefixed path shape too', () => {
		expect(
			packedBinaryProblem({
				pkgName: 'p',
				binaryPath: 'bin/puzzle',
				files: [{ path: 'package/bin/puzzle', size: 10 }],
			})
		).toBeNull();
	});

	// The real defect this exists for: the manifest packs cleanly and installs
	// cleanly, and the shim has nothing to spawn.
	it('reports a pack with no binary at all', () => {
		const problem = packedBinaryProblem({
			pkgName: '@magic-spells/puzzle-win32-x64',
			binaryPath: 'bin/puzzle.exe',
			files: files.filter((f) => !f.path.startsWith('bin/')),
		});
		expect(problem).toMatch(/no bin\/puzzle\.exe/);
		expect(problem).toContain('@magic-spells/puzzle-win32-x64');
	});

	// A name mismatch reads as "no binary", which is the point: the Windows
	// package declares bin/puzzle.exe, so a bin/puzzle in the tarball is a miss.
	it('reports a binary packed under the wrong name', () => {
		const problem = packedBinaryProblem({
			pkgName: '@magic-spells/puzzle-win32-x64',
			binaryPath: 'bin/puzzle.exe',
			files: [{ path: 'bin/puzzle', size: 999 }],
		});
		expect(problem).toMatch(/no bin\/puzzle\.exe/);
	});

	it('reports a zero-byte binary', () => {
		const problem = packedBinaryProblem({
			pkgName: 'p',
			binaryPath: 'bin/puzzle',
			files: [{ path: 'bin/puzzle', size: 0 }],
		});
		expect(problem).toMatch(/0 bytes/);
	});

	it('reports a missing file list rather than throwing', () => {
		expect(packedBinaryProblem({ pkgName: 'p', binaryPath: 'bin/puzzle', files: undefined }))
			.toMatch(/no file list/);
	});

	// The report shape is npm's, not ours. Pack a real platform package and feed
	// the genuine report through the predicate, so an npm that renames `files` or
	// `size` fails here instead of at release time.
	it('reads a real `npm pack --dry-run --json` report', () => {
		const raw = execFileSync(
			'npm',
			['pack', '--dry-run', '--json', './npm/puzzle-darwin-arm64'],
			{ cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		);
		const report = JSON.parse(raw);
		const entry = Array.isArray(report) ? report[0] : report;
		expect(entry.name).toBe('@magic-spells/puzzle-darwin-arm64');
		expect(Array.isArray(entry.files)).toBe(true);
		// The binaries are build artefacts and are not committed, so in a clean
		// checkout this MUST report the missing binary — proving the predicate is
		// reading the real report's fields and not silently passing on a shape it
		// does not understand. After a `release:prep` the binary is there and the
		// predicate returns null; both answers are correct, a throw is not.
		const problem = packedBinaryProblem({
			pkgName: entry.name,
			binaryPath: 'bin/puzzle',
			files: entry.files,
		});
		const packedBinary = entry.files.find((f) => f.path === 'bin/puzzle');
		if (packedBinary) expect(problem).toBeNull();
		else expect(problem).toMatch(/no bin\/puzzle/);
	});
});
