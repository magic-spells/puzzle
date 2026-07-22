package main

import (
	"os"
	"path/filepath"
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
