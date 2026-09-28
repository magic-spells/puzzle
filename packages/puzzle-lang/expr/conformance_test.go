package expr_test

import (
	"encoding/json"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/conformance"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// conformance_test.go runs the shared expression table
// (../conformance/expressions-parse.json), the grammar's contract: every host
// that parses Puzzle expressions runs these rows and must produce the same
// trees and the same errors at the same positions.

type parseCase struct {
	Name     string `json:"name"`
	Src      string `json:"src"`
	Argument bool   `json:"argument"`
	Event    bool   `json:"event"`
	OK       bool   `json:"ok"`
	AST      string `json:"ast"`
	Error    string `json:"error"`
	Line     int    `json:"line"`
	Col      int    `json:"col"`
}

func TestConformanceExpressionsParse(t *testing.T) {
	var table struct {
		About string      `json:"about"`
		Cases []parseCase `json:"cases"`
	}
	if err := json.Unmarshal(conformance.ExpressionsParse, &table); err != nil {
		t.Fatalf("expressions-parse.json: %v", err)
	}
	if len(table.Cases) < 150 {
		t.Fatalf("expressions-parse.json has %d cases; the table must cover the grammar", len(table.Cases))
	}
	seen := map[string]bool{}
	for _, c := range table.Cases {
		if seen[c.Name] {
			t.Errorf("duplicate case name %q", c.Name)
		}
		seen[c.Name] = true
		t.Run(c.Name, func(t *testing.T) {
			n, err := expr.Parse(c.Src, expr.Pos{Line: 1, Col: 1}, expr.Options{CallArgument: c.Argument, AllowEvent: c.Event})
			if c.OK {
				if err != nil {
					t.Fatalf("%q: unexpected error %v", c.Src, err)
				}
				if got := expr.Print(n); got != c.AST {
					t.Errorf("%q:\n got  %s\n want %s", c.Src, got, c.AST)
				}
				return
			}
			if err == nil {
				t.Fatalf("%q: parsed as %s, want error %q at %d:%d", c.Src, expr.Print(n), c.Error, c.Line, c.Col)
			}
			e, ok := err.(*expr.Error)
			if !ok {
				t.Fatalf("%q: error type %T, want *expr.Error", c.Src, err)
			}
			if e.Message != c.Error || e.Pos.Line != c.Line || e.Pos.Col != c.Col {
				t.Errorf("%q:\n got  %d:%d %s\n want %d:%d %s", c.Src, e.Pos.Line, e.Pos.Col, e.Message, c.Line, c.Col, c.Error)
			}
		})
	}
}
