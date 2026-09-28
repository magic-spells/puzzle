package codegen

import (
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// datalang.go enforces D176: a template VALUE expression is data plus
// operators, not JavaScript. It is a pre-check over the authored template
// (and skeleton), run before anything is emitted, so the emitters can trust
// that every value they resolve is in the data language. Two doors into
// JavaScript stay open (D176 rule 5): a `this.` chain — from `this` through
// every member step, index and call argument that follows it — and an @event
// handler body. A handler-valued conditional's CONDITION is a render-time
// value and is checked; its branches are handler bodies and are not.

// The positioned D176 messages, worded as Puzzle Sites words its expression
// errors ("… are not available in template expressions"), each naming the
// replacement.
const (
	dataCallMsg     = "method and function calls are not available in template expressions — use a formatter (`| round`, `| upcase`), or compute the value first in data()"
	dataArrowMsg    = "arrow functions are not available in template expressions — compute the value first in data()"
	dataTemplateMsg = "template literals are not available in template expressions — write `{ a } { b }` or `a + ' ' + b`"
	dataRegexMsg    = "regular expression literals are not available in template expressions — compute the value first in data()"
	dataUpdateMsg   = "`++` and `--` are not available in template expressions — a template reads data; change it in an event handler"
	dataAssignMsg   = "assignment is not available in template expressions — a template reads data; change it in an event handler (compare with `===`)"
	dataCommaMsg    = "the comma operator is not available in template expressions — a value is one expression; compute it first in data()"
	dataBitwiseMsg  = "bitwise operators are not available in template expressions — use `&&` / `||` for logic, or compute the value first in data()"
	dataLengthMsg   = "`.length` is not part of the template language — use `.size` (the count of a list or string)"
	// An @event value is JavaScript, but it is still written in a template: a
	// `|` there is neither a formatter pipe (those format a displayed value)
	// nor a bitwise OR (the template language has none, D176 rule 4).
	dataHandlerPipeMsg = "a `|` is not available in an event handler — formatter pipes format a displayed value and there is no bitwise OR in templates; format the value in the handler method instead"
)

// dataKeywordMsg names an operator keyword the data language does not have.
func dataKeywordMsg(word string) string {
	return "`" + word + "` is not available in template expressions — compute the value first in data()"
}

// dataKeywords are the JavaScript operator keywords rejected in a value.
var dataKeywords = map[string]bool{"new": true, "typeof": true, "instanceof": true, "in": true}

// dataAssignOps are the assignment operators. `==`, `===`, `!=`, `!==`, `<=`,
// `>=` and `=>` are separate tokens, so they never match here.
var dataAssignOps = map[string]bool{
	"=": true, "+=": true, "-=": true, "*=": true, "/=": true, "%=": true, "**=": true,
	"<<=": true, ">>=": true, ">>>=": true, "&=": true, "|=": true, "^=": true,
	"&&=": true, "||=": true, "??=": true,
}

// dataBitwiseOps are the bitwise operators. A single `|` is the parser's (a
// formatter pipe at the top level of a value, an error anywhere else).
var dataBitwiseOps = map[string]bool{"&": true, "^": true, "~": true, "<<": true, ">>": true, ">>>": true}

// dataPuncts are the multi-byte punctuators, longest first so the lexer takes
// the longest match.
var dataPuncts = []string{
	">>>=",
	"===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "...",
	"=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--",
	"+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
}

type dataTokKind byte

const (
	dtIdent dataTokKind = iota
	dtNumber
	dtString
	dtTemplate
	dtRegex
	dtPunct
)

// dataTok is one token of a template expression. endsExpr reports whether the
// token can end an expression, which decides whether a following `(` is a call
// and a following `/` is division.
type dataTok struct {
	kind       dataTokKind
	text       string
	start, end int
	endsExpr   bool
}

// lexDataExpr tokenizes a template expression. Strings, template literals,
// regex literals and comments are opaque (parser.LexSkip, the one shared
// lexical skip), so nothing inside them is ever read as an operator or name.
func lexDataExpr(expr string) []dataTok {
	var toks []dataTok
	prev := false
	add := func(kind dataTokKind, start, end int, ends bool) {
		toks = append(toks, dataTok{kind: kind, text: expr[start:end], start: start, end: end, endsExpr: ends})
		prev = ends
	}
	for i := 0; i < len(expr); {
		c := expr[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
			continue
		case c == '/' && i+1 < len(expr) && (expr[i+1] == '/' || expr[i+1] == '*'):
			i, _, _ = parser.LexSkip(expr, i, prev)
			continue
		case isDigit(c) || (c == '.' && !prev && i+1 < len(expr) && isDigit(expr[i+1])):
			j := scanNumber(expr, i)
			add(dtNumber, i, j, true)
			i = j
			continue
		case c == '\'' || c == '"':
			j, _, _ := parser.LexSkip(expr, i, prev)
			add(dtString, i, j, true)
			i = j
			continue
		case c == '`':
			j, _, _ := parser.LexSkip(expr, i, prev)
			add(dtTemplate, i, j, true)
			i = j
			continue
		case c == '/' && !prev:
			j, _, _ := parser.LexSkip(expr, i, prev)
			add(dtRegex, i, j, true)
			i = j
			continue
		case isIdentStart(c):
			j := i
			for j < len(expr) && isIdentChar(expr[j]) {
				j++
			}
			name := expr[i:j]
			ends := !regexPrecedingKeywords[name]
			if n := len(toks); n > 0 && (toks[n-1].text == "." || toks[n-1].text == "?.") {
				ends = true
			}
			add(dtIdent, i, j, ends)
			i = j
			continue
		}
		width := 1
		for _, p := range dataPuncts {
			if len(expr)-i >= len(p) && expr[i:i+len(p)] == p {
				width = len(p)
				break
			}
		}
		op := expr[i : i+width]
		if op == "?." && i+2 < len(expr) && isDigit(expr[i+2]) {
			// `a?.5:1` is a conditional with a `.5` branch, not optional chaining.
			width, op = 1, "?"
		}
		ends := c == ')' || c == ']' || c == '}'
		if op == "++" || op == "--" {
			ends = prev
		}
		add(dtPunct, i, i+width, ends)
		i += width
	}
	return toks
}

// matchDataBrackets maps each opening bracket token to its closing token (-1
// when unclosed).
func matchDataBrackets(toks []dataTok) []int {
	match := make([]int, len(toks))
	var stack []int
	for k, t := range toks {
		match[k] = -1
		if t.kind != dtPunct {
			continue
		}
		switch t.text {
		case "(", "[", "{":
			stack = append(stack, k)
		case ")", "]", "}":
			if len(stack) > 0 {
				match[stack[len(stack)-1]] = k
				stack = stack[:len(stack)-1]
			}
		}
	}
	return match
}

// isMemberDot reports whether toks[k] is a member-access dot (`.` or `?.`).
func isMemberDot(toks []dataTok, k int) bool {
	return k >= 0 && k < len(toks) && toks[k].kind == dtPunct && (toks[k].text == "." || toks[k].text == "?.")
}

// thisChainTokens marks the tokens of every `this.` chain: the `this` root and
// every member step, index, call argument list and tagged template after it.
// Such a chain is the view instance — PuzzleKit JavaScript (D176 rule 5) — so
// nothing in it is checked or rewritten.
func thisChainTokens(toks []dataTok) []bool {
	exempt := make([]bool, len(toks))
	match := matchDataBrackets(toks)
	closeOf := func(k int) int {
		if match[k] < 0 {
			return len(toks) - 1
		}
		return match[k]
	}
	for k := 0; k < len(toks); k++ {
		t := toks[k]
		if t.kind != dtIdent || t.text != "this" || isMemberDot(toks, k-1) {
			continue
		}
		end := k + 1
	chain:
		for end < len(toks) {
			next := toks[end]
			switch {
			case isMemberDot(toks, end) && end+1 < len(toks) && toks[end+1].kind == dtIdent:
				end += 2
			case next.text == "?." && end+1 < len(toks) && (toks[end+1].text == "(" || toks[end+1].text == "["):
				end = closeOf(end+1) + 1
			case next.kind == dtPunct && (next.text == "(" || next.text == "["):
				end = closeOf(end) + 1
			case next.kind == dtTemplate:
				end++
			default:
				break chain
			}
		}
		for j := k; j < end && j < len(toks); j++ {
			exempt[j] = true
		}
		k = end - 1
	}
	return exempt
}

// sizeSteps returns the byte offsets of the `size` names in expr that are the
// D176 count: a member step (`.size`, `?.size`) outside a `this.` chain and not
// called. The resolver lowers exactly these to the `__z` helper, and the
// pre-check reads the same set to import the helper, so the two can never
// disagree about whether a module uses it.
func sizeSteps(expr string) map[int]bool {
	if !strings.Contains(expr, "size") {
		return nil
	}
	toks := lexDataExpr(expr)
	exempt := thisChainTokens(toks)
	var steps map[int]bool
	for k, t := range toks {
		if exempt[k] || t.kind != dtIdent || t.text != "size" || !isMemberDot(toks, k-1) {
			continue
		}
		if k+1 < len(toks) && toks[k+1].text == "(" {
			continue
		}
		if steps == nil {
			steps = map[int]bool{}
		}
		steps[t.start] = true
	}
	return steps
}

// dataExprError returns the D176 message for the first construct in expr that
// is not in the template data language, or "" when expr is a data expression.
func dataExprError(expr string) string {
	toks := lexDataExpr(expr)
	exempt := thisChainTokens(toks)
	var stack []string
	for k, t := range toks {
		if exempt[k] {
			continue
		}
		var prev *dataTok
		if k > 0 {
			prev = &toks[k-1]
		}
		switch t.kind {
		case dtTemplate:
			return dataTemplateMsg
		case dtRegex:
			return dataRegexMsg
		case dtIdent:
			if isMemberDot(toks, k-1) {
				if t.text == "length" {
					return dataLengthMsg
				}
				continue
			}
			objectKey := len(stack) > 0 && stack[len(stack)-1] == "{" &&
				k+1 < len(toks) && toks[k+1].text == ":"
			if dataKeywords[t.text] && !objectKey {
				return dataKeywordMsg(t.text)
			}
		case dtPunct:
			switch {
			case t.text == "(" || t.text == "[" || t.text == "{":
				if t.text == "(" && prev != nil && prev.endsExpr {
					return dataCallMsg
				}
				stack = append(stack, t.text)
			case t.text == ")" || t.text == "]" || t.text == "}":
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
			case t.text == "?." && k+1 < len(toks) && toks[k+1].text == "(":
				return dataCallMsg
			case t.text == "=>":
				return dataArrowMsg
			case t.text == "++" || t.text == "--":
				return dataUpdateMsg
			case dataAssignOps[t.text]:
				return dataAssignMsg
			case dataBitwiseOps[t.text]:
				return dataBitwiseMsg
			case t.text == "," && len(stack) == 0:
				return dataCommaMsg
			}
		}
	}
	return ""
}

// hasSinglePipe reports whether expr holds a `|` operator (not `||` or `|=`)
// outside its strings, comments and regex literals.
func hasSinglePipe(expr string) bool {
	for _, t := range lexDataExpr(expr) {
		if t.kind == dtPunct && t.text == "|" {
			return true
		}
	}
	return false
}

// checkDataLanguage walks a template (or skeleton) and rejects, with a
// positioned error, every value expression that is not in the data language:
// text interpolations, attribute values and props (brace-only and quoted,
// inline-if conditions and branches), marker arguments, `key=`, the
// `{#if}`/`{#case}`/`{:when}` subjects, loop collections and range bounds,
// every formatter argument, and a handler-valued conditional's condition.
func (c *compiler) checkDataLanguage(nodes []parser.Node) error {
	for _, n := range nodes {
		var err error
		switch node := n.(type) {
		case *parser.Interpolation:
			err = c.checkDataInterp(node, node.Pos)
		case *parser.Element:
			if err = c.checkDataAttrs(node.Attrs); err == nil {
				err = c.checkDataLanguage(node.Children)
			}
		case *parser.Component:
			if err = c.checkDataAttrs(node.Props); err == nil {
				err = c.checkDataLanguage(node.Children)
			}
		case *parser.Slot:
			if err = c.checkDataAttrs(node.Args); err == nil {
				err = c.checkDataLanguage(node.Children)
			}
		case *parser.Snippet:
			err = c.checkDataLanguage(node.Body)
		case *parser.Portal:
			err = c.checkDataLanguage(node.Children)
		case *parser.If:
			if err = c.checkDataExpr(node.Cond, node.Pos); err == nil {
				if err = c.checkDataLanguage(node.Then); err == nil {
					err = c.checkDataLanguage(node.Else)
				}
			}
		case *parser.Case:
			err = c.checkDataExpr(node.Expr, node.Pos)
			for _, clause := range node.Clauses {
				for _, v := range clause.Values {
					if err == nil {
						err = c.checkDataExpr(v, clause.Pos)
					}
				}
				if err == nil {
					err = c.checkDataLanguage(clause.Body)
				}
			}
			if err == nil {
				err = c.checkDataLanguage(node.Else)
			}
		case *parser.For:
			if node.IsRange {
				if err = c.checkDataExpr(node.RangeFrom, node.Pos); err == nil {
					err = c.checkDataExpr(node.RangeTo, node.Pos)
				}
			} else {
				err = c.checkDataExpr(node.Collection, node.Pos)
			}
			if err == nil {
				err = c.checkDataLanguage(node.Body)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (c *compiler) checkDataAttrs(attrs []parser.Attr) error {
	for _, attr := range attrs {
		var err error
		switch a := attr.(type) {
		case *parser.DynamicAttr:
			err = c.checkDataChain(a.Expr, a.Formatters, a.Pos)
		case *parser.MixedAttr:
			err = c.checkDataParts(a.Parts, a.Pos)
		case *parser.EventAttr:
			// The handler body is JavaScript; only a handler-valued
			// conditional's condition is evaluated during render.
			if hasSinglePipe(a.Expr) {
				err = c.cgErr(a.Pos, dataHandlerPipeMsg)
			} else if cond, _, _, ok := splitEventConditional(a.Expr); ok {
				err = c.checkDataExpr(cond, a.Pos)
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (c *compiler) checkDataParts(parts []parser.Part, pos parser.Position) error {
	for _, part := range parts {
		var err error
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				err = c.checkDataInterp(p.Interp, pos)
			}
		case *parser.InlineIfPart:
			if err = c.checkDataExpr(p.Cond, pos); err == nil {
				if err = c.checkDataParts(p.Then, pos); err == nil {
					err = c.checkDataParts(p.Else, pos)
				}
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (c *compiler) checkDataInterp(in *parser.Interpolation, pos parser.Position) error {
	return c.checkDataChain(in.Expr, in.Formatters, pos)
}

// checkDataChain checks a value's base expression and every formatter
// argument. The formatter call itself is not a call on data (D176 rule 3).
func (c *compiler) checkDataChain(expr string, fmts []parser.FormatterCall, pos parser.Position) error {
	if err := c.checkDataExpr(expr, pos); err != nil {
		return err
	}
	for _, fc := range fmts {
		for _, arg := range fc.Args {
			if err := c.checkDataExpr(arg, pos); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *compiler) checkDataExpr(expr string, pos parser.Position) error {
	if len(sizeSteps(expr)) > 0 {
		c.usesSize = true
	}
	if msg := dataExprError(expr); msg != "" {
		return c.cgErr(pos, msg)
	}
	return nil
}
