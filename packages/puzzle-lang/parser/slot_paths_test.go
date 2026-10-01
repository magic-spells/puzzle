package parser

import (
	"strings"
	"testing"
)

// TestParseMarkersPerRenderPath covers D173 V13: at most one default marker,
// and one <Slot name="x"> per name, on any single render path. Mutually
// exclusive {#if}/{:else}/{:else if}/{#unless}/{#case} branches are separate
// paths; anything a branch declares is on the path of what follows the block.
func TestParseMarkersPerRenderPath(t *testing.T) {
	ok := []struct {
		name string
		src  string
	}{
		{"default marker in if/else", `{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}`},
		{"both spellings in if/else", `{#if a}<Children/>{:else}<Slot/>{/if}`},
		{"else-if chain", `{#if a}<Children/>{:else if b}<p><Children/></p>{:else}<Slot/>{/if}`},
		{"unless/else", `{#unless a}<Children/>{:else}<b><Children/></b>{/unless}`},
		{"case clauses and else", `{#case mode}{:when 'a'}<Children/>{:when 'b', 'c'}<i><Children/></i>{:else}<Children/>{/case}`},
		{"named slot in exclusive branches", `{#if a}<Slot name="x"/>{:else}<Slot name="x">fb</Slot>{/if}`},
		{"nested exclusive branches", `{#if a}{#if b}<Children/>{:else}<Children/>{/if}{:else}<Children/>{/if}`},
		{"forwarding in one branch, local in the other", `{#if a}<Card><Children/></Card>{:else}<Children/>{/if}`},
		{"exclusive args-bearing markers", `{#if a}<Children item={ x }/>{:else}<Children item={ y }/>{/if}`},
		{"one marker in a loop body", `{#for i in items}<li><Children item={ i }/></li>{/for}`},
	}
	for _, tc := range ok {
		t.Run(tc.name, func(t *testing.T) {
			src := `<puzzle-view>` + tc.src + `</puzzle-view>` + "\n<script></script>"
			if _, err := Parse([]byte(src), "test.pzl"); err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
		})
	}

	errs := []struct {
		name string
		src  string
		want string
	}{
		{"marker before the block and in a branch", `<Children/>{#if a}<Children/>{/if}`, "duplicate default marker"},
		{"marker in a branch and after the block", `{#if a}<Children/>{/if}<Slot/>`, "duplicate default marker (<Children/>/<Slot/>) — already declared at 1:21"},
		{"two markers in one branch", `{#if a}<Children/><Children/>{:else}x{/if}`, "duplicate default marker"},
		{"two separate ifs are not exclusive", `{#if a}<Children/>{/if}{#if b}<Children/>{/if}`, "duplicate default marker"},
		{"case clause then trailing marker", `{#case m}{:when 1}<i/>{:else}<Children/>{/case}<Children/>`, "duplicate default marker"},
		{"named slot in a branch and after", `{#if a}<Slot name="x"/>{/if}<Slot name="x"/>`, `duplicate slot name "x"`},
		{"two markers in one loop body", `{#for i in items}<Children/><Children/>{/for}`, "duplicate default marker"},
		{"marker inside and outside an invocation within one branch", `{#if a}<Children/><Card><Children/></Card>{/if}`, "duplicate default marker"},
	}
	for _, tc := range errs {
		t.Run(tc.name, func(t *testing.T) {
			src := `<puzzle-view>` + tc.src + `</puzzle-view>` + "\n<script></script>"
			_, err := Parse([]byte(src), "test.pzl")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}
