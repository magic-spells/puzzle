// Package standalone compiles one .pzl file into a self-contained ES module
// with no bundler around it. It is the split → parse → codegen pipeline the
// esbuild plugin runs, minus the bundle-only parts: {#svg} assets are inlined
// rather than deduplicated into virtual modules, no module stamp is written,
// and a lang="ts" script has its types stripped here (the bundler path leaves
// that to esbuild's TS loader).
//
// Two callers share it: the repo's pzlc tool, which writes compiled fixtures
// for the framework's own Vitest suite, and `puzzle compile`, which the
// @magic-spells/puzzle/vitest plugin runs so an app's own tests can import
// .pzl files (D194).
package standalone

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// Result is one compiled module plus the non-fatal codegen diagnostics.
type Result struct {
	// JS is the runnable ES module source.
	JS string
	// Warnings are advisories (for example a template expression naming a
	// script import); the module is still usable.
	Warnings []codegen.Warning
}

// Compile turns src, the contents of the .pzl file at filename, into a
// standalone module in the given emission mode. filename is used for
// positioned diagnostics and for the scoped-styles id; assetsDir is the
// {#svg} root (see AssetsDirFor). A split, parse or codegen error is returned
// as-is, so its "file:line:col: message" position survives.
func Compile(filename string, src []byte, mode codegen.EmissionMode, assetsDir string) (*Result, error) {
	sec, err := parser.SplitSections(string(src), filename)
	if err != nil {
		return nil, err
	}
	res, err := codegen.Compile(sec, codegen.Options{Filename: filename, Mode: mode, AssetsDir: assetsDir})
	if err != nil {
		return nil, err
	}
	code := res.JS
	// typescript scripts (v1.22, D54): with no bundler to strip the types, run
	// esbuild's transform api here so the result is plain runnable esm.
	if sec.ScriptsLang == "ts" {
		tr := api.Transform(code, api.TransformOptions{
			Loader:     api.LoaderTS,
			Format:     api.FormatESModule,
			Sourcefile: filename,
		})
		if len(tr.Errors) > 0 {
			msgs := make([]string, 0, len(tr.Errors))
			for _, m := range tr.Errors {
				if m.Location != nil {
					msgs = append(msgs, fmt.Sprintf("%s:%d:%d: %s", m.Location.File, m.Location.Line, m.Location.Column, m.Text))
				} else {
					msgs = append(msgs, m.Text)
				}
			}
			return nil, fmt.Errorf("%s", strings.Join(msgs, "\n"))
		}
		code = string(tr.Code)
	}
	return &Result{JS: code, Warnings: res.Warnings}, nil
}

// AssetsDirFor finds the {#svg} assets root for a .pzl file by walking up to
// the nearest ancestor directory named "app" and returning <app>/assets. It
// returns "" when there is none, and {#svg} then fails with its own clear
// "no app/assets/ directory" error.
func AssetsDirFor(path string) string {
	abs, err := filepath.Abs(path)
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
