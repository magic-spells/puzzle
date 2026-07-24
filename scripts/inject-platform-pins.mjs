#!/usr/bin/env node
// Inject/restore the four platform-binary optionalDependencies around `npm pack`.
//
// The repo's package.json must NOT carry these pins: between a version bump and
// the actual publish the pinned versions do not exist on the registry, which
// desyncs package-lock.json and breaks `npm ci` (CI installs). The published
// manifest MUST carry them so installs fetch the right binary. So `prepack`
// injects the pins (version-matched to package.json's own version) into the
// manifest right before the tarball is built, and `postpack` removes them again.
//
// Idempotent in both directions. If a crash between the two hooks leaves the
// pins behind, `node scripts/inject-platform-pins.mjs restore` (or
// `git checkout package.json`) recovers.
//
// scripts/verify-pack.mjs imports PLATFORM_PACKAGES/injectPins to assert the
// as-published manifest, so the CLI entry below must stay import-safe.

import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Same four packages as scripts/release-prep.mjs MATRIX and bin/puzzle.js.
export const PLATFORM_PACKAGES = [
	'@magic-spells/puzzle-darwin-arm64',
	'@magic-spells/puzzle-darwin-x64',
	'@magic-spells/puzzle-linux-arm64',
	'@magic-spells/puzzle-linux-x64',
];

/** Return a copy of the manifest with the platform pins injected at its version. */
export function injectPins(manifest) {
	return {
		...manifest,
		optionalDependencies: Object.fromEntries(
			PLATFORM_PACKAGES.map((name) => [name, manifest.version])
		),
	};
}

// npm runs lifecycle hooks with a RELATIVE argv[1]; realpath both sides so the
// CLI branch fires from hooks but not when verify-pack imports this module.
const isCLI =
	process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isCLI) {
	const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
	const mode = process.argv[2];

	if (mode !== 'inject' && mode !== 'restore') {
		console.error('usage: inject-platform-pins.mjs <inject|restore>');
		process.exit(1);
	}

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

	// Log to stderr: prepack/postpack stdout would corrupt `npm pack --json`
	// payloads (verify-pack parses one).
	let next;
	if (mode === 'inject') {
		next = injectPins(manifest);
		console.error(
			`inject-platform-pins: pinned ${PLATFORM_PACKAGES.length} platform packages at ${manifest.version}`
		);
	} else {
		next = { ...manifest };
		delete next.optionalDependencies;
		console.error('inject-platform-pins: removed platform pins from package.json');
	}

	writeFileSync(manifestPath, JSON.stringify(next, null, '\t') + '\n');
}
