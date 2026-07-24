package codegen

// a11y.go — compile-time accessibility warnings (v1.48, D82). A read-only walk
// over the parsed template (and skeleton) AST that surfaces five common,
// unambiguous accessibility mistakes as positioned, NON-FATAL Warnings
// (Result.Warnings — same out-of-band channel as the <script>-import collision
// warning, so the generated JS is byte-identical and goldens never move):
//
//  1. <img> without alt
//  2. <input type="image"> without alt (static type only)
//  3. <iframe> without title
//  4. <a> without href
//  5. a statically positive tabindex
//
// Deliberately conservative: an attribute counts as present if ANY attr node
// carries its name — alt={desc} and mixed values count, and alt="" is valid
// (decorative image), so neither warns. Dynamic or mixed values the compiler
// cannot read statically (type={t}, tabindex={i}) never warn. Capitalized tags
// parse as Components, so user components never reach these element rules.

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// collectA11yWarnings walks nodes recursively — descending into If/For/Case
// branches and Component/Slot children — appending one Warning per finding at
// the offending element's own position. Run it on the freshly parsed AST,
// BEFORE resolveInlineSVG: a resolved {#svg} element carries never-parsed raw
// markup (RawInner) that must not be inspected, and pre-resolve those nodes are
// still InlineSVG leaves the walk skips naturally.
func collectA11yWarnings(nodes []parser.Node, file string, warnings *[]Warning) {
	for _, n := range nodes {
		switch node := n.(type) {
		case *parser.Element:
			checkElementA11y(node, file, warnings)
			collectA11yWarnings(node.Children, file, warnings)
		case *parser.Component:
			collectA11yWarnings(node.Children, file, warnings)
		case *parser.Slot:
			collectA11yWarnings(node.Children, file, warnings)
		case *parser.If:
			collectA11yWarnings(node.Then, file, warnings)
			collectA11yWarnings(node.Else, file, warnings)
		case *parser.For:
			collectA11yWarnings(node.Body, file, warnings)
		case *parser.Case:
			for i := range node.Clauses {
				collectA11yWarnings(node.Clauses[i].Body, file, warnings)
			}
			collectA11yWarnings(node.Else, file, warnings)
		}
		// Text, Interpolation, InlineSVG: nothing to check, nothing to descend.
	}
}

// checkElementA11y applies the five D82 rules to one element. The tag rules are
// mutually exclusive; the tabindex rule applies to any tag on top of them.
func checkElementA11y(el *parser.Element, file string, warnings *[]Warning) {
	warn := func(msg string) {
		*warnings = append(*warnings, Warning{
			File: file, Line: el.Pos.Line, Col: el.Pos.Col, Message: msg,
		})
	}

	switch {
	case strings.EqualFold(el.Tag, "img"):
		if !attrPresent(el.Attrs, "alt") {
			warn(`<img> has no alt attribute — add alt text, or alt="" for a decorative image`)
		}
	case strings.EqualFold(el.Tag, "input"):
		// Only a STATIC type="image" is an image button; a dynamic/mixed type is
		// unknowable at compile time, so it stays silent.
		if v, ok := staticAttrValue(el.Attrs, "type"); ok && strings.EqualFold(v, "image") {
			if !attrPresent(el.Attrs, "alt") {
				warn(`<input type="image"> has no alt attribute — add alt text describing the button action`)
			}
		}
	case strings.EqualFold(el.Tag, "iframe"):
		if !attrPresent(el.Attrs, "title") {
			warn(`<iframe> has no title attribute — add a title describing the embedded content`)
		}
	case strings.EqualFold(el.Tag, "a"):
		if !attrPresent(el.Attrs, "href") {
			warn(`<a> has no href attribute — add an href, or use a <button> for actions that are not navigation`)
		}
	}

	if v, ok := staticAttrValue(el.Attrs, "tabindex"); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			warn(fmt.Sprintf(`tabindex=%q is positive — positive values override the natural tab order; use tabindex="0" and reorder the markup instead`, v))
		}
	}
}

// attrPresent reports whether ANY attr node — static (including valueless),
// dynamic, or mixed — carries the given name, case-insensitively. Event attrs
// (@name) are listeners, not attributes, so they never count.
func attrPresent(attrs []parser.Attr, name string) bool {
	for _, a := range attrs {
		switch at := a.(type) {
		case *parser.StaticAttr:
			if strings.EqualFold(at.Name, name) {
				return true
			}
		case *parser.DynamicAttr:
			if strings.EqualFold(at.Name, name) {
				return true
			}
		case *parser.MixedAttr:
			if strings.EqualFold(at.Name, name) {
				return true
			}
		}
	}
	return false
}

// staticAttrValue returns the named attribute's value ONLY when it is a plain
// StaticAttr with a written value — dynamic, mixed, and valueless forms return
// ok=false, keeping the value-inspecting rules silent on anything not
// statically knowable.
func staticAttrValue(attrs []parser.Attr, name string) (string, bool) {
	for _, a := range attrs {
		if at, ok := a.(*parser.StaticAttr); ok && strings.EqualFold(at.Name, name) && !at.Valueless {
			return at.Value, true
		}
	}
	return "", false
}
