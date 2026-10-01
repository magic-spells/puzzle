package pieces

import (
	"strings"
)

// A piece manifest's `dependencies` entry is an npm INSTALL SPEC, not a bare
// package name: "@magic-spells/collapsible-content@^1.2.0" carries the semver
// FLOOR the piece was built against (D169). The floor is optional — a bare
// "marked" still means "any version", which is what a third-party registry
// written against the pre-0.7.1 schema emits, so both shapes parse and both
// print.
//
// The floor is a range string, not a version: whatever npm accepts after the
// `@` (`^1.2.0`, `~2.0.1`, `>=3 <4`, an exact `3.30.0`) is passed through
// verbatim to the printed `npm install` line. We only ever COMPARE floors, and
// only to answer "which of these two is higher" when two pieces name the same
// package — see compareFloors.

// splitDepSpec splits an npm install spec into its package name and range. The
// separator is the LAST `@` at a non-zero index, so a scoped package
// ("@scope/pkg") keeps its leading `@` and an unversioned spec returns an empty
// range.
func splitDepSpec(spec string) (name, rng string) {
	if i := strings.LastIndex(spec, "@"); i > 0 {
		return spec[:i], spec[i+1:]
	}
	return spec, ""
}

// joinDepSpec is splitDepSpec's inverse: an empty range prints the bare name,
// exactly as a pre-floor manifest did.
func joinDepSpec(name, rng string) string {
	if rng == "" {
		return name
	}
	return name + "@" + rng
}

// compareFloors orders two ranges by the lowest version each one admits, so
// merging pieces that disagree can keep the STRICTER floor. It returns -1, 0 or
// 1 (a < b, equal, a > b).
//
// Ordering rules, in the order they apply:
//   - An absent range is the weakest floor ("any version"), below every range.
//   - Otherwise compare the range's leading semver core numerically
//     (1.10.0 > 1.9.0 — never lexically).
//   - A version with a prerelease tag sorts BELOW the same core release
//     (^1.2.0-rc.1 < ^1.2.0), matching semver precedence.
//   - Ranges we cannot read a core out of compare lexically, purely so the
//     merge stays deterministic; an exotic hand-written range is never
//     silently dropped, it just may not win.
func compareFloors(a, b string) int {
	switch {
	case a == b:
		return 0
	case a == "":
		return -1
	case b == "":
		return 1
	}
	av, aOK := parseFloorVersion(a)
	bv, bOK := parseFloorVersion(b)
	switch {
	case aOK && !bOK:
		return 1
	case !aOK && bOK:
		return -1
	case !aOK && !bOK:
		return strings.Compare(a, b)
	}
	for i := 0; i < 3; i++ {
		if av.core[i] != bv.core[i] {
			if av.core[i] < bv.core[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case av.pre == bv.pre:
		return 0
	case av.pre == "":
		return 1 // a release outranks the same version's prerelease
	case bv.pre == "":
		return -1
	}
	return strings.Compare(av.pre, bv.pre)
}

// floorVersion is the comparable part of a range: the semver core plus an
// optional prerelease tag. Build metadata is ignored (semver says it has no
// precedence).
type floorVersion struct {
	core [3]int
	pre  string
}

// parseFloorVersion reads the first semver version out of a range, skipping the
// comparator characters npm ranges start with (`^`, `~`, `>=`, `=`, `v`, space).
// It reports false when there is no leading numeric version — a tag ("latest"),
// a URL, or a `*` — which compareFloors then handles as unreadable.
func parseFloorVersion(rng string) (floorVersion, bool) {
	s := strings.TrimLeft(rng, "^~<>= vV\t")
	// Trim anything after the version: the second half of a compound range
	// (">=1.2.0 <2") or build metadata.
	if i := strings.IndexAny(s, " \t+|,"); i >= 0 {
		s = s[:i]
	}
	pre := ""
	if i := strings.IndexByte(s, '-'); i >= 0 {
		pre, s = s[i+1:], s[:i]
	}
	if s == "" {
		return floorVersion{}, false
	}
	var v floorVersion
	for i, part := range strings.SplitN(s, ".", 3) {
		if i > 2 {
			break
		}
		n, ok := atoiStrict(part)
		if !ok {
			return floorVersion{}, false
		}
		v.core[i] = n
	}
	v.pre = pre
	return v, true
}

// atoiStrict parses a non-negative decimal integer, rejecting anything else
// (an `x` placeholder, a sign, an empty segment) rather than coercing it to 0.
func atoiStrict(s string) (int, bool) {
	if s == "" {
		return 0, false
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
		n = n*10 + int(r-'0')
		if n > 1<<30 {
			return 0, false // absurd; treat the range as unreadable
		}
	}
	return n, true
}
