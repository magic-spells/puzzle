package expr

import (
	"fmt"
	"math"
	"sync"
)

// parser.go is a Pratt (precedence-climbing) parser over the token slice.
// Binary operators with the same precedence loop instead of recursing, so a
// long flat chain parses in linear time and constant stack; nesting — groups,
// unary operators, conditionals, arrow bodies, literals — recurses and is
// capped at maxDepth.

// Options adjusts Parse for the position the expression sits in.
type Options struct {
	// Handler marks an @event handler value — a PuzzleKit extension; Sites has
	// no handlers. There the FREE name `event` is the DOM event, so a member
	// chain rooted at it reads any property and calls any method
	// (`event.target.closest('li')`, `event.preventDefault()`) with no
	// method-table check — the browser's Event object is not template data. A
	// bound `event` (a binding or an arrow parameter) shadows it, as in
	// JavaScript, and its chain is ordinary data. Outside a handler a free
	// `event` is an error. The handler's own call (the whole value, or a
	// branch of a top-level conditional) names a view handler, so it may share
	// a name with a binding.
	Handler bool
	// Bindings are the names the enclosing template constructs bind: {#for}
	// items and counters and <Snippet> parameters (in Sites, {#let} names).
	// A binding is a value: reading it is legal, calling it is an error, so
	// `t('key')` inside `{#for t in …}` never reaches the library's `t`.
	Bindings []string
}

// maxDepth caps syntactic nesting (groups, unary operators, conditionals,
// literals, arrow bodies, calls). No template comes near it; it keeps a
// hostile or generated expression from exhausting the stack.
const maxDepth = 500

// Parse parses src, one expression whose first byte sits at base in the file,
// and returns its tree. Every node position and every error position is in
// file coordinates. The error, when there is one, is an *Error. opts is at
// most one Options value.
func Parse(src string, base Pos, opts ...Options) (n Node, err error) {
	buf := tokenBuffers.Get().(*[]token)
	p := &parser{toks: lex(src, base, *buf)}
	if len(opts) > 0 {
		p.opts = opts[0]
	}
	p.matchParens()
	defer func() {
		// The tree holds no token, so the buffer goes back for the next parse
		// — a template parses thousands of short expressions, and regrowing a
		// fresh token slice for each dominated parse-time allocation. A buffer
		// grown by a huge expression is dropped rather than kept.
		if cap(p.toks) <= maxPooledTokens {
			clear(p.toks)
			*buf = p.toks[:0]
			tokenBuffers.Put(buf)
		}
		if r := recover(); r != nil {
			b, ok := r.(bailout)
			if !ok {
				panic(r)
			}
			n, err = nil, b.err
		}
	}()
	n = p.parseTop()
	p.checkBindingCalls(n)
	p.checkAmbient(n)
	return n, nil
}

// checkAmbient rejects a read of a browser global (ambientGlobals) as a data
// root. parseName records each unbound, uncalled candidate; a handler value's
// own name — the whole value, or a branch of its top-level conditional —
// names a view handler, not the global, so it is exempt. It runs on the
// finished tree because which name is the handler's own shows only in the
// tree's shape.
func (p *parser) checkAmbient(root Node) {
	if len(p.ambient) == 0 {
		return
	}
	own := map[Node]bool{}
	if p.opts.Handler {
		own[root] = true
		if c, ok := root.(*Conditional); ok {
			own[c.Consequent] = true
			own[c.Alternate] = true
		}
	}
	for _, id := range p.ambient {
		if !own[id] {
			p.fail(id.Start, ambientMessage(id.Name))
		}
	}
}

