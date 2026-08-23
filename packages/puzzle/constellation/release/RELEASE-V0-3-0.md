---
name: 0.3.0 — testing surface, published broken
status: built
version: 0.3.0
connections:
  - RELEASE-V0-2-0
  - RELEASE-V0-3-1
  - DECISION-D120-TARBALL-PUBLISH
---

# 0.3.0 — testing surface, published broken

**Never recommend, install, or reference 0.3.0.** It is published, deprecated,
and dead on arrival on every machine: its registry metadata carries no
`optionalDependencies`, so npm installs the CLI shim with no platform binary
behind it and `puzzle` exits 1. Use `0.3.1`, which is the identical feature
set published correctly.

The cause was a packaging seam, not a code defect. Platform pins are injected
into the manifest at pack time and stripped again by `postpack`; `npm publish`
on a **directory** re-reads the manifest *after* the strip, so the registry
received a pin-less packument even though the tarball on disk was fine. The
root has to be published as the packed tarball it prints. That rule, and the
guards that now enforce it, are D120.

The theme, for the record, was making Puzzle apps testable: two new export
subpaths — `./testing` and `./fixtures` — plus a hardening round carrying four
breaking changes. Two subpaths and four breaks is a minor, not a patch.

## Upgrade notes

Do not upgrade to this version. The upgrade notes for this feature set live on
`RELEASE-V0-3-1`.
