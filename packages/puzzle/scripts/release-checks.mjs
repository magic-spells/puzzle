// Pure predicates shared by the release scripts. No side effects, no I/O, no
// top-level work — release-prep.mjs and verify-published.mjs are both top-level
// scripts that exit(1) on import, so anything worth unit-testing has to live
// here instead. tests/release-checks.test.js is the suite.

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

/**
 * The tag reminder release-prep prints in its summary. Cory tags every release
 * by hand, and the language module needs a second tag beside the framework's:
 * the Go toolchain finds a version of a module in a repository subdirectory
 * only through a tag prefixed with that directory, so Sites and other `go get`
 * consumers resolve `packages/puzzle-lang` through
 * `packages/puzzle-lang/vX.Y.Z`, never through `vX.Y.Z` (D172).
 *
 * These are lines to print, not commands to run — release-prep creates and
 * pushes no tags.
 *
 * @param {string} version the framework version being released ('0.8.0')
 * @returns {string[]} summary lines, without trailing newlines
 */
export function tagReminderLines(version) {
	const langTag = `packages/puzzle-lang/v${version}`;
	return [
		`After tagging v${version}, also push the language module's tag — Go consumers`,
		`(Sites) \`go get\` packages/puzzle-lang by it, not by v${version}. This script`,
		'creates no tags:',
		`  git tag ${langTag} && git push origin ${langTag}`,
	];
}

/**
 * The README's status line (`> **Status: 0.8.0** — the current release`) names
 * the release the tarball ships in. It sat at 0.7.0 in the 0.8.0 package
 * because no version script touches it and nothing checked it.
 *
 * @param {string} readme README.md's contents
 * @param {string} version the framework version being released ('0.8.0')
 * @returns {string|null} the problem, or null when the line names `version`
 */
export function readmeStatusProblem(readme, version) {
	const match = readme.match(/\*\*Status: ([^*]+)\*\*/);
	if (!match) return 'README.md has no "**Status: <version>**" line';
	const stated = match[1].trim();
	return stated === version ? null : `README.md says "Status: ${stated}", expected "${version}"`;
}