// checkBindingCalls rejects a call whose callee is a template binding. It runs
// on the finished tree because a handler's own call is exempt, and which call
// that is shows only in the tree's shape. (An arrow parameter called in its
// body is rejected while parsing; see callee.)
func (p *parser) checkBindingCalls(root Node) {
	if len(p.opts.Bindings) == 0 {
		return
	}
	var handlerCalls []Node
	if p.opts.Handler {
		handlerCalls = append(handlerCalls, root)
		if c, ok := root.(*Conditional); ok {
			handlerCalls = append(handlerCalls, c.Consequent, c.Alternate)
		}
	}
	Walk(root, func(n Node) bool {
		c, ok := n.(*Call)
		if !ok {
			return true
		}
		id, ok := c.Callee.(*Identifier)
		if !ok || !p.isBinding(id.Name) {
			return true
		}
		for _, h := range handlerCalls {
			if h == n {
				return true
			}
		}
		p.fail(id.Start, "`"+id.Name+"` is a template variable here and cannot be called")
		return false
	})
}

func (p *parser) isBinding(name string) bool {
	for _, b := range p.opts.Bindings {
		if b == name {
			return true
		}
	}
	return false
}

// eventBound reports whether `event` is bound here — by the template or by
// an enclosing arrow function — and so names a value, not the DOM event.
func (p *parser) eventBound() bool {
	if p.isBinding("event") {
		return true
	}
	for _, name := range p.params {
		if name == "event" {
			return true
		}
	}
	return false
}

// isDOMEvent reports whether the name `event` here is a handler's DOM event:
// in a handler, and not shadowed by a binding.
func (p *parser) isDOMEvent() bool {
	return p.opts.Handler && !p.eventBound()
}

const maxPooledTokens = 4096

var tokenBuffers = sync.Pool{New: func() any {
	buf := make([]token, 0, 64)
	return &buf
}}

type bailout struct{ err *Error }

type parser struct {
	toks  []token
	k     int
	opts  Options
	depth int
	// match maps the index of a `(` token to the index of its `)`, or -1. It is
	// built only when the source holds a `=>`, the one place the parser needs
	// to look past a parenthesized group before parsing it.
	match []int
	// params are the arrow-function parameters in scope, innermost last.
	params []string
	// ambient are the reads of a browser global parseName saw, for
	// checkAmbient.
	ambient []*Identifier
}

func (p *parser) matchParens() {
	hasArrow := false
	for i := range p.toks {
		if isPunct(&p.toks[i], "=>") {
			hasArrow = true
			break
		}
	}
	if !hasArrow {
		return
	}
	p.match = make([]int, len(p.toks))
	var stack []int
	for i := range p.toks {
		t := &p.toks[i]
		p.match[i] = -1
		if t.kind != tPunct {
			continue
		}
		switch t.text {
		case "(":
			stack = append(stack, i)
		case ")":
			if len(stack) > 0 {
				p.match[stack[len(stack)-1]] = i
				stack = stack[:len(stack)-1]
			}
		}
	}
}

func (p *parser) cur() *token { return &p.toks[p.k] }

func (p *parser) peek(n int) *token {
	if p.k+n < len(p.toks) {
		return &p.toks[p.k+n]
	}
	return &p.toks[len(p.toks)-1]
}

func (p *parser) advance() {
	if p.k < len(p.toks)-1 {
		p.k++
	}
}

func isPunct(t *token, s string) bool { return t.kind == tPunct && t.text == s }

func (p *parser) fail(at Pos, msg string) {
	panic(bailout{&Error{Pos: at, Message: msg}})
}

func (p *parser) enter(at Pos) {
	p.depth++
	if p.depth > maxDepth {
		p.fail(at, msgTooDeep)
	}
}

func (p *parser) leave() { p.depth-- }

// describe names a token for an "unexpected …" message.
func describe(t *token) string {
	switch t.kind {
	case tEOF:
		return "end of the expression"
	case tIdent:
		if reservedMessage(t.text) != "" {
			return "`" + t.text + "`"
		}
		return "name `" + t.text + "`"
	case tNumber:
		return "number `" + t.text + "`"
	case tString:
		return "string " + t.text
	case tTemplate, tTemplateHead:
		return "template literal"
	case tTemplateMiddle, tTemplateTail:
		return "`}`"
	}
	return "`" + t.text + "`"
}

// unexpected fails at t: with the lexer's error when t is one, otherwise
// "unexpected …".
func (p *parser) unexpected(t *token) {
	if t.kind == tError {
		panic(bailout{t.ext.err})
	}
	p.fail(t.pos, "unexpected "+describe(t))
}

