package expr_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/conformance"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// fuzz_test.go fuzzes Parse from the conformance rows. A plain `go test` runs
// only the seeds; run the fuzzer by hand:
//
//	go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr

// fuzzBindings are the names the bindings mode binds: a {#for} item and
// counter, and a bound `event` that shadows a handler's DOM event.
var fuzzBindings = []string{"item", "i", "event"}

// fuzzOptions maps the fuzzed mode to the three ways a host parses: a plain
// value, an @event handler, and a value inside binding constructs.
func fuzzOptions(mode uint8) expr.Options {
	switch mode % 3 {
	case 1:
		return expr.Options{Handler: true}
	case 2:
		return expr.Options{Bindings: fuzzBindings}
	}
	return expr.Options{}
}

// parseResult renders one parse as a string: the tree and its node positions,
// or the error and its position.
func parseResult(t *testing.T, src string, opts expr.Options) string {
	n, err := expr.Parse(src, expr.Pos{Line: 1, Col: 1}, opts)
	if err != nil {
		e, ok := err.(*expr.Error)
		if !ok {
			t.Fatalf("%q: error type %T, want *expr.Error", src, err)
		}
		if e.Pos.Offset < 0 || e.Pos.Offset > len(src) {
			t.Fatalf("%q: error offset %d outside the source (len %d): %s", src, e.Pos.Offset, len(src), e.Message)
		}
		return fmt.Sprintf("error %d:%d:%d %s", e.Pos.Line, e.Pos.Col, e.Pos.Offset, e.Message)
	}
	if n == nil {
		t.Fatalf("%q: no tree and no error", src)
	}
	expr.Walk(n, func(n expr.Node) bool {
		if off := n.Pos().Offset; off < 0 || off >= len(src) {
			t.Fatalf("%q: %T at offset %d outside the source (len %d)", src, n, off, len(src))
		}
		return true
	})
	return expr.Print(n) + " @ " + expr.PrintPositions(n)
}

func FuzzParse(f *testing.F) {
	var table struct {
		Cases []struct {
			Src string `json:"src"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(conformance.ExpressionsParse, &table); err != nil {
		f.Fatalf("expressions-parse.json: %v", err)
	}
	for _, c := range table.Cases {
		for mode := uint8(0); mode < 3; mode++ {
			f.Add(c.Src, mode)
		}
	}
	f.Fuzz(func(t *testing.T, src string, mode uint8) {
		opts := fuzzOptions(mode)
		first := parseResult(t, src, opts)
		if second := parseResult(t, src, opts); second != first {
			t.Fatalf("%q: a second parse differs:\n first  %s\n second %s", src, first, second)
		}
	})
}
