package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// compileWithSkeleton compiles a view whose skeleton tag is spelled by the
// caller, so the min-duration attribute (v1.20, D52) can be varied.
func compileWithSkeleton(t *testing.T, skeletonTag string) string {
	t.Helper()
	src := `<puzzle-view class="post-detail">
  <p>{ post.body }</p>
</puzzle-view>

` + skeletonTag + `
  <div class="bg-skeleton"></div>
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res.JS
}

// TestSkeletonMinDurationEmission asserts the D52 emission contract (v1.20): the
// prototype assignment is emitted (with the byte style of the renderSkeleton
// tail) only when min-duration is present and non-zero.
func TestSkeletonMinDurationEmission(t *testing.T) {
	got := compileWithSkeleton(t, `<puzzle-skeleton min-duration="300">`)
	if !strings.HasSuffix(got, "\nT.prototype.skeletonMinDuration = 300;\n") {
		t.Errorf("expected a trailing skeletonMinDuration assignment\n%s", got)
	}
	// Emitted AFTER the renderSkeleton tail, separated by exactly one blank line.
	if !strings.Contains(got, ";\n};\n\nT.prototype.skeletonMinDuration = 300;\n") {
		t.Errorf("skeletonMinDuration not placed immediately after renderSkeleton\n%s", got)
	}
}

// TestSkeletonMinDurationAbsentByteIdentical asserts that an attribute-less
// skeleton — and min-duration="0" — emit NO assignment, so v1.8 output is
// byte-identical.
func TestSkeletonMinDurationAbsentByteIdentical(t *testing.T) {
	absent := compileWithSkeleton(t, `<puzzle-skeleton>`)
	zero := compileWithSkeleton(t, `<puzzle-skeleton min-duration="0">`)
	if strings.Contains(absent, "skeletonMinDuration") {
		t.Errorf("attribute-less skeleton must not emit skeletonMinDuration\n%s", absent)
	}
	if strings.Contains(zero, "skeletonMinDuration") {
		t.Errorf("min-duration=\"0\" must not emit skeletonMinDuration\n%s", zero)
	}
	if absent != zero {
		t.Errorf("min-duration=\"0\" must be byte-identical to no attribute\nabsent:\n%s\nzero:\n%s", absent, zero)
	}
}
