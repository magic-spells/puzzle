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
// templates, the pieces registry, and the codegen goldens. Each file is parsed
// in full — which parses every expression position with package expr — and
// every expression position must carry a tree. From the Go module cache the
// sibling packages are absent and the test skips, as
// TestFixturesMatchCanonicalExample does.

var corpusRoots = []string{
	"../../puzzle/examples",
	"../../puzzle/compiler/internal/scaffold",
	"../../puzzle-pieces/registry",
	"../../puzzle/compiler/internal/codegen/testdata",
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
	chain := func(what, text string, ast expr.Node, fmts []FormatterCall) {
		add(what, text, ast)
		for _, f := range fmts {
			for i, a := range f.Args {
				var n expr.Node
				if i < len(f.ArgsAST) {
					n = f.ArgsAST[i]
				}
				add("formatter argument", a, n)
			}
		}
	}
	var parts func([]Part)
	parts = func(ps []Part) {
		for _, p := range ps {
			switch p := p.(type) {
			case *InterpPart:
				chain("attribute interpolation", p.Interp.Expr, p.Interp.ExprAST, p.Interp.Formatters)
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
				chain("attribute", a.Expr, a.ExprAST, a.Formatters)
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
			chain("interpolation", n.Expr, n.ExprAST, n.Formatters)
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