// expectClose consumes the closer that ends the group opened by open, or
// fails at whatever stands there instead.
func (p *parser) expectClose(closer string, open *token) {
	t := p.cur()
	if isPunct(t, closer) {
		p.advance()
		return
	}
	if t.kind == tError {
		panic(bailout{t.ext.err})
	}
	p.fail(t.pos, fmt.Sprintf("expected `%s` to close the `%s` at %d:%d", closer, open.text, open.pos.Line, open.pos.Col))
}

func (p *parser) parseTop() Node {
	t := p.cur()
	if t.kind == tEOF {
		p.fail(t.pos, msgExpected)
	}
	n := p.parseExpr()
	t = p.cur()
	switch {
	case t.kind == tEOF:
		return n
	case isPunct(t, ","):
		p.fail(t.pos, msgComma)
	case isPunct(t, ";"):
		p.fail(t.pos, msgSemicolon)
	}
	p.unexpected(t)
	return nil
}

// parseExpr parses a conditional expression — the grammar's full expression,
// JavaScript's AssignmentExpression without assignment, arrows, or yield.
func (p *parser) parseExpr() Node {
	p.enter(p.cur().pos)
	defer p.leave()
	test := p.parseBinary(0)
	q := p.cur()
	if !isPunct(q, "?") {
		return test
	}
	p.advance()
	cons := p.parseExpr()
	c := p.cur()
	if !isPunct(c, ":") {
		if c.kind == tError {
			panic(bailout{c.ext.err})
		}
		p.fail(c.pos, fmt.Sprintf("expected `:` to complete the `?` at %d:%d", q.pos.Line, q.pos.Col))
	}
	p.advance()
	alt := p.parseExpr()
	return &Conditional{Start: test.Pos(), Test: test, Consequent: cons, Alternate: alt}
}

// binaryPrecedence is the binding power of each binary operator the grammar
// has, per JavaScript. `??` shares the lowest level with `||`; mixing the two,
// or `??` with `&&`, needs parentheses (checkCoalesceMix).
var binaryPrecedence = map[string]int{
	"??": 1, "||": 1,
	"&&": 2,
	"==": 3, "!=": 3, "===": 3, "!==": 3,
	"<": 4, "<=": 4, ">": 4, ">=": 4,
	"+": 5, "-": 5,
	"*": 6, "/": 6, "%": 6,
}

// excludedOperators are JavaScript binary, assignment, and update operators
// the grammar leaves out, each with its message.
var excludedOperators = map[string]string{
	"&": msgBitwise, "^": msgBitwise, "<<": msgBitwise, ">>": msgBitwise, ">>>": msgBitwise,
	"**": msgExponent,
	"=":  msgAssign, "+=": msgAssign, "-=": msgAssign, "*=": msgAssign, "/=": msgAssign, "%=": msgAssign,
	"**=": msgAssign, "<<=": msgAssign, ">>=": msgAssign, ">>>=": msgAssign, "&=": msgAssign,
	"|=": msgAssign, "^=": msgAssign, "&&=": msgAssign, "||=": msgAssign, "??=": msgAssign,
	"++": msgUpdate, "--": msgUpdate, "~": msgBitwise,
}

func (p *parser) parseBinary(minBP int) Node {
	left := p.parseUnary()
	for {
		t := p.cur()
		bp := 0
		if t.kind == tPunct {
			bp = binaryPrecedence[t.text]
			if bp == 0 {
				if t.text == "|" {
					name := ""
					if next := p.peek(1); next.kind == tIdent {
						name = next.text
					}
					panic(bailout{&Error{Pos: t.pos, Message: pipeMessage(name), Code: CodePipe}})
				}
				if msg, ok := excludedOperators[t.text]; ok {
					p.fail(t.pos, msg)
				}
			}
		} else if t.kind == tIdent && (t.text == "in" || t.text == "instanceof") {
			p.fail(t.pos, keywordMessages[t.text])
		}
		if bp <= minBP {
			return left
		}
		p.advance()
		right := p.parseBinary(bp)
		switch t.text {
		case "&&", "||", "??":
			p.checkCoalesceMix(t.text, t.pos, left, right)
			left = &Logical{Start: left.Pos(), Op: t.text, OpPos: t.pos, Left: left, Right: right}
		default:
			left = &Binary{Start: left.Pos(), Op: t.text, OpPos: t.pos, Left: left, Right: right}
		}
	}
}

