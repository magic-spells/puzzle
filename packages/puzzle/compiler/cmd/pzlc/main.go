// Command pzlc is a minimal single-file .pzl compiler used by the integration
// tests described in constellation/doc/DOC-TESTING.md. It is the same split → parse → codegen
// pipeline the esbuild plugin runs, exposed as a one-shot CLI so an npm script
// can emit compiled modules for the vitest suite:
//
//	pzlc --mode view|layout|component <in.pzl> <out.js>
//
// "view" and "layout" both emit a <puzzle-view> root (codegen.ModeView, D20);
// "component" emits an inline single-root render (codegen.ModeComponent). Parse
// and codegen errors print as positioned "file:line:col: message" and exit 1.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/standalone"
)

func main() {
	mode := flag.String("mode", "view", "emission mode: view, layout, or component")
	assets := flag.String("assets", "", "app/assets dir for {#svg} inlining (default: nearest ancestor 'app'/assets)")
	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, "usage: pzlc --mode view|layout|component [--assets <dir>] <in.pzl> <out.js>")
	}
	flag.Parse()
	if flag.NArg() != 2 {
		flag.Usage()
		os.Exit(2)
	}
	in, out := flag.Arg(0), flag.Arg(1)

	var em codegen.EmissionMode
	switch *mode {
	case "view", "layout":
		em = codegen.ModeView
	case "component":
		em = codegen.ModeComponent
	default:
		fmt.Fprintf(os.Stderr, "pzlc: invalid --mode %q (expected view, layout, or component)\n", *mode)
		os.Exit(2)
	}

	src, err := os.ReadFile(in)
	if err != nil {
		fmt.Fprintf(os.Stderr, "pzlc: %v\n", err)
		os.Exit(1)
	}
	assetsDir := *assets
	if assetsDir == "" {
		assetsDir = standalone.AssetsDirFor(in)
	}
	// the shared standalone pipeline (split, parse, codegen, and type stripping
	// for a lang="ts" script) — the same one `puzzle compile` runs.
	res, err := standalone.Compile(in, src, em, assetsDir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Non-fatal codegen diagnostics (e.g. a template referencing a <script>
	// import) print to stderr; the compiled module is still emitted.
	for _, w := range res.Warnings {
		fmt.Fprintf(os.Stderr, "%s:%d:%d: warning: %s\n", w.File, w.Line, w.Col, w.Message)
	}
	code := res.JS
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "pzlc: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(out, []byte(code), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "pzlc: %v\n", err)
		os.Exit(1)
	}
}
