package pieces

import (
	"strings"
	"testing"
)

func TestSplitDepSpec(t *testing.T) {
	cases := []struct {
		spec, name, rng string
	}{
		// A floor on a scoped package: only the LAST @ separates.
		{"@magic-spells/collapsible-content@^1.2.0", "@magic-spells/collapsible-content", "^1.2.0"},
		{"@tiptap/core@^3.30.0", "@tiptap/core", "^3.30.0"},
		{"marked@^17.0.1", "marked", "^17.0.1"},
		// Bare names — the pre-D169 shape — keep parsing as "any version".
		{"@magic-spells/dialog-panel", "@magic-spells/dialog-panel", ""},
		{"highlight.js", "highlight.js", ""},
		// Exotic but legal ranges pass through verbatim.
		{"pkg@>=1.2.0 <2", "pkg", ">=1.2.0 <2"},
		{"pkg@latest", "pkg", "latest"},
	}
	for _, c := range cases {
		name, rng := splitDepSpec(c.spec)
		if name != c.name || rng != c.rng {
			t.Errorf("splitDepSpec(%q) = (%q, %q), want (%q, %q)", c.spec, name, rng, c.name, c.rng)
		}
		if got := joinDepSpec(name, rng); got != c.spec {
			t.Errorf("joinDepSpec round-trip of %q = %q", c.spec, got)
		}
	}
}

func TestCompareFloors(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"^1.2.0", "^1.2.0", 0},
		// Numeric, never lexical: 1.10 outranks 1.9.
		{"^1.10.0", "^1.9.0", 1},
		{"^0.2.0", "^0.10.0", -1},
		{"^2.0.0", "^1.99.99", 1},
		{"^1.2.3", "^1.2.10", -1},
		// A floor always beats "any version".
		{"^1.0.0", "", 1},
		{"", "^1.0.0", -1},
		// Comparator characters are skipped; only the version decides.
		{">=2.1.0", "^1.2.0", 1},
		{"~1.2.0", "1.2.0", 0},
		// A prerelease sorts below its own release.
		{"^1.2.0-rc.1", "^1.2.0", -1},
		{"^1.2.0", "^1.2.0-rc.1", 1},
		// Partial versions fill missing segments with 0.
		{"^2", "^1.9.9", 1},
		{"^1.2", "^1.2.0", 0},
		// An unreadable range loses to a real one but still compares
		// deterministically against another unreadable one.
		{"latest", "^1.0.0", -1},
		{"^1.0.0", "*", 1},
		{"latest", "next", -1},
	}
	for _, c := range cases {
		if got := compareFloors(c.a, c.b); got != c.want {
			t.Errorf("compareFloors(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// floorRegistry: two pieces name the same package at DIFFERENT floors, one
// piece carries a bare name (a pre-D169 / third-party manifest), and one
// carries a floor nobody else mentions.
const floorRegistry = `{
  "version": 1,
  "theme": "theme/pieces.css",
  "pieces": [
    {"name":"low","description":"","files":["Low.pzl"],"registryDependencies":[],"dependencies":["@magic-spells/collapsible-content@^1.1.0","marked"],"targetDir":"app/components/ui"},
    {"name":"high","description":"","files":["High.pzl"],"registryDependencies":["low"],"dependencies":["@magic-spells/collapsible-content@^1.2.0","highlight.js@^11.11.1"],"targetDir":"app/components/ui"}
  ]
}`

// The printed next step is `npm install <name>@<range>` — the whole point of
// D169: npm resolves the floor, not "latest".
func TestAddPrintsDependencyFloors(t *testing.T) {
	reg := buildRegistry(t, floorRegistry,
		fixtureFile{"ui/low/Low.pzl", "LOW\n"},
		fixtureFile{"ui/high/High.pzl", "HIGH\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true) // marker present ⇒ no theme advisory noise
	res, err := Add(Options{AppRoot: app, Names: []string{"high"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"@magic-spells/collapsible-content@^1.2.0", // the HIGHER of the two floors
		"highlight.js@^11.11.1",
		"marked", // bare stays bare — "any version"
	}
	if len(res.NpmDeps) != len(want) {
		t.Fatalf("npm deps = %v, want %v", res.NpmDeps, want)
	}
	for i, w := range want {
		if res.NpmDeps[i] != w {
			t.Errorf("npm dep %d = %q, want %q", i, res.NpmDeps[i], w)
		}
	}
	out := render(res)
	line := "npm install @magic-spells/collapsible-content@^1.2.0 highlight.js@^11.11.1 marked"
	if !strings.Contains(out, line) {
		t.Errorf("output missing %q:\n%s", line, out)
	}
	// The LOWER floor must never reach the printed line.
	if strings.Contains(out, "^1.1.0") {
		t.Errorf("printed the weaker floor:\n%s", out)
	}
}

// The merge is order-independent: whichever piece is requested first, the
// strictest floor wins.
func TestAddDependencyFloorMergeIsOrderIndependent(t *testing.T) {
	reg := buildRegistry(t, floorRegistry,
		fixtureFile{"ui/low/Low.pzl", "LOW\n"},
		fixtureFile{"ui/high/High.pzl", "HIGH\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	for _, names := range [][]string{{"low", "high"}, {"high", "low"}} {
		app := newApp(t, true)
		res, err := Add(Options{AppRoot: app, Names: names, Fetcher: NewFetcher(reg)})
		if err != nil {
			t.Fatal(err)
		}
		if res.NpmDeps[0] != "@magic-spells/collapsible-content@^1.2.0" {
			t.Errorf("names %v: npm deps = %v", names, res.NpmDeps)
		}
	}
}
