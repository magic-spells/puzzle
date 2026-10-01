package codegen

import (
	"strings"
	"testing"
)

// D173 V13: a default marker in each of two exclusive branches compiles, and
// each branch carries its own SLOT_TAG vnode — only the taken branch reaches
// slot expansion at runtime, so the call-site content lands exactly once.
func TestExclusiveBranchDefaultMarkersCompile(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  {#if compact}<div><Children/></div>{:else}<section><Children>Empty</Children></section>{/if}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if n := strings.Count(got, "new ViewNode(SLOT_TAG"); n != 2 {
		t.Fatalf("want one marker vnode per branch (2), got %d:\n%s", n, got)
	}
	if !strings.Contains(got, "__d.compact") {
		t.Fatalf("branch condition missing:\n%s", got)
	}
}
