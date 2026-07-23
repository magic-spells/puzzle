package parser

import (
	"strings"
	"testing"
)

// refs_test.go — element refs (v1.39, D72). A static `ref="name"` on a plain
// element links its DOM node to this.refs.name; validateRefs rejects every shape
// the runtime cannot honor. See refs.go for the invariant list.

// firstRefAttr returns the ref StaticAttr on the first element that carries one,
// searching the given nodes depth-first. It exists so the valid-parse test can
// assert the AST representation chosen: ref rides through as an ordinary
// StaticAttr (no new node type), and codegen specializes it.
func firstRefAttr(nodes []Node) *StaticAttr {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Element:
			for _, a := range node.Attrs {
				if sa, ok := a.(*StaticAttr); ok && sa.Name == "ref" {
					return sa
				}
			}
			if r := firstRefAttr(node.Children); r != nil {
				return r
			}
		case *If:
			if r := firstRefAttr(node.Then); r != nil {
				return r
			}
			if r := firstRefAttr(node.Else); r != nil {
				return r
			}
		}
	}
	return nil
}

// TestParseRef pins that a valid ref parses and is preserved as a non-Valueless
// StaticAttr named "ref" — the representation codegen specializes into a
// this.__ref("name") call. Both quote forms are accepted, and ref coexists with
// island on the same element (the headline use case).
func TestParseRef(t *testing.T) {
	t.Run("double-quoted ref is a static attr", func(t *testing.T) {
		root := parseContent(t, `<canvas ref="chart"></canvas>`)
		ref := firstRefAttr(root.Children)
		if ref == nil {
			t.Fatal("expected a ref StaticAttr")
		}
		if ref.Value != "chart" || ref.Valueless {
			t.Errorf("ref attr wrong: %+v", ref)
		}
	})

	t.Run("single-quoted ref is a static attr", func(t *testing.T) {
		root := parseContent(t, `<canvas ref='chart'></canvas>`)
		ref := firstRefAttr(root.Children)
		if ref == nil || ref.Value != "chart" {
			t.Fatalf("ref attr wrong: %+v", ref)
		}
	})

	t.Run("dollar-prefixed name is accepted", func(t *testing.T) {
		root := parseContent(t, `<div ref="$el"></div>`)
		if ref := firstRefAttr(root.Children); ref == nil || ref.Value != "$el" {
			t.Fatalf("ref attr wrong: %+v", ref)
		}
	})

	t.Run("ref coexists with island", func(t *testing.T) {
		root := parseContent(t, `<div ref="grid" island></div>`)
		if ref := firstRefAttr(root.Children); ref == nil || ref.Value != "grid" {
			t.Fatalf("ref+island should parse, got: %+v", ref)
		}
	})

	t.Run("distinct names across the body parse cleanly", func(t *testing.T) {
		// Two different names, one nested — the duplicate walk must not false-trip.
		root := parseContent(t, `<div ref="a"></div><section><span ref="b"></span></section>`)
		if firstRefAttr(root.Children) == nil {
			t.Fatal("expected refs to parse cleanly")
		}
	})
}

// TestParseRefErrors covers every positioned rejection. Each case is a full .pzl
// source so the root-level and skeleton cases can be expressed too.
func TestParseRefErrors(t *testing.T) {
	tests := []struct {
		name       string
		src        string
		wantSubstr string
	}{
		{
			"dynamic ref",
			`<puzzle-view><div ref={ chart }></div></puzzle-view>` + "\n<script></script>",
			"ref must be a static string name",
		},
		{
			"interpolated ref",
			`<puzzle-view><div ref="a{ x }"></div></puzzle-view>` + "\n<script></script>",
			"ref must be a static string name",
		},
		{
			"bare valueless ref",
			`<puzzle-view><div ref></div></puzzle-view>` + "\n<script></script>",
			"ref requires a name",
		},
		{
			"empty ref",
			`<puzzle-view><div ref=""></div></puzzle-view>` + "\n<script></script>",
			"ref cannot be empty",
		},
		{
			"hyphenated name",
			`<puzzle-view><div ref="my-chart"></div></puzzle-view>` + "\n<script></script>",
			"must be a valid identifier",
		},
		{
			"hyphenated name is named",
			`<puzzle-view><div ref="my-chart"></div></puzzle-view>` + "\n<script></script>",
			"my-chart",
		},
		{
			"dotted name",
			`<puzzle-view><div ref="a.b"></div></puzzle-view>` + "\n<script></script>",
			"must be a valid identifier",
		},
		{
			"ref on component",
			`<puzzle-view><Chart ref="c" /></puzzle-view>` + "\n<script>\nimport Chart from './Chart.pzl';\n</script>",
			"@ready callback prop",
		},
		{
			"ref on component names the tag",
			`<puzzle-view><Chart ref="c" /></puzzle-view>` + "\n<script>\nimport Chart from './Chart.pzl';\n</script>",
			"<Chart>",
		},
		{
			"ref on bare slot",
			`<puzzle-view><slot ref="x"></slot></puzzle-view>` + "\n<script></script>",
			"ref cannot be placed on a <slot>",
		},
		{
			"ref on capitalized Slot",
			`<puzzle-view><Slot ref="x" /></puzzle-view>` + "\n<script></script>",
			"ref cannot be placed on a <Slot>",
		},
		{
			"ref inside for block",
			`<puzzle-view>{#for i in items}<span ref="x"></span>{/for}</puzzle-view>` + "\n<script></script>",
			"not allowed inside a {#for}",
		},
		{
			"ref nested deep inside for block",
			`<puzzle-view>{#for i in items}<ul><li><b ref="x"></b></li></ul>{/for}</puzzle-view>` + "\n<script></script>",
			"not allowed inside a {#for}",
		},
		{
			"duplicate ref name",
			`<puzzle-view><div ref="a"></div><span ref="a"></span></puzzle-view>` + "\n<script></script>",
			`duplicate ref name "a"`,
		},
		{
			"ref on the puzzle-view root",
			`<puzzle-view ref="root"><div>x</div></puzzle-view>` + "\n<script></script>",
			"root cannot carry a ref",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse([]byte(tc.src), "test.pzl")
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantSubstr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSubstr)
			}
		})
	}
}

// TestParseRefDuplicateNamesFirstPosition pins that the duplicate error points a
// reader back to the FIRST declaration's line:col (the duplicate-slot shape).
func TestParseRefDuplicateNamesFirstPosition(t *testing.T) {
	src := `<puzzle-view><div ref="a"></div><span ref="a"></span></puzzle-view>` + "\n<script></script>"
	_, err := Parse([]byte(src), "test.pzl")
	if err == nil {
		t.Fatal("expected a duplicate-ref error")
	}
	if !strings.Contains(err.Error(), "already declared at") {
		t.Errorf("duplicate error should cite the first position, got: %v", err)
	}
}

// TestParseRefInSkeleton pins the skeleton-body rejection, which flows through
// ParseSkeleton rather than Parse.
func TestParseRefInSkeleton(t *testing.T) {
	src := `<puzzle-view><span>a</span></puzzle-view>` + "\n<puzzle-skeleton><div ref=\"x\"></div></puzzle-skeleton>\n<script></script>"
	sec, err := SplitSections(src, "test.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	_, err = ParseSkeleton(sec, "test.pzl")
	if err == nil {
		t.Fatal("expected a ref-in-skeleton error")
	}
	if !strings.Contains(err.Error(), "not allowed inside a <puzzle-skeleton>") {
		t.Errorf("unexpected error message: %v", err)
	}
}
