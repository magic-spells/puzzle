package parser

import (
	"strings"
	"testing"
)

// inlinesvg_test.go — parser coverage for `{#svg 'path'}` (v1.14, D46): the void
// block header, its rejections, the stray-{/svg} guard, and ScanSVGFile lifting
// a file's <svg> root + verbatim (inert) inner markup.

// findInlineSVG returns the first *InlineSVG among nodes (recursing one level
// through element children), or nil.
func findInlineSVG(nodes []Node) *InlineSVG {
	for _, n := range nodes {
		switch t := n.(type) {
		case *InlineSVG:
			return t
		case *Element:
			if got := findInlineSVG(t.Children); got != nil {
				return got
			}
		}
	}
	return nil
}

func TestParseSvgHeader(t *testing.T) {
	t.Run("single quotes", func(t *testing.T) {
		root := parseContent(t, `{#svg 'icons/heart.svg'}`)
		svg := findInlineSVG(root.Children)
		if svg == nil {
			t.Fatalf("no InlineSVG node parsed")
		}
		if svg.Src != "icons/heart.svg" {
			t.Errorf("src: got %q, want %q", svg.Src, "icons/heart.svg")
		}
	})

	t.Run("double quotes", func(t *testing.T) {
		root := parseContent(t, `{#svg "icons/star.svg"}`)
		svg := findInlineSVG(root.Children)
		if svg == nil || svg.Src != "icons/star.svg" {
			t.Fatalf("double-quoted path not parsed: %#v", svg)
		}
	})

	t.Run("void tag among siblings (no closer)", func(t *testing.T) {
		root := parseContent(t, `<span>a</span>{#svg 'x.svg'}<span>b</span>`)
		kids := elementChildren(root.Children)
		if len(kids) != 3 {
			t.Fatalf("expected 3 siblings, got %d: %#v", len(kids), kids)
		}
		if _, ok := kids[1].(*InlineSVG); !ok {
			t.Fatalf("middle sibling: got %T, want *InlineSVG", kids[1])
		}
	})

	t.Run("void tag inside an element (no closer needed)", func(t *testing.T) {
		root := parseContent(t, `<span class="inline-block size-5">{#svg 'icons/heart.svg'}</span>`)
		svg := findInlineSVG(root.Children)
		if svg == nil {
			t.Fatalf("InlineSVG inside <span> not parsed")
		}
	})
}

