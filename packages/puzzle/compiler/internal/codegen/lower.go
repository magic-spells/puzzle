package codegen

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// lower.go lowers template expressions to JavaScript from the expression AST
// the parser attaches to every template node (puzzle-lang/expr; DESIGN-expr-v2
// §5). Nothing here reads an expression's source string: names are resolved
// from the tree, parentheses come from operator precedence, and the render
// facts a list block needs (D170) are read off the same tree.
//
// The lowering table (render target — the render() function codegen emits):
//
//	AST                              JavaScript
//	-------------------------------  ------------------------------------------------
//	Literal                          as written: 'a' "b" 1.5 1e3 true null undefined NaN Infinity
//	Identifier, data root            __d.name
//	Identifier, template binding     its JS: s.item / s.i (a lowered row), a bare name, a mangled __pzl<name>
//	Identifier, arrow parameter      the parameter — it shadows data roots and bindings
//	Identifier `event` (handler)     the DOM event parameter: event, or __ev when a binding owns `event`
//	a.b   a?.b                       <a>?.b          every step optional: reads never throw (D173 V4)
//	a[i]  a?.[i]                     <a>?.[<i>]
//	(a?.b).c                         (<a?.b>)?.c     a Chain in object position keeps its parentheses
//	x.size, not called               __z(<x>)        TEMPORARY until P4 migrates the corpus
//	f(a, b), library function        (__f["f"] || __f.__missing("f"))(<a>, <b>)   the D43 guard
//	a.m(x), method                   <a>?.m(<x>)     a call on a missing receiver is undefined (§9 d)
//	Math.round(x)  Number(x)         verbatim        a JavaScript global the language allows
//	Math.PI                          verbatim
//	x => e   (x, i) => e             (x) => <e>      a fresh scope; an object body is parenthesized
//	`a ${x}`                         `a ${<x>}`
//	!x  -x  +x                       !<x>            parentheses from precedence, never source spacing
//	a + b  a && b  a ?? b            <a> + <b>       ?? never mixes unparenthesized with && or ||
//	c ? a : b                        <c> ? <a> : <b>
//	[a, b]                           [<a>, <b>]
//	{ k: v, 'q-r': v, s }            { k: <v>, 'q-r': <v>, s: <s> }   shorthand expanded
//	event.target.value (handler)     verbatim        a DOM event chain is not template data (§9 k)
//	base | f(a) | g                  (__f["g"] || …)((__f["f"] || …)(<base>, <a>))   TEMPORARY until P4
//
// Handler values (@event={ … }):
//
//	name                             (event) => this.events.name(event)
//	name(a, b)                       (event) => this.events.name(<a>, <b>)   the view's handler wins (§9 c)
//	c ? h1 : h2   (h is a form, or null)   (<c>) ? <h1> : <h2>
//	null                             null
//
// A handler's arguments are lowered like any expression (guarded, library
// calls through __f) except that `.size` is not the count there — they were
// JavaScript before this language, so the corpus has no count to migrate. A
// handler-valued conditional's condition is a render-time value and gets the
// `.size` lowering like one.
//
// The check target (puzzle check, WriteCheckValue/WriteCheckEvent) emits the
// same tree as TypeScript with three differences: no member guard is added (an
// authored `?.` stays), a library call is `__puzzle_fn.name(…)` so the shim's
// signatures type it, and a method call whose arguments hold an arrow takes
// its receiver through `__puzzle_check_list(…)`, which gives the arrow's
// parameters a type when the receiver is an untyped data value.

// ---- scope ------------------------------------------------------------------

// scopeMap is the lexical scope threaded through emission: an in-scope
// template binding maps to the JS it resolves to. The empty string means "emit
// the name bare" — an ordinary binding (a range-loop variable, a snippet
// param, the imported `ViewNode`). A NON-empty value is a rewrite, which is
// how a persistent list block's row locals reach their scope object (the D170
// emission contract: `todo` → `s.item`, the counter → `s.i`). Arrow-function
// parameters are not in it: the lowerer keeps them on its own stack, so they
// shadow every binding and data root while their body is lowered.
type scopeMap map[string]string

// scopeRef reports the JS an in-scope binding resolves to.
func scopeRef(scope scopeMap, name string) (string, bool) {
	repl, ok := scope[name]
	if !ok {
		return "", false
	}
	if repl == "" {
		return name, true
	}
	return repl, true
}

func cloneScope(scope scopeMap) scopeMap {
	out := make(scopeMap, len(scope)+1)
	for k, v := range scope {
		out[k] = v
	}
	return out
}

// ---- render facts (D170) ----------------------------------------------------

// exprFacts is what one lowered expression READ, classified from its tree. A
// list block needs three things from a loop body — which parent data roots it
// reads (the `roots` dirty mask), which members it reads off the row item
// (`fields`/`deep`), and whether it reads a value that can change with no data
// mutation (`volatile`).
type exprFacts struct {
	// roots are the data roots read (`__d.<name>`), in first-read order,
	// distinct.
	roots []string
	// locals records how each template binding was read.
	locals map[string]*localRead
	// volatileRead is set by a call to a clock-reading library function
	// (clockFunctions): its value can differ between two renders with no data
	// mutation, so a cached row would freeze it (D170 volatile).
	volatileRead bool
	// libRead is set by a library function call, which reads the render's
	// function registry (`__f`). A handler whose arguments call one is not
	// data-independent (D62), and a loop key that calls one cannot be hoisted
	// out of render().
	libRead bool
}

