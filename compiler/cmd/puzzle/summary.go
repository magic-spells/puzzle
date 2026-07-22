package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// distFile is one emitted artifact under dist/, with its on-disk size and an
// estimated gzip size (gz == -1 for assets we don't gzip, e.g. source maps or
// already-compressed binaries).
type distFile struct {
	rel  string // slash path relative to dist/ (e.g. "app.js", "assets/logo.svg")
	size int64
	gz   int64
}

// printBuildSummary walks the freshly-written dist/ tree and prints a per-file
// table with human-readable sizes + gzip estimates, then a totals footer. It
// degrades cleanly on a non-TTY: the ui.Printer no-ops color codes, and the
// alignment is plain spaces, so piped/CI output stays readable.
func printBuildSummary(out *ui.Printer, outdir, mode string, elapsed time.Duration) {
	files, err := collectDist(outdir)
	if err != nil || len(files) == 0 {
		// Never let a reporting hiccup mask a successful build — fall back to
		// the terse line.
		fmt.Fprintf(os.Stdout, "%s built in %s\n", out.Green("✓"), formatMillis(elapsed))
		return
	}

	// Column widths.
	nameW, rawW, gzW := 0, 0, 0
	for _, f := range files {
		if n := len("dist/" + f.rel); n > nameW {
			nameW = n
		}
		if n := len(humanSize(f.size)); n > rawW {
			rawW = n
		}
		if f.gz >= 0 {
			if n := len(humanSize(f.gz)); n > gzW {
				gzW = n
			}
		}
	}

	var totalRaw, totalGz int64
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s %s\n\n", out.Cyan(out.Bold("puzzle build")), out.Dim("· "+mode))

	shipped := 0
	for _, f := range files {
		name := fmt.Sprintf("%-*s", nameW, "dist/"+f.rel)
		raw := fmt.Sprintf("%*s", rawW, humanSize(f.size))

		// Source maps are dev-only ballast — dim the row and keep them out of the
		// shipped-payload totals so the footer reflects what users download.
		if isMap(f.rel) {
			fmt.Fprintf(os.Stdout, "  %s  %s\n", out.Dim(name), out.Dim(raw))
			continue
		}

		shipped++
		totalRaw += f.size

		var gzCol string
		if f.gz >= 0 {
			totalGz += f.gz
			gzCol = fmt.Sprintf("%*s %s", gzW, humanSize(f.gz), out.Dim("gzip"))
		} else {
			gzCol = fmt.Sprintf("%*s", gzW, out.Dim("—"))
		}
		fmt.Fprintf(os.Stdout, "  %s  %s %s %s\n", name, raw, out.Dim("│"), gzCol)
	}

	fmt.Fprintln(os.Stdout)
	footer := fmt.Sprintf("built in %s  %s",
		formatMillis(elapsed),
		out.Dim(fmt.Sprintf("· %d files · %s raw (%s gzip)", shipped, humanSize(totalRaw), humanSize(totalGz))),
	)
	fmt.Fprintf(os.Stdout, "  %s %s\n", out.Green("✓"), footer)
}

// collectDist enumerates the regular files under outdir, sizes them, and gzip-
// estimates the compressible ones. Shipped assets sort first (largest first);
// source maps sink to the bottom.
func collectDist(outdir string) ([]distFile, error) {
	var files []distFile
	err := filepath.WalkDir(outdir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(outdir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		gz := int64(-1)
		if gzippable(rel) && info.Size() > 0 {
			data, readErr := os.ReadFile(p)
			if readErr != nil {
				return readErr
			}
			gz = gzipSize(data)
		}
		files = append(files, distFile{rel: rel, size: info.Size(), gz: gz})
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		im, jm := isMap(files[i].rel), isMap(files[j].rel)
		if im != jm {
			return jm // non-maps before maps
		}
		if files[i].size != files[j].size {
			return files[i].size > files[j].size
		}
		return files[i].rel < files[j].rel
	})
	return files, nil
}

// gzipSize returns the byte length of data compressed at best gzip level — a
// close proxy for what a CDN serves.
func gzipSize(data []byte) int64 {
	var buf bytes.Buffer
	w, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	_, _ = w.Write(data)
	_ = w.Close()
	return int64(buf.Len())
}

var textExts = map[string]bool{
	".js": true, ".mjs": true, ".css": true, ".html": true, ".htm": true,
	".json": true, ".svg": true, ".txt": true, ".xml": true, ".map": true,
}

func gzippable(rel string) bool {
	// Source maps are text but not shipped to users — don't gzip-report them.
	if isMap(rel) {
		return false
	}
	return textExts[strings.ToLower(filepath.Ext(rel))]
}

func isMap(rel string) bool { return strings.HasSuffix(rel, ".map") }

// humanSize renders a byte count as B / KB / MB (1 decimal above 1 KB).
func humanSize(n int64) string {
	const k = 1024.0
	switch {
	case n < 1024:
		return fmt.Sprintf("%d B", n)
	case n < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(n)/k)
	default:
		return fmt.Sprintf("%.1f MB", float64(n)/(k*k))
	}
}
