// Package expr is the Puzzle expression language: the lexer, parser, and AST
// for everything written between a template's braces. Both hosts consume the
// same tree — PuzzleKit lowers it to JavaScript, Magic Spells Sites evaluates
// it in Go — so the package holds syntax, positions, and names only: no
// lowering, no evaluation, no knowledge of which host is asking.
//
// The grammar is a closed, JavaScript-shaped subset (literals, paths, calls,
// call-argument arrow functions, and the arithmetic, comparison, and logical
// operators, all with JavaScript precedence). Anything outside it is a
// positioned *Error naming the construct. The shared fixtures in
// ../conformance/expressions-parse.json are the contract; Print renders the
// tree in the compact form those fixtures use, and PrintPositions its node
// positions.
//
// One PuzzleKit-only extension: in an @event handler value (Options.Handler)
// the free name `event` is the browser's DOM event, and a member chain rooted
// at it is unrestricted — any property, any method (`event.target.closest('li')`,
// `event.preventDefault()`), no method-table check — because it is not
// template data. A bound `event` shadows it, as in JavaScript, and its chain
// is ordinary data. Outside a handler `event` is an ordinary name that reads
// the data field or prop of that name. Sites has no handlers, so the
// extension never applies there.
//
// Names a template binds — arrow parameters, {#for} items and counters,
// <Snippet> parameters, Sites' {#let} — follow one rule (IsIdentifier and
// BindingNameReason), and a bound name is a value: it reads, and calling it
// is an error.
package expr

// Pos is a source position: 1-based line and column plus the 0-based byte
// offset, all relative to the file the expression came from (the base passed
// to Parse). Columns count bytes and only '\n' starts a new line — the
// convention parser.Position uses, so an expression error and a template error
// on the same line agree.
type Pos struct {
	Line   int
	Col    int
	Offset int
}

// Node is any expression node. Pos is where the node's source text starts —
// its first token, which for a parenthesized expression is the first token
// inside the parentheses.
type Node interface {
	Pos() Pos
	node()
}

// LiteralKind says which JavaScript primitive a Literal holds.
type LiteralKind int

const (
	LitString LiteralKind = iota
	LitNumber
	LitBool
	LitNull
	LitUndefined
)

// Literal is a string, number, true/false, null, or undefined. Str holds a
// string's cooked value (escapes resolved), Num a number's value, Bool a
// boolean's. Raw is the literal as written. `NaN` and `Infinity` are number
// literals (Num NaN and +Inf), never names; `-Infinity` is a Unary over one.
type Literal struct {
	Start Pos
	Kind  LiteralKind
	Str   string
	Num   float64
	Bool  bool
	Raw   string
}

// TemplateLiteral is `a ${x} b`. Quasis holds the cooked text segments and
// always has exactly one more element than Exprs: Quasis[0] Exprs[0]
// Quasis[1] … Quasis[n].
type TemplateLiteral struct {
	Start  Pos
	Quasis []string
	Exprs  []Node
}

// Identifier is a bare name read: a data field, a loop or snippet binding,
// an arrow-function parameter, or (in an event handler) `event`. As a Call
// callee it names a library function. Which of those it is, is scope
// resolution — the host's job.
type Identifier struct {
	Start Pos
	Name  string
}

// Member is a property read: `a.b` and `a?.b` (Computed false, Property
// set), or `a[i]` and `a?.[i]` (Computed true, Index set). Optional marks the
// `?.` link. PropPos is where the property name (or the `[`) starts.
type Member struct {
	Start    Pos
	Object   Node
	Property string
	Index    Node
	Optional bool
	Computed bool
	PropPos  Pos
}

// Call is a call. The Callee is always one of:
//   - *Identifier — a library function, `currency(price)`;
//   - *Global — a JavaScript global the language allows, `Math.round(x)`;
//   - *Member, non-computed — a method, `name.trim()` or `name?.trim()`,
//     whose name the parser has checked against the method table.
//
// An optional-chain call (`f?.()`) is not in the grammar, so a Call carries
// no optional flag of its own: the `?.` of `a?.m()` is on the callee Member.
type Call struct {
	Start  Pos
	Callee Node
	Args   []Node
}

// Param is one arrow-function parameter.
type Param struct {
	Name  string
	Start Pos
}

// Arrow is `x => body` or `(x, i) => body`. The grammar allows one only as a
// call argument, and its body is a single expression.
type Arrow struct {
	Start  Pos
	Params []Param
	Body   Node
}

// Unary is `!x`, `-x`, or `+x`.
type Unary struct {
	Start   Pos
	Op      string
	Operand Node
}