// checkCoalesceMix rejects `??` combined with `||` or `&&` without
// parentheses, a SyntaxError in JavaScript. The error sits on whichever of
// the two operators comes second.
func (p *parser) checkCoalesceMix(op string, opPos Pos, left, right Node) {
	mixes := func(n Node) (*Logical, bool) {
		l, ok := n.(*Logical)
		if !ok || l.grouped {
			return nil, false
		}
		return l, (op == "??") != (l.Op == "??")
	}
	if l, bad := mixes(left); bad {
		p.fail(opPos, coalesceMessage(op, l.Op))
	}
	if r, bad := mixes(right); bad {
		p.fail(r.OpPos, coalesceMessage(op, r.Op))
	}
}

func coalesceMessage(a, b string) string {
	other := a
	if a == "??" {
		other = b
	}
	return "`??` cannot be mixed with `" + other + "` without parentheses — write `(a ?? b) " + other + " c` or `a ?? (b " + other + " c)`"
}

func (p *parser) parseUnary() Node {
	t := p.cur()
	p.enter(t.pos)
	defer p.leave()
	switch t.kind {
	case tPunct:
		switch t.text {
		case "!", "-", "+":
			p.advance()
			operand := p.parseUnary()
			return &Unary{Start: t.pos, Op: t.text, Operand: operand}
		case "~":
			p.fail(t.pos, msgBitwise)
		case "++", "--":
			p.fail(t.pos, msgUpdate)
		}
	case tIdent:
		switch t.text {
		case "typeof", "void", "delete", "await":
			p.fail(t.pos, keywordMessages[t.text])
		}
	}
	return p.parsePostfix()
}

// parsePostfix parses a primary expression and its member accesses and calls.
// A chain holding a `?.` link is wrapped in a Chain node.
func (p *parser) parsePostfix() Node {
	n := p.parsePrimary()
	// A chain rooted at a handler's DOM `event` is the browser's Event, not
	// template data: its members and methods are unrestricted. A bound
	// `event` shadows it, and its chain is data.
	domEvent := rootIsEvent(n) && p.isDOMEvent()
	optional := false
	for {
		t := p.cur()
		switch {
		case isPunct(t, "."):
			p.advance()
			n = p.memberName(n, false, domEvent)
		case isPunct(t, "?."):
			optional = true
			p.advance()
			c := p.cur()
			switch {
			case isPunct(c, "("):
				p.fail(t.pos, msgOptionalCall)
			case isPunct(c, "["):
				p.advance()
				idx := p.parseExpr()
				p.expectClose("]", c)
				n = &Member{Start: n.Pos(), Object: n, Index: idx, Optional: true, Computed: true, PropPos: c.pos}
			case c.kind == tTemplate || c.kind == tTemplateHead:
				p.fail(c.pos, msgTaggedTemplate)
			default:
				n = p.memberName(n, true, domEvent)
			}
		case isPunct(t, "["):
			p.advance()
			idx := p.parseExpr()
			p.expectClose("]", t)
			n = &Member{Start: n.Pos(), Object: n, Index: idx, Computed: true, PropPos: t.pos}
		case isPunct(t, "("):
			callee := p.callee(n, t, domEvent)
			p.advance()
			args := p.parseArgs(t)
			n = &Call{Start: n.Pos(), Callee: callee, Args: args}
		case t.kind == tTemplate || t.kind == tTemplateHead:
			p.fail(t.pos, msgTaggedTemplate)
		default:
			if optional {
				return &Chain{Start: n.Pos(), Expr: n}
			}
			return n
		}
	}
}

