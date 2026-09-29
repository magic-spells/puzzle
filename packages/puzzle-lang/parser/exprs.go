package parser

import (
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// exprs.go connects the template grammar to the expression language (package
// expr). Every expression position — an interpolation's base and formatter
// arguments, an attribute value, a handler, a block header — parses its text
// into an expr.Node stored beside the raw string, and an expression error is a
// ParseError at the expression's own position. The template parser still
// owns the positions' structure (pipe splitting, header shapes, the {#for}
// forms); expr owns everything inside one expression.

func toExprPos(p Position) expr.Pos {
	return expr.Pos{Line: p.Line, Col: p.Col, Offset: p.Offset}
}

// parseExprAt parses src, whose first byte sits at pos in file.
func parseExprAt(src string, pos Position, file string, opts expr.Options) (expr.Node, *ParseError) {
	n, err := expr.Parse(src, toExprPos(pos), opts)
	if err != nil {
		e := err.(*expr.Error)
		return nil, &ParseError{File: file, Line: e.Pos.Line, Col: e.Pos.Col, Message: e.Message, Note: e.Note}
	}
	return n, nil
}

// posCursor maps byte offsets in s, whose first byte sits at base, to file
// positions. Asking for offsets in increasing order costs linear time in
// total, so a long formatter chain or {:when} list stays linear.
type posCursor struct {
	s    string
	base Position
	i    int
	pos  Position
}

func newPosCursor(s string, base Position) *posCursor {
	return &posCursor{s: s, base: base, pos: base}
}

func (c *posCursor) at(j int) Position {
	if j < c.i {
		c.i, c.pos = 0, c.base
	}
	c.pos = c.pos.advance(c.s[c.i:j])
	c.i = j
	return c.pos
}

// exprScope is what an expression position sees: the names the enclosing
// {#for} blocks and <Snippet> bodies bind. The expression parser lets a
// binding be read and never called.
type exprScope struct {
	bindings []string
}

func (s exprScope) valueOpts() expr.Options {
	return expr.Options{Bindings: s.bindings}
}

func (s exprScope) argOpts() expr.Options {
	return expr.Options{Bindings: s.bindings, CallArgument: true}
}

// handlerOpts is an @event value's: `event` is the DOM event there.
func (s exprScope) handlerOpts() expr.Options {
	return expr.Options{Bindings: s.bindings, Handler: true}
}

// scope returns the expression scope at the parser's current position. The
// full slice expression keeps a later bind from writing into it.
func (p *parser) scope() exprScope {
	return exprScope{bindings: p.bound[:len(p.bound):len(p.bound)]}
}

// bind pushes the names a {#for} or <Snippet> binds for its body and returns
// the mark to restore with unbind.
func (p *parser) bind(names ...string) int {
	mark := len(p.bound)
	for _, n := range names {
		if n != "" {
			p.bound = append(p.bound, n)
		}
	}
	return mark
}

func (p *parser) unbind(mark int) { p.bound = p.bound[:mark] }
