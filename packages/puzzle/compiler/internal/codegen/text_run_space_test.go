package codegen

import (
	"strings"
	"testing"
)

// A newline BETWEEN members of one text run separates words — it is not source
// indentation — so exactly one space survives at that boundary. Run edges keep
// the strip, and members with no whitespace between them stay adjacent.
func TestTextRunInternalNewlineKeepsOneSpace(t *testing.T) {
	cases := []struct {
		name     string
		template string
		want     string
		notWant  string
	}{
		{
			name:     "text to interpolation across a newline",
			template: "<p>— you have { count } new\n    { count === 1 ? 'message' : 'messages' }.</p>",
			want:     "' new ' + __s(",
			notWant:  "' new' + __s(",
		},
		{
			name:     "interpolation to interpolation across a dropped whitespace-only node",
			template: "<p>{ user.first }\n   { user.last }</p>",
			want:     " + ' ' + __s(__d.user?.last",
		},
		{
			name:     "interpolation to text across a newline",
			template: "<pre>a { x }\nb</pre>",
			want:     " + ' b' }",
			notWant:  " + 'b' }",
		},
		{
			name:     "adjacent interpolations stay adjacent",
			template: "<p>{ a }{ b }</p>",
			want:     "0) + __s(__d.b",
			notWant:  "+ ' ' +",
		},
		{
			name:     "run edges still strip their indentation",
			template: "<ul><li>\n  { item }\n</li></ul>",
			want:     "value: __s(__d.item",
			notWant:  "' '",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, "<puzzle-view>\n"+tc.template+"\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n")
			if !strings.Contains(got, tc.want) {
				t.Errorf("compiled output missing %q:\n%s", tc.want, got)
			}
			if tc.notWant != "" && strings.Contains(got, tc.notWant) {
				t.Errorf("compiled output must not contain %q:\n%s", tc.notWant, got)
			}
		})
	}
}

// A control-flow block breaks the coalesced run but not the line of prose, so a
// newline between a text run and an adjacent {#if}/{#for}/{#case} sibling keeps
// exactly one space — the same rule as a run-internal boundary. Element
// boundaries are unchanged, and no space is invented at an element edge.
func TestTextRunControlFlowBoundaryKeepsOneSpace(t *testing.T) {
	cases := []struct {
		name     string
		template string
		want     []string
		notWant  []string
	}{
		{
			name:     "text run to {#if} across a newline",
			template: "<p>\n  you have { n } new\n  {#if x}message{/if}\n</p>",
			want:     []string{"+ ' new ' }"},
			notWant:  []string{"+ ' new' }"},
		},
		{
			name:     "{#if} to text run across a newline",
			template: "<p>\n  {#if x}message{/if}\n  is waiting\n</p>",
			want:     []string{"value: ' is waiting'"},
			notWant:  []string{"value: 'is waiting'"},
		},
		{
			name:     "interpolations on both sides pad as standalone spaces",
			template: "<p>{ a }\n{#if x}b{/if}\n{ c }</p>",
			want:     []string{"0) + ' ' }", "value: ' ' + __s(__d.c"},
		},
		{
			name:     "{#for} to text run across a newline",
			template: "<p>\n  {#for w in words}<b>{ w }</b>{/for}\n  done\n</p>",
			want:     []string{"value: ' done'"},
			notWant:  []string{"value: 'done'"},
		},
		{
			name:     "{#case} pads both of its boundaries",
			template: "<p>\n  hi\n  {#case n}{:when 1}one{:else}many{/case}\n  there\n</p>",
			want:     []string{"value: 'hi '", "value: ' there'"},
		},
		{
			name:     "a nested block pads inside its parent branch",
			template: "<p>\n  {#if a}\n    outer\n    {#if b}inner{/if}\n  {/if}\n</p>",
			want:     []string{"value: 'outer '", "value: 'inner'"},
		},
		{
			name:     "{:else} branch text pads against a following block",
			template: "<p>\n  {#if x}yes{:else}no\n  {#if y}maybe{/if}{/if}\n</p>",
			want:     []string{"value: 'no '"},
		},
		{
			name:     "a block body's own edges keep the element-boundary strip",
			template: "<p>\n  a\n  {#if x}\n    b\n  {/if}\n</p>",
			want:     []string{"value: 'a '", "value: 'b'"},
			notWant:  []string{"value: ' b'", "value: 'b '"},
		},
		{
			name:     "a block at an element edge invents no space",
			template: "<p>\n  {#if x}a{/if}\n</p>",
			notWant:  []string{"' '"},
		},
		{
			name:     "no whitespace at the boundary stays adjacent",
			template: "<p>{#if x}a{/if}{ b }</p>",
			notWant:  []string{"' ' + __s(__d.b"},
		},
		{
			name:     "element boundaries still strip (documented non-goal)",
			template: "<p>\n  <span>a</span>\n  b\n</p>",
			want:     []string{"value: 'b'"},
			notWant:  []string{"value: ' b'"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, "<puzzle-view>\n"+tc.template+"\n</puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n")
			for _, w := range tc.want {
				if !strings.Contains(got, w) {
					t.Errorf("compiled output missing %q:\n%s", w, got)
				}
			}
			for _, nw := range tc.notWant {
				if strings.Contains(got, nw) {
					t.Errorf("compiled output must not contain %q:\n%s", nw, got)
				}
			}
		})
	}
}
