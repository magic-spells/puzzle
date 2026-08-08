package plugin

// cache.go — the BUILD-SCOPED .pzl transform memo.
//
// A one-shot static build registers three separate Plugin instances, one per
// esbuild pass (browser app.js, the node prerender bundle, the per-page browser
// bundles). Each pass ran the full onLoad body for every .pzl it reached:
// ReadFile → SplitSections → codegen.Compile, where Compile itself parses the
// template and (when present) the skeleton. Per file per static build that is
// three reads, six SplitSections/ParseTemplate passes and three codegen runs of
// which two produce bytes that are discarded (the prerender and per-page passes
// keep only the JS esbuild bundles; their CSS is thrown away).
//
// Nothing in the transform varies by pass. The generated module is a pure
// function of (app root, file path, file bytes): the plugin's only other inputs
// are the app root — fixed for the whole build — and SVGDedup, which the plugin
// path always sets. Platform, dev/prod, defines, minification, and splitting all
// live in the esbuild BuildOptions and are applied AFTER onLoad returns, to the
// same input bytes. So one entry per file serves all three passes, and the
// per-pass work reduces to re-registering the file's <style> block into that
// pass's own CSS collector.
//
// Scope is exactly one Build call. There is no cross-build invalidation because
// there is no cross-build lifetime: WatchBuilder (SPA dev) never attaches a
// cache, so its incremental rebuilds keep re-running onLoad exactly as before
// and esbuild's own onLoad result cache stays the only memo on that path.

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

// pzlResult is everything one .pzl transform produces. It is written once, then
// read concurrently by every pass, so it must be treated as immutable after
// publication — callers copy the slices they hand to esbuild.
type pzlResult struct {
	// name is the app-relative filename used for diagnostics, ModeForPath, the
	// module stamp, and the scoped-style ScopeID.
	name string
	// js is the generated module (empty when errs is non-empty: a file that
	// fails to compile emits no output).
	js string
	// loader is JS or TS per <script lang>.
	loader api.Loader
	// hasStyles / cssBody carry the <style> block exactly as the collector wants
	// it — already @scope-wrapped when the block was scoped. Every pass applies
	// this to its OWN css map; the memo never holds a pass's collector state.
	hasStyles bool
	cssBody   string
	// watchFiles are the {#svg} paths codegen recorded (present even on failure,
	// so esbuild can invalidate a cached failure once a missing asset appears).
	watchFiles []string
	// errs are the positioned esbuild messages for a failed split/compile.
	errs []api.Message
	// warnings are codegen's out-of-band diagnostics. They are printed by the
	// pass that MISSES — i.e. once per build rather than once per pass, which is
	// what a user reading a build log expects: three identical copies of the same
	// warning is noise that says nothing extra.
	warnings []codegen.Warning
}

// CompileCache memoizes .pzl transforms for the lifetime of one build.
//
// esbuild runs onLoad concurrently, and the three passes overlap only in time,
// not in goroutines — but the same file can still be requested concurrently
// within one pass. Each key gets its own sync.Once so a file is transformed
// exactly once no matter how many callers race for it, and the loser waits for
// the winner rather than duplicating the work.
type CompileCache struct {
	mu      sync.Mutex
	entries map[string]*cacheEntry

	// svg memoizes {#svg} asset reads + scans for the same build. It is shared
	// with codegen (through Options.SVGCache) AND with the shared-asset virtual
	// module loader, so an icon used at fifty sites across three passes is read
	// and parsed once rather than 150+ times.
	svg *codegen.SVGCache
}

type cacheEntry struct {
	once sync.Once
	res  pzlResult
}

// NewCompileCache returns an empty cache. A nil *CompileCache is a valid
// "no caching" value — every method is nil-safe — which is what the watch/dev
// path passes.
func NewCompileCache() *CompileCache {
	return &CompileCache{entries: map[string]*cacheEntry{}, svg: codegen.NewSVGCache()}
}

// svgCache returns the build's {#svg} memo, or nil when there is no cache (the
// watch/dev path), which codegen and the asset loader both treat as "no memo".
func (c *CompileCache) svgCache() *codegen.SVGCache {
	if c == nil {
		return nil
	}
	return c.svg
}

// SetCompileCache attaches a build-scoped memo shared with the other passes of
// the same build. Left unset (the WatchBuilder path), every onLoad transforms
// from source as before.
func (p *Plugin) SetCompileCache(c *CompileCache) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cache = c
}

// load returns the transform for (path, src), computing it with compute at most
// once per distinct key. The key is the app root, the resolved file path, and a
// content hash of the bytes: the root because it decides every app-relative name
// baked into the output (diagnostics, the module stamp, ScopeID), and the hash
// so a file rewritten mid-build cannot serve a result for bytes that no longer
// exist. A nil cache always computes.
func (c *CompileCache) load(appRoot, path string, src []byte, compute func() pzlResult) pzlResult {
	if c == nil {
		return compute()
	}
	sum := sha256.Sum256(src)
	key := appRoot + "\x00" + path + "\x00" + hex.EncodeToString(sum[:])

	c.mu.Lock()
	e := c.entries[key]
	if e == nil {
		e = &cacheEntry{}
		c.entries[key] = e
	}
	c.mu.Unlock()

	e.once.Do(func() { e.res = compute() })
	return e.res
}
