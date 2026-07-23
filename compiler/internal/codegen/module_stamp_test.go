package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// module_stamp_test.go — the D81 `Class.__pzlModule = "<path>"` stamp the
// static-pages build reads to map a route's view/layout classes back to their
// source .pzl. It is emitted immediately after the render tail; ModulePath
// (threaded by the esbuild plugin) is the stamped value, and its absence
// (standalone pzlc / goldens) falls back to the plain basename of Filename.

func compileStamp(t *testing.T, src string, opts Options) string {
	t.Helper()
	sec, err := parser.SplitSections(src, opts.Filename)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, opts)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res.JS
}

const stampSrc = `<puzzle-view>
  <h1>Home</h1>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</scripts>
`

// TestModuleStampUsesModulePath: when the plugin supplies an app-relative
// ModulePath, that exact POSIX path is stamped (not Filename, not the basename).
func TestModuleStampUsesModulePath(t *testing.T) {
	got := compileStamp(t, stampSrc, Options{
		Filename:   "app/views/Home.pzl",
		Mode:       ModeView,
		ModulePath: "app/views/Home.pzl",
	})
	if !strings.Contains(got, `Home.__pzlModule = 'app/views/Home.pzl';`) {
		t.Errorf("expected app-relative module stamp, got:\n%s", got)
	}
}

// TestModuleStampFallsBackToBasename: with no ModulePath (pzlc single-file /
// goldens), the stamp is the plain basename of Filename, even for a nested path.
func TestModuleStampFallsBackToBasename(t *testing.T) {
	got := compileStamp(t, stampSrc, Options{
		Filename: "some/deep/dir/Home.pzl",
		Mode:     ModeView,
	})
	if !strings.Contains(got, `Home.__pzlModule = 'Home.pzl';`) {
		t.Errorf("expected basename module stamp, got:\n%s", got)
	}
	if strings.Contains(got, "some/deep/dir") {
		t.Errorf("basename fallback must not leak the directory path:\n%s", got)
	}
}

// TestModuleStampFollowsRender: the stamp is emitted immediately after the
// render function's closing `};`, before any skeleton tail.
func TestModuleStampFollowsRender(t *testing.T) {
	got := compileStamp(t, stampSrc, Options{Filename: "Home.pzl", Mode: ModeView})
	renderIdx := strings.Index(got, "Home.prototype.render = function")
	stampIdx := strings.Index(got, "Home.__pzlModule = ")
	if renderIdx < 0 || stampIdx < 0 {
		t.Fatalf("missing render tail or module stamp:\n%s", got)
	}
	if stampIdx < renderIdx {
		t.Errorf("module stamp must follow the render tail, not precede it:\n%s", got)
	}
}
