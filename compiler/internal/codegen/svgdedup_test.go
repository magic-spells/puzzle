package codegen

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// compileDedup compiles a .pzl at ModeView with SVGDedup on (the esbuild-plugin
// emission).
func compileDedup(t *testing.T, path string) string {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	sec, err := parser.SplitSections(string(src), filepath.Base(path))
	if err != nil {
		t.Fatalf("split %s: %v", path, err)
	}
	res, err := Compile(sec, Options{
		Filename:  filepath.Base(path),
		Mode:      ModeView,
		AssetsDir: "testdata/assets",
		SVGDedup:  true,
	})
	if err != nil {
		t.Fatalf("compile %s: %v", path, err)
	}
	return res.JS
}

// TestSVGDedupEmission: inline_svg.pzl references icons/heart.svg at THREE use
// sites (span, {#for} body, skeleton). In dedup mode all three collapse onto ONE
// shared-module import + three factory calls, and the icon markup is NOT inlined
// at any site (it lives in the shared module the plugin serves). This is the
// codegen half of the {#svg} dedup optimization (D46 amendment).
func TestSVGDedupEmission(t *testing.T) {
	js := compileDedup(t, "testdata/inline_svg.pzl")

	// Exactly one shared-module import for the asset.
	imp := "import __svg_0 from '" + SVGAssetSpecifierPrefix + "icons/heart.svg';"
	if n := strings.Count(js, imp); n != 1 {
		t.Errorf("expected exactly one shared-module import, got %d\n%s", n, js)
	}
	// No second identifier: a single unique asset means a single import binding.
	if strings.Contains(js, "__svg_1") {
		t.Errorf("unexpected second svg import binding for a single unique asset:\n%s", js)
	}

	// Three keyless references — span, {#for}-body <li> child, and skeleton (the
	// list's key rides on the <li> root, not the icon inside it).
	if n := strings.Count(js, "__svg_0("); n != 3 {
		t.Errorf("expected 3 factory references, got %d\n%s", n, js)
	}
	if strings.Count(js, "__svg_0()") != 3 {
		t.Errorf("expected 3 keyless references:\n%s", js)
	}

	// The icon markup must NOT be inlined anywhere: no <svg> vnode literal, no
	// verbatim path data at the use sites.
	if strings.Contains(js, "new ViewNode('svg'") {
		t.Errorf("dedup emission must not inline the <svg> vnode:\n%s", js)
	}
	if strings.Contains(js, "M12 21l-1.45") {
		t.Errorf("dedup emission must not inline the icon's inner markup:\n%s", js)
	}
}

// TestSVGDedupForBodyRootKey: when a bare {#svg} is the SOLE root of a {#for}
// body, the synthetic reconciliation key is threaded through as the factory
// argument so keyed list updates still work in dedup mode.
func TestSVGDedupForBodyRootKey(t *testing.T) {
	src := `<puzzle-view class="icons">
  {#for item in items}{#svg 'icons/heart.svg'}{/for}
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Icons extends PuzzleView { data() { return { items: [] }; } }
</scripts>
`
	sec, err := parser.SplitSections(src, "Icons.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "Icons.pzl", Mode: ModeView, AssetsDir: "testdata/assets", SVGDedup: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if !strings.Contains(res.JS, "__svg_0(ViewNode.keyOf(item))") {
		t.Errorf("{#svg} as {#for}-body root must thread the key as the factory arg:\n%s", res.JS)
	}
}

// TestSVGDedupOffInlines: with SVGDedup off (pzlc standalone, no bundler), the
// same fixture inlines the markup at every site and emits no virtual import —
// a self-contained module. Guards the default (golden) behavior.
func TestSVGDedupOffInlines(t *testing.T) {
	js := compileFile(t, "testdata/inline_svg.pzl", ModeView)
	if strings.Contains(js, SVGAssetSpecifierPrefix) {
		t.Errorf("standalone (inline) emission must not import a virtual svg module:\n%s", js)
	}
	if !strings.Contains(js, "new ViewNode('svg'") {
		t.Errorf("standalone emission must inline the <svg> vnode:\n%s", js)
	}
}

// TestSVGAssetModule: the shared module the plugin serves builds a factory that
// produces the SAME vnode shape as the inline path — `new ViewNode('svg', …)`
// with the file's static attrs and its inner markup as string children — plus a
// key passthrough for {#for} reconciliation.
func TestSVGAssetModule(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="ABC"/></svg>`
	mod, err := SVGAssetModule([]byte(svg), "app/assets/icons/heart.svg", "@magic-spells/puzzle")
	if err != nil {
		t.Fatalf("SVGAssetModule: %v", err)
	}
	for _, want := range []string{
		"import { ViewNode } from '@magic-spells/puzzle';",
		"const __a = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 24 24', fill: 'currentColor' };",
		`const __s = '<path d="ABC"/>';`,
		"export default function (key) {",
		"new ViewNode('svg', key === undefined ? __a : { ...__a, key }, __s);",
	} {
		if !strings.Contains(mod, want) {
			t.Errorf("shared module missing %q\n%s", want, mod)
		}
	}
}
