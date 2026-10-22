package parser

import (
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/jsident"
)

// let.go is the {#let} block, an opt-in dialect extension (Options.Let; D172:
// Sites turns it on, PuzzleKit names computed values in data()).
//
// {#let} is a VOID block: it opens no context and has no closer, so it reads
// like a statement in the middle of markup. The single-line form names one
// value; the multiline form names several, one per line:
//
//	{#let
//	  total    = price * qty
//	  discount = member ? total * 0.15 : 0
//	  due      = currency(total - discount)
//	}
//
// The bindings are sequential — each sees the ones above it, never itself —
// and they are scoped to the child list the block sits in: a file's top level,
// an element's children, a {#for} body, one branch of an {#if}, one {:when}
// clause. A later {#let} in the same list may name a value again; the new value
// shadows the old one from that point on. One block may not name a value
// twice.
//
// A binding's right-hand side is one expression (D176), exactly as an
// interpolation's is, so `due = currency(total)` is spelled the way
// `{ currency(total) }` is. There is no control flow inside a {#let}: a
// conditional value is written with the ternary. The names reach every later
// expression in scope as expr Bindings, as {#for} names do: they read, and
// calling one is an error.

// letShape is the one-line reminder appended to a {#let} diagnostic.
const letShape = "a {#let} names values: {#let total = price * qty}"

// unknownBlockErr is the error for a block keyword the grammar does not know.
// With {#let} off it is the message PuzzleKit has always printed; with it on,
// the list of blocks includes {#let} and the spellings other template
// languages use for the same idea point at it.
func unknownBlockErr(file string, pos Position, kw string, opts Options) *ParseError {
	if !opts.Let {
		return errAt(file, pos, "unknown block {#%s} (expected {#if}, {#unless}, {#for}, {#case}, or {#svg})", kw)
	}
	if letTypo(kw) {
		return errAt(file, pos, "unknown block {#%s} — did you mean {#let}? %s", kw, letShape)
	}
	return errAt(file, pos, "unknown block {#%s} (expected {#if}, {#unless}, {#for}, {#case}, {#let}, or {#svg})", kw)
}

// letTypo reports whether kw is a spelling another template language uses for
// {#let}, so an author arriving from one is told the Puzzle word.
func letTypo(kw string) bool {
	switch kw {
	case "assign", "set", "var", "const", "lets", "let_":
		return true
	}
	return false
}

// parseLet parses a {#let} header into its bindings and binds each name for
// the rest of the enclosing child list (parseChildren unbinds it). rest is the
// header text after the keyword, trimmed; restPos is where rest starts in the
// file; pos is the opening brace, where a header-shaped problem is reported.
// Each binding is reported at its own line, so a diagnostic about one line of a
// multiline block points at that line.
func (p *parser) parseLet(rest string, pos, restPos Position) (Node, *ParseError) {
	if strings.TrimSpace(rest) == "" {
		return nil, errAt(p.file, pos, "{#let} requires at least one assignment — %s", letShape)
	}
	let := &Let{Pos: pos}
	// Positions advance through rest once, in order, and names are looked up
	// in a map, so a block of any length parses in linear time.
	at := newPosCursor(rest, restPos)
	named := map[string]Position{}
	cursor := 0
	// Assignments are one per line. Splitting at top level keeps a newline
	// inside a string literal or inside brackets out of the split.
	for _, line := range splitTopLevel(rest, '\n') {
		start := cursor
		cursor += len(line) + 1
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		lineAt := at.at(start + len(line) - len(strings.TrimLeft(line, " \t\r")))
		binding, perr := p.parseLetBinding(text, lineAt)
		if perr != nil {
			return nil, perr
		}
		if prev, dup := named[binding.Name]; dup {
			return nil, errAt(p.file, binding.NamePos, "{#let} names %q twice in one block — already assigned at %d:%d",
				binding.Name, prev.Line, prev.Col)
		}
		named[binding.Name] = binding.NamePos
		let.Bindings = append(let.Bindings, binding)
		// Sequential: the next assignment, and everything after the block,
		// sees this name.
		p.bind(binding.Name)
	}
	if len(let.Bindings) == 0 {
		return nil, errAt(p.file, pos, "{#let} requires at least one assignment — %s", letShape)
	}
	return let, nil
}

// parseLetBinding parses one `name = expression` assignment, its value in the
// scope before the name is bound. at locates the assignment's first byte.
func (p *parser) parseLetBinding(text string, at Position) (LetBinding, *ParseError) {
	eq := letAssignmentOp(text)
	if eq < 0 {
		return LetBinding{}, errAt(p.file, at, "{#let} assignment %q is missing '=' — write name = expression, one per line", text)
	}
	name := strings.TrimSpace(text[:eq])
	raw := strings.TrimSpace(text[eq+1:])
	if name == "" {
		return LetBinding{}, errAt(p.file, at, "{#let} assignment is missing a name — write name = expression")
	}
	if !expr.IsIdentifier(name) {
		return LetBinding{}, errAt(p.file, at, "{#let} name %q is not a name — use letters, digits and underscores, starting with a letter", name)
	}
	if jsident.IsReservedBindingIdentifier(name) {
		return LetBinding{}, errAt(p.file, at, "{#let} name %q is reserved", name)
	}
	// The language's one binding-name rule (expr.BindingNameReason), which
	// {#for} names, snippet parameters and arrow parameters follow too.
	if reason := expr.BindingNameReason(name); reason != "" {
		return LetBinding{}, errAt(p.file, at, "{#let} name %q %s", name, reason)
	}
	if raw == "" {
		return LetBinding{}, errAt(p.file, at, "{#let} assignment %q is missing a value — write name = expression", name)
	}
	exprAt := at.advance(text[:eq+1])
	exprAt = exprAt.advance(text[eq+1 : len(text)-len(strings.TrimLeft(text[eq+1:], " \t"))])
	ast, perr := parseExprAt(raw, exprAt, p.file, p.scope().valueOpts())
	if perr != nil {
		return LetBinding{}, perr
	}
	return LetBinding{
		Name:    name,
		Interp:  &Interpolation{Expr: raw, ExprAST: ast, Pos: exprAt},
		NamePos: at,
		ExprPos: exprAt,
	}, nil
}

// letAssignmentOp returns the byte offset of the assignment '=' in text, or
// -1. It skips the comparison operators, so `a == b` is not an assignment, and
// only looks at the top level, so an '=' inside a string or brackets is not one
// either.
func letAssignmentOp(text string) int {
	depth := 0
	prevEndsExpr := false
	for i := 0; i < len(text); {
		if next, pee, consumed := LexSkip(text, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		c := text[i]
		switch c {
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case '=':
			if depth == 0 && i+1 < len(text) && text[i+1] == '=' {
				// ==, === — a comparison, not the assignment.
				i += 2
				prevEndsExpr = false
				continue
			}
			if depth == 0 && i > 0 && !letComparisonLead(text[i-1]) {
				return i
			}
		}
		prevEndsExpr = LexPlainEndsExpr(c, prevEndsExpr)
		i++
	}
	return -1
}

// letComparisonLead reports whether c turns a following '=' into part of an
// operator rather than the assignment.
func letComparisonLead(c byte) bool {
	return c == '!' || c == '<' || c == '>' || c == '=' || c == '+' || c == '-' || c == '*' || c == '/' || c == '%'
}
