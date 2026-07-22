package codegen

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// inlinesvg_test.go — codegen coverage for {#svg} resolution (v1.14, D46): file
// root attrs lifted onto the vnode, raw inner correctly escaped into the JS
// string literal, path-shape/missing/no-assets rejections with positions, and
// the InlinedFiles list (dedupe + sort, populated on error).

// writeAssets lays out an assets dir with the given relative files.
func writeAssets(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// compileTemplate wraps a template body in a minimal scriptless-ok .pzl and
// compiles it as a view with the given assets dir.
func compileTemplate(t *testing.T, body, assetsDir string) (*Result, error) {
	t.Helper()
	src := body + "\n<scripts>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</scripts>\n"
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	return Compile(sec, Options{Filename: "T.pzl", Mode: ModeView, AssetsDir: assetsDir})
}

func TestInlineSVGAttrsAndInner(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"icons/heart.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M1 2"/></svg>`,
	})
	res, err := compileTemplate(t, `<puzzle-view>{#svg 'icons/heart.svg'}</puzzle-view>`, dir)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	// Root attrs lifted onto the emitted <svg> vnode.
	for _, want := range []string{
		"new ViewNode('svg', {",
		"xmlns: 'http://www.w3.org/2000/svg',",
		"viewBox: '0 0 24 24',",
		"fill: 'currentColor',",
		`, '<path d="M1 2"/>')`, // inner as a string literal (island seed)
	} {
		if !strings.Contains(res.JS, want) {
			t.Errorf("generated JS missing %q\n%s", want, res.JS)
		}
	}
	// InlinedFiles carries the one resolved absolute path.
	full := filepath.Join(dir, "icons", "heart.svg")
	if len(res.InlinedFiles) != 1 || res.InlinedFiles[0] != full {
		t.Errorf("InlinedFiles = %v, want [%s]", res.InlinedFiles, full)
	}
}

func TestInlineSVGRootAttrsStayLiteral(t *testing.T) {
	svg := `<svg data-quoted="{foo}" data-bare={foo}><path/></svg>`
	dir := writeAssets(t, map[string]string{"literal.svg": svg})

	inline, err := compileTemplate(t, `<puzzle-view>{#svg 'literal.svg'}</puzzle-view>`, dir)
	if err != nil {
		t.Fatalf("inline compile: %v", err)
	}
	for _, want := range []string{"'data-quoted': '{foo}'", "'data-bare': '{foo}'"} {
		if !strings.Contains(inline.JS, want) {
			t.Errorf("inline output missing %q\n%s", want, inline.JS)
		}
	}
	if strings.Contains(inline.JS, "__d.foo") {
		t.Errorf("inline SVG root attrs must not read render data:\n%s", inline.JS)
	}

	// Deduplicated builds serve SVGAssetModule through the plugin. Its shared
	// module has no render-data scope, so this is the import-time regression path.
	shared, err := SVGAssetModule([]byte(svg), "app/assets/literal.svg", "@magic-spells/puzzle")
	if err != nil {
		t.Fatalf("deduplicated module: %v", err)
	}
	for _, want := range []string{"'data-quoted': '{foo}'", "'data-bare': '{foo}'"} {
		if !strings.Contains(shared, want) {
			t.Errorf("deduplicated module missing %q\n%s", want, shared)
		}
	}
	if strings.Contains(shared, "__d.foo") {
		t.Errorf("deduplicated SVG module must not read render data:\n%s", shared)
	}
}

func TestInlineSVGEscaping(t *testing.T) {
	// Inner markup with a backslash, single quotes, a newline, and </script>-ish
	// content — all must survive into a valid single-quoted JS string literal.
	inner := "\n<path d='M1\\2'/>\n<desc>a</script>b</desc>\n"
	dir := writeAssets(t, map[string]string{
		"tricky.svg": "<svg>" + inner + "</svg>",
	})
	res, err := compileTemplate(t, `<puzzle-view>{#svg 'tricky.svg'}</puzzle-view>`, dir)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	for _, want := range []string{
		`\\`,          // escaped backslash
		`\'`,          // escaped single quote
		`\n`,          // escaped newline
		`</script>`,   // passed through verbatim (JS module string, not HTML)
		"<desc>a</sc", // sanity: desc present
	} {
		if !strings.Contains(res.JS, want) {
			t.Errorf("generated JS missing escaped sequence %q\n%s", want, res.JS)
		}
	}
	// The raw newline byte must NOT survive inside the string literal.
	if strings.Contains(res.JS, "<path d='M1\\2'/>\n<desc>") {
		t.Errorf("raw newline leaked into JS string literal:\n%s", res.JS)
	}
}

func TestInlineSVGPathShapeRejected(t *testing.T) {
	dir := writeAssets(t, map[string]string{"ok.svg": `<svg></svg>`})
	bad := []string{"/abs/x.svg", "./x.svg", "../x.svg", "a/../../b.svg"}
	for _, p := range bad {
		t.Run(p, func(t *testing.T) {
			res, err := compileTemplate(t, `<puzzle-view>{#svg '`+p+`'}</puzzle-view>`, dir)
			if err == nil {
				t.Fatalf("expected error for path %q", p)
			}
			if !strings.Contains(err.Error(), `"./" and "../" are not supported`) {
				t.Errorf("error %q missing path-shape message", err.Error())
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("err: got %T, want *parser.ParseError", err)
			}
			if pe.File != "T.pzl" || pe.Line != 1 {
				t.Errorf("position: got %s:%d, want T.pzl:1", pe.File, pe.Line)
			}
			// No file was read → nothing recorded for a shape rejection.
			if len(res.InlinedFiles) != 0 {
				t.Errorf("InlinedFiles = %v, want empty for shape rejection", res.InlinedFiles)
			}
		})
	}
}

// TestInlineSVGBackslashRejected proves a backslash anywhere in the path is a
// positioned compile error (platform-independent traversal posture), while a
// valid nested forward-slash path still works.
func TestInlineSVGBackslashRejected(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"ok.svg":          `<svg></svg>`,
		"icons/heart.svg": `<svg></svg>`,
	})
	bad := []string{`icons\heart.svg`, `..\x.svg`, `\abs\x.svg`, `a\b.svg`}
	for _, p := range bad {
		t.Run(p, func(t *testing.T) {
			res, err := compileTemplate(t, `<puzzle-view>{#svg '`+p+`'}</puzzle-view>`, dir)
			if err == nil {
				t.Fatalf("expected error for backslash path %q", p)
			}
			if !strings.Contains(err.Error(), "backslashes are not allowed") {
				t.Errorf("error %q missing backslash message", err.Error())
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("err: got %T, want *parser.ParseError", err)
			}
			if pe.File != "T.pzl" || pe.Line != 1 {
				t.Errorf("position: got %s:%d, want T.pzl:1", pe.File, pe.Line)
			}
			// A shape rejection reads no file → nothing recorded.
			if len(res.InlinedFiles) != 0 {
				t.Errorf("InlinedFiles = %v, want empty for shape rejection", res.InlinedFiles)
			}
		})
	}

	// A valid nested forward-slash path keeps working.
	if _, err := compileTemplate(t, `<puzzle-view>{#svg 'icons/heart.svg'}</puzzle-view>`, dir); err != nil {
		t.Errorf("valid forward-slash path should compile: %v", err)
	}
}