// rootIsEvent reports whether the member/call chain n starts at the name
// `event`, parentheses and optional chains included.
func rootIsEvent(n Node) bool {
	for {
		switch m := n.(type) {
		case *Member:
			n = m.Object
		case *Call:
			n = m.Callee
		case *Chain:
			n = m.Expr
		case *Identifier:
			return m.Name == "event"
		default:
			return false
		}
	}
}

// memberName finishes `obj.name` / `obj?.name`: any IdentifierName, reserved
// words included, as in JavaScript. domEvent lifts the prototype-name rule on
// a handler's DOM event chain.
func (p *parser) memberName(obj Node, optional, domEvent bool) Node {
	t := p.cur()
	if t.kind != tIdent {
		if t.kind == tError {
			panic(bailout{t.ext.err})
		}
		p.fail(t.pos, "expected a property name after `.`, found "+describe(t))
	}
	if prototypeNames[t.text] && !domEvent {
		p.fail(t.pos, prototypeMessage(t.text))
	}
	p.advance()
	return &Member{Start: obj.Pos(), Object: obj, Property: t.text, Optional: optional, PropPos: t.pos}
}

// callee checks what is about to be called at open and returns the callee
// node: a library function name, a Global, or a method whose name is in the
// table — checked against the receiver's type when that type is certain from
// the syntax alone (receiverType). On a handler's DOM event chain (domEvent)
// any method is callable. It runs before the arguments are parsed so an error
// in the callee is reported before one further along in the source.
func (p *parser) callee(n Node, open *token, domEvent bool) Node {
	switch c := n.(type) {
	case *Identifier:
		for _, prm := range p.params {
			if prm == c.Name {
				p.fail(c.Start, "`"+c.Name+"` is a parameter here and cannot be called")
			}
		}
		if c.Name == "event" && p.isDOMEvent() {
			p.fail(c.Start, "`event` is the DOM event here and cannot be called")
		}
		return c
	case *Global:
		if IsGlobalConstant(c.Namespace, c.Name) {
			p.fail(open.pos, constantCallMessage(c.Namespace, c.Name))
		}
		return c
	case *Member:
		if c.Computed {
			p.fail(c.PropPos, msgComputedCall)
		}
		if domEvent {
			return c
		}
		if c.Property == "length" {
			p.fail(c.PropPos, msgLengthCall)
		}
		if typ := receiverType(c.Object); typ != "" {
			if !typeHasMethod(typ, c.Property) {
				p.fail(c.PropPos, "`."+c.Property+"()` is not available on "+typ+" in template expressions")
			}
			return c
		}
		if !IsMethod(c.Property) {
			receiver := ""
			if obj, ok := c.Object.(*Identifier); ok {
				receiver = obj.Name
			}
			p.fail(c.PropPos, methodMessage(c.Property, receiver))
		}
		return c
	case *Call:
		p.fail(open.pos, msgCallResult)
	}
	p.fail(open.pos, msgNotCallable)
	return nil
}

// parseArgs parses a call's arguments after its `(`. A trailing comma is
// allowed, as in JavaScript.
func (p *parser) parseArgs(open *token) []Node {
	p.enter(open.pos)
	defer p.leave()
	var args []Node
	for {
		t := p.cur()
		switch {
		case isPunct(t, ")"):
			p.advance()
			return args
		case isPunct(t, ","):
			p.fail(t.pos, msgEmptyArg)
		case isPunct(t, "..."):
			p.fail(t.pos, msgSpreadCall)
		}
		args = append(args, p.parseArgument())
		t = p.cur()
		if isPunct(t, ",") {
			p.advance()
			continue
		}
		p.expectClose(")", open)
		return args
	}
}

// parseArgument parses one call argument: an arrow function or an expression.
func (p *parser) parseArgument() Node {
	if p.arrowAhead() {
		return p.parseArrow()
	}
	return p.parseExpr()
}

