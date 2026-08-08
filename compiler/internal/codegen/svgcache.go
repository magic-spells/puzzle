package codegen

// svgcache.go — the per-build memo for {#svg} asset files.
//
// Without it, one icon used at N sites across M files costs N reads + N
// ScanSVGFile parses at compile time, plus one more read + parse in the plugin's
// shared-asset module loader — and, in a static build, all of that again in each
// of the three esbuild passes. The file is inert markup that cannot change
// mid-build, so the read + scan is memoized per absolute path.
//
// What is deliberately NOT done: skipping the parse in dedup mode. emitRawSVG
// ignores the scanned attrs/inner there and emits only a factory reference, so it
// is tempting to check existence alone. But "valid" is defined BY the scan — a
// file whose root is <div>, or which holds two roots, must fail the .pzl compile
// with a ParseError positioned inside the SVG (TestInlineSVGMalformedFileReports
// SVGPath), and no cheaper check reproduces that contract. Memoizing makes the
// parse happen once per FILE instead of once per use site, which is the same win
// without weakening the diagnostic.

import (
	"os"
	"sync"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// ScannedSVG is one resolved {#svg} asset: the file's bytes and the result of
// scanning its single <svg> root. Treated as immutable after publication —
// consumers copy Attrs before splicing it into an AST, since the AST owner may
// append to that slice.
type ScannedSVG struct {
	Data  []byte
	Attrs []parser.Attr
	Inner string
	// ReadErr is set when the file could not be read at all. The CALLER turns
	// this into its own positioned message (the .pzl's {#svg} site, or an
	// esbuild message for the virtual module), so the memo never has to know
	// which caller it is serving.
	ReadErr error
	// ScanErr is the malformed-file *parser.ParseError, already positioned
	// inside the SVG by ScanSVGFile.
	ScanErr error
}

// SVGCache memoizes ScannedSVG per (absolute path, diagnostic name) for the
// lifetime of one build. The name is part of the key because it is baked into
// ScanErr's position; in practice every caller derives the same
// "app/assets/<src>" name for a given file, so the second component only ever
// splits the key if that ever stops being true — in which case both entries are
// correct rather than one being subtly wrong.
//
// A nil *SVGCache is the valid "no memo" value: Load then reads and scans
// directly. That is what the standalone pzlc path and the codegen goldens use.
type SVGCache struct {
	mu      sync.Mutex
	entries map[string]*svgEntry
}

type svgEntry struct {
	once sync.Once
	res  *ScannedSVG
}

// NewSVGCache returns an empty memo.
func NewSVGCache() *SVGCache {
	return &SVGCache{entries: map[string]*svgEntry{}}
}

// Load returns the scan for full, reading and parsing it at most once per key.
// It never returns nil.
func (c *SVGCache) Load(full, name string) *ScannedSVG {
	if c == nil {
		return scanSVGPath(full, name)
	}
	key := full + "\x00" + name

	c.mu.Lock()
	e := c.entries[key]
	if e == nil {
		e = &svgEntry{}
		c.entries[key] = e
	}
	c.mu.Unlock()

	e.once.Do(func() { e.res = scanSVGPath(full, name) })
	return e.res
}

// scanSVGPath is the uncached read + scan.
func scanSVGPath(full, name string) *ScannedSVG {
	data, err := os.ReadFile(full)
	if err != nil {
		return &ScannedSVG{ReadErr: err}
	}
	attrs, inner, serr := parser.ScanSVGFile(data, name)
	return &ScannedSVG{Data: data, Attrs: attrs, Inner: inner, ScanErr: serr}
}
