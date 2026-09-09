package codegen

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// compileWithSVGCache compiles a template against an assets dir with a memo
// attached, so the error-contract cases below run through the CACHED path
// rather than the direct read/scan the other inlinesvg tests cover.
func compileWithSVGCache(t *testing.T, body, assetsDir string, cache *SVGCache) (*Result, error) {
	t.Helper()
	sec, err := parser.SplitSections(body, "T.pzl")
	if err != nil {
		t.Fatalf("SplitSections: %v", err)
	}
	return Compile(sec, Options{Filename: "T.pzl", Mode: ModeView, AssetsDir: assetsDir, SVGCache: cache})
}

// The memo must not blunt any of the three {#svg} failure modes. Each is
// asserted on a SECOND compile through the same cache as well as the first: a
// cached failure has to stay a failure, with the same positioned message, or a
// build would go green on the second pass over a missing or malformed asset.
func TestSVGCachePreservesErrorContract(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"icons/ok.svg":  `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
		"icons/bad.svg": `<div><span/></div>`,
	})

	t.Run("missing file", func(t *testing.T) {
		cache := NewSVGCache()
		full := filepath.Join(dir, "icons", "nope.svg")
		for _, pass := range []string{"first", "cached"} {
			res, err := compileWithSVGCache(t, `<puzzle-view>{#svg 'icons/nope.svg'}</puzzle-view>`, dir, cache)
			if err == nil {
				t.Fatalf("%s pass: expected a missing-file error", pass)
			}
			if !strings.Contains(err.Error(), "no such file at "+full) {
				t.Errorf("%s pass: error %q missing 'no such file at %s'", pass, err.Error(), full)
			}
			pe, ok := err.(*parser.ParseError)
			if !ok || pe.File != "T.pzl" {
				t.Fatalf("%s pass: want a *parser.ParseError at T.pzl, got %T %v", pass, err, err)
			}
			// The attempted path is still recorded for WatchFiles recovery.
			if len(res.InlinedFiles) != 1 || res.InlinedFiles[0] != full {
				t.Errorf("%s pass: InlinedFiles = %v, want [%s]", pass, res.InlinedFiles, full)
			}
		}
	})

	t.Run("malformed file", func(t *testing.T) {
		cache := NewSVGCache()
		for _, pass := range []string{"first", "cached"} {
			_, err := compileWithSVGCache(t, `<puzzle-view>{#svg 'icons/bad.svg'}</puzzle-view>`, dir, cache)
			if err == nil {
				t.Fatalf("%s pass: expected a malformed-svg error", pass)
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("%s pass: got %T, want *parser.ParseError", pass, err)
			}
			// Still positioned INSIDE the svg, not at the {#svg} site.
			if pe.File != "app/assets/icons/bad.svg" {
				t.Errorf("%s pass: File = %q, want app/assets/icons/bad.svg", pass, pe.File)
			}
			if !strings.Contains(pe.Message, "root element is <div>, not <svg>") {
				t.Errorf("%s pass: message %q should name the actual root tag", pass, pe.Message)
			}
		}
	})

	t.Run("valid file compiles identically cached and uncached", func(t *testing.T) {
		body := `<puzzle-view>{#svg 'icons/ok.svg'}<span>{#svg 'icons/ok.svg'}</span></puzzle-view>`
		plain, err := compileWithSVGCache(t, body, dir, nil)
		if err != nil {
			t.Fatalf("uncached compile: %v", err)
		}
		cache := NewSVGCache()
		first, err := compileWithSVGCache(t, body, dir, cache)
		if err != nil {
			t.Fatalf("cached compile: %v", err)
		}
		second, err := compileWithSVGCache(t, body, dir, cache)
		if err != nil {
			t.Fatalf("cache-hit compile: %v", err)
		}
		if first.JS != plain.JS || second.JS != plain.JS {
			t.Error("memoized {#svg} resolution changed the generated module")
		}
	})
}

// A loop body root gets a synthetic `key` prepended to its attrs. The memo hands
// the same scanned attr slice to every use site, so resolveOneSVG must copy it —
// otherwise the second use of an icon would inherit the first's injected key.
func TestSVGCacheAttrsAreNotSharedAcrossUseSites(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"icons/heart.svg": `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
	})
	body := `<puzzle-view>
  {#for item in items}
    {#svg 'icons/heart.svg'}
  {/for}
  {#svg 'icons/heart.svg'}
</puzzle-view>`

	cache := NewSVGCache()
	withCache, err := compileWithSVGCache(t, body, dir, cache)
	if err != nil {
		t.Fatalf("cached compile: %v", err)
	}
	plain, err := compileWithSVGCache(t, body, dir, nil)
	if err != nil {
		t.Fatalf("uncached compile: %v", err)
	}
	if withCache.JS != plain.JS {
		t.Errorf("shared attrs leaked between use sites\n--- uncached ---\n%s\n--- cached ---\n%s", plain.JS, withCache.JS)
	}
}

// The memo exists to collapse N use sites onto one read + scan; prove it does,
// and that concurrent callers (esbuild's parallel onLoad) still get one compute.
func TestSVGCacheReadsEachAssetOnce(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"icons/heart.svg": `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
	})
	cache := NewSVGCache()
	full := filepath.Join(dir, "icons", "heart.svg")

	var wg sync.WaitGroup
	got := make([]*ScannedSVG, 24)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i] = cache.Load(full, "app/assets/icons/heart.svg")
		}(i)
	}
	wg.Wait()

	for i, s := range got {
		if s != got[0] {
			t.Fatalf("caller %d got a different *ScannedSVG — the file was scanned more than once", i)
		}
	}
	if got[0].ScanErr != nil || got[0].ReadErr != nil {
		t.Fatalf("unexpected errors: read=%v scan=%v", got[0].ReadErr, got[0].ScanErr)
	}
	if !strings.Contains(got[0].Inner, "<path") {
		t.Errorf("scanned inner markup looks wrong: %q", got[0].Inner)
	}
}
