package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

func TestHumanSize(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1023, "1023 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1024 * 1024, "1.0 MB"},
		{1024 * 1024 * 3 / 2, "1.5 MB"},
	}
	for _, c := range cases {
		if got := humanSize(c.in); got != c.want {
			t.Errorf("humanSize(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestGzippable(t *testing.T) {
	yes := []string{"app.js", "styles.css", "index.html", "data.json", "logo.svg", "sub/dir/app.MJS"}
	no := []string{"app.js.map", "photo.png", "font.woff2", "bin.wasm", "noext"}
	for _, r := range yes {
		if !gzippable(r) {
			t.Errorf("gzippable(%q) = false, want true", r)
		}
	}
	for _, r := range no {
		if gzippable(r) {
			t.Errorf("gzippable(%q) = true, want false", r)
		}
	}
}

func TestGzipSizeShrinksRepetitiveData(t *testing.T) {
	data := make([]byte, 10_000) // all zeros — highly compressible
	if got := gzipSize(data); got >= int64(len(data)) {
		t.Errorf("gzipSize(10k zeros) = %d, expected well under 10000", got)
	}
}

func TestCollectDistSortsAndSizes(t *testing.T) {
	dir := t.TempDir()
	write := func(name string, n int) {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, make([]byte, n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("app.js", 3000)
	write("index.html", 1000)
	write("app.js.map", 9000) // largest, but a map → must sort last
	write("styles.css", 0)    // empty → gz should be N/A (-1)
	// A split build's lazy chunk is an ordinary shipped row: sized, gzip-estimated,
	// and sorted by size like any other output.
	write("chunks/lazy-ABCD1234.js", 2000)

	files, err := collectDist(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 5 {
		t.Fatalf("got %d files, want 5", len(files))
	}
	if files[1].rel != "chunks/lazy-ABCD1234.js" {
		t.Errorf("chunk should sort as an ordinary row by size, got %q at index 1", files[1].rel)
	}
	if files[1].gz < 0 {
		t.Error("chunk should be gzip-sized like any other shipped .js")
	}
	// Non-maps first (largest first among them), map always last.
	if files[0].rel != "app.js" || files[len(files)-1].rel != "app.js.map" {
		t.Errorf("sort order wrong: first=%q last=%q", files[0].rel, files[len(files)-1].rel)
	}
	for _, f := range files {
		switch f.rel {
		case "app.js.map":
			if f.gz != -1 {
				t.Errorf("map should not be gzip-sized, got %d", f.gz)
			}
		case "styles.css":
			if f.gz != -1 {
				t.Errorf("empty file should have gz=-1, got %d", f.gz)
			}
		case "app.js":
			if f.gz < 0 {
				t.Errorf("app.js should be gzip-sized, got %d", f.gz)
			}
		}
	}
}

// metafileWith builds a synthetic esbuild metafile whose single output
// attributes bytesInOutput to the given input paths — enough for the
// composition report, which reads nothing else.
func metafileWith(inputs map[string]int) string {
	var b strings.Builder
	b.WriteString(`{"inputs":{},"outputs":{"dist/app.js":{"bytes":1,"inputs":{`)
	first := true
	keys := make([]string, 0, len(inputs))
	for k := range inputs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !first {
			b.WriteString(",")
		}
		first = false
		fmt.Fprintf(&b, `%q:{"bytesInOutput":%d}`, k, inputs[k])
	}
	b.WriteString(`}}}}`)
	return b.String()
}

// TestDependencyTotalsGroupsByPackage pins the grouping rule: every module under
// node_modules is attributed to its top-level package (scoped names keep both
// segments, a nested node_modules attributes to the innermost package), and
// everything else is the app's own code.
func TestDependencyTotalsGroupsByPackage(t *testing.T) {
	deps := dependencyTotals(metafileWith(map[string]int{
		"node_modules/mermaid/dist/mermaid.core.mjs":          300,
		"node_modules/mermaid/dist/diagram.mjs":               200,
		"node_modules/@magic-spells/puzzle/client-runtime.js": 100,
		"node_modules/big/node_modules/nested/index.js":       50,
		"app/app.js":         40,
		"app/views/Home.pzl": 10,
	}))

	want := map[string]int64{
		"mermaid":              500,
		"@magic-spells/puzzle": 100,
		"nested":               50,
		"app":                  50,
	}
	if len(deps) != len(want) {
		t.Fatalf("dependencyTotals returned %d groups, want %d: %+v", len(deps), len(want), deps)
	}
	for _, d := range deps {
		if got, ok := want[d.name]; !ok || got != d.bytes {
			t.Errorf("group %q = %d bytes, want %d (ok=%v)", d.name, d.bytes, got, ok)
		}
	}
	// Sorted largest first, so the top of the list is what to act on.
	if deps[0].name != "mermaid" {
		t.Errorf("deps[0] = %q, want the largest group (mermaid)", deps[0].name)
	}
}

// TestPrintCompositionWarnsHeavyDependency proves the banner names a dependency
// that dominates the bundle and points at the fix — the report that would have
// flagged an inlined mermaid on day one.
func TestPrintCompositionWarnsHeavyDependency(t *testing.T) {
	heavy := 250 * 1024
	var buf bytes.Buffer
	printComposition(&buf, ui.New(os.Stdout), dependencyTotals(metafileWith(map[string]int{
		"node_modules/heavyweight/dist/index.js": heavy,
		"app/app.js":                             1024,
	})))
	got := buf.String()

	if !strings.Contains(got, "heavyweight") {
		t.Errorf("composition report should name the heavy dependency:\n%s", got)
	}
	if !strings.Contains(got, humanSize(int64(heavy))) {
		t.Errorf("composition report should print the dependency's size %s:\n%s", humanSize(int64(heavy)), got)
	}
	if !strings.Contains(got, "build.splitting") {
		t.Errorf("the warning should point at the dynamic import()/build.splitting fix:\n%s", got)
	}
}

// TestPrintCompositionStaysQuietUnderThreshold keeps the banner calm for an
// ordinary app: the breakdown still prints, the warning does not.
func TestPrintCompositionStaysQuietUnderThreshold(t *testing.T) {
	var buf bytes.Buffer
	printComposition(&buf, ui.New(os.Stdout), dependencyTotals(metafileWith(map[string]int{
		"node_modules/small/index.js": 4096,
		"app/app.js":                  2048,
	})))
	got := buf.String()

	if !strings.Contains(got, "small") {
		t.Errorf("breakdown should still list dependencies:\n%s", got)
	}
	if strings.Contains(got, "build.splitting") {
		t.Errorf("no dependency crosses the threshold — there must be no warning:\n%s", got)
	}
}

// TestPrintCompositionEmptyMetafileIsSilent covers the degraded path: no
// metafile (a reporting hiccup, or a build that never asked for one) must not
// print an empty section.
func TestPrintCompositionEmptyMetafileIsSilent(t *testing.T) {
	for _, mf := range []string{"", "not json", `{"outputs":{}}`} {
		var buf bytes.Buffer
		printComposition(&buf, ui.New(os.Stdout), dependencyTotals(mf))
		if buf.Len() != 0 {
			t.Errorf("metafile %q printed %q, want nothing", mf, buf.String())
		}
	}
}

// TestCollectDistGzipSizesMatchContents guards the parallel gzip pass: every
// entry must carry the gzip size of ITS OWN file (an index mix-up across workers
// would swap them), non-gzippable and empty files must stay at -1, and the
// numbers must be identical to compressing each file directly.
func TestCollectDistGzipSizesMatchContents(t *testing.T) {
	dist := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dist, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	// Distinct, differently-compressible contents so a swapped result cannot
	// coincidentally match.
	contents := map[string]string{
		"app.js":           strings.Repeat("console.log('a');\n", 200),
		"styles.css":       strings.Repeat(".x{color:red}\n", 137),
		"index.html":       "<html><body>" + strings.Repeat("hi ", 91) + "</body></html>",
		"nested/data.json": `{"k":` + strings.Repeat(`"v",`, 63) + `"z":1}`,
		"empty.js":         "",
		"logo.png":         "\x89PNG not really",
		"app.js.map":       `{"version":3,"sources":[]}`,
	}
	for rel, body := range contents {
		if err := os.WriteFile(filepath.Join(dist, filepath.FromSlash(rel)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	files, err := collectDist(dist)
	if err != nil {
		t.Fatalf("collectDist: %v", err)
	}
	if len(files) != len(contents) {
		t.Fatalf("collectDist returned %d files, want %d", len(files), len(contents))
	}

	for _, f := range files {
		body, ok := contents[f.rel]
		if !ok {
			t.Fatalf("unexpected entry %q", f.rel)
		}
		if f.size != int64(len(body)) {
			t.Errorf("%s: size = %d, want %d", f.rel, f.size, len(body))
		}
		want := int64(-1)
		if gzippable(f.rel) && len(body) > 0 {
			want = gzipSize([]byte(body))
		}
		if f.gz != want {
			t.Errorf("%s: gz = %d, want %d", f.rel, f.gz, want)
		}
	}
}