// localRead is how one template binding was used inside an expression.
type localRead struct {
	// fields are the depth-one member names read off the binding
	// (`todo.text` → "text"), in first-read order, distinct.
	fields []string
	// deep marks a read the row revision cannot cover: a deeper path
	// (`todo.author.name`), a computed member (`todo[k]`), or a method call on
	// the binding or a path off it (`todo.text.trim()`).
	deep bool
	// bareInCall marks the binding passed WHOLE as a call argument —
	// `fmt(todo)`, whose result is displayed, so the row depends on more than
	// the item's own identity.
	bareInCall bool
	// whole marks a whole-value read that IS the entire expression — `{ todo }`,
	// `todo={ todo }`. Such a read depends on the item's identity alone, which
	// the row revision covers exactly.
	whole bool
	// opaque marks a whole-value read that is NOT the entire expression: an
	// operand, a template-literal part, an array element or object value, a
	// call argument, a pipe base or formatter argument. The compiler cannot
	// see which members the value reaches, so the site is conservative (`deep`)
	// exactly as a relation read is.
	opaque bool
	// renderRead marks a read evaluated during RENDER. Handler arguments are
	// read at fire time off the live row scope, so their local reads never
	// reach the caller (see lowerer.handlerArgs).
	renderRead bool
}

func (f *exprFacts) addRoot(name string) {
	for _, r := range f.roots {
		if r == name {
			return
		}
	}
	f.roots = append(f.roots, name)
}

func (f *exprFacts) local(name string) *localRead {
	if f.locals == nil {
		f.locals = map[string]*localRead{}
	}
	r := f.locals[name]
	if r == nil {
		r = &localRead{}
		f.locals[name] = r
	}
	return r
}

func (r *localRead) addField(name string) {
	for _, f := range r.fields {
		if f == name {
			return
		}
	}
	r.fields = append(r.fields, name)
}

// merge folds other into f, preserving first-read order.
func (f *exprFacts) merge(other *exprFacts) {
	if f == nil || other == nil {
		return
	}
	for _, r := range other.roots {
		f.addRoot(r)
	}
	if other.volatileRead {
		f.volatileRead = true
	}
	if other.libRead {
		f.libRead = true
	}
	for name, read := range other.locals {
		dst := f.local(name)
		for _, fl := range read.fields {
			dst.addField(fl)
		}
		dst.deep = dst.deep || read.deep
		dst.bareInCall = dst.bareInCall || read.bareInCall
		dst.whole = dst.whole || read.whole
		dst.opaque = dst.opaque || read.opaque
		dst.renderRead = dst.renderRead || read.renderRead
	}
}

// ---- the function library ---------------------------------------------------

// LibraryFunctionNames is the standard function library a bare call `name(…)`
// resolves to (DESIGN-expr-v2 §4, §9 b) — the names Sites implements in Go
// with the same arguments — plus `in_timezone`, a built-in treated as standard
// until P3 settles membership against the conformance table. App-registered
// functions join it at run time. The
// compiler needs the set for two things: the warning when a view handler
// shares a name with one (§9 c), and puzzle check's signatures, whose table
// (check.libraryFunctionSignatures) must list exactly these names. P3 moves
// the runtime to the same set and publishes the same signatures in types/.
var LibraryFunctionNames = []string{
	"link", "t",
	"currency", "percentage", "number_with_delimiter", "compact_number", "pluralize",
	"date", "time", "datetime", "timeago", "in_timezone",
	"truncate", "capitalize", "strip_html", "strip_newlines",
	"escape", "raw", "newline_to_br", "json",
}

var libraryFunctions = func() map[string]bool {
	m := make(map[string]bool, len(LibraryFunctionNames))
	for _, n := range LibraryFunctionNames {
		m[n] = true
	}
	return m
}()

// IsLibraryFunction reports whether name is in the standard function library.
func IsLibraryFunction(name string) bool { return libraryFunctions[name] }

// clockFunctions are the library functions whose output depends on the
// current time rather than on their arguments alone, so a cached row using one
// would display a frozen value ("1 second ago", forever); a site calling one
// is `volatile` (D170). Hardcoded until the runtime manifest (P3) can name
// them. App-registered functions are pure by contract.
var clockFunctions = map[string]bool{"timeago": true}

// ---- the lowerer ------------------------------------------------------------

type lowerTarget int

const (
	// targetRender is the render() code codegen emits.
	targetRender lowerTarget = iota
	// targetCheck is the TypeScript puzzle check type-checks.
	targetCheck
)

// exprWriter receives lowered text. The render emitter only concatenates;
// puzzle check maps every authored token back to its .pzl byte offset.
type exprWriter interface {
	WriteString(s string)
	WriteMapped(s string, sourceOffset int)
}

