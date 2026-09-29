package parser

import (
	"os"
	"strings"
	"testing"
	"time"
)

// perf_test.go holds the parser's time budget: a 20,000-line template —
// every line carrying expressions in the positions templates use — parses in
// under 100 ms, expression trees included. Best of three runs, so a busy
// machine does not fail it; skipped under -short.
func TestLargeTemplateParsesWithinBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	lines := []string{
		`  <li class="row {#if item.done}done{/if}" data-id={ item.id } @click={ toggle(item, event) }>`,
		`    <span title="{ truncate(item.title, 40, '…') }">{ item.title ?? 'Untitled' }</span>`,
		`    {#if item.tags.length > 0 && !item.hidden}<em>{ item.tags.join(', ') }</em>{:else}<em>none</em>{/if}`,
		`    <b>{ currency(item.price * item.qty, '$', 2) } { item.count === 1 ? 'item' : 'items' }</b>`,
		`  </li>`,
	}
	var b strings.Builder
	b.WriteString("<puzzle-view>\n<ul>\n{#for item in items}\n")
	n := 3
	for n < 20000-3 {
		for _, l := range lines {
			b.WriteString(l)
			b.WriteByte('\n')
			n++
		}
	}
	b.WriteString("{/for}\n</ul>\n</puzzle-view>\n<script></script>\n")
	src := b.String()
	if got := strings.Count(src, "\n"); got < 20000 {
		t.Fatalf("template has %d lines", got)
	}
	best := time.Duration(1 << 62)
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := Parse([]byte(src), "big.pzl"); err != nil {
			t.Fatal(err)
		}
		if d := time.Since(start); d < best {
			best = d
		}
	}
	// The budget is a developer-machine figure (about 60 ms there, 38 ms of it
	// the template scan the expression layer sits on). A shared CI runner is
	// several times slower and noisier, so it gets three times the headroom:
	// enough to pass on a slow machine, not enough to hide a quadratic path.
	budget := 100 * time.Millisecond
	if os.Getenv("CI") != "" {
		budget *= 3
	}
	t.Logf("20,000-line template: %v (budget %v)", best, budget)
	if best > budget {
		t.Errorf("a 20,000-line template took %v; the budget is %v", best, budget)
	}
}
