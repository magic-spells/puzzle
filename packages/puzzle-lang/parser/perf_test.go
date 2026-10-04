package parser

import (
	"fmt"
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

// A {#raw} body's braces are literal (D150), so the section splitter steps
// over the span in one pass. Scanning it as brace groups made every
// unbalanced '{' run a failed scan to the end of the file and retry one byte
// later: seconds for 40 KB. Best of three; skipped under -short.
func TestLargeRawBlockParsesWithinBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	src := "<puzzle-view><pre>{#raw}" + strings.Repeat("{", 40*1024) + "{/raw}</pre></puzzle-view>\n" +
		"<script>\n// it's a view\nexport default class Big {}\n</script>\n"
	best := time.Duration(1 << 62)
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := Parse([]byte(src), "raw.pzl"); err != nil {
			t.Fatal(err)
		}
		if d := time.Since(start); d < best {
			best = d
		}
	}
	budget := 20 * time.Millisecond
	if os.Getenv("CI") != "" {
		budget *= 3
	}
	t.Logf("40 KB {#raw} block: %v (budget %v)", best, budget)
	if best > budget {
		t.Errorf("a 40 KB {#raw} block took %v; the budget is %v", best, budget)
	}
}

// A {#let} block is parsed in one pass: binding positions advance through the
// header once, duplicate names are a map lookup, and a long scope answers
// "is this a binding?" from an index rather than a scan (exprs.go). Each of
// those was quadratic once: a 430 KB block took 5.6 s. The block below is
// ~430 KB, and every right-hand side calls a function, so each expression
// asks the binding question. Best of three; skipped under -short.
func TestLargeLetBlockParsesWithinBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	var b strings.Builder
	b.WriteString("<ul>\n  {#let\n")
	n := 0
	for b.Len() < 430*1024 {
		fmt.Fprintf(&b, "    v%d = currency(v%d * 2, '$') + 1\n", n, n/2)
		n++
	}
	b.WriteString("  }\n  <li>{ v1 }</li>\n</ul>\n")
	src := b.String()
	best := time.Duration(1 << 62)
	for i := 0; i < 3; i++ {
		start := time.Now()
		root, err := ParseMarkup(src, Position{}, "let.pzl", Options{Let: true})
		if err != nil {
			t.Fatal(err)
		}
		if d := time.Since(start); d < best {
			best = d
		}
		let := root.Children[0].(*Element).Children[1].(*Let)
		if len(let.Bindings) != n {
			t.Fatalf("%d bindings, want %d", len(let.Bindings), n)
		}
	}
	budget := 100 * time.Millisecond
	if os.Getenv("CI") != "" {
		budget *= 3
	}
	t.Logf("%d-binding {#let} (%d KB): %v (budget %v)", n, len(src)/1024, best, budget)
	if best > budget {
		t.Errorf("a %d KB {#let} block took %v; the budget is %v", len(src)/1024, best, budget)
	}
}

// An attribute value full of braces maps its positions in one forward pass
// (attr.go). It used to advance from the value's start for every brace.
func TestLongAttributeValueParsesWithinBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("timing test")
	}
	src := `<p title="` + strings.Repeat("{ a } x ", 50*1024) + `"></p>`
	best := time.Duration(1 << 62)
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := ParseMarkup(src, Position{}, "attr.pzl"); err != nil {
			t.Fatal(err)
		}
		if d := time.Since(start); d < best {
			best = d
		}
	}
	budget := 100 * time.Millisecond
	if os.Getenv("CI") != "" {
		budget *= 3
	}
	t.Logf("%d KB attribute value: %v (budget %v)", len(src)/1024, best, budget)
	if best > budget {
		t.Errorf("a %d KB attribute value took %v; the budget is %v", len(src)/1024, best, budget)
	}
}