func TestInlineSVGMissingFile(t *testing.T) {
	dir := writeAssets(t, map[string]string{"ok.svg": `<svg></svg>`})
	res, err := compileTemplate(t, `<puzzle-view>{#svg 'icons/nope.svg'}</puzzle-view>`, dir)
	if err == nil {
		t.Fatal("expected a missing-file error")
	}
	full := filepath.Join(dir, "icons", "nope.svg")
	if !strings.Contains(err.Error(), "no such file at "+full) {
		t.Errorf("error %q missing 'no such file at %s'", err.Error(), full)
	}
	if !strings.Contains(err.Error(), "{#svg} paths resolve from app/assets/") {
		t.Errorf("error %q missing the app/assets hint", err.Error())
	}
	pe, ok := err.(*parser.ParseError)
	if !ok || pe.File != "T.pzl" {
		t.Fatalf("expected a *parser.ParseError at T.pzl, got %T %v", err, err)
	}
	// Populated on error: the attempted path is recorded for WatchFiles recovery.
	if len(res.InlinedFiles) != 1 || res.InlinedFiles[0] != full {
		t.Errorf("InlinedFiles = %v, want [%s] even on error", res.InlinedFiles, full)
	}
}

func TestInlineSVGNoAssetsDir(t *testing.T) {
	res, err := compileTemplate(t, `<puzzle-view>{#svg 'icons/heart.svg'}</puzzle-view>`, "")
	if err == nil {
		t.Fatal("expected a no-assets-dir error")
	}
	if !strings.Contains(err.Error(), "this project has no app/assets/ directory") {
		t.Errorf("error %q missing no-assets-dir message", err.Error())
	}
	if len(res.InlinedFiles) != 0 {
		t.Errorf("InlinedFiles = %v, want empty (nothing resolvable)", res.InlinedFiles)
	}
}

