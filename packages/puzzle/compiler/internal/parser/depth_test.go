package parser

import (
	"strings"
	"testing"
)

// splitForDepth is the section split every depth case starts from; a broken
// split would make the depth assertions meaningless.
func splitForDepth(t *testing.T, src string) *Sections {
	t.Helper()
	sec, err := SplitSections(src, "app/views/Depth.pzl")
	if err != nil {
		t.Fatalf("SplitSections: %v", err)
	}
	return sec
}

func TestOverNestingDepthCountsElementsAndBlocks(t *testing.T) {
	cases := []struct {
		name  string
		body  string
		limit int
		over  bool
	}{
		{"flat siblings never nest", "<p>a</p><p>b</p><p>c</p>", 2, false},
		{"self-closing tags do not push", "<br/><br/><br/><br/>", 1, false},
		{"exactly at the limit passes", "<div><span>x</span></div>", 2, false},
		{"one past the limit trips", "<div><span><b>x</b></span></div>", 2, true},
		{"blocks count as a level", "{#if ready}<div><span>x</span></div>{/if}", 2, true},
		{"a closed level is popped", "<div><span>x</span></div><div><em>y</em></div>", 2, false},
		{"markup inside a script body is text", "<script>{#raw}<div><div><div>x</div></div></div>{/raw}</script>", 2, false},
		{"markup inside {#raw} still counts", "{#raw}<div><div><div>x</div></div></div>{/raw}", 2, true},
		// {#svg} is a VOID block (D46) with no {/svg} closer, so counting it as a
		// level made a flat row of icons look like ever-deepening nesting.
		{"flat {#svg} siblings never nest", strings.Repeat("{#svg 'icons/heart.svg'}", 250), 200, false},
		{"a {#svg} inside real nesting still sits at its parent's depth", "<div><span>{#svg 'icons/heart.svg'}</span></div>", 2, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sec := splitForDepth(t, "<puzzle-view>"+tc.body+"</puzzle-view>")
			// The <puzzle-view> root is not part of TemplateContent, so the limits
			// above are depths inside the template body.
			_, over := OverNestingDepth(sec, "app/views/Depth.pzl", tc.limit)
			if over != tc.over {
				t.Fatalf("OverNestingDepth over = %v, want %v", over, tc.over)
			}
		})
	}
}

func TestOverNestingDepthPositionsTheOffendingTag(t *testing.T) {
	src := "<puzzle-view>\n  <div>\n    <span>\n      <b>x</b>\n    </span>\n  </div>\n</puzzle-view>"
	pos, over := OverNestingDepth(splitForDepth(t, src), "app/views/Depth.pzl", 2)
	if !over {
		t.Fatal("OverNestingDepth did not trip on a 3-deep template")
	}
	if pos.Line != 4 {
		t.Fatalf("diagnostic line = %d, want 4 (the <b> that went over)", pos.Line)
	}
}

// The whole point of scanning tokens instead of an AST: a source deep enough to
// exhaust the parser's stack must still get an answer, cheaply.
func TestOverNestingDepthSurvivesPathologicalNesting(t *testing.T) {
	const levels = 50000
	src := "<puzzle-view>" + strings.Repeat("<div>", levels) + "x" + strings.Repeat("</div>", levels) + "</puzzle-view>"
	if _, over := OverNestingDepth(splitForDepth(t, src), "app/views/Depth.pzl", 200); !over {
		t.Fatal("OverNestingDepth did not trip on a 50,000-deep template")
	}
}

// A malformed stream is the real parse's story to tell; the scan must not
// invent an error of its own.
func TestOverNestingDepthIgnoresLexErrors(t *testing.T) {
	sec := splitForDepth(t, "<puzzle-view>{#if unclosed</puzzle-view>")
	if _, over := OverNestingDepth(sec, "app/views/Depth.pzl", 200); over {
		t.Fatal("OverNestingDepth reported a depth failure for a lex error")
	}
}
