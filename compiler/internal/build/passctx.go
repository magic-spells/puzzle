package build

import (
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// passContext is the state ONE build.Build call shares across its esbuild
// passes. A static build runs three of them — the browser app.js bundle, the
// node-platform prerender bundle, and the per-page browser bundles — over the
// same source tree, and each needs its own *plugin.Plugin (the CSS collector is
// per-pass, and the prerender/per-page passes deliberately discard theirs).
// Everything else is a property of the SOURCES, not of the pass, so it is
// computed once here and handed to every plugin instance.
//
// Scope is exactly one Build call: it is created at the top of Build and dies
// with it. The long-lived dev/watch builder (WatchBuilder) deliberately does not
// use it — its plugin is reused across rebuilds and must re-derive source facts
// when files change.
type passContext struct {
	// usage is the project-wide tree-shaking scan (formatter manifest seeds + the
	// D85 flip bit). Immutable once built; every pass gets the same value, so the
	// esbuild Define map and the virtual formatter manifest are identical across
	// passes by construction rather than by three walks agreeing.
	usage plugin.Usage
}

// newPassContext runs the once-per-build source scans.
func newPassContext(absRoot string) (*passContext, error) {
	usage, err := scanUsageOnce(absRoot)
	if err != nil {
		return nil, err
	}
	return &passContext{usage: usage}, nil
}

// plugin builds a fresh *plugin.Plugin for one esbuild pass, pre-loaded with
// the shared per-build state. Callers must use this rather than plugin.New so a
// new pass can never silently start with an unscanned (all-false) Usage.
func (pc *passContext) plugin(absRoot string) *plugin.Plugin {
	pl := plugin.New(absRoot)
	pl.SetUsage(pc.usage)
	return pl
}