// Binary is an arithmetic, equality, or relational operator:
// `* / % + - < <= > >= == != === !==`. OpPos is where the operator is.
type Binary struct {
	Start Pos
	Op    string
	OpPos Pos
	Left  Node
	Right Node
}

// Logical is `&&`, `||`, or `??`. OpPos is where the operator is.
type Logical struct {
	Start Pos
	Op    string
	OpPos Pos
	Left  Node
	Right Node

	// grouped records that the node was written inside parentheses, which is
	// what makes `(a || b) ?? c` legal where `a || b ?? c` is not.
	grouped bool
}

// Conditional is `test ? consequent : alternate`.
type Conditional struct {
	Start      Pos
	Test       Node
	Consequent Node
	Alternate  Node
}

// Array is `[a, b]`.
type Array struct {
	Start    Pos
	Elements []Node
}

// Entry is one `key: value` of an Object. A shorthand entry `{ k }` has Value
// set to the Identifier k.
type Entry struct {
	Key       string
	KeyPos    Pos
	Value     Node
	Shorthand bool
}

// Object is `{ k: v, 'k': v, k }`.
type Object struct {
	Start   Pos
	Entries []Entry
}

// Global is a JavaScript global the language allows: a function, only ever as
// a Call callee — `Math.round` (Namespace "Math", Name "round") or `Number`
// (Namespace "", Name "Number") — or a readable constant, `Math.PI` or
// `Math.E`. See GlobalFunctions and GlobalConstants. A global is never a
// value on its own: `Math`, `items.filter(Boolean)`, and `Math.round`
// uncalled are errors, so a data field named after a global is unreachable.
type Global struct {
	Start     Pos
	Namespace string
	Name      string
}

// Chain marks the extent of an optional chain, as ESTree's ChainExpression
// does: `a?.b.c` is Chain(Member(Member(a, b, optional), c)). A nullish value
// at a `?.` link short-circuits everything inside the Chain to undefined and
// nothing outside it, which is why `(a?.b).c` — a Chain inside a Member — is
// a different tree from `a?.b.c`.
type Chain struct {
	Start Pos
	Expr  Node
}

func (n *Literal) Pos() Pos         { return n.Start }
func (n *TemplateLiteral) Pos() Pos { return n.Start }
func (n *Identifier) Pos() Pos      { return n.Start }
func (n *Member) Pos() Pos          { return n.Start }
func (n *Call) Pos() Pos            { return n.Start }
func (n *Arrow) Pos() Pos           { return n.Start }
func (n *Unary) Pos() Pos           { return n.Start }
func (n *Binary) Pos() Pos          { return n.Start }
func (n *Logical) Pos() Pos         { return n.Start }
func (n *Conditional) Pos() Pos     { return n.Start }
func (n *Array) Pos() Pos           { return n.Start }
func (n *Object) Pos() Pos          { return n.Start }
func (n *Global) Pos() Pos          { return n.Start }
func (n *Chain) Pos() Pos           { return n.Start }

func (*Literal) node()         {}
func (*TemplateLiteral) node() {}
func (*Identifier) node()      {}
func (*Member) node()          {}
func (*Call) node()            {}
func (*Arrow) node()           {}
func (*Unary) node()           {}
func (*Binary) node()          {}
func (*Logical) node()         {}
func (*Conditional) node()     {}
func (*Array) node()           {}
func (*Object) node()          {}
func (*Global) node()          {}
func (*Chain) node()           {}

// Walk visits n and its descendants depth-first, in source order. When visit
// returns false the node's children are skipped. Arrow parameters and Member
// property names are not nodes and are not visited; a computed Member's Index
// is.
func Walk(n Node, visit func(Node) bool) {
	if n == nil || !visit(n) {
		return
	}
	switch n := n.(type) {
	case *TemplateLiteral:
		for _, e := range n.Exprs {
			Walk(e, visit)
		}
	case *Member:
		Walk(n.Object, visit)
		if n.Computed {
			Walk(n.Index, visit)
		}
	case *Call:
		Walk(n.Callee, visit)
		for _, a := range n.Args {
			Walk(a, visit)
		}
	case *Arrow:
		Walk(n.Body, visit)
	case *Unary:
		Walk(n.Operand, visit)
	case *Binary:
		Walk(n.Left, visit)
		Walk(n.Right, visit)
	case *Logical:
		Walk(n.Left, visit)
		Walk(n.Right, visit)
	case *Conditional:
		Walk(n.Test, visit)
		Walk(n.Consequent, visit)
		Walk(n.Alternate, visit)
	case *Array:
		for _, e := range n.Elements {
			Walk(e, visit)
		}
	case *Object:
		for _, e := range n.Entries {
			Walk(e.Value, visit)
		}
	case *Chain:
		Walk(n.Expr, visit)
	}
}
