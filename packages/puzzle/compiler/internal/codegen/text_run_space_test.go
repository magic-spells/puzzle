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
			want:     " + ' ' + __s(__d.user.last",
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
