#!/usr/bin/env node
// `prepublishOnly` guard (D120): refuse a DIRECTORY publish of the root package.
//
// npm runs prepublishOnly for `npm publish` on a directory and NOT for
// `npm publish ./some.tgz` (lib/commands/publish.js gates it on
// `spec.type === 'directory'`). That asymmetry is exactly the distinction we need,
// so this hook can only fire on the broken path.
//
// Why a directory publish is always wrong for this package: the four platform
// optionalDependencies are injected at pack time by prepack and removed again by
// postpack, so the repo manifest stays lockfile-clean between a version bump and
// the publish. But a directory publish re-reads package.json from disk AFTER
// packing — postpack has already stripped the pins by then — and sends THAT as the
// registry metadata. The uploaded tarball is pin-perfect while the packument
// declares no optionalDependencies, and npm resolves installs from the packument.
// Result: the CLI shim ships with no platform binary behind it, and `puzzle`
// exits 1 on every machine. 0.3.0 shipped exactly that way.
//
// Publishing the packed file instead makes npm read the manifest out of the
// tarball, so the injected pins reach the registry.

console.error(`
refuse-directory-publish: FAIL — do not publish the root package from this directory.

The platform pins are injected at PACK time, and a directory publish sends the
manifest npm re-reads from disk AFTER postpack strips them again. The tarball
would be correct and the registry metadata would carry no optionalDependencies,
so every install resolves the CLI shim with no binary behind it. That is how
0.3.0 shipped with a completely broken \`puzzle\` command.

Publish the packed tarball instead:

  npm run release:prep      # builds the binaries and packs a verified .tgz
  npm publish ./npm/puzzle-darwin-arm64 --access public
  npm publish ./npm/puzzle-darwin-x64   --access public
  npm publish ./npm/puzzle-linux-arm64  --access public
  npm publish ./npm/puzzle-linux-x64    --access public
  npm publish ./magic-spells-puzzle-<version>.tgz --access public   # root LAST

Then confirm the registry really got the pins:

  npm run verify:published

(The platform packages above are plain directory publishes — correct, they
declare no injected dependencies of their own.)
`);
process.exit(1);
