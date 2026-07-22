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

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
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
	sec, err := parser.SplitSections(string(src), in)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	assetsDir := *assets
	if assetsDir == "" {
		assetsDir = defaultAssetsDir(in)
	}
	res, err := codegen.Compile(sec, codegen.Options{Filename: in, Mode: em, AssetsDir: assetsDir})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// Non-fatal codegen diagnostics (e.g. a template referencing a <scripts>
	// import) print to stderr; the compiled module is still emitted.
	for _, w := range res.Warnings {
		fmt.Fprintf(os.Stderr, "%s:%d:%d: warning: %s\n", w.File, w.Line, w.Col, w.Message)
	}
	code := res.JS
	// TypeScript scripts (v1.22, D54): the bundler path lets esbuild strip types
	// via LoaderTS, but pzlc emits a standalone module with no bundler, so strip
	// types here with esbuild's Transform API. The result stays runnable ESM JS.
	if sec.ScriptsLang == "ts" {
		tr := api.Transform(code, api.TransformOptions{
			Loader:     api.LoaderTS,
			Format:     api.FormatESModule,
			Sourcefile: in,
		})
		if len(tr.Errors) > 0 {
			for _, m := range tr.Errors {
				if m.Location != nil {
					fmt.Fprintf(os.Stderr, "pzlc: %s:%d:%d: %s\n", m.Location.File, m.Location.Line, m.Location.Column, m.Text)
				} else {
					fmt.Fprintf(os.Stderr, "pzlc: %s\n", m.Text)
				}
			}
			os.Exit(1)
		}
		code = string(tr.Code)
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "pzlc: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(out, []byte(code), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "pzlc: %v\n", err)
		os.Exit(1)
	}
}

// defaultAssetsDir finds the {#svg} assets root for input by walking up to the
// nearest ancestor directory named "app" and returning <app>/assets; "" if none
// (a project with no app/ dir — {#svg} then errors with a clear message).
func defaultAssetsDir(input string) string {
	abs, err := filepath.Abs(input)
	if err != nil {
		return ""
	}
	dir := filepath.Dir(abs)
	for {
		if filepath.Base(dir) == "app" {
			return filepath.Join(dir, "assets")
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