func TestInlineSVGMalformedFileReportsSVGPath(t *testing.T) {
	dir := writeAssets(t, map[string]string{"icons/bad.svg": `<div><span/></div>`})
	_, err := compileTemplate(t, `<puzzle-view>{#svg 'icons/bad.svg'}</puzzle-view>`, dir)
	if err == nil {
		t.Fatal("expected a malformed-svg error")
	}
	pe, ok := err.(*parser.ParseError)
	if !ok {
		t.Fatalf("err: got %T, want *parser.ParseError", err)
	}
	// The error points INSIDE the svg file (app-root-relative name), not the .pzl.
	if pe.File != "app/assets/icons/bad.svg" {
		t.Errorf("File: got %q, want app/assets/icons/bad.svg", pe.File)
	}
	if !strings.Contains(pe.Message, "root element is <div>, not <svg>") {
		t.Errorf("message %q should name the actual root tag", pe.Message)
	}
}

func TestInlineSVGDedupeAndSort(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"b.svg": `<svg></svg>`,
		"a.svg": `<svg></svg>`,
	})
	// Reference b, then a, then b again — three uses, two distinct files.
	body := `<puzzle-view>{#svg 'b.svg'}<span>{#svg 'a.svg'}</span>{#svg 'b.svg'}</puzzle-view>`
	res, err := compileTemplate(t, body, dir)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	want := []string{filepath.Join(dir, "a.svg"), filepath.Join(dir, "b.svg")}
	if len(res.InlinedFiles) != 2 || res.InlinedFiles[0] != want[0] || res.InlinedFiles[1] != want[1] {
		t.Errorf("InlinedFiles = %v, want deduped+sorted %v", res.InlinedFiles, want)
	}
}

func TestInlineSVGInSkeletonAndFor(t *testing.T) {
	dir := writeAssets(t, map[string]string{
		"icons/heart.svg": `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
	})
	body := `<puzzle-view>
  {#for item in items}
    <li>{#svg 'icons/heart.svg'}</li>
  {/for}
</puzzle-view>

<puzzle-skeleton>
  <div>{#svg 'icons/heart.svg'}</div>
</puzzle-skeleton>`
	res, err := compileTemplate(t, body, dir)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	// Both render() (via the {#for} .map) and renderSkeleton() carry the svg vnode.
	if !strings.Contains(res.JS, ".prototype.renderSkeleton") {
		t.Fatalf("expected a renderSkeleton tail:\n%s", res.JS)
	}
	if n := strings.Count(res.JS, `new ViewNode('svg', {`); n != 2 {
		t.Errorf("expected 2 emitted <svg> vnodes (for + skeleton), got %d\n%s", n, res.JS)
	}
	// Keyed under {#for}: the svg's parent <li> gets key: ViewNode.keyOf(item)
	// (pk-aware auto-key, D58), and dedupe keeps one entry despite two uses.
	if !strings.Contains(res.JS, "key: ViewNode.keyOf(item)") {
		t.Errorf("expected keyed {#for} body:\n%s", res.JS)
	}
	if len(res.InlinedFiles) != 1 {
		t.Errorf("InlinedFiles = %v, want a single deduped entry", res.InlinedFiles)
	}
}
