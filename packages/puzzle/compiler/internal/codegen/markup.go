package codegen

import (
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// The markup functions (D174). `raw` injects its value as HTML through the
// runtime's allowlist sanitizer; `newline_to_br` escapes its value and turns
// each line break into a real <br>. Their output is markup, not text, so each
// may only be the OUTERMOST call of a TEXT interpolation — `{ raw(post.body) }`
// — or, in the TEMPORARY pipe form (P4: remove), the last link of a text
// interpolation's chain, `{ post.body | raw }`. That is how the compiler knows
// which interpolations render markup, and it is why an app function can never
// inject markup: the registry is never consulted for these two names.
//
// A text interpolation rendering markup is lowered to the live-HTML vnode
// (`new ViewNode('#html', { value })`, client-runtime/views/html.js) instead of
// joining a coalesced text run. The usage scan (plugin/scan.go) sets
// `__PUZZLE_HAS_RAW_HTML__` from the same names, so an app that never uses them
// ships neither the node nor the sanitizer.

// IsMarkupFormatter reports whether name is one of the two markup functions.
func IsMarkupFormatter(name string) bool {
	return name == "raw" || name == "newline_to_br"
}

// markupCallOf returns the call a text interpolation renders markup through
// when it is written as one — no pipe chain, and the whole expression a call
// to `raw` or `newline_to_br` — or nil.
func markupCallOf(in *parser.Interpolation) *expr.Call {
	if len(in.Formatters) > 0 {
		return nil
	}
	call, ok := in.ExprAST.(*expr.Call)
	if !ok {
		return nil
	}
	if id, ok := call.Callee.(*expr.Identifier); ok && IsMarkupFormatter(id.Name) {
		return call
	}
	return nil
}

// markupName returns the markup function a text interpolation renders
// through, or "". checkTemplateExprs has already rejected every other
// placement, so only the outermost call and the last pipe link are tested.
func markupName(in *parser.Interpolation) string {
	if call := markupCallOf(in); call != nil {
		return call.Callee.(*expr.Identifier).Name
	}
	if n := len(in.Formatters); n > 0 && IsMarkupFormatter(in.Formatters[n-1].Name) {
		return in.Formatters[n-1].Name
	}
	return ""
}

// isMarkupInterp reports whether n is a text interpolation that renders markup.
func isMarkupInterp(n parser.Node) bool {
	in, ok := n.(*parser.Interpolation)
	return ok && markupName(in) != ""
}

// textOnlyTags hold text content in the HTML parser (RAWTEXT/RCDATA/PLAINTEXT;
// noscript whenever scripting is on), so markup inside them would never render
// as markup — and inside <script> the sanitized text would run as code.
var textOnlyTags = map[string]bool{
	"script": true, "style": true, "textarea": true, "title": true, "noscript": true,
	"xmp": true, "iframe": true, "noembed": true, "noframes": true, "plaintext": true,
}

// foreignContentTags open foreign content: inside <svg> or <math> the HTML
// parser reads markup as SVG/MathML, so the prerendered page would parse a
// markup value differently from the browser runtime, which inserts HTML nodes.
// The whole subtree is foreign down to an SVG <foreignObject>, which hosts HTML
// again (the runtime's namespace rule, viewManager.js inSvgNamespace).
var foreignContentTags = map[string]string{"svg": "SVG", "math": "MathML"}

// markupContext is the parentTag an element's children are checked under: its
// own tag, unless the element sits in foreign content, which it then continues.
func markupContext(parentTag, tag string) string {
	if foreignContentTags[parentTag] != "" && !strings.EqualFold(tag, "foreignObject") {
		return parentTag
	}
	return tag
}

// thisMsg is the safety net's error for a `this` in a template expression. The
// expression parser rejects `this` first with these same words (puzzle-lang
// expr.msgThis — keep the two identical; the design's P3 note rewords both);
// an AST that reached codegen some other way still never compiles one.
const thisMsg = "`this` is not available in template expressions — return the value from data() (a getter or a computed field), or use a formatter for a display transform"

func exprPos(p expr.Pos) parser.Position {
	return parser.Position{Line: p.Line, Col: p.Col, Offset: p.Offset}
}

// checkTemplateExprs walks a template (or skeleton) before anything is
// emitted and rejects, with a positioned error, what the lowering cannot
// accept: a markup function anywhere but the outermost call of a text
// interpolation (or the last link of its pipe chain), and — as a safety net
// behind the parser — `this`. It also warns once per handler whose name
// shadows a standard library function (§9 c). The emitters can then trust
// every expression they lower.
func (c *compiler) checkTemplateExprs(nodes []parser.Node, parentTag string) error {
	for _, n := range nodes {
		var err error
		switch node := n.(type) {
		case *parser.Interpolation:
			err = c.checkTextInterp(node, parentTag)
		case *parser.Element:
			if err = c.checkAttrExprs(node.Attrs, "an attribute value"); err == nil {
				err = c.checkTemplateExprs(node.Children, markupContext(parentTag, node.Tag))
			}
		case *parser.Component:
			// A component renders inline, so its children and snippets render
			// inside the element around it: the parent's context carries through.
			if err = c.checkAttrExprs(node.Props, "a component prop"); err == nil {
				err = c.checkTemplateExprs(node.Children, parentTag)
			}
		case *parser.Slot:
			if err = c.checkAttrExprs(node.Args, "a marker argument"); err == nil {
				err = c.checkTemplateExprs(node.Children, parentTag)
			}
		case *parser.Snippet:
			err = c.checkTemplateExprs(node.Body, parentTag)
		case *parser.Portal:
			err = c.checkTemplateExprs(node.Children, "")
		case *parser.If:
			if err = c.checkExpr(node.CondAST, "an {#if} condition"); err == nil {
				if err = c.checkTemplateExprs(node.Then, parentTag); err == nil {
					err = c.checkTemplateExprs(node.Else, parentTag)
				}
			}
		case *parser.Case:
			err = c.checkExpr(node.ExprAST, "a {#case} expression")
			for _, clause := range node.Clauses {
				for _, v := range clause.ValuesAST {
					if err == nil {
						err = c.checkExpr(v, "a {:when} value")
					}
				}
				if err == nil {
					err = c.checkTemplateExprs(clause.Body, parentTag)
				}
			}
			if err == nil {
				err = c.checkTemplateExprs(node.Else, parentTag)
			}
		case *parser.For:
			for _, e := range []expr.Node{node.CollectionAST, node.RangeFromAST, node.RangeToAST} {
				if err == nil && e != nil {
					err = c.checkExpr(e, "a {#for} header")
				}
			}
			if err == nil {
				err = c.checkTemplateExprs(node.Body, parentTag)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// checkTextInterp validates one text interpolation: a markup function must be
// its outermost call (or the last pipe link), take the one value, and not sit
// inside a text-only element or foreign content.
func (c *compiler) checkTextInterp(in *parser.Interpolation, parentTag string) error {
	name := ""
	if call := markupCallOf(in); call != nil {
		name = call.Callee.(*expr.Identifier).Name
		if len(call.Args) != 1 {
			return c.cgErr(exprPos(call.Start), fmt.Sprintf("`%s` takes one argument — the value to render (D174)", name))
		}
		if err := c.checkNested(call.Args[0]); err != nil {
			return err
		}
	} else {
		// TEMPORARY (P4: remove): the pipe form.
		last := len(in.Formatters) - 1
		for i, fc := range in.Formatters {
			if !IsMarkupFormatter(fc.Name) {
				continue
			}
			if i != last {
				return c.cgErr(in.Pos, fmt.Sprintf(
					"`%s` must be the last formatter in the chain — its output is markup, which no formatter takes as input (D174)",
					fc.Name))
			}
			if len(fc.Args) > 0 {
				return c.cgErr(in.Pos, fmt.Sprintf("`%s` takes no arguments", fc.Name))
			}
			name = fc.Name
		}
		if err := c.checkNested(in.ExprAST); err != nil {
			return err
		}
		for _, fc := range in.Formatters {
			for _, a := range fc.ArgsAST {
				if err := c.checkNested(a); err != nil {
					return err
				}
			}
		}
	}
	if name == "" {
		return nil
	}
	if textOnlyTags[parentTag] {
		return c.cgErr(in.Pos, fmt.Sprintf(
			"`%s` cannot render inside <%s>, whose content is text — drop it or move the interpolation out",
			name, parentTag))
	}
	if lang := foreignContentTags[parentTag]; lang != "" {
		return c.cgErr(in.Pos, fmt.Sprintf(
			"`%s` cannot render inside <%s>, whose content is %s, not HTML — move the interpolation out (or into a <foreignObject>) (D174)",
			name, parentTag, lang))
	}
	return nil
}

// checkNested rejects a markup call inside a text interpolation's value, where
// it would not be the outermost call.
func (c *compiler) checkNested(n expr.Node) error {
	return c.walkExpr(n, nil, func(call *expr.Call, name string) error {
		return c.cgErr(exprPos(call.Start), fmt.Sprintf(
			"`%s` must be the outermost call of a text interpolation — its output is markup, which no function takes as input (D174)",
			name))
	})
}

// checkExpr rejects a markup call anywhere in a value that is not a text
// interpolation.
func (c *compiler) checkExpr(n expr.Node, where string) error {
	return c.walkExpr(n, nil, func(call *expr.Call, name string) error {
		return c.cgErr(exprPos(call.Start), fmt.Sprintf(
			"`%s` renders markup, so it can only be the outermost call of a text interpolation — not %s (D174)",
			name, where))
	})
}

// walkExpr walks n, failing on `this` and handing every markup call to
// onMarkup. skip holds the calls that are not library calls: an event
// handler's own call names a view handler.
func (c *compiler) walkExpr(n expr.Node, skip map[*expr.Call]bool, onMarkup func(*expr.Call, string) error) error {
	var err error
	expr.Walk(n, func(n expr.Node) bool {
		if err != nil {
			return false
		}
		switch n := n.(type) {
		case *expr.Identifier:
			if n.Name == "this" {
				err = c.cgErr(exprPos(n.Start), thisMsg)
			}
		case *expr.Call:
			if skip[n] {
				return true
			}
			if id, ok := n.Callee.(*expr.Identifier); ok && IsMarkupFormatter(id.Name) {
				err = onMarkup(n, id.Name)
			}
		}
		return err == nil
	})
	return err
}

func (c *compiler) checkAttrExprs(attrs []parser.Attr, where string) error {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.DynamicAttr:
			if err := c.checkChain(a.ExprAST, a.Formatters, a.Pos, where); err != nil {
				return err
			}
		case *parser.MixedAttr:
			if err := c.checkParts(a.Parts, a.Pos, where); err != nil {
				return err
			}
		case *parser.EventAttr:
			if err := c.checkHandler(a); err != nil {
				return err
			}
		}
	}
	return nil
}

// checkChain checks a value position that is not a text interpolation: its
// expression, and its TEMPORARY pipe chain (P4: remove).
func (c *compiler) checkChain(n expr.Node, fmts []parser.FormatterCall, pos parser.Position, where string) error {
	if err := c.checkExpr(n, where); err != nil {
		return err
	}
	for _, fc := range fmts {
		if IsMarkupFormatter(fc.Name) {
			return c.cgErr(pos, fmt.Sprintf(
				"`%s` renders markup, so it can only end a text interpolation — not %s (D174)",
				fc.Name, where))
		}
		for _, a := range fc.ArgsAST {
			if err := c.checkExpr(a, where); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *compiler) checkParts(parts []parser.Part, pos parser.Position, where string) error {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				if err := c.checkChain(p.Interp.ExprAST, p.Interp.Formatters, pos, where); err != nil {
					return err
				}
			}
		case *parser.InlineIfPart:
			if err := c.checkExpr(p.CondAST, where); err != nil {
				return err
			}
			if err := c.checkParts(p.Then, pos, where); err != nil {
				return err
			}
			if err := c.checkParts(p.Else, pos, where); err != nil {
				return err
			}
		}
	}
	return nil
}

// handlerCalls returns the handler forms of an @event value — the whole value,
// or both branches of a handler-valued conditional — that name a view handler.
func handlerCalls(n expr.Node) []expr.Node {
	if cond, ok := n.(*expr.Conditional); ok {
		return []expr.Node{cond.Consequent, cond.Alternate}
	}
	return []expr.Node{n}
}

// checkHandler checks an @event value. Its own call names the view's handler,
// never the library (§9 c), so only calls inside its arguments and its
// condition are library calls; a handler named like a standard function draws
// a warning, since the same name means the library everywhere else.
func (c *compiler) checkHandler(a *parser.EventAttr) error {
	skip := map[*expr.Call]bool{}
	for _, form := range handlerCalls(a.ExprAST) {
		var name *expr.Identifier
		switch f := form.(type) {
		case *expr.Identifier:
			name = f
		case *expr.Call:
			skip[f] = true
			name, _ = f.Callee.(*expr.Identifier)
		}
		if name != nil && IsLibraryFunction(name.Name) {
			c.warn(exprPos(name.Start), fmt.Sprintf(
				"the view handler `%s` shares its name with the standard `%s()` function — in @%s it calls the view's handler, everywhere else `%s(…)` calls the function; rename the handler to keep them apart",
				name.Name, name.Name, a.Name, name.Name))
		}
	}
	return c.walkExpr(a.ExprAST, skip, func(call *expr.Call, name string) error {
		return c.cgErr(exprPos(call.Start), fmt.Sprintf(
			"`%s` renders markup, so it can only be the outermost call of a text interpolation — not an event handler (D174)",
			name))
	})
}

// warn records a positioned, non-fatal diagnostic once.
func (c *compiler) warn(pos parser.Position, msg string) {
	if c.warnings == nil {
		return
	}
	for _, w := range *c.warnings {
		if w.Line == pos.Line && w.Col == pos.Col && w.Message == msg {
			return
		}
	}
	*c.warnings = append(*c.warnings, Warning{File: c.file, Line: pos.Line, Col: pos.Col, Message: msg})
}

// emitMarkup lowers a text interpolation that renders markup to the live-HTML
// vnode. The value compiles exactly as a text interpolation's does and takes
// the shared display coercion, so `{ raw(post.body) }` prints what
// `{ post.body }` would print — as markup. The markup function itself is never
// called through the registry: the runtime applies the sanitizer (`raw`) or
// the escape-and-<br> (`newline_to_br`, flagged by `br: true`).
func (c *compiler) emitMarkup(in *parser.Interpolation, scope scopeMap) (string, error) {
	if startsWithObjectLiteral(in.Expr) {
		return "", c.cgErr(in.Pos, objectLiteralMsg)
	}
	facts := c.factSink()
	defer c.absorb(facts, scope)
	name := markupName(in)
	var js string
	if call := markupCallOf(in); call != nil {
		js = c.valueInto(call.Args[0], nil, scope, facts)
	} else {
		// TEMPORARY (P4: remove): the pipe form; the chain before the markup
		// link compiles as a text interpolation's does.
		js = c.valueInto(in.ExprAST, in.Formatters[:len(in.Formatters)-1], scope, facts)
	}
	value := c.displayValue(js, in.Expr)
	if name == "newline_to_br" {
		return "new ViewNode('#html', { value: " + value + ", br: true })", nil
	}
	return "new ViewNode('#html', { value: " + value + " })", nil
}
