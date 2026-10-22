package parser

import (
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

// exprs.go connects the template grammar to the expression language (package
// expr). Every expression position — an interpolation, an attribute value, a
// handler, a block header — parses its text as ONE expression into an
// expr.Node stored beside the raw string, and an expression error is a
// ParseError at the expression's own position. The template parser owns the
// positions' structure (header shapes, the {#for} forms, {:when} lists); expr
// owns everything inside one expression.

func toExprPos(p Position) expr.Pos {
	return expr.Pos{Line: p.Line, Col: p.Col, Offset: p.Offset}
}

// parseExprAt parses src, whose first byte sits at pos in file.
func parseExprAt(src string, pos Position, file string, opts expr.Options) (expr.Node, *ParseError) {
	n, err := expr.Parse(src, toExprPos(pos), opts)
	if err != nil {
		e := err.(*expr.Error)
		return nil, &ParseError{File: file, Line: e.Pos.Line, Col: e.Pos.Col, Message: e.Message, Note: e.Note, code: e.Code}
	}
	return n, nil
}

// posCursor maps byte offsets in s, whose first byte sits at base, to file
// positions. Asking for offsets in increasing order costs linear time in
// total, so a long {:when} list stays linear.
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
// {#for} blocks, <Snippet> bodies and {#let} blocks bind. The expression
// parser lets a binding be read and never called.
type exprScope struct {
	bindings []string
	// first maps each bound name to its lowest index in the parser's binding
	// stack (parser.first). A name is in this scope when that index falls
	// inside bindings, so the lookup stays O(1) however many names a long
	// {#let} block binds. nil when the parser never bound many names.
	first map[string]int
	// maxDepth caps inline-{#if} nesting inside an attribute value (attr.go):
	// ParseMarkup's nesting limit, 0 everywhere else.
	maxDepth int
}

// manyBindings is the scope size past which an expression gets the map
// lookup instead of expr's scan of the slice. Template scopes are a handful
// of names; only a long {#let} block grows past it.
const manyBindings = 32

func (s exprScope) opts() expr.Options {
	o := expr.Options{Bindings: s.bindings}
	if s.first != nil && len(s.bindings) > manyBindings {
		first, n := s.first, len(s.bindings)
		o.IsBinding = func(name string) bool {
			i, ok := first[name]
			return ok && i < n
		}
	}
	return o
}

func (s exprScope) valueOpts() expr.Options { return s.opts() }

// handlerOpts is an @event value's: `event` is the DOM event there.
func (s exprScope) handlerOpts() expr.Options {
	o := s.opts()
	o.Handler = true
	return o
}

// scope returns the expression scope at the parser's current position. The
// full slice expression keeps a later bind from writing into it. A scope is
// used only while its prefix of the stack is intact — scopes nest — so the
// shared first map answers for it.
func (p *parser) scope() exprScope {
	return exprScope{bindings: p.bound[:len(p.bound):len(p.bound)], first: p.first, maxDepth: p.maxDepth}
}

// bind pushes the names a {#for}, <Snippet> or {#let} binds for the nodes
// after it and returns the mark to restore with unbind.
func (p *parser) bind(names ...string) int {
	mark := len(p.bound)
	for _, n := range names {
		if n == "" {
			continue
		}
		if p.first == nil && len(p.bound) >= manyBindings {
			p.first = make(map[string]int, 2*len(p.bound))
			for i, b := range p.bound {
				if _, ok := p.first[b]; !ok {
					p.first[b] = i
				}
			}
		}
		if p.first != nil {
			if _, ok := p.first[n]; !ok {
				p.first[n] = len(p.bound)
			}
		}
		p.bound = append(p.bound, n)
	}
	return mark
}

// unbind pops the stack back to mark. A name leaves first only when its
// lowest occurrence is popped; a shadowed outer one stays.
func (p *parser) unbind(mark int) {
	if p.first != nil {
		for i := mark; i < len(p.bound); i++ {
			if j, ok := p.first[p.bound[i]]; ok && j >= mark {
				delete(p.first, p.bound[i])
			}
		}
	}
	p.bound = p.bound[:mark]
}
