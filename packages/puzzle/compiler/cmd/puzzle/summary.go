package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
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
// table with human-readable sizes + gzip estimates, then the bundle-composition
// breakdown (from esbuild's metafile, empty when the caller has none), then a
// totals footer. It degrades cleanly on a non-TTY: the ui.Printer no-ops color
// codes, and the alignment is plain spaces, so piped/CI output stays readable.
func printBuildSummary(out *ui.Printer, outdir, mode, metafile string, elapsed time.Duration) {
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

	printComposition(os.Stdout, out, dependencyTotals(metafile), mode == "production")

	fmt.Fprintln(os.Stdout)
	footer := fmt.Sprintf("built in %s  %s",
		formatMillis(elapsed),
		out.Dim(fmt.Sprintf("· %d files · %s raw (%s gzip)", shipped, humanSize(totalRaw), humanSize(totalGz))),
	)
	fmt.Fprintf(os.Stdout, "  %s %s\n", out.Green("✓"), footer)
}

// depSize is one dependency's contribution to the emitted bundle: the summed
// bytesInOutput of every module esbuild attributed to that package.
type depSize struct {
	name  string
	bytes int64
}

// heavyDependencyBytes is the point at which one dependency stops being a cost
// of doing business and starts being the bundle. It is deliberately generous:
// the report exists to catch the accidental 3 MB inline (an `import('mermaid')`
// with nowhere to split to), not to nag about a fat date library.
//
// It is calibrated against MINIFIED bytes, so the warning is production-only —
// an unminified dev build puts everything, the framework included, over the
// line, and a warning that always fires is noise.
const heavyDependencyBytes = 200 * 1024

// frameworkPackage is never the answer to "what should I lazy-load?" — it is
// the module that boots the page, so it cannot be behind a dynamic import().
// It still appears in the breakdown; it just never draws the advisory.
const frameworkPackage = "@magic-spells/puzzle"

// compositionListLimit caps the printed breakdown. Five rows is enough to see
// where the weight is without turning the build banner into a report.
const compositionListLimit = 5

// dependencyTotals aggregates an esbuild metafile into per-dependency emitted
// bytes, largest first. Attribution uses bytesInOutput — what actually SHIPPED
// after tree-shaking and minification — not the input file's size on disk, so
// the numbers add up to the bundle the user is looking at.
//
// An absent or unparseable metafile yields nothing, and the caller prints
// nothing: the composition report is a courtesy, never a reason to fail or to
// muddy a successful build.
func dependencyTotals(metafileJSON string) []depSize {
	if strings.TrimSpace(metafileJSON) == "" {
		return nil
	}
	var mf struct {
		Outputs map[string]struct {
			Inputs map[string]struct {
				BytesInOutput int64 `json:"bytesInOutput"`
			} `json:"inputs"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal([]byte(metafileJSON), &mf); err != nil {
		return nil
	}

	totals := map[string]int64{}
	for _, out := range mf.Outputs {
		for input, contribution := range out.Inputs {
			totals[dependencyGroup(input)] += contribution.BytesInOutput
		}
	}
	deps := make([]depSize, 0, len(totals))
	for name, bytes := range totals {
		deps = append(deps, depSize{name: name, bytes: bytes})
	}
	sort.Slice(deps, func(i, j int) bool {
		if deps[i].bytes != deps[j].bytes {
			return deps[i].bytes > deps[j].bytes
		}
		return deps[i].name < deps[j].name
	})
	return deps
}

// dependencyGroup names the package a metafile input belongs to: the package
// directly under the LAST node_modules segment (so a nested dependency is
// attributed to the nested package, which is the thing to go look at), keeping
// both segments of a scoped name. Everything else — the app's own modules, the
// plugin's virtual inputs — groups as "app".
func dependencyGroup(input string) string {
	const marker = "node_modules/"
	idx := strings.LastIndex(input, marker)
	if idx < 0 {
		return "app"
	}
	rest := input[idx+len(marker):]
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" {
		return "app"
	}
	if strings.HasPrefix(parts[0], "@") && len(parts) > 1 {
		return parts[0] + "/" + parts[1]
	}
	return parts[0]
}

// printComposition renders the per-dependency breakdown and, for anything past
// heavyDependencyBytes, the one-line advisory that names the fix. Nothing is
// printed for an empty breakdown. warn is false for a development build, whose
// unminified bytes the threshold does not describe.
func printComposition(w io.Writer, out *ui.Printer, deps []depSize, warn bool) {
	if len(deps) == 0 {
		return
	}

	shown := deps
	if len(shown) > compositionListLimit {
		shown = shown[:compositionListLimit]
	}
	nameW := 0
	for _, d := range shown {
		if len(d.name) > nameW {
			nameW = len(d.name)
		}
	}

	fmt.Fprintln(w)
	fmt.Fprintf(w, "  %s\n", out.Dim("largest dependencies"))
	for _, d := range shown {
		fmt.Fprintf(w, "  %-*s  %s\n", nameW, d.name, humanSize(d.bytes))
	}

	if !warn {
		return
	}
	for _, d := range deps {
		if d.bytes < heavyDependencyBytes {
			break // sorted largest first — nothing after this crosses the line
		}
		if d.name == "app" || d.name == frameworkPackage {
			continue // neither the app's own code nor the framework is swappable
		}
		fmt.Fprintf(w, "  %s %s contributes %s — consider loading it with a dynamic import() and build.splitting, or a lighter alternative\n",
			out.Yellow("!"), d.name, humanSize(d.bytes))
	}
}

// collectDist enumerates the regular files under outdir, sizes them, and gzip-
// estimates the compressible ones. Shipped assets sort first (largest first);
// source maps sink to the bottom.
//
// The walk only records what needs compressing; the read-and-gzip work then runs
// across a GOMAXPROCS-bounded worker pool, because it is the whole cost of the
// summary and every file is independent. The compression LEVEL stays
// BestCompression on purpose: the printed numbers are what users compare across
// builds and against their CDN, so they must not shift because the reporter got
// faster.
func collectDist(outdir string) ([]distFile, error) {
	var files []distFile
	var srcPaths []string // absolute source path per files index, "" when not gzipped
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

		src := ""
		if gzippable(rel) && info.Size() > 0 {
			src = p
		}
		files = append(files, distFile{rel: rel, size: info.Size(), gz: -1})
		srcPaths = append(srcPaths, src)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := fillGzipSizes(files, srcPaths); err != nil {
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

// fillGzipSizes reads and gzips every file with a non-empty source path,
// writing the result into the matching files[i].gz. Entries are addressed by
// index and each worker owns its own, so no locking is needed around the
// results — only around the first error.
func fillGzipSizes(files []distFile, srcPaths []string) error {
	work := make(chan int)
	workers := runtime.GOMAXPROCS(0)
	if workers > len(files) {
		workers = len(files)
	}
	if workers < 1 {
		return nil
	}

	var (
		mu       sync.Mutex
		firstErr error
		wg       sync.WaitGroup
	)
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for i := range work {
				data, err := os.ReadFile(srcPaths[i])
				if err != nil {
					mu.Lock()
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					continue
				}
				files[i].gz = gzipSize(data)
			}
		}()
	}
	for i, src := range srcPaths {
		if src != "" {
			work <- i
		}
	}
	close(work)
	wg.Wait()
	return firstErr
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
