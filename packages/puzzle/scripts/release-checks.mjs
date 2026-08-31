// Pure predicates shared by the release scripts. No side effects, no I/O, no
// top-level work — release-prep.mjs and verify-published.mjs are both top-level
// scripts that exit(1) on import, so anything worth unit-testing has to live
// here instead. tests/release-checks.test.js is the suite.

/**
 * The compatibility-fallback notice `puzzle add piece` prints on stderr when no
 * pieces release exists on the CLI's own major.minor line and it silently drops
 * to an older one (compiler/internal/pieces/npm.go, resolve()).
 *
 * That fallback is CORRECT behaviour for a user on a fresh install — the CLI can
 * ship before the matching pieces minor exists — and a RELEASE DEFECT for us: it
 * means we published the framework without publishing the pieces release the
 * D32 version lock promises. So the notice is exactly the string a post-publish
 * check has to treat as a failure.
 *
 * The match is deliberately loose on the parts that carry data (package name,
 * versions) and tight on the two fragments that identify the message, so a
 * reworded parenthetical does not silently turn this check into a no-op.
 *
 * @param {string} output combined stdout+stderr of an `add piece` run
 * @returns {string|null} the offending line, or null when no fallback happened
 */
export function piecesFallbackNotice(output) {
	for (const raw of String(output ?? '').split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('note:')) continue;
		if (!/\brelease matches puzzle\b/.test(line)) continue;
		if (!/\bnewest compatible release\b/.test(line)) continue;
		return line;
	}
	return null;
}

/**
 * Assert an `npm pack --dry-run --json` report for one platform package actually
 * carries its CLI binary.
 *
 * release-prep cross-compiles five binaries and then executes exactly one — the
 * host's. The other four are proved only by the go build exiting 0, which says
 * nothing about whether the file landed where the package's "files" field
 * declares it: a `bin/puzzle` vs `bin/puzzle.exe` mismatch, a stale "files"
 * entry, or an .npmignore packs a manifest-only tarball that installs cleanly
 * and leaves the shim with nothing to spawn. That is the 0.3.0 failure shape —
 * a healthy-looking publish with no binary behind it — reached by a different
 * road.
 *
 * @param {object} args
 * @param {string} args.pkgName package name, for the message
 * @param {string} args.binaryPath declared path inside the tarball ('bin/puzzle' | 'bin/puzzle.exe')
 * @param {Array<{path: string, size: number}>} args.files the report's `files` array
 * @returns {string|null} a problem description, or null when the pack is good
 */
export function packedBinaryProblem({ pkgName, binaryPath, files }) {
	if (!Array.isArray(files)) {
		return `${pkgName}: \`npm pack --dry-run --json\` reported no file list`;
	}
	// npm reports paths without the `package/` prefix it writes into the tarball;
	// tolerate either so a future npm that changes its mind is not a false alarm.
	const entry = files.find(
		(f) => f?.path === binaryPath || f?.path === `package/${binaryPath}`
	);
	if (!entry) {
		const listed = files.map((f) => f?.path).join(', ') || '(nothing)';
		return `${pkgName}: the packed tarball has no ${binaryPath} — it would ship ${listed}`;
	}
	if (!(entry.size > 0)) {
		return `${pkgName}: ${binaryPath} packs at ${entry.size} bytes — the cross-compile produced an empty file`;
	}
	return null;
}
