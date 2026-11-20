package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// compileAs compiles one .pzl source in the given mode and filename, failing
// the test on a compile error.
func compileAs(t *testing.T, src, filename string, mode EmissionMode) *Result {
	t.Helper()
	sec, err := parser.SplitSections(src, filename)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: filename, Mode: mode})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res
}

// outletWarnings keeps the D199 warnings out of a result's warning list.
func outletWarnings(res *Result) []Warning {
	var out []Warning
	for _, w := range res.Warnings {
		if strings.Contains(w.Message, "<Outlet/> in a component") {
			out = append(out, w)
		}
	}
	return out
}

// an <Outlet/> in a component compiles, with one positioned warning per
// marker that steers to <Children/>: the router never fills a component.
func TestOutletInComponentWarns(t *testing.T) {
	src := "<puzzle-view>\n  <div>\n    {#if open}<Outlet/>{:else}<Outlet><p>none</p></Outlet>{/if}\n  </div>\n</puzzle-view>\n"
	res := compileAs(t, src, "Panel.pzl", ModeComponent)
	ws := outletWarnings(res)
	if len(ws) != 2 {
		t.Fatalf("want 2 outlet warnings, got %#v", res.Warnings)
	}
	if ws[0].Line != 3 || ws[0].Col != 15 {
		t.Errorf("first warning at %d:%d, want 3:15", ws[0].Line, ws[0].Col)
	}
	if !strings.Contains(ws[0].Message, "spell it <Children/> (D199)") {
		t.Errorf("message = %q", ws[0].Message)
	}
}

// in a layout or a view, <Outlet/> is the router outlet: no warning.
func TestOutletInViewDoesNotWarn(t *testing.T) {
	res := compileAs(t, "<puzzle-view>\n  <main><Outlet/></main>\n</puzzle-view>\n", "Default.pzl", ModeView)
	if ws := outletWarnings(res); len(ws) != 0 {
		t.Errorf("want no outlet warning in a view, got %#v", ws)
	}
}

// <Outlet/> and <Children/> fill the same default position, so they emit the
// same code: the rename changes no runtime bytes.
func TestOutletEmitsTheSameCodeAsChildren(t *testing.T) {
	outlet := compileAs(t, "<puzzle-view>\n  <main><Outlet/></main>\n</puzzle-view>\n", "A.pzl", ModeView)
	children := compileAs(t, "<puzzle-view>\n  <main><Children/></main>\n</puzzle-view>\n", "A.pzl", ModeView)
	if outlet.JS != children.JS {
		t.Errorf("<Outlet/> and <Children/> emit different code\n--- outlet ---\n%s\n--- children ---\n%s", outlet.JS, children.JS)
	}
}

// a component file named Outlet.pzl could never be written as a tag, so it is
// a compile error naming a rename.
func TestOutletFilenameIsReserved(t *testing.T) {
	sec, err := parser.SplitSections("<puzzle-view><p>x</p></puzzle-view>\n", "app/components/Outlet.pzl")
	if err != nil {
		t.Fatal(err)
	}
	_, err = Compile(sec, Options{Filename: "app/components/Outlet.pzl", Mode: ModeComponent})
	if err == nil || !strings.Contains(err.Error(), "Outlet is a reserved built-in tag") {
		t.Fatalf("want the reserved-name error, got %v", err)
	}
}