// arrowAhead reports whether an arrow function starts at the current token: a
// name followed by `=>`, or a parenthesized group followed by `=>`.
func (p *parser) arrowAhead() bool {
	t := p.cur()
	if t.kind == tIdent {
		return isPunct(p.peek(1), "=>")
	}
	if isPunct(t, "(") && p.match != nil {
		if j := p.match[p.k]; j >= 0 && j+1 < len(p.toks) {
			return isPunct(&p.toks[j+1], "=>")
		}
	}
	return false
}

func (p *parser) parseArrow() Node {
	start := p.cur()
	p.enter(start.pos)
	defer p.leave()
	var params []Param
	seen := map[string]bool{}
	param := func(t *token) {
		if t.kind != tIdent {
			if t.kind == tError {
				panic(bailout{t.ext.err})
			}
			p.fail(t.pos, msgArrowParam)
		}
		// The token is identifier-shaped; the binding-name rule is the one
		// {#for} and <Snippet> bindings follow.
		if reason := BindingNameReason(t.text); reason != "" {
			p.fail(t.pos, "`"+t.text+"` "+reason)
		}
		if seen[t.text] {
			p.fail(t.pos, "duplicate arrow function parameter `"+t.text+"`")
		}
		seen[t.text] = true
		params = append(params, Param{Name: t.text, Start: t.pos})
	}
	if start.kind == tIdent {
		param(start)
		p.advance()
	} else {
		p.advance() // (
		for !isPunct(p.cur(), ")") {
			param(p.cur())
			p.advance()
			if isPunct(p.cur(), ",") {
				p.advance()
				continue
			}
			if !isPunct(p.cur(), ")") {
				p.fail(p.cur().pos, msgArrowParam)
			}
		}
		p.advance() // )
	}
	arrow := p.cur()
	if arrow.nl {
		p.fail(arrow.pos, msgArrowNewline)
	}
	p.advance() // =>
	if isPunct(p.cur(), "{") {
		p.fail(p.cur().pos, msgArrowBlock)
	}
	mark := len(p.params)
	for _, prm := range params {
		p.params = append(p.params, prm.Name)
	}
	body := p.parseExpr()
	p.params = p.params[:mark]
	return &Arrow{Start: start.pos, Params: params, Body: body}
}

func (p *parser) parsePrimary() Node {
	t := p.cur()
	switch t.kind {
	case tNumber:
		p.advance()
		return &Literal{Start: t.pos, Kind: LitNumber, Num: t.num, Raw: t.text}
	case tString:
		p.advance()
		return &Literal{Start: t.pos, Kind: LitString, Str: t.str, Raw: t.text}
	case tTemplate:
		p.advance()
		return &TemplateLiteral{Start: t.pos, Quasis: []string{t.str}}
	case tTemplateHead:
		return p.parseTemplate()
	case tIdent:
		return p.parseName()
	case tPunct:
		switch t.text {
		case "(":
			return p.parseGroup()
		case "[":
			return p.parseArray()
		case "{":
			return p.parseObject()
		case "/", "/=":
			p.fail(t.pos, msgRegex)
		case "...":
			p.fail(t.pos, msgSpread)
		case ";":
			p.fail(t.pos, msgSemicolon)
		}
	case tEOF:
		p.fail(t.pos, msgExpected)
	}
	p.unexpected(t)
	return nil
}

// parseName parses a primary that starts with a name: a literal word, a
// reserved word (an error), or an identifier read.
func (p *parser) parseName() Node {
	t := p.cur()
	switch t.text {
	case "true", "false":
		p.advance()
		return &Literal{Start: t.pos, Kind: LitBool, Bool: t.text == "true", Raw: t.text}
	case "null":
		p.advance()
		return &Literal{Start: t.pos, Kind: LitNull, Raw: t.text}
	case "undefined":
		p.advance()
		return &Literal{Start: t.pos, Kind: LitUndefined, Raw: t.text}
	case "NaN":
		p.advance()
		return &Literal{Start: t.pos, Kind: LitNumber, Num: math.NaN(), Raw: t.text}
	case "Infinity":
		p.advance()
		return &Literal{Start: t.pos, Kind: LitNumber, Num: math.Inf(1), Raw: t.text}
	}
	if isPunct(p.peek(1), "=>") {
		p.fail(t.pos, msgArrowPlace)
	}
	if msg := reservedMessage(t.text); msg != "" {
		p.fail(t.pos, msg)
	}
	if isGlobalNamespace(t.text) {
		return p.parseNamespaceMember()
	}
	if IsGlobalFunction("", t.text) {
		return p.parseGlobalFunction()
	}
	if t.text == "event" && !p.opts.Handler && !p.eventBound() {
		p.fail(t.pos, msgEvent)
	}
	id := &Identifier{Start: t.pos, Name: t.text}
	if !isPunct(p.peek(1), "(") {
		p.noteAmbient(id)
	}
	p.advance()
	return id
}

