#!/usr/bin/env node
// Bin shim for the `puzzle` CLI. The Go binary ships in a per-platform optional
// dependency (@magic-spells/puzzle-<platform>-<arch>); this resolves the one that
// matches the host, then forwards argv + stdio + exit code to it.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// process.platform-process.arch → platform package name. There is deliberately no
// win32-arm64 PACKAGE — Windows runs the x64 binary under emulation — but there
// must still be a win32-arm64 ROW: a native ARM64 build of Node reports
// process.arch === 'arm64', so without this fold the key misses the table and the
// CLI dies on a platform the docs call supported. The x64 package's "cpu" field
// is widened to match, so npm actually installs it there.
const PLATFORM_PACKAGES = {
	'darwin-arm64': '@magic-spells/puzzle-darwin-arm64',
	'darwin-x64': '@magic-spells/puzzle-darwin-x64',
	'linux-x64': '@magic-spells/puzzle-linux-x64',
	'linux-arm64': '@magic-spells/puzzle-linux-arm64',
	'win32-x64': '@magic-spells/puzzle-win32-x64',
	'win32-arm64': '@magic-spells/puzzle-win32-x64',
};

const key = `${process.platform}-${process.arch}`;
const pkg = PLATFORM_PACKAGES[key];

// The Windows binary carries the .exe suffix the platform requires to run it;
// every other target ships an extensionless `bin/puzzle`.
const binName = process.platform === 'win32' ? 'puzzle.exe' : 'puzzle';

let binPath;
if (pkg) {
	try {
		// Resolve THROUGH the platform package so wrong-arch node_modules (copied
		// between machines) don't accidentally resolve a mismatched binary.
		binPath = require.resolve(`${pkg}/bin/${binName}`);
	} catch {
		binPath = undefined;
	}
}

if (!binPath) {
	// Printed as host → package, not as a bare host list: win32-arm64 and win32-x64
	// resolve the SAME package, and a plain list of keys would read as a promise of
	// two Windows binaries that do not exist.
	const supported = Object.entries(PLATFORM_PACKAGES)
		.map(([hostKey, name]) => `  - ${hostKey} → ${name}`)
		.join('\n');
	process.stderr.write(
		`puzzle: no prebuilt CLI binary available for this platform (${key}).\n\n` +
			`Prebuilt binaries ship for:\n${supported}\n\n` +
			`If you're on a supported platform, this usually means node_modules was\n` +
			`copied from a different OS/arch, or the install skipped optional deps\n` +
			`(--no-optional / --omit=optional). Reinstall on THIS machine:\n` +
			`  npm install\n\n` +
			`For unsupported platforms, install the CLI from source:\n` +
			`  go install github.com/magic-spells/puzzle/compiler/cmd/puzzle@latest\n`
	);
	process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
	process.stderr.write(`puzzle: failed to launch ${binPath}\n${result.error.message}\n`);
	process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
