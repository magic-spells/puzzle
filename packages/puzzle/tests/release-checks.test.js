// The release scripts run by hand, once per release, on one machine — the worst
// possible place to discover a check does not work. These are their pure
// predicates, exercised against the REAL strings and report shapes they read in
// production so a changed npm report is a red test rather than a silently-passing
// release gate.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	packedBinaryProblem,
	readmeStatusProblem,
	tagReminderLines,
} from '../scripts/release-checks.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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

describe('tagReminderLines', () => {
	// Go resolves a module in a repo subdirectory only through a tag prefixed
	// with that directory, so the reminder must name the prefixed tag exactly.
	it('prints the prefixed puzzle-lang tag and push command for the version', () => {
		const text = tagReminderLines('0.8.0').join('\n');
		expect(text).toContain('After tagging v0.8.0');
		expect(text).toContain(
			'git tag packages/puzzle-lang/v0.8.0 && git push origin packages/puzzle-lang/v0.8.0'
		);
	});

	// Cory creates every tag. The summary may print git commands; the script
	// must never run one that tags or pushes.
	it('release-prep prints the reminder and never runs git tag or git push', () => {
		const src = readFileSync(join(repoRoot, 'scripts/release-prep.mjs'), 'utf8');
		expect(src).toContain('tagReminderLines(version)');
		expect(src).not.toMatch(/exec\w*\(\s*['"]git['"]/);
	});
});

describe('readmeStatusProblem', () => {
	it('accepts a status line naming the version and reports any other', () => {
		expect(readmeStatusProblem('> **Status: 0.8.0** — the current release.', '0.8.0')).toBeNull();
		expect(readmeStatusProblem('> **Status: 0.7.0** — the current release.', '0.8.0')).toBe(
			'README.md says "Status: 0.7.0", expected "0.8.0"'
		);
		expect(readmeStatusProblem('# Puzzle\n', '0.8.0')).toMatch(/no "\*\*Status: <version>\*\*" line/);
	});

	it('reads the status line out of a full README', () => {
		const readme = '# Puzzle\n\nIntro.\n\n> **Status: 0.9.0** — the current release. More prose.\n';
		expect(readmeStatusProblem(readme, '0.9.0')).toBeNull();
		expect(readmeStatusProblem(readme, '0.10.0')).toBe(
			'README.md says "Status: 0.9.0", expected "0.10.0"'
		);
	});

	// The real README is checked against package.json by release-prep only, like
	// every other version stamp — a fresh release branch bumps package.json first,
	// and must not fail `npm test` until the README is edited.
	it('release-prep runs the check on the real README', () => {
		const src = readFileSync(join(repoRoot, 'scripts/release-prep.mjs'), 'utf8');
		expect(src).toMatch(/readmeStatusProblem\(\s*readFileSync\(join\(repoRoot, 'README\.md'\)/);
	});
});