// noteAmbient records a read of a browser global object (ambientGlobals) as a
// data root, unless a template binding or an arrow parameter owns the name.
// checkAmbient reports it once the tree is complete.
func (p *parser) noteAmbient(id *Identifier) {
	if _, ok := ambientGlobals[id.Name]; ok && !p.isBinding(id.Name) && !p.isParam(id.Name) {
		p.ambient = append(p.ambient, id)
	}
}

// isParam reports whether name is an arrow-function parameter in scope.
func (p *parser) isParam(name string) bool {
	for _, n := range p.params {
		if n == name {
			return true
		}
	}
	return false
}

// parseNamespaceMember parses `Math.round`, `Object.keys`, `Array.isArray`, or
// a readable constant (`Math.PI`, `Math.E`) into a Global. A namespace is
// never a value on its own, and a function member must be called — the
// postfix loop sees the `(` next. Anything else is a positioned error.
func (p *parser) parseNamespaceMember() Node {
	ns, dot, name := p.cur(), p.peek(1), p.peek(2)
	if !isPunct(dot, ".") || name.kind != tIdent {
		p.fail(ns.pos, namespaceValueMessage(ns.text))
	}
	called := isPunct(p.peek(3), "(")
	switch {
	case IsGlobalFunction(ns.text, name.text):
		if !called {
			p.fail(ns.pos, callOnlyMessage(ns.text+"."+name.text))
		}
	case IsGlobalConstant(ns.text, name.text):
	default:
		p.fail(name.pos, namespaceMessage(ns.text, name.text, called))
	}
	p.advance()
	p.advance()
	p.advance()
	return &Global{Start: ns.pos, Namespace: ns.text, Name: name.text}
}

// parseGlobalFunction parses a bare global function (`Number`, `parseInt`, …),
// which is only ever a callee: the postfix loop sees the `(` next.
func (p *parser) parseGlobalFunction() Node {
	g := p.cur()
	next := p.peek(1)
	if isPunct(next, ".") && p.peek(2).kind == tIdent {
		name := p.peek(2)
		p.fail(name.pos, globalMemberMessage(g.text, name.text, isPunct(p.peek(3), "(")))
	}
	if !isPunct(next, "(") {
		p.fail(g.pos, callOnlyMessage(g.text))
	}
	p.advance()
	return &Global{Start: g.pos, Name: g.text}
}

func (p *parser) parseGroup() Node {
	open := p.cur()
	if p.arrowAhead() {
		p.fail(open.pos, msgArrowPlace)
	}
	p.advance()
	if isPunct(p.cur(), ")") {
		p.fail(p.cur().pos, msgEmptyParens)
	}
	inner := p.parseExpr()
	if isPunct(p.cur(), ",") {
		p.fail(p.cur().pos, msgComma)
	}
	p.expectClose(")", open)
	if l, ok := inner.(*Logical); ok {
		l.grouped = true
	}
	return inner
}

