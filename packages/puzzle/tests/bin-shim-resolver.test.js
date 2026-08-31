// bin/puzzle.js is the only code path between `npm install` and a running CLI,
// and it is the one file in the package that no other suite touches: the runtime
// tests import the runtime, the Go tests never see it. So this exercises the REAL
// shim end to end, against a fake platform package planted in a temp node_modules.
//
// The host's own platform/arch cannot answer the question — the interesting cases
// are hosts this machine is not — so each case runs in a child `node` that
// redefines process.platform/process.arch BEFORE importing the shim. That is the
// only way to see what a native ARM64 Node on Windows would resolve, and that
// case is the point: Windows-on-ARM ships no package of its own and must fold
// onto the x64 one (which Windows runs under emulation).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every platform package the fake tree provides, keyed by the package name the
// shim is expected to resolve. The binary is a shell script rather than a real
// executable: the shim only has to FIND and spawn it, and a script that echoes
// its own identity proves which one was found.
const FAKE_PACKAGES = [
	['@magic-spells/puzzle-darwin-arm64', 'puzzle'],
	['@magic-spells/puzzle-darwin-x64', 'puzzle'],
	['@magic-spells/puzzle-linux-arm64', 'puzzle'],
	['@magic-spells/puzzle-linux-x64', 'puzzle'],
	['@magic-spells/puzzle-win32-x64', 'puzzle.exe'],
];

let sandbox;
let shimPath;

beforeAll(() => {
	sandbox = mkdtempSync(join(tmpdir(), 'puzzle-shim-'));

	// The shim resolves through `require.resolve` from its OWN location, so it has
	// to sit inside the sandbox with the fake node_modules above it.
	mkdirSync(join(sandbox, 'bin'), { recursive: true });
	shimPath = join(sandbox, 'bin', 'puzzle.js');
	copyFileSync(join(repoRoot, 'bin', 'puzzle.js'), shimPath);
	writeFileSync(
		join(sandbox, 'package.json'),
		JSON.stringify({ name: 'shim-sandbox', version: '0.0.0', private: true, type: 'module' })
	);

	for (const [name, binary] of FAKE_PACKAGES) {
		const dir = join(sandbox, 'node_modules', name);
		mkdirSync(join(dir, 'bin'), { recursive: true });
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({ name, version: '0.0.0', files: [`bin/${binary}`] })
		);
		const binPath = join(dir, 'bin', binary);
		// The fake binary's whole job is to name itself, so the assertion reads
		// "the shim spawned THIS package's binary" rather than "the shim exited 0".
		writeFileSync(binPath, `#!/bin/sh\necho "${name}"\n`);
		chmodSync(binPath, 0o755);
	}
});

afterAll(() => {
	if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Run the shim as `platform`/`arch` would see it and return { status, stdout, stderr }.
 * The child redefines the two process fields — they are configurable, and no other
 * mechanism lets one host observe another host's resolution.
 */
function resolveAs(platform, arch) {
	const driver = join(sandbox, `drive-${platform}-${arch}.mjs`);
	writeFileSync(
		driver,
		`Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });\n` +
			`Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });\n` +
			`await import(${JSON.stringify(shimPath)});\n`
	);
	try {
		const stdout = execFileSync(process.execPath, [driver], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { status: 0, stdout, stderr: '' };
	} catch (err) {
		return {
			status: err.status ?? 1,
			stdout: err.stdout ?? '',
			stderr: err.stderr ?? '',
		};
	}
}

describe('bin/puzzle.js platform resolution', () => {
	it.each([
		['darwin', 'arm64', '@magic-spells/puzzle-darwin-arm64'],
		['darwin', 'x64', '@magic-spells/puzzle-darwin-x64'],
		['linux', 'arm64', '@magic-spells/puzzle-linux-arm64'],
		['linux', 'x64', '@magic-spells/puzzle-linux-x64'],
		['win32', 'x64', '@magic-spells/puzzle-win32-x64'],
	])('%s-%s resolves %s', (platform, arch, expected) => {
		const { status, stdout, stderr } = resolveAs(platform, arch);
		expect(stderr).toBe('');
		expect(status).toBe(0);
		expect(stdout.trim()).toBe(expected);
	});

	// The finding: on native ARM64 Node the shim computes `win32-arm64`, which had
	// no mapping — so it printed "no prebuilt CLI binary available" and exited 1 on
	// a platform the docs say is supported. Windows runs the x64 binary under
	// emulation, so the x64 package is the right answer, not an error.
	it('win32-arm64 folds onto the x64 package (Windows-on-ARM emulation)', () => {
		const { status, stdout, stderr } = resolveAs('win32', 'arm64');
		expect(stderr).toBe('');
		expect(status).toBe(0);
		expect(stdout.trim()).toBe('@magic-spells/puzzle-win32-x64');
	});

	// The fold must not become a blanket "any unknown arch gets x64": a genuinely
	// unsupported host still has to fail loudly with the install guidance.
	it('an unsupported platform still fails with guidance', () => {
		const { status, stderr } = resolveAs('sunos', 'x64');
		expect(status).toBe(1);
		expect(stderr).toContain('no prebuilt CLI binary available for this platform (sunos-x64)');
		expect(stderr).toContain('go install');
	});
});