// textWriter is the render target's writer: plain concatenation.
type textWriter struct{ b strings.Builder }

func (w *textWriter) WriteString(s string)        { w.b.WriteString(s) }
func (w *textWriter) WriteMapped(s string, _ int) { w.b.WriteString(s) }
func (w *textWriter) String() string              { return w.b.String() }

// paramBinding is one arrow-function parameter in scope and the identifier it
// is emitted as.
type paramBinding struct{ name, js string }

// lowerer lowers one expression position. It is cheap and single-use: the
// compiler makes one per value.
type lowerer struct {
	w      exprWriter
	target lowerTarget
	scope  scopeMap
	facts  *exprFacts
	// params are the arrow parameters in scope, innermost last.
	params []paramBinding
	// event is the DOM event parameter's name while a handler's arguments are
	// lowered ("event" or "__ev"), and "" everywhere else.
	event string
	// sizeCompat turns on the TEMPORARY `.size` → __z lowering (P4: remove).
	sizeCompat bool
	// rowScopes are the lowered rows' scope object names (`s`, `s1`, …); an
	// arrow parameter spelled like one is mangled so the rows' locals stay
	// reachable inside the arrow body.
	rowScopes []string

	// usesLib and usesSize report what the emitted text needs: the `__f`
	// registry line and the `__z` import.
	usesLib  bool
	usesSize bool
}

func newLowerer(w exprWriter, target lowerTarget, scope scopeMap, facts *exprFacts) *lowerer {
	return &lowerer{w: w, target: target, scope: scope, facts: facts, sizeCompat: true}
}

// renderLowerer returns a render-target lowerer for the compiler's current position.
func (c *compiler) renderLowerer(w exprWriter, scope scopeMap, facts *exprFacts) *lowerer {
	l := newLowerer(w, targetRender, scope, facts)
	for _, site := range c.loops {
		l.rowScopes = append(l.rowScopes, site.scope)
	}
	return l
}

// absorbFlags folds what a lowerer emitted into the module-level import flags.
func (c *compiler) absorbFlags(l *lowerer) {
	if l.usesLib {
		c.usesFormatters = true
	}
	if l.usesSize {
		c.usesSize = true
	}
}

// refKind is what a bare name refers to.
type refKind int

const (
	refData refKind = iota
	refParam
	refBinding
	refEvent
	refThis
)

// resolve reports what name refers to here and the JS it is written as.
// Arrow parameters shadow template bindings, which shadow the handler's DOM
// event, which shadows nothing: every other name is a data root.
func (l *lowerer) resolve(name string) (refKind, string) {
	for i := len(l.params) - 1; i >= 0; i-- {
		if l.params[i].name == name {
			return refParam, l.params[i].js
		}
	}
	if js, ok := scopeRef(l.scope, name); ok {
		return refBinding, js
	}
	if name == "event" && l.event != "" {
		return refEvent, l.event
	}
	if name == "this" {
		// Unreachable: the parser rejects `this`, and checkTemplateExprs is the
		// safety net. Never read it as the data field `__d.this`.
		return refThis, "undefined"
	}
	return refData, "__d." + name
}

// mangleParam reports the identifier an arrow parameter is emitted as. A name
// spelled like a compiler-private identifier (`__d`, `__f`, …) or a lowered
// row's scope object (`s`, `s1`, …) would shadow what the arrow body's other
// reads compile to, so it is renamed `__pzl<name>`; every other parameter
// keeps its name.
func (l *lowerer) mangleParam(name string) string {
	if strings.HasPrefix(name, "__") {
		return "__pzl" + name
	}
	for _, s := range l.rowScopes {
		if s == name {
			return "__pzl" + name
		}
	}
	return name
}

// Operator precedence, JavaScript's, for the operators the grammar has.
const (
	precArrow   = 0
	precCond    = 1
	precOr      = 2 // || and ??
	precAnd     = 3
	precEq      = 4
	precRel     = 5
	precAdd     = 6
	precMul     = 7
	precUnary   = 8
	precPostfix = 9 // member, call, and every primary
)

func binaryPrec(op string) int {
	switch op {
	case "*", "/", "%":
		return precMul
	case "+", "-":
		return precAdd
	case "<", "<=", ">", ">=":
		return precRel
	case "==", "!=", "===", "!==":
		return precEq
	case "&&":
		return precAnd
	}
	return precOr
}

func precOf(n expr.Node) int {
	switch n := n.(type) {
	case *expr.Arrow:
		return precArrow
	case *expr.Conditional:
		return precCond
	case *expr.Logical:
		return binaryPrec(n.Op)
	case *expr.Binary:
		return binaryPrec(n.Op)
	case *expr.Unary:
		return precUnary
	}
	return precPostfix
}

// write lowers n, parenthesized when it binds looser than minPrec.
func (l *lowerer) write(n expr.Node, minPrec int) {
	if precOf(n) < minPrec {
		l.w.WriteString("(")
		l.node(n)
		l.w.WriteString(")")
		return
	}
	l.node(n)
}

