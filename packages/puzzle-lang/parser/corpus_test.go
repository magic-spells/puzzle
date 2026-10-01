package parser

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// corpus_test.go proves the expression grammar against every .pzl file the
// monorepo ships or tests with: the framework's examples, the scaffold
// templates, the pieces registry and demo, the DevTools panel, the runtime
// test fixtures, and the codegen and check goldens. Each file is parsed
// in full — which parses every expression position with package expr — and
// every expression position must carry a tree. From the Go module cache the
// sibling packages are absent and the test skips, as
// TestFixturesMatchCanonicalExample does.

var corpusRoots = []string{
	"../../puzzle/examples",
	"../../puzzle/compiler/internal/scaffold",
	"../../puzzle-pieces/registry",
	"../../puzzle-pieces/demo",
	"../../puzzle-devtools/panel",
	"../../puzzle/tests/fixtures",
	"../../puzzle/compiler/internal/codegen/testdata",
	"../../puzzle/compiler/internal/check/testdata",
}

func TestCorpusExpressionsParse(t *testing.T) {
	if _, err := os.Stat(corpusRoots[0]); err != nil {
		t.Skip("monorepo corpus not present (outside the monorepo)")
	}
	files, exprs := 0, 0
	for _, root := range corpusRoots {
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				switch d.Name() {
				case "node_modules", "dist", ".puzzle":
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(path, ".pzl") {
				return nil
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			files++
			sec, err := SplitSections(string(src), path)
			if err != nil {
				t.Errorf("%v", err)
				return nil
			}
			roots := []*Element{}
			root, err := ParseTemplate(sec, path)
			if err != nil {
				t.Errorf("%v", err)
				return nil
			}
			roots = append(roots, root)
			skel, err := ParseSkeleton(sec, path)
			if err != nil {
				t.Errorf("%v", err)
				return nil
			}
			if skel != nil {
				roots = append(roots, skel)
			}
			for _, r := range roots {
				for _, e := range expressionSites(r) {
					exprs++
					if e.ast == nil {
						t.Errorf("%s: %s %q has no parsed tree", path, e.what, e.text)
					}
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walking %s: %v", root, err)
		}
	}
	if files == 0 {
		t.Fatal("no .pzl files found")
	}
	t.Logf("corpus: %d .pzl files, %d expressions, all parsed", files, exprs)
}

// walkAll visits every node under nodes, into every kind of body: element,
// component, marker fallback, snippet, portal, and each branch of a block.
func walkAll(nodes []Node, fn func(Node)) {
	for _, n := range nodes {
		fn(n)
		switch n := n.(type) {
		case *Element:
			walkAll(n.Children, fn)
		case *Component:
			walkAll(n.Children, fn)
		case *Slot:
			walkAll(n.Children, fn)
		case *Snippet:
			walkAll(n.Body, fn)
		case *Portal:
			walkAll(n.Children, fn)
		case *If:
			walkAll(n.Then, fn)
			walkAll(n.Else, fn)
		case *For:
			walkAll(n.Body, fn)
		case *Case:
			for _, c := range n.Clauses {
				walkAll(c.Body, fn)
			}
			walkAll(n.Else, fn)
		}
	}
}

type exprSite struct {
	what, text string
	ast        expr.Node
}

// expressionSites lists every expression position under root with its tree.
func expressionSites(root *Element) []exprSite {
	var out []exprSite
	add := func(what, text string, ast expr.Node) {
		out = append(out, exprSite{what, text, ast})
	}
	var parts func([]Part)
	parts = func(ps []Part) {
		for _, p := range ps {
			switch p := p.(type) {
			case *InterpPart:
				add("attribute interpolation", p.Interp.Expr, p.Interp.ExprAST)
			case *InlineIfPart:
				add("inline {#if}", p.Cond, p.CondAST)
				parts(p.Then)
				parts(p.Else)
			}
		}
	}
	attrs := func(as []Attr) {
		for _, a := range as {
			switch a := a.(type) {
			case *DynamicAttr:
				add("attribute", a.Expr, a.ExprAST)
			case *EventAttr:
				add("handler", a.Expr, a.ExprAST)
			case *MixedAttr:
				parts(a.Parts)
			}
		}
	}
	attrs(root.Attrs)
	walkAll(root.Children, func(n Node) {
		switch n := n.(type) {
		case *Interpolation:
			add("interpolation", n.Expr, n.ExprAST)
		case *Element:
			attrs(n.Attrs)
		case *Component:
			attrs(n.Props)
		case *Slot:
			attrs(n.Args)
		case *If:
			add("{#if}", n.Cond, n.CondAST)
		case *Case:
			add("{#case}", n.Expr, n.ExprAST)
			for _, c := range n.Clauses {
				for i, v := range c.Values {
					var ast expr.Node
					if i < len(c.ValuesAST) {
						ast = c.ValuesAST[i]
					}
					add("{:when}", v, ast)
				}
			}
		case *For:
			if n.IsRange {
				add("range start", n.RangeFrom, n.RangeFromAST)
				add("range end", n.RangeTo, n.RangeToAST)
			} else {
				add("{#for} collection", n.Collection, n.CollectionAST)
			}
		}
	})
	return out
}
