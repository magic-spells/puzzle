package codegen

import (
	"fmt"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// The markup formatters (D174). `raw` injects its value as HTML through the
// runtime's allowlist sanitizer; `newline_to_br` escapes its value and turns
// each line break into a real <br>. After either one the value is markup, not
// text, so each may only be the LAST link of a TEXT interpolation's chain: that
// is how the compiler knows which interpolations render markup, and it is why
// an app formatter can never inject markup — the registry is never consulted
// for these two names.
//
// A text interpolation ending in one of them is lowered to the live-HTML vnode
// (`new ViewNode('#html', { value })`, client-runtime/views/html.js) instead of
// joining a coalesced text run. The usage scan (plugin/scan.go) sets
// `__PUZZLE_HAS_RAW_HTML__` from the same names, so an app that never uses them
// ships neither the node nor the sanitizer.

// IsMarkupFormatter reports whether name is one of the two markup formatters.
func IsMarkupFormatter(name string) bool {
	return name == "raw" || name == "newline_to_br"
}

// isMarkupInterp reports whether n is a text interpolation that renders markup:
// its chain ends in a markup formatter. checkMarkupFormatters has already
// rejected every other placement, so the last link is the only one to test.
func isMarkupInterp(n parser.Node) bool {
	in, ok := n.(*parser.Interpolation)
	return ok && len(in.Formatters) > 0 && IsMarkupFormatter(in.Formatters[len(in.Formatters)-1].Name)
}

// textOnlyTags hold text content in the HTML parser (RAWTEXT/RCDATA), so
// markup inside them would never render as markup — and inside <script> the
// sanitized text would run as code.
var textOnlyTags = map[string]bool{"script": true, "style": true, "textarea": true, "title": true}

// checkMarkupFormatters rejects every placement of a markup formatter other
// than the last link of a text interpolation, with a positioned error. It runs
// over the whole template (and skeleton) before emission, so the emitters can
// trust that a markup name reaching them is in a legal place.
func (c *compiler) checkMarkupFormatters(nodes []parser.Node, parentTag string) error {
	for _, n := range nodes {
		var err error
		switch node := n.(type) {
		case *parser.Interpolation:
			err = c.checkTextChain(node, parentTag)
		case *parser.Element:
			if err = c.checkMarkupAttrs(node.Attrs, "an attribute value"); err == nil {
				err = c.checkMarkupFormatters(node.Children, node.Tag)
			}
		case *parser.Component:
			if err = c.checkMarkupAttrs(node.Props, "a component prop"); err == nil {
				err = c.checkMarkupFormatters(node.Children, "")
			}
		case *parser.Slot:
			if err = c.checkMarkupAttrs(node.Args, "a marker argument"); err == nil {
				err = c.checkMarkupFormatters(node.Children, parentTag)
			}
		case *parser.Snippet:
			err = c.checkMarkupFormatters(node.Body, "")
		case *parser.Portal:
			err = c.checkMarkupFormatters(node.Children, "")
		case *parser.If:
			if err = c.checkNoMarkup(node.Formatters, node.Pos, "an {#if} subject"); err == nil {
				if err = c.checkMarkupFormatters(node.Then, parentTag); err == nil {
					err = c.checkMarkupFormatters(node.Else, parentTag)
				}
			}
		case *parser.Case:
			if err = c.checkNoMarkup(node.Formatters, node.Pos, "a {#case} subject"); err == nil {
				for _, clause := range node.Clauses {
					if err = c.checkMarkupFormatters(clause.Body, parentTag); err != nil {
						break
					}
				}
				if err == nil {
					err = c.checkMarkupFormatters(node.Else, parentTag)
				}
			}
		case *parser.For:
			err = c.checkMarkupFormatters(node.Body, parentTag)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// checkTextChain validates one text interpolation: a markup formatter must be
// the last link, take no arguments, and not sit inside a text-only element.
func (c *compiler) checkTextChain(in *parser.Interpolation, parentTag string) error {
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
		if textOnlyTags[parentTag] {
			return c.cgErr(in.Pos, fmt.Sprintf(
				"`%s` cannot render inside <%s>, whose content is text — drop the formatter or move the interpolation out",
				fc.Name, parentTag))
		}
	}
	return nil
}

func (c *compiler) checkMarkupAttrs(attrs []parser.Attr, where string) error {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.DynamicAttr:
			if err := c.checkNoMarkup(a.Formatters, a.Pos, where); err != nil {
				return err
			}
		case *parser.MixedAttr:
			if err := c.checkMarkupParts(a.Parts, a.Pos, where); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *compiler) checkMarkupParts(parts []parser.Part, pos parser.Position, where string) error {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				if err := c.checkNoMarkup(p.Interp.Formatters, pos, where); err != nil {
					return err
				}
			}
		case *parser.InlineIfPart:
			if err := c.checkNoMarkup(p.Formatters, p.Pos, "an inline {#if} condition"); err != nil {
				return err
			}
			if err := c.checkMarkupParts(p.Then, pos, where); err != nil {
				return err
			}
			if err := c.checkMarkupParts(p.Else, pos, where); err != nil {
				return err
			}
		}
	}
	return nil
}

// checkNoMarkup rejects a markup formatter anywhere in a chain that is not a
// text interpolation's.
func (c *compiler) checkNoMarkup(fmts []parser.FormatterCall, pos parser.Position, where string) error {
	for _, fc := range fmts {
		if IsMarkupFormatter(fc.Name) {
			return c.cgErr(pos, fmt.Sprintf(
				"`%s` renders markup, so it can only end a text interpolation — not %s (D174)",
				fc.Name, where))
		}
	}
	return nil
}

// emitMarkup lowers a text interpolation ending in a markup formatter to the
// live-HTML vnode. The chain before the markup formatter compiles exactly as a
// text interpolation's does, and the value takes the shared display coercion,
// so `{ post.body | raw }` prints what `{ post.body }` would print — as markup.
// The markup formatter itself is never called through the registry: the
// runtime applies the sanitizer (`raw`) or the escape-and-<br> (`newline_to_br`,
// flagged by `br: true`).
func (c *compiler) emitMarkup(in *parser.Interpolation, scope scopeMap) (string, error) {
	if startsWithObjectLiteral(in.Expr) {
		return "", c.cgErr(in.Pos, objectLiteralMsg)
	}
	facts := c.factSink()
	defer c.absorb(facts, scope)
	last := len(in.Formatters) - 1
	chain := in.Formatters[:last]
	resolved := c.resolveInterpBase(in.Expr, chain, scope, facts)
	value := c.displayValue(c.applyFormatters(resolved, chain, scope, facts), in.Expr)
	if in.Formatters[last].Name == "newline_to_br" {
		return "new ViewNode('#html', { value: " + value + ", br: true })", nil
	}
	return "new ViewNode('#html', { value: " + value + " })", nil
}