// top lowers n as a whole value.
func (l *lowerer) top(n expr.Node) { l.write(n, precArrow) }

func (l *lowerer) node(n expr.Node) {
	switch n := n.(type) {
	case *expr.Literal:
		l.w.WriteMapped(n.Raw, n.Start.Offset)
	case *expr.TemplateLiteral:
		l.w.WriteString("`" + escapeTemplateText(n.Quasis[0]))
		for i, e := range n.Exprs {
			l.w.WriteString("${")
			l.top(e)
			l.w.WriteString("}" + escapeTemplateText(n.Quasis[i+1]))
		}
		l.w.WriteString("`")
	case *expr.Identifier:
		l.ident(n)
	case *expr.Member:
		l.member(n)
	case *expr.Chain:
		l.node(n.Expr)
	case *expr.Call:
		l.call(n)
	case *expr.Global:
		l.global(n)
	case *expr.Arrow:
		l.arrow(n)
	case *expr.Unary:
		l.w.WriteString(n.Op)
		// `-(-x)` and `+(+x)`: without the parentheses the two signs lex as a
		// decrement or an increment.
		if inner, ok := n.Operand.(*expr.Unary); ok && (n.Op == "-" || n.Op == "+") && inner.Op == n.Op {
			l.w.WriteString("(")
			l.node(inner)
			l.w.WriteString(")")
			return
		}
		l.write(n.Operand, precUnary)
	case *expr.Binary:
		p := binaryPrec(n.Op)
		l.write(n.Left, p)
		l.w.WriteString(" " + n.Op + " ")
		l.write(n.Right, p+1)
	case *expr.Logical:
		p := binaryPrec(n.Op)
		l.logicalOperand(n.Op, n.Left, p)
		l.w.WriteString(" " + n.Op + " ")
		l.logicalOperand(n.Op, n.Right, p+1)
	case *expr.Conditional:
		l.write(n.Test, precOr)
		l.w.WriteString(" ? ")
		l.write(n.Consequent, precCond)
		l.w.WriteString(" : ")
		l.write(n.Alternate, precCond)
	case *expr.Array:
		l.w.WriteString("[")
		for i, e := range n.Elements {
			if i > 0 {
				l.w.WriteString(", ")
			}
			l.top(e)
		}
		l.w.WriteString("]")
	case *expr.Object:
		if len(n.Entries) == 0 {
			l.w.WriteString("{}")
			return
		}
		l.w.WriteString("{ ")
		for i, e := range n.Entries {
			if i > 0 {
				l.w.WriteString(", ")
			}
			if expr.IsIdentifier(e.Key) {
				l.w.WriteMapped(e.Key, e.KeyPos.Offset)
			} else {
				l.w.WriteString(jsString(e.Key))
			}
			l.w.WriteString(": ")
			l.top(e.Value)
		}
		l.w.WriteString(" }")
	default:
		panic(fmt.Sprintf("codegen: unhandled expression node %T", n))
	}
}

// logicalOperand writes one operand of a `&&`, `||`, or `??`. JavaScript
// rejects `??` mixed with `&&` or `||` without parentheses at any precedence,
// so such an operand is always grouped.
func (l *lowerer) logicalOperand(op string, n expr.Node, minPrec int) {
	if inner, ok := n.(*expr.Logical); ok && (op == "??") != (inner.Op == "??") {
		l.w.WriteString("(")
		l.node(n)
		l.w.WriteString(")")
		return
	}
	l.write(n, minPrec)
}

func (l *lowerer) ident(id *expr.Identifier) {
	kind, js := l.resolve(id.Name)
	switch kind {
	case refData:
		l.w.WriteString("__d.")
		l.w.WriteMapped(id.Name, id.Start.Offset)
	case refThis:
		l.w.WriteString(js)
	default:
		if js == id.Name {
			l.w.WriteMapped(js, id.Start.Offset)
		} else {
			l.w.WriteString(js)
		}
	}
}

// verbatimChain reports whether member steps off n are written as authored,
// with no guard: a handler's DOM event chain (§9 k) and the compiler's own
// `ViewNode` import (the synthetic loop key). In the check target every chain
// is written as authored.
func (l *lowerer) verbatimChain(n expr.Node) bool {
	if l.target == targetCheck {
		return true
	}
	root := chainRoot(n)
	id, ok := root.(*expr.Identifier)
	if !ok {
		return false
	}
	kind, js := l.resolve(id.Name)
	switch kind {
	case refEvent:
		return true
	case refBinding:
		return id.Name == "ViewNode" && js == "ViewNode"
	}
	return false
}

// chainRoot is the primary a member/call chain starts at.
func chainRoot(n expr.Node) expr.Node {
	for {
		switch m := n.(type) {
		case *expr.Member:
			n = m.Object
		case *expr.Call:
			n = m.Callee
		case *expr.Chain:
			n = m.Expr
		default:
			return n
		}
	}
}

// step writes the member operator before a property: `?.` everywhere a guard
// applies, and the authored `.`/`?.` on a verbatim chain.
func (l *lowerer) step(verbatim, optional, computed bool) {
	switch {
	case verbatim && !optional && computed:
		l.w.WriteString("[")
	case verbatim && !optional:
		l.w.WriteString(".")
	case computed:
		l.w.WriteString("?.[")
	default:
		l.w.WriteString("?.")
	}
}

