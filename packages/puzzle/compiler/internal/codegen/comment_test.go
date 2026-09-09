package codegen

import (
	"strings"
	"testing"
)

// comment_test.go — D70 template comments verified THROUGH compiled output: a
// template carrying both comment spellings (inline {## … } and block
// {#comment} … {/comment}) must compile byte-for-byte identically to the same
// template with the comments removed. Comments are discarded in the lexer and
// leave zero trace in the AST, so codegen never sees them. The comments are
// inserted INLINE (no surrounding whitespace) so that deleting the exact comment
// substrings recovers the plain template verbatim — the equivalence the test
// asserts against a self-check.

func TestCommentsCompileByteIdentical(t *testing.T) {
	scripts := "import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"export default class T extends PuzzleView { data() { return { show: true, items: [] }; } }"

	plainBody := "<ul>{#for item in items}<li>{ item.name }</li>{/for}</ul>" +
		"{#if show}<p>on</p>{:else}<p>off</p>{/if}"
	withBody := "<ul>{#comment}the list is simplified{/comment}" +
		"{#for item in items}<li>{ item.name }</li>{## per-row note }{/for}</ul>" +
		"{#if show}<p>on</p>{## disabled else }{:else}<p>off</p>{/if}"

	// Self-check: deleting the exact comment substrings must recover the plain
	// template, so any output difference is attributable to comment handling only.
	recovered := withBody
	for _, c := range []string{"{#comment}the list is simplified{/comment}", "{## per-row note }", "{## disabled else }"} {
		recovered = strings.Replace(recovered, c, "", 1)
	}
	if recovered != plainBody {
		t.Fatalf("test setup: stripping comments did not recover the plain body\n  got:  %q\n  want: %q", recovered, plainBody)
	}

	got := compileSrc(t, viewSrc(plainBody, scripts))
	want := compileSrc(t, viewSrc(withBody, scripts))
	if got != want {
		t.Fatalf("commented template must compile byte-identically to the plain one\n--- plain ---\n%s\n--- commented ---\n%s", got, want)
	}
}
