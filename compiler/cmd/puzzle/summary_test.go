package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
		if err := os.WriteFile(filepath.Join(dir, name), make([]byte, n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("app.js", 3000)
	write("index.html", 1000)
	write("app.js.map", 9000) // largest, but a map → must sort last
	write("styles.css", 0)    // empty → gz should be N/A (-1)

	files, err := collectDist(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 4 {
		t.Fatalf("got %d files, want 4", len(files))
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