func TestParseSvgHeaderErrors(t *testing.T) {
	tests := []struct {
		name       string
		content    string
		wantSubstr string
	}{
		{"missing path", `{#svg}`, "{#svg} requires a quoted path"},
		{"missing path with space", `{#svg }`, "{#svg} requires a quoted path"},
		{"unquoted path", `{#svg iconPath}`, "{#svg} requires a quoted path"},
		{"empty single-quoted path", `{#svg ''}`, "{#svg} requires a quoted path"},
		{"empty double-quoted path", `{#svg ""}`, "{#svg} requires a quoted path"},
		{"trailing content", `{#svg 'a.svg' class="x"}`, "{#svg} takes only a path"},
		{"trailing word", `{#svg 'a.svg' foo}`, "{#svg} takes only a path"},
		{"stray closer", `{#svg 'a.svg'}{/svg}`, "{#svg} is self-contained — remove the {/svg}"},
		{"stray closer alone", `{/svg}`, "{#svg} is self-contained — remove the {/svg}"},
		{"stray closer inside element", `<div>{/svg}</div>`, "{#svg} is self-contained — remove the {/svg}"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := "<puzzle-view>" + tc.content + "</puzzle-view>\n<scripts></scripts>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got none")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseUnknownBlockMentionsSvg confirms {#svg} joins the unknown-block hint.
func TestParseUnknownBlockMentionsSvg(t *testing.T) {
	src := "<puzzle-view>{#nope}x{/nope}</puzzle-view>\n<scripts></scripts>"
	_, err := Parse([]byte(src), "test.pzl")
	if err == nil {
		t.Fatalf("expected error, got none")
	}
	if !strings.Contains(err.Error(), "{#svg}") {
		t.Fatalf("unknown-block error %q should mention {#svg}", err.Error())
	}
}

// TestParseSvgInsideIsland confirms {#svg} inside an island subtree parses (it is
// not a component/slot, so island validation lets it through).
func TestParseSvgInsideIsland(t *testing.T) {
	src := `<puzzle-view><div island>{#svg 'icons/heart.svg'}</div></puzzle-view>` + "\n<scripts></scripts>"
	root, err := Parse([]byte(src), "test.pzl")
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if findInlineSVG(root.Children) == nil {
		t.Fatalf("InlineSVG inside island not parsed")
	}
}

func TestScanSVGFile(t *testing.T) {
	t.Run("plain svg", func(t *testing.T) {
		attrs, inner, err := ScanSVGFile([]byte(`<svg viewBox="0 0 24 24"><path d="M1 2"/></svg>`), "heart.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != `<path d="M1 2"/>` {
			t.Errorf("inner: got %q", inner)
		}
		if got := staticAttr(attrs, "viewBox"); got != "0 0 24 24" {
			t.Errorf("viewBox: got %q, want %q", got, "0 0 24 24")
		}
	})

	t.Run("xml prolog + doctype stripped, positions after", func(t *testing.T) {
		src := "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
			"<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n" +
			`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>`
		attrs, inner, err := ScanSVGFile([]byte(src), "circle.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != `<circle cx="12" cy="12" r="10"/>` {
			t.Errorf("inner: got %q", inner)
		}
		if got := staticAttr(attrs, "xmlns"); got != "http://www.w3.org/2000/svg" {
			t.Errorf("xmlns: got %q", got)
		}
	})

	t.Run("error position after prolog stripping points into svg", func(t *testing.T) {
		src := "<?xml version=\"1.0\"?>\n<div>not an svg</div>"
		_, _, err := ScanSVGFile([]byte(src), "bad.svg")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("err: got %T, want *ParseError", err)
		}
		if pe.File != "bad.svg" {
			t.Errorf("File: got %q, want bad.svg", pe.File)
		}
		if pe.Line != 2 {
			t.Errorf("Line: got %d, want 2 (after the prolog line)", pe.Line)
		}
		if !strings.Contains(pe.Message, "root element is <div>") {
			t.Errorf("message %q should name the actual root tag", pe.Message)
		}
	})

	t.Run("non-svg root names actual tag", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte(`<div><span/></div>`), "x.svg")
		if err == nil || !strings.Contains(err.Error(), "root element is <div>, not <svg>") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("self-closing root yields empty inner", func(t *testing.T) {
		attrs, inner, err := ScanSVGFile([]byte(`<svg width="16" height="16"/>`), "empty.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != "" {
			t.Errorf("inner: got %q, want empty", inner)
		}
		if got := staticAttr(attrs, "width"); got != "16" {
			t.Errorf("width: got %q", got)
		}
	})

	t.Run("kebab-case, xmlns, viewBox attrs", func(t *testing.T) {
		attrs, _, err := ScanSVGFile([]byte(`<svg xmlns="ns" xmlns:xlink="xl" viewBox="0 0 1 1" stroke-width="2" fill="none"></svg>`), "a.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		for name, want := range map[string]string{
			"xmlns":        "ns",
			"xmlns:xlink":  "xl",
			"viewBox":      "0 0 1 1",
			"stroke-width": "2",
			"fill":         "none",
		} {
			if got := staticAttr(attrs, name); got != want {
				t.Errorf("attr %s: got %q, want %q", name, got, want)
			}
		}
	})

	t.Run("root attribute braces stay literal", func(t *testing.T) {
		attrs, _, err := ScanSVGFile([]byte(`<svg quoted="{foo}" bare={foo} unmatched="{"></svg>`), "literal.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := map[string]string{
			"quoted":    "{foo}",
			"bare":      "{foo}",
			"unmatched": "{",
		}
		if len(attrs) != len(want) {
			t.Fatalf("attrs: got %d, want %d", len(attrs), len(want))
		}
		for _, attr := range attrs {
			static, ok := attr.(*StaticAttr)
			if !ok {
				t.Errorf("root attr: got %T, want *StaticAttr", attr)
				continue
			}
			if got := static.Value; got != want[static.Name] {
				t.Errorf("%s: got %q, want %q", static.Name, got, want[static.Name])
			}
		}
	})

	t.Run("inner returned verbatim including literal braces and {#svg}", func(t *testing.T) {
		body := `<text>{ not an expr } {#svg 'nope'} {/svg}</text>`
		attrs, inner, err := ScanSVGFile([]byte(`<svg>`+body+`</svg>`), "inert.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != body {
			t.Errorf("inner: got %q, want %q (verbatim/inert)", inner, body)
		}
		if len(attrs) != 0 {
			t.Errorf("attrs: got %d, want 0", len(attrs))
		}
	})

	t.Run("nested svg counts depth", func(t *testing.T) {
		body := `<svg x="10"><rect/></svg>`
		_, inner, err := ScanSVGFile([]byte(`<svg>`+body+`</svg>`), "nested.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != body {
			t.Errorf("inner: got %q, want %q", inner, body)
		}
	})

	t.Run("</svg> inside a CDATA section is inert", func(t *testing.T) {
		// A CDATA block is verbatim character data: the </svg> inside it must not
		// close the root. Before findRootClose skipped CDATA (like comments), the
		// scan matched that inner </svg> and rejected the file as multi-root.
		body := `<style><![CDATA[ .a { content: "</svg>" } ]]></style><path d="M1 2"/>`
		_, inner, err := ScanSVGFile([]byte(`<svg>`+body+`</svg>`), "cdata.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != body {
			t.Errorf("inner: got %q, want %q", inner, body)
		}
	})

	t.Run("<svg inside an attribute value is inert", func(t *testing.T) {
		// A '<svg' in another element's attribute value is text, not a nested open
		// tag. Before findRootClose skipped whole foreign tags via scanTagEnd, the
		// byte-at-a-time advance re-scanned the value, counted a phantom depth, and
		// reported the root unclosed.
		body := `<rect aria-label="<svg icon>"/>`
		_, inner, err := ScanSVGFile([]byte(`<svg>`+body+`</svg>`), "attrval.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != body {
			t.Errorf("inner: got %q, want %q", inner, body)
		}
	})

	t.Run("multi-root rejected", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte(`<svg><a/></svg><svg><b/></svg>`), "multi.svg")
		if err == nil || !strings.Contains(err.Error(), "single <svg> root") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("trailing junk after root rejected", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte(`<svg></svg> trailing text`), "junk.svg")
		if err == nil || !strings.Contains(err.Error(), "single <svg> root") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("trailing whitespace allowed", func(t *testing.T) {
		_, inner, err := ScanSVGFile([]byte("<svg><path/></svg>\n   \n"), "ws.svg")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inner != "<path/>" {
			t.Errorf("inner: got %q", inner)
		}
	})

	t.Run("empty file rejected", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte("   \n  "), "empty.svg")
		if err == nil || !strings.Contains(err.Error(), "no root element") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("unclosed root rejected", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte(`<svg><path/>`), "unclosed.svg")
		if err == nil || !strings.Contains(err.Error(), "unclosed <svg>") {
			t.Fatalf("got %v", err)
		}
	})

	t.Run("ParseError.File is the svg filename", func(t *testing.T) {
		_, _, err := ScanSVGFile([]byte(`<nope/>`), "my-icon.svg")
		pe, ok := err.(*ParseError)
		if !ok {
			t.Fatalf("err: got %T, want *ParseError", err)
		}
		if pe.File != "my-icon.svg" {
			t.Errorf("File: got %q, want my-icon.svg", pe.File)
		}
	})
}

// staticAttr returns the value of a StaticAttr named name, or "" (and for a
// MixedAttr concatenates its static parts — SVG values are static in practice).
func staticAttr(attrs []Attr, name string) string {
	for _, a := range attrs {
		if sa, ok := a.(*StaticAttr); ok && sa.Name == name {
			return sa.Value
		}
	}
	return ""
}