func (p *parser) parseTemplate() Node {
	head := p.cur()
	p.enter(head.pos)
	defer p.leave()
	tl := &TemplateLiteral{Start: head.pos, Quasis: []string{head.str}}
	open := head
	p.advance()
	for {
		t := p.cur()
		if t.kind == tTemplateMiddle || t.kind == tTemplateTail {
			p.fail(t.pos, "expected an expression inside `${ }`")
		}
		tl.Exprs = append(tl.Exprs, p.parseExpr())
		t = p.cur()
		switch t.kind {
		case tTemplateMiddle:
			tl.Quasis = append(tl.Quasis, t.str)
			open = t
			p.advance()
		case tTemplateTail:
			tl.Quasis = append(tl.Quasis, t.str)
			p.advance()
			return tl
		case tError:
			panic(bailout{t.ext.err})
		default:
			p.fail(t.pos, fmt.Sprintf("expected `}` to close the `${` at %d:%d", open.ext.sub.Line, open.ext.sub.Col))
		}
	}
}

func (p *parser) parseArray() Node {
	open := p.cur()
	p.enter(open.pos)
	defer p.leave()
	p.advance()
	arr := &Array{Start: open.pos}
	for {
		t := p.cur()
		switch {
		case isPunct(t, "]"):
			p.advance()
			return arr
		case isPunct(t, ","):
			p.fail(t.pos, msgArrayHole)
		case isPunct(t, "..."):
			p.fail(t.pos, msgSpreadArray)
		}
		arr.Elements = append(arr.Elements, p.parseExpr())
		if isPunct(p.cur(), ",") {
			p.advance()
			continue
		}
		p.expectClose("]", open)
		return arr
	}
}

func (p *parser) parseObject() Node {
	open := p.cur()
	p.enter(open.pos)
	defer p.leave()
	p.advance()
	obj := &Object{Start: open.pos}
	for {
		t := p.cur()
		switch {
		case isPunct(t, "}"):
			p.advance()
			return obj
		case isPunct(t, "..."):
			p.fail(t.pos, msgSpreadObject)
		case isPunct(t, "["):
			p.fail(t.pos, msgComputedKey)
		case t.kind == tNumber:
			p.fail(t.pos, msgNumericKey)
		case t.kind == tString:
			p.advance()
			if prototypeNames[t.str] {
				p.fail(t.pos, prototypeMessage(t.str))
			}
			c := p.cur()
			if !isPunct(c, ":") {
				if c.kind == tError {
					panic(bailout{c.ext.err})
				}
				p.fail(c.pos, "expected `:` after the object key "+t.text)
			}
			p.advance()
			obj.Entries = append(obj.Entries, Entry{Key: t.str, KeyPos: t.pos, Value: p.parseExpr()})
		case t.kind == tIdent:
			if prototypeNames[t.text] {
				p.fail(t.pos, prototypeMessage(t.text))
			}
			p.advance()
			c := p.cur()
			switch {
			case isPunct(c, ":"):
				p.advance()
				obj.Entries = append(obj.Entries, Entry{Key: t.text, KeyPos: t.pos, Value: p.parseExpr()})
			case isPunct(c, ",") || isPunct(c, "}"):
				// A shorthand entry reads its name as a value.
				if msg := reservedMessage(t.text); msg != "" {
					p.fail(t.pos, msg)
				}
				if msg := globalValueMessage(t.text); msg != "" {
					p.fail(t.pos, msg)
				}
				if t.text == "event" && !p.opts.Handler && !p.eventBound() {
					p.fail(t.pos, msgEvent)
				}
				id := &Identifier{Start: t.pos, Name: t.text}
				p.noteAmbient(id)
				obj.Entries = append(obj.Entries, Entry{Key: t.text, KeyPos: t.pos, Shorthand: true, Value: id})
			case isPunct(c, "(") || (t.text == "get" || t.text == "set" || t.text == "async") &&
				(c.kind == tIdent || c.kind == tString || isPunct(c, "[")):
				p.fail(c.pos, msgObjectMethod)
			default:
				if c.kind == tError {
					panic(bailout{c.ext.err})
				}
				p.fail(c.pos, "expected `:` after the object key `"+t.text+"`")
			}
		default:
			p.unexpected(t)
		}
		if isPunct(p.cur(), ",") {
			p.advance()
			continue
		}
		p.expectClose("}", open)
		return obj
	}
}