// object writes the object of a member step. A Chain there keeps its
// parentheses — `(a?.b).c` is a different expression from `a?.b.c` — and a
// number literal gets them so its `.` cannot read as a decimal point.
func (l *lowerer) object(obj expr.Node) {
	_, chain := obj.(*expr.Chain)
	lit, isLit := obj.(*expr.Literal)
	if chain || (isLit && lit.Kind == expr.LitNumber) {
		l.w.WriteString("(")
		l.node(obj)
		l.w.WriteString(")")
		return
	}
	l.write(obj, precPostfix)
}

func (l *lowerer) member(m *expr.Member) {
	verbatim := l.verbatimChain(m.Object)
	if l.sizeCompat && !m.Computed && m.Property == "size" && !(verbatim && l.target == targetRender) {
		// TEMPORARY (P4: remove): D176's count. `.size` on a value compiles to
		// the runtime's sizeOf helper until the corpus migrates to `.length`.
		l.usesSize = true
		l.w.WriteString("__z(")
		l.top(m.Object)
		l.w.WriteString(")")
		return
	}
	l.object(m.Object)
	l.step(verbatim, m.Optional, m.Computed)
	if m.Computed {
		l.top(m.Index)
		l.w.WriteString("]")
		return
	}
	l.w.WriteMapped(m.Property, m.PropPos.Offset)
}

func (l *lowerer) call(c *expr.Call) {
	switch callee := c.Callee.(type) {
	case *expr.Identifier:
		l.libraryCall(callee, c.Args)
	case *expr.Global:
		l.global(callee)
		l.args(c.Args)
	case *expr.Member:
		// A method from the table: the same JavaScript method, called through a
		// guard so a missing receiver yields undefined (§9 d). A computed callee
		// is a parse error.
		verbatim := l.verbatimChain(callee.Object)
		if l.target == targetCheck && hasArrowArg(c.Args) {
			l.w.WriteString("__puzzle_check_list(")
			l.top(callee.Object)
			l.w.WriteString(")")
		} else {
			l.object(callee.Object)
		}
		l.step(verbatim, callee.Optional, false)
		l.w.WriteMapped(callee.Property, callee.PropPos.Offset)
		l.args(c.Args)
	default:
		panic(fmt.Sprintf("codegen: unhandled callee %T", c.Callee))
	}
}

func hasArrowArg(args []expr.Node) bool {
	for _, a := range args {
		if _, ok := a.(*expr.Arrow); ok {
			return true
		}
	}
	return false
}

// libraryCall writes a bare call, which names a library function (§4): a
// template binding is never callable (the parser rejects it) and a data field
// never is.
func (l *lowerer) libraryCall(id *expr.Identifier, args []expr.Node) {
	l.usesLib = true
	if l.target == targetCheck {
		l.w.WriteString("__puzzle_fn.")
		l.w.WriteMapped(id.Name, id.Start.Offset)
	} else {
		l.w.WriteString(registryRef(id.Name))
	}
	l.args(args)
}

// registryRef is the D43-guarded read of one function from the render's
// registry: `(__f["name"] || __f.__missing("name"))`. The name is bracketed and
// JSON-quoted uniformly — the registry's keys are arbitrary strings — and an
// unregistered name resolves to the __missing factory, which warns once and
// passes the value through instead of crashing the view.
func registryRef(name string) string {
	q := strconv.Quote(name)
	return "(__f[" + q + "] || __f.__missing(" + q + "))"
}

func (l *lowerer) args(args []expr.Node) {
	l.w.WriteString("(")
	for i, a := range args {
		if i > 0 {
			l.w.WriteString(", ")
		}
		l.top(a)
	}
	l.w.WriteString(")")
}

func (l *lowerer) global(g *expr.Global) {
	if g.Namespace == "" {
		l.w.WriteMapped(g.Name, g.Start.Offset)
		return
	}
	l.w.WriteMapped(g.Namespace, g.Start.Offset)
	l.w.WriteString("." + g.Name)
}

func (l *lowerer) arrow(a *expr.Arrow) {
	mark := len(l.params)
	l.w.WriteString("(")
	for i, p := range a.Params {
		js := l.mangleParam(p.Name)
		l.params = append(l.params, paramBinding{name: p.Name, js: js})
		if i > 0 {
			l.w.WriteString(", ")
		}
		if js == p.Name {
			l.w.WriteMapped(js, p.Start.Offset)
		} else {
			l.w.WriteString(js)
		}
	}
	l.w.WriteString(") => ")
	if startsWithObject(a.Body) {
		// `x => ({ … })`: a body that opens with `{` would read as a block.
		l.w.WriteString("(")
		l.top(a.Body)
		l.w.WriteString(")")
	} else {
		l.write(a.Body, precCond)
	}
	l.params = l.params[:mark]
}

// startsWithObject reports whether n's lowered text begins with an object
// literal's `{`.
func startsWithObject(n expr.Node) bool {
	for {
		switch m := n.(type) {
		case *expr.Object:
			return true
		case *expr.Member:
			n = m.Object
		case *expr.Call:
			n = m.Callee
		case *expr.Chain:
			n = m.Expr
		case *expr.Binary:
			n = m.Left
		case *expr.Logical:
			n = m.Left
		case *expr.Conditional:
			n = m.Test
		default:
			return false
		}
	}
}

// escapeTemplateText writes a template literal's cooked text back as source:
// a backslash, a backtick, and a `${` are escaped, and a carriage return
// spelled out — a raw one would be read back as a line feed.
func escapeTemplateText(s string) string {
	if !strings.ContainsAny(s, "\\`$\r") {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c == '\\':
			b.WriteString(`\\`)
		case c == '`':
			b.WriteString("\\`")
		case c == '$' && i+1 < len(s) && s[i+1] == '{':
			b.WriteString(`\$`)
		case c == '\r':
			b.WriteString(`\r`)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// ---- facts ------------------------------------------------------------------

// readCtx is where a bare binding is read.
type readCtx int

const (
	readWhole   readCtx = iota // the entire expression
	readOperand                // part of a larger expression
	readArg                    // a call argument
)

// note records into l.facts what n reads (D170): data roots, template-binding
// reads by shape, and volatile or library calls. It walks the tree in source
// order, so roots are recorded in the order they are read.
func (l *lowerer) note(n expr.Node, ctx readCtx) {
	if l.facts == nil {
		return
	}
	switch n := n.(type) {
	case *expr.Identifier:
		l.noteName(n.Name, ctx)
	case *expr.Member:
		l.noteMember(n, false)
	case *expr.Chain:
		l.note(n.Expr, ctx)
	case *expr.Call:
		l.noteCall(n)
	case *expr.Arrow:
		mark := len(l.params)
		for _, p := range n.Params {
			l.params = append(l.params, paramBinding{name: p.Name, js: p.Name})
		}
		l.note(n.Body, readOperand)
		l.params = l.params[:mark]
	case *expr.TemplateLiteral:
		for _, e := range n.Exprs {
			l.note(e, readOperand)
		}
	case *expr.Unary:
		l.note(n.Operand, readOperand)
	case *expr.Binary:
		l.note(n.Left, readOperand)
		l.note(n.Right, readOperand)
	case *expr.Logical:
		l.note(n.Left, readOperand)
		l.note(n.Right, readOperand)
	case *expr.Conditional:
		l.note(n.Test, readOperand)
		l.note(n.Consequent, readOperand)
		l.note(n.Alternate, readOperand)
	case *expr.Array:
		for _, e := range n.Elements {
			l.note(e, readOperand)
		}
	case *expr.Object:
		for _, e := range n.Entries {
			l.note(e.Value, readOperand)
		}
	}
}

// noteName records a bare name read.
func (l *lowerer) noteName(name string, ctx readCtx) {
	switch kind, _ := l.resolve(name); kind {
	case refData:
		l.facts.addRoot(name)
	case refBinding:
		read := l.facts.local(name)
		read.renderRead = true
		if ctx == readArg {
			read.bareInCall = true
		}
		if ctx == readWhole {
			read.whole = true
		} else {
			read.opaque = true
		}
	}
}

// noteMember records a member read. step reports that m is itself the object
// of a further step or a method's callee, which makes a read off a binding
// deep: only `todo.text` (or `todo?.text`) as the last step is a field.
func (l *lowerer) noteMember(m *expr.Member, step bool) {
	if id, ok := m.Object.(*expr.Identifier); ok {
		if kind, _ := l.resolve(id.Name); kind == refBinding {
			read := l.facts.local(id.Name)
			read.renderRead = true
			if m.Computed || step {
				read.deep = true
			} else {
				read.addField(m.Property)
			}
		} else {
			l.noteName(id.Name, readOperand)
		}
	} else {
		l.noteStep(m.Object)
	}
	if m.Computed {
		l.note(m.Index, readOperand)
	}
}

// noteStep records the object of a member step.
func (l *lowerer) noteStep(n expr.Node) {
	switch n := n.(type) {
	case *expr.Member:
		l.noteMember(n, true)
	case *expr.Chain:
		l.noteStep(n.Expr)
	case *expr.Call:
		l.noteCall(n)
	default:
		l.note(n, readOperand)
	}
}

func (l *lowerer) noteCall(c *expr.Call) {
	switch callee := c.Callee.(type) {
	case *expr.Identifier:
		l.facts.libRead = true
		if clockFunctions[callee.Name] {
			l.facts.volatileRead = true
		}
	case *expr.Member:
		l.noteMember(callee, true)
	}
	for _, a := range c.Args {
		l.note(a, readArg)
	}
}

// ---- value positions --------------------------------------------------------

// value lowers a value position — an expression and its TEMPORARY pipe chain —
// recording what it reads into l.facts.
func (l *lowerer) value(n expr.Node, fmts []parser.FormatterCall) {
	if len(fmts) == 0 {
		l.note(n, readWhole)
		l.top(n)
		return
	}
	// TEMPORARY (P4: remove): `base | f(a) | g` lowers to nested library calls.
	// The base and every argument are handed to a formatter, which may read
	// anything off a record, so a binding read there is opaque.
	l.note(n, readArg)
	for _, fc := range fmts {
		if l.facts != nil {
			l.facts.libRead = true
			if clockFunctions[fc.Name] {
				l.facts.volatileRead = true
			}
		}
		for _, a := range fc.ArgsAST {
			l.note(a, readArg)
		}
	}
	l.usesLib = true
	for i := len(fmts) - 1; i >= 0; i-- {
		if l.target == targetCheck {
			l.w.WriteString("__puzzle_check_formatter(" + strconv.Quote(fmts[i].Name) + ", ")
		} else {
			l.w.WriteString(registryRef(fmts[i].Name) + "(")
		}
	}
	l.top(n)
	for _, fc := range fmts {
		for _, a := range fc.ArgsAST {
			l.w.WriteString(", ")
			l.top(a)
		}
		l.w.WriteString(")")
	}
}

// value lowers a value position with the emitter's fact sink and returns the
// JS; the chained form of the old resolveValue.
func (c *compiler) value(n expr.Node, fmts []parser.FormatterCall, scope scopeMap) string {
	f := c.factSink()
	out := c.valueInto(n, fmts, scope, f)
	c.absorb(f, scope)
	return out
}

// valueInto is value with an explicit fact collector.
func (c *compiler) valueInto(n expr.Node, fmts []parser.FormatterCall, scope scopeMap, facts *exprFacts) string {
	w := &textWriter{}
	l := c.renderLowerer(w, scope, facts)
	l.value(n, fmts)
	c.absorbFlags(l)
	return w.String()
}

// cond lowers a branch condition. A condition that is itself a ternary is
// grouped, so the compiler's own `? then : else` cannot re-associate into the
// condition's false branch; every other operator binds tighter.
func (c *compiler) cond(n expr.Node, scope scopeMap, facts *exprFacts) string {
	js := c.valueInto(n, nil, scope, facts)
	if _, ternary := n.(*expr.Conditional); ternary {
		return "(" + js + ")"
	}
	return js
}

// ---- handlers ---------------------------------------------------------------

// eventValue is a compiled @event value plus the two caching verdicts the
// emitter needs.
type eventValue struct {
	js string
	// cacheable marks a DATA-INDEPENDENT handler: the same function object on
	// every render, so it rides the per-instance `__h` cache (v1.29 D62 / SPEC
	// §31).
	cacheable bool
	// rowCacheable marks a handler that captures template bindings and nothing
	// else: not `__h`-cacheable (its capture differs per row), but stable for
	// the LIFE of a row, so a persistent list block caches it on the row scope
	// (`s.h0 ??= …`, D170 stable loop handlers). The emitter still checks that
	// every captured binding belongs to a lowered loop before using it.
	rowCacheable bool
	// refs are the template bindings the handler ARGUMENTS read (the DOM event
	// and arrow parameters are not bindings).
	refs []string
}

// handlerForm checks one handler form — the whole value, or one branch of a
// handler-valued conditional (where null is also a form) — and returns the
// view handler's name and the call's arguments (nil for the bare form).
func handlerForm(n expr.Node, src string, branch bool) (name *expr.Identifier, args []expr.Node, call bool, err error) {
	switch n := n.(type) {
	case *expr.Identifier:
		return n, nil, false, nil
	case *expr.Call:
		id, ok := n.Callee.(*expr.Identifier)
		if !ok {
			return nil, nil, false, fmt.Errorf("event handler callee must be a plain method name (got %q)", src)
		}
		return id, n.Args, true, nil
	case *expr.Literal:
		if branch && n.Kind == expr.LitNull {
			return nil, nil, false, nil
		}
	}
	return nil, nil, false, fmt.Errorf("event handler must be a bare method name or a single call expression (got %q)", src)
}

// handler lowers an @event value: a bare handler name, one call to a view
// handler, a conditional whose branches are each one of those or null, or
// null. bareAsReference (puzzle check) writes a bare handler as the reference
// `this.events.name` rather than wrapping it in a call: the runtime always
// passes the DOM event, but a handler may declare no parameters, and a
// synthesized one-argument call would report an arity error at a generated
// position with no authored bytes to point at.
func (l *lowerer) handler(n expr.Node, src string, bareAsReference bool) (eventValue, error) {
	eventParam := "event"
	if _, shadowed := l.scope["event"]; shadowed {
		// A binding named `event` (a {#for} item or counter, a snippet
		// parameter) owns the name, so the DOM parameter is renamed rather than
		// shadowing it.
		eventParam = "__ev"
	}
	if lit, ok := n.(*expr.Literal); ok && lit.Kind == expr.LitNull {
		l.w.WriteString("null")
		return eventValue{}, nil
	}
	cond, isCond := n.(*expr.Conditional)
	if !isCond {
		name, args, call, err := handlerForm(n, src, false)
		if err != nil {
			return eventValue{}, err
		}
		ev := l.handlerArgs(args)
		l.writeHandler(name, args, call, eventParam, bareAsReference)
		dataFree := len(ev.roots) == 0 && !ev.libRead
		out := eventValue{refs: sortedKeys(ev.locals)}
		out.cacheable = len(out.refs) == 0 && dataFree
		out.rowCacheable = len(out.refs) > 0 && dataFree
		return out, nil
	}
	type form struct {
		name *expr.Identifier
		args []expr.Node
		call bool
	}
	var forms [2]form
	for i, br := range []expr.Node{cond.Consequent, cond.Alternate} {
		name, args, call, err := handlerForm(br, src, true)
		if err != nil {
			return eventValue{}, err
		}
		forms[i] = form{name, args, call}
	}
	// Facts in evaluation order of the old emitter: both branches' arguments,
	// then the condition, which is a render-time read.
	for _, f := range forms {
		if f.name != nil {
			l.handlerArgs(f.args)
		}
	}
	l.note(cond.Test, readWhole)
	// The condition is evaluated during render and may toggle function ↔
	// null, so the conditional value is never cached — by the instance cache
	// or by a row scope. It is a value position: guarded, and `.size` is the
	// count.
	l.w.WriteString("(")
	l.top(cond.Test)
	l.w.WriteString(") ? ")
	for i, f := range forms {
		if i == 1 {
			l.w.WriteString(" : ")
		}
		if f.name == nil {
			l.w.WriteString("null")
			continue
		}
		l.writeHandler(f.name, f.args, f.call, eventParam, bareAsReference)
	}
	return eventValue{}, nil
}

// handlerArgs records what a handler call's arguments read into a scratch set
// and returns it. Arguments are read when the event fires, against the live
// row scope, so only their data roots reach l.facts: a closure over the
// render's `__d` must be rebuilt (D170). Their binding reads decide the D62
// caching verdict instead.
func (l *lowerer) handlerArgs(args []expr.Node) *exprFacts {
	saved, savedEvent := l.facts, l.event
	scratch := &exprFacts{}
	l.facts = scratch
	l.event = "event" // any non-empty value: the DOM event is in scope
	for _, a := range args {
		l.note(a, readArg)
	}
	l.facts, l.event = saved, savedEvent
	if saved != nil {
		for _, r := range scratch.roots {
			saved.addRoot(r)
		}
	}
	return scratch
}

// writeHandler writes one handler form.
func (l *lowerer) writeHandler(name *expr.Identifier, args []expr.Node, call bool, eventParam string, bareAsReference bool) {
	if !call && bareAsReference {
		l.w.WriteString("this.events.")
		l.w.WriteMapped(name.Name, name.Start.Offset)
		return
	}
	l.w.WriteString("(" + eventParam + ") => this.events.")
	l.w.WriteMapped(name.Name, name.Start.Offset)
	if !call {
		l.w.WriteString("(" + eventParam + ")")
		return
	}
	savedEvent, savedSize := l.event, l.sizeCompat
	l.event, l.sizeCompat = eventParam, false
	l.args(args)
	l.event, l.sizeCompat = savedEvent, savedSize
}

func sortedKeys(m map[string]*localRead) []string {
	if len(m) == 0 {
		return nil
	}
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}

// compileEvent compiles an @event attribute's value and reports its caching
// verdicts. facts, when non-nil, collects what the value reads during render
// (the row's `roots` mask includes handler-argument roots — D170 emission
// contract).
func (c *compiler) compileEvent(at *parser.EventAttr, scope scopeMap, facts *exprFacts) (eventValue, error) {
	w := &textWriter{}
	l := c.renderLowerer(w, scope, facts)
	ev, err := l.handler(at.ExprAST, at.Expr, false)
	if err != nil {
		return eventValue{}, err
	}
	c.absorbFlags(l)
	ev.js = w.String()
	return ev, nil
}

// ---- puzzle check -----------------------------------------------------------

// CheckWriter is what puzzle check writes its TypeScript into: generated text,
// and authored text mapped to its byte offset in the .pzl source.
type CheckWriter interface {
	WriteString(s string)
	WriteMapped(s string, sourceOffset int)
}

func checkScope(names map[string]bool) scopeMap {
	out := make(scopeMap, len(names))
	for k := range names {
		out[k] = ""
	}
	return out
}

// WriteCheckValue writes a template value — an expression and its TEMPORARY
// pipe chain — as TypeScript for puzzle check, resolving names exactly as the
// render code does: scope holds the template bindings (loop items and
// counters, snippet parameters), every other name reads `__d`.
func WriteCheckValue(w CheckWriter, n expr.Node, fmts []parser.FormatterCall, scope map[string]bool) {
	newLowerer(w, targetCheck, checkScope(scope), nil).value(n, fmts)
}

// WriteCheckEvent writes an @event value as TypeScript for puzzle check. src
// is the authored value, for the error message of a value that is not a
// handler form.
func WriteCheckEvent(w CheckWriter, n expr.Node, src string, scope map[string]bool) error {
	_, err := newLowerer(w, targetCheck, checkScope(scope), nil).handler(n, src, true)
	return err
}
