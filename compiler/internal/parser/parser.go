package parser

import "strings"

// parser.go is the recursive-descent parser over the lexer's token stream
// (constellation/doc/DOC-COMPILER-DESIGN.md §c). It produces the AST in ast.go. Blocks and
// elements are cross-checked so a {/if} closing across an unclosed <div> (or
// vice versa) is a positioned error naming BOTH the opener and the offender
// (constellation/doc/DOC-COMPILER-DESIGN.md §e).

type parser struct {
	lex  *lexer
	file string
	cur  Token
}

func newParser(lex *lexer, file string) (*parser, error) {
	p := &parser{lex: lex, file: file}
	if err := p.advance(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *parser) advance() error {
	t, err := p.lex.Next()
	if err != nil {
		return toPE(err)
	}
	p.cur = t
	return nil
}

func tokPos(t Token) Position {
	return Position{Line: t.Line, Col: t.Col, Offset: t.Offset}
}

// ctxKind identifies what a child list is being collected for, so a stray
// closer can be diagnosed with the opener's position.
type ctxKind int

const (
	ctxRoot ctxKind = iota
	ctxElement
	ctxBlockIf
	ctxBlockUnless
	ctxBlockFor
	ctxBlockCase
)

type openCtx struct {
	kind ctxKind
	name string // element tag, for ctxElement
	pos  Position
}

// Parse splits sections and parses the template, returning the <puzzle-view>
// root element.
func Parse(source []byte, filename string) (*Element, error) {
	sec, err := SplitSections(string(source), filename)
	if err != nil {
		return nil, err
	}
	return ParseTemplate(sec, filename)
}

// ParseTemplate parses the already-split template content into the root
// <puzzle-view> element (attributes supplied by the section splitter).
func ParseTemplate(sec *Sections, filename string) (*Element, error) {
	lx := newLexer(sec.TemplateContent, sec.TemplatePos, filename)
	p, err := newParser(lx, filename)
	if err != nil {
		return nil, err
	}
	nodes, perr := p.parseChildren(openCtx{kind: ctxRoot, pos: sec.ViewTagPos})
	if perr != nil {
		return nil, perr
	}
	root := &Element{
		Tag:      "puzzle-view",
		Attrs:    sec.TemplateAttrs,
		Children: nodes,
		Pos:      sec.ViewTagPos,
	}
	if perr := validateIslands(root, filename); perr != nil {
		return nil, perr
	}
	if perr := validateSlots(root, filename); perr != nil {
		return nil, perr
	}
	if perr := validateRefs(root, filename); perr != nil {
		return nil, perr
	}
	return root, nil
}

// ParseSkeleton parses the optional <puzzle-skeleton> section (v1.8, D39) with
// the full template grammar, returning (nil, nil) when the file has none. The
// synthetic root carries NO attributes — in view mode codegen re-parents the
// skeleton children under the same <puzzle-view> root (and attributes) as the
// real template, so the loaded swap patches children only.
func ParseSkeleton(sec *Sections, filename string) (*Element, error) {
	if !sec.HasSkeleton {
		return nil, nil
	}
	lx := newLexer(sec.Skeleton, sec.SkeletonPos, filename)
	p, err := newParser(lx, filename)
	if err != nil {
		return nil, err
	}
	nodes, perr := p.parseChildren(openCtx{kind: ctxRoot, pos: sec.SkeletonTagPos})
	if perr != nil {
		return nil, perr
	}
	root := &Element{
		Tag:      "puzzle-skeleton",
		Children: nodes,
		Pos:      sec.SkeletonTagPos,
	}
	if perr := validateIslands(root, filename); perr != nil {
		return nil, perr
	}
	if perr := validateSlots(root, filename); perr != nil {
		return nil, perr
	}
	if perr := validateRefs(root, filename); perr != nil {
		return nil, perr
	}
	return root, nil
}

// ParsedFile is the full result of parsing a .pzl file: the template root plus
// the opaque <scripts> body and optional <styles> body (used by Step 3).
type ParsedFile struct {
	Root      *Element
	Scripts   string
	Styles    string
	HasStyles bool
}

// ParseFile parses a whole .pzl file.
func ParseFile(source []byte, filename string) (*ParsedFile, error) {
	sec, err := SplitSections(string(source), filename)
	if err != nil {
		return nil, err
	}
	root, err := ParseTemplate(sec, filename)
	if err != nil {
		return nil, err
	}
	return &ParsedFile{Root: root, Scripts: sec.Scripts, Styles: sec.Styles, HasStyles: sec.HasStyles}, nil
}

// parseChildren collects nodes for ctx until it meets a closer token, which it
// validates against ctx (leaving it unconsumed for the caller) or an error.
func (p *parser) parseChildren(ctx openCtx) ([]Node, *ParseError) {
	var nodes []Node
	for {
		t := p.cur
		switch t.Type {
		case TokEOF:
			if ctx.kind == ctxRoot {
				return nodes, nil
			}
			return nil, p.unclosedErr(ctx)
		case TokText:
			if t.Value != "" {
				nodes = append(nodes, &Text{Value: t.Value, Pos: tokPos(t)})
			}
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
		case TokComment:
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
		case TokInterp:
			interp, perr := parseInterpolationExpr(t.Value, tokPos(t), p.file)
			if perr != nil {
				return nil, perr
			}
			nodes = append(nodes, interp)
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
		case TokTagOpen:
			n, perr := p.parseElement()
			if perr != nil {
				return nil, perr
			}
			nodes = append(nodes, n)
		case TokBlockOpen:
			n, perr := p.parseBlock()
			if perr != nil {
				return nil, perr
			}
			nodes = append(nodes, n)
		case TokTagClose, TokBlockClose, TokElse, TokElseIf, TokWhen:
			if perr := p.checkCloser(ctx, t); perr != nil {
				return nil, perr
			}
			return nodes, nil
		default:
			return nil, errAt(p.file, tokPos(t), "unexpected token %s", t.Type)
		}
	}
}

// checkCloser validates that closer t terminates ctx; returns nil (match) or a
// positioned error naming both the opener and the offending closer.
func (p *parser) checkCloser(ctx openCtx, t Token) *ParseError {
	pos := tokPos(t)
	// {#svg} is a VOID block (v1.14, D46): it never opens a context, so any
	// {/svg} is stray regardless of the surrounding block/element. Report it with
	// a dedicated message before the generic closer-matching paths would print
	// their "unexpected {/svg}" / "closes across unclosed …" forms.
	if t.Type == TokBlockClose && t.Value == "svg" {
		return errAt(p.file, pos, "{#svg} is self-contained — remove the {/svg}")
	}
	// {:else if} is a valid boundary inside {#if} (parseBlock's if loop drives
	// the chaining); it is rejected in {#unless}/{#case}. Report the rejections
	// with a context-aware hint before the per-context closer matching.
	if t.Type == TokElseIf {
		switch ctx.kind {
		case ctxBlockUnless:
			return errAt(p.file, pos, "{:else if} is not allowed inside {#unless} opened at %d:%d — restructure as {#if}",
				ctx.pos.Line, ctx.pos.Col)
		case ctxBlockCase:
			return errAt(p.file, pos, "{:else if} is not allowed inside {#case} opened at %d:%d — use {:when} clauses",
				ctx.pos.Line, ctx.pos.Col)
		case ctxBlockIf:
			return nil
		default:
			return errAt(p.file, pos, "{:else if} outside of {#if} block")
		}
	}
	// {:when} is only a valid boundary inside a {#case}; anywhere else it is a
	// misplaced clause (name it clearly rather than falling into the generic
	// closer path, whose "</%s>" formatting would print the raw values header).
	if t.Type == TokWhen && ctx.kind != ctxBlockCase {
		return errAt(p.file, pos, "{:when} outside of {#case} block")
	}
	switch ctx.kind {
	case ctxRoot:
		switch t.Type {
		case TokTagClose:
			return errAt(p.file, pos, "unexpected closing tag </%s>", t.Value)
		case TokElse:
			return errAt(p.file, pos, "{:else} outside of {#if} block")
		default:
			return errAt(p.file, pos, "unexpected {/%s}", t.Value)
		}
	case ctxElement:
		if t.Type == TokTagClose {
			if t.Value == ctx.name {
				return nil
			}
			return errAt(p.file, pos, "closing tag </%s> does not match <%s> opened at %d:%d",
				t.Value, ctx.name, ctx.pos.Line, ctx.pos.Col)
		}
		return errAt(p.file, pos, "%s closes across unclosed <%s> opened at %d:%d",
			closerName(t), ctx.name, ctx.pos.Line, ctx.pos.Col)
	case ctxBlockIf:
		if t.Type == TokElse || t.Type == TokElseIf || (t.Type == TokBlockClose && t.Value == "if") {
			return nil
		}
		if t.Type == TokBlockClose {
			return errAt(p.file, pos, "{/%s} does not match {#if} opened at %d:%d",
				t.Value, ctx.pos.Line, ctx.pos.Col)
		}
		return errAt(p.file, pos, "</%s> closes across unclosed {#if} opened at %d:%d",
			t.Value, ctx.pos.Line, ctx.pos.Col)
	case ctxBlockUnless:
		if t.Type == TokElse || (t.Type == TokBlockClose && t.Value == "unless") {
			return nil
		}
		if t.Type == TokBlockClose {
			return errAt(p.file, pos, "{/%s} does not match {#unless} opened at %d:%d",
				t.Value, ctx.pos.Line, ctx.pos.Col)
		}
		return errAt(p.file, pos, "</%s> closes across unclosed {#unless} opened at %d:%d",
			t.Value, ctx.pos.Line, ctx.pos.Col)
	case ctxBlockFor:
		if t.Type == TokBlockClose && t.Value == "for" {
			return nil
		}
		if t.Type == TokBlockClose {
			return errAt(p.file, pos, "{/%s} does not match {#for} opened at %d:%d",
				t.Value, ctx.pos.Line, ctx.pos.Col)
		}
		if t.Type == TokElse {
			return errAt(p.file, pos, "{:else} outside of {#if} block")
		}
		return errAt(p.file, pos, "</%s> closes across unclosed {#for} opened at %d:%d",
			t.Value, ctx.pos.Line, ctx.pos.Col)
	case ctxBlockCase:
		// A {#case} body list is bounded by its own clause boundaries ({:when},
		// {:else}) and its closer {/case}; parseBlock's case loop drives the
		// clause sequencing, so all three are accepted here.
		if t.Type == TokWhen || t.Type == TokElse || (t.Type == TokBlockClose && t.Value == "case") {
			return nil
		}
		if t.Type == TokBlockClose {
			return errAt(p.file, pos, "{/%s} does not match {#case} opened at %d:%d",
				t.Value, ctx.pos.Line, ctx.pos.Col)
		}
		return errAt(p.file, pos, "</%s> closes across unclosed {#case} opened at %d:%d",
			t.Value, ctx.pos.Line, ctx.pos.Col)
	}
	return errAt(p.file, pos, "unexpected closer")
}

func closerName(t Token) string {
	switch t.Type {
	case TokElse:
		return "{:else}"
	case TokElseIf:
		return "{:else if}"
	case TokWhen:
		return "{:when}"
	case TokBlockClose:
		return "{/" + t.Value + "}"
	case TokTagClose:
		return "</" + t.Value + ">"
	}
	return "closer"
}

func (p *parser) unclosedErr(ctx openCtx) *ParseError {
	switch ctx.kind {
	case ctxElement:
		return errAt(p.file, ctx.pos, "unclosed <%s> opened at %d:%d", ctx.name, ctx.pos.Line, ctx.pos.Col)
	case ctxBlockIf:
		return errAt(p.file, ctx.pos, "unclosed {#if} opened at %d:%d", ctx.pos.Line, ctx.pos.Col)
	case ctxBlockUnless:
		return errAt(p.file, ctx.pos, "unclosed {#unless} opened at %d:%d", ctx.pos.Line, ctx.pos.Col)
	case ctxBlockFor:
		return errAt(p.file, ctx.pos, "unclosed {#for} opened at %d:%d", ctx.pos.Line, ctx.pos.Col)
	case ctxBlockCase:
		return errAt(p.file, ctx.pos, "unclosed {#case} opened at %d:%d", ctx.pos.Line, ctx.pos.Col)
	}
	return errAt(p.file, ctx.pos, "unclosed block")
}

// parseElement parses an element, component, or composition marker
// (<children/>, <Slot/>, or a named <slot name>) starting at the current
// TokTagOpen.
func (p *parser) parseElement() (Node, *ParseError) {
	open := p.cur
	name := open.Value
	pos := tokPos(open)
	if err := p.advance(); err != nil {
		return nil, toPE(err)
	}
	attrs, selfClose, perr := p.parseAttrs()
	if perr != nil {
		return nil, perr
	}

	// Composition markers (v1.41, D74): each spelling now has exactly one role —
	// <children/> is the default marker (call-site content), <Slot/> is the same
	// marker capitalized (the router outlet), and lowercase <slot> is ONLY ever a
	// named slot (name is required). All three emit the same marker vnode.
	isChildren := name == "children"
	isSlotTag := name == "slot"
	isOutlet := name == "Slot"
	isComp := isCapitalized(name)

	var children []Node
	if !selfClose {
		ch, cerr := p.parseChildren(openCtx{kind: ctxElement, name: name, pos: pos})
		if cerr != nil {
			return nil, cerr
		}
		children = ch
		if err := p.advance(); err != nil { // consume matching TokTagClose
			return nil, toPE(err)
		}
	}

	if isChildren {
		// <children/> (D74): the DEFAULT marker. No attributes (any is a
		// positioned error; ref gets the D72 render-target message). Fallback
		// children ARE allowed — rendered when the default bucket is empty (this
		// un-freezes D53's deferred default-slot fallback). Modeled as an unnamed
		// *Slot so codegen and the runtime treat it exactly like a bare <Slot/>.
		if perr := childrenMarkerAttrs(attrs, p.file); perr != nil {
			return nil, perr
		}
		return &Slot{Name: "", Children: children, Pos: pos}, nil
	}
	if isOutlet {
		// <Slot/> (D30): the router outlet — the default marker, capitalized,
		// canonical in routed views/layouts. Bare only: a `name` attr steers to
		// lowercase <slot name>, and children are rejected (no fallback on the
		// outlet — an index child route is the sanctioned empty-state; only
		// <children> takes fallback).
		if perr := slotOutletAttrs(attrs, p.file); perr != nil {
			return nil, perr
		}
		if len(children) > 0 {
			return nil, errAt(p.file, pos, "<Slot> cannot have children")
		}
		return &Slot{Pos: pos}, nil
	}
	if isSlotTag {
		// Lowercase <slot> (D74): a NAMED slot only — `name` is REQUIRED. A
		// nameless <slot>/<slot/> is a positioned error naming both replacements.
		// Children are fallback content (full grammar), rendered when the call
		// site fills nothing for this name (v1.21, D53).
		slotName, perr := namedSlotFromAttrs(attrs, pos, p.file)
		if perr != nil {
			return nil, perr
		}
		return &Slot{Name: slotName, Children: children, Pos: pos}, nil
	}
	if isComp {
		return &Component{Name: name, Props: attrs, Children: children, Pos: pos}, nil
	}
	return &Element{Tag: name, Attrs: attrs, Children: children, Pos: pos}, nil
}

// parseAttrs reads attributes until the tag terminator, which it consumes.
// selfClose reports whether the tag ended with "/>".
func (p *parser) parseAttrs() (attrs []Attr, selfClose bool, perr *ParseError) {
	for {
		t := p.cur
		switch t.Type {
		case TokTagEnd:
			if err := p.advance(); err != nil {
				return nil, false, toPE(err)
			}
			return attrs, false, nil
		case TokSelfClose:
			if err := p.advance(); err != nil {
				return nil, false, toPE(err)
			}
			return attrs, true, nil
		case TokAttrName:
			name := t.Value
			npos := tokPos(t)
			if err := p.advance(); err != nil {
				return nil, false, toPE(err)
			}
			if p.cur.Type == TokEquals {
				if err := p.advance(); err != nil {
					return nil, false, toPE(err)
				}
				a, e := buildAttr(name, npos, p.cur, p.file)
				if e != nil {
					return nil, false, e
				}
				if err := p.advance(); err != nil {
					return nil, false, toPE(err)
				}
				attrs = append(attrs, a)
			} else {
				if strings.HasPrefix(name, "@") {
					return nil, false, errAt(p.file, npos, "event handler %s requires an ={ ... } expression", name)
				}
				attrs = append(attrs, &StaticAttr{Name: name, Value: "", Valueless: true, Pos: npos})
			}
		case TokEOF:
			return nil, false, errAt(p.file, tokPos(t), "unexpected end of input inside tag")
		default:
			return nil, false, errAt(p.file, tokPos(t), "unexpected token %s in tag", t.Type)
		}
	}
}

// buildAttr classifies an attribute given its name and value token.
func buildAttr(name string, npos Position, v Token, file string) (Attr, *ParseError) {
	vpos := tokPos(v)
	// Template comments (D70) are not template structure — an unquoted
	// attr={##…} / attr={#comment…} would otherwise be treated as a JS expression.
	if v.Type == TokAttrBrace && isTemplateCommentInner(v.Value) {
		return nil, errAt(file, vpos, "template comments are not allowed in attribute values")
	}
	if strings.HasPrefix(name, "@") {
		if v.Type != TokAttrBrace {
			return nil, errAt(file, npos, "event handler %s must use ={ ... }", name)
		}
		expr := strings.TrimSpace(v.Value)
		if expr == "" {
			return nil, errAt(file, vpos, "event handler %s has an empty expression", name)
		}
		event, mods, perr := parseEventModifiers(name[1:], npos, file)
		if perr != nil {
			return nil, perr
		}
		return &EventAttr{Name: event, Modifiers: mods, Expr: expr, Pos: npos}, nil
	}
	switch v.Type {
	case TokAttrBrace:
		expr := strings.TrimSpace(v.Value)
		if expr == "" {
			return nil, errAt(file, vpos, "empty attribute expression for %q", name)
		}
		return &DynamicAttr{Name: name, Expr: expr, Pos: npos}, nil
	case TokAttrQuoted, TokAttrBare:
		parts, perr := parseAttrParts(v.Value, vpos, file)
		if perr != nil {
			return nil, perr
		}
		if allStatic(parts) {
			return &StaticAttr{Name: name, Value: staticText(parts), Pos: npos}, nil
		}
		return &MixedAttr{Name: name, Parts: parts, Pos: npos}, nil
	default:
		return nil, errAt(file, vpos, "invalid attribute value for %q", name)
	}
}

// eventKeyFilters are the key-name modifiers, valid ONLY on keyboard events.
// The value is the DOM KeyboardEvent.key the modifier gates on.
var eventKeyFilters = map[string]string{
	"enter":     "Enter",
	"escape":    "Escape",
	"tab":       "Tab",
	"space":     " ",
	"up":        "ArrowUp",
	"down":      "ArrowDown",
	"left":      "ArrowLeft",
	"right":     "ArrowRight",
	"backspace": "Backspace",
	"delete":    "Delete",
}

// eventGenericMods are the modifiers valid on any event.
var eventGenericMods = map[string]bool{
	"prevent": true,
	"stop":    true,
	"once":    true,
}

// eventKeyboardEvents are the events on which key-filter modifiers are allowed.
var eventKeyboardEvents = map[string]bool{
	"keydown":  true,
	"keyup":    true,
	"keypress": true,
}

// isKnownEventModifier reports whether s is any recognized modifier word —
// a generic modifier (prevent/stop/once) or a key filter (enter/escape/…).
// Reuses the modifier tables so the dotted-event-name guard (parseEventModifiers)
// never duplicates the list.
func isKnownEventModifier(s string) bool {
	if eventGenericMods[s] {
		return true
	}
	_, isKey := eventKeyFilters[s]
	return isKey
}

// parseEventModifiers splits an event-attribute name (already stripped of its
// leading '@') into the bare event name and its validated modifier list
// (`keydown:enter:prevent` → "keydown", ["enter","prevent"]). Modifiers keep
// their written order. Errors: unknown modifier; key filter on a non-keyboard
// event; duplicate modifier; more than one key filter.
func parseEventModifiers(raw string, npos Position, file string) (string, []string, *ParseError) {
	segs := strings.Split(raw, ":")
	event := segs[0]
	mods := segs[1:]
	// The event-name segment (before the first ':') is validated here — an unchecked
	// name silently binds a listener to a dead event type at runtime.
	//   (a) An EMPTY name (`@={h}`, `@:prevent={h}`) → a listener on event type "".
	if event == "" {
		return "", nil, errAt(file, npos, "event binding has no event name — write @click, @input, … (got @%s)", raw)
	}
	//   (b) Vue muscle-memory `@click.prevent`: the modifier is dotted, not ':'-
	//       separated, so the whole thing parses as the literal event type
	//       "click.prevent". If the segment after the LAST '.' is a recognized
	//       modifier word, reject with a did-you-mean. A dotted name whose suffix is
	//       NOT a modifier (a real custom event like @my.custom-event) is left alone.
	if dot := strings.LastIndexByte(event, '.'); dot >= 0 && isKnownEventModifier(event[dot+1:]) {
		return "", nil, errAt(file, npos, "event modifiers use ':', not '.' — write @%s instead of @%s",
			strings.ReplaceAll(raw, ".", ":"), raw)
	}
	if len(mods) == 0 {
		return event, nil, nil
	}
	seen := make(map[string]bool, len(mods))
	keyFilterCount := 0
	for _, m := range mods {
		if seen[m] {
			return "", nil, errAt(file, npos, "duplicate event modifier :%s in @%s", m, raw)
		}
		seen[m] = true
		if _, isKey := eventKeyFilters[m]; isKey {
			if !eventKeyboardEvents[event] {
				return "", nil, errAt(file, npos, "key filter :%s is only valid on keyboard events (keydown/keyup/keypress), not @%s", m, event)
			}
			keyFilterCount++
			if keyFilterCount > 1 {
				return "", nil, errAt(file, npos, "only one key filter is allowed per event handler (@%s)", raw)
			}
			continue
		}
		if !eventGenericMods[m] {
			return "", nil, errAt(file, npos, "unknown event modifier :%s in @%s", m, raw)
		}
	}
	return event, mods, nil
}

// parseBlock parses a {#if}/{#for} block starting at the current TokBlockOpen.
func (p *parser) parseBlock() (Node, *ParseError) {
	open := p.cur
	pos := tokPos(open)
	header := open.Value
	kw := firstWord(header)
	rest := strings.TrimSpace(header[len(kw):])
	if err := p.advance(); err != nil {
		return nil, toPE(err)
	}

	switch kw {
	case "if":
		// {#if a} … {:else if b} … {:else} … {/if}. Each {:else if} clause
		// desugars (right-to-left) into a nested If in the parent's Else list, so
		// codegen reuses the conditional path unchanged — no else-if AST node. The
		// opener pos threads through every clause context so unclosed errors keep
		// naming the {#if} opener.
		if rest == "" {
			return nil, errAt(p.file, pos, "{#if} requires a condition")
		}
		thenNodes, perr := p.parseChildren(openCtx{kind: ctxBlockIf, pos: pos})
		if perr != nil {
			return nil, perr
		}
		type elseIfClause struct {
			cond string
			body []Node
			pos  Position
		}
		var clauses []elseIfClause
		for p.cur.Type == TokElseIf {
			cpos := tokPos(p.cur)
			cond := p.cur.Value
			if cond == "" {
				return nil, errAt(p.file, cpos, "{:else if} requires a condition")
			}
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			body, e := p.parseChildren(openCtx{kind: ctxBlockIf, pos: pos})
			if e != nil {
				return nil, e
			}
			clauses = append(clauses, elseIfClause{cond: cond, body: body, pos: cpos})
		}
		var elseNodes []Node
		if p.cur.Type == TokElse {
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			en, e := p.parseChildren(openCtx{kind: ctxBlockIf, pos: pos})
			if e != nil {
				return nil, e
			}
			elseNodes = en
		}
		// {:else} must be the last clause — an {:else if} after it is misplaced.
		if p.cur.Type == TokElseIf {
			return nil, errAt(p.file, tokPos(p.cur),
				"{:else if} after {:else} in {#if} opened at %d:%d — {:else} must be the last clause",
				pos.Line, pos.Col)
		}
		if p.cur.Type != TokBlockClose || p.cur.Value != "if" {
			return nil, errAt(p.file, pos, "unclosed {#if} opened at %d:%d", pos.Line, pos.Col)
		}
		if err := p.advance(); err != nil {
			return nil, toPE(err)
		}
		// Desugar right-to-left: each {:else if} becomes an If nested in the
		// previous level's Else, terminating in the optional {:else} body.
		tail := elseNodes
		for i := len(clauses) - 1; i >= 0; i-- {
			c := clauses[i]
			tail = []Node{&If{Cond: c.cond, Then: c.body, Else: tail, Pos: c.pos}}
		}
		return &If{Cond: rest, Then: thenNodes, Else: tail, Pos: pos}, nil

	case "unless":
		// {#unless expr} desugars to the If node with a negated condition, so
		// codegen reuses the conditional path unchanged. The body renders when
		// expr is falsy; an optional {:else} renders when expr is truthy. The
		// expr is wrapped as !(…) to stay precedence-safe. {:else if} is rejected
		// (checkCloser) — unless/else-if chains are unreadable by design.
		if rest == "" {
			return nil, errAt(p.file, pos, "{#unless} requires a condition")
		}
		thenNodes, perr := p.parseChildren(openCtx{kind: ctxBlockUnless, pos: pos})
		if perr != nil {
			return nil, perr
		}
		var elseNodes []Node
		if p.cur.Type == TokElse {
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			en, e := p.parseChildren(openCtx{kind: ctxBlockUnless, pos: pos})
			if e != nil {
				return nil, e
			}
			elseNodes = en
		}
		if p.cur.Type != TokBlockClose || p.cur.Value != "unless" {
			return nil, errAt(p.file, pos, "unclosed {#unless} opened at %d:%d", pos.Line, pos.Col)
		}
		if err := p.advance(); err != nil {
			return nil, toPE(err)
		}
		return &If{Cond: "!(" + rest + ")", Then: thenNodes, Else: elseNodes, Pos: pos}, nil

	case "case":
		// {#case expr} … {:when v1, v2} … {:else} … {/case}. Unlike {#unless},
		// this keeps its own Case AST node so codegen can bind expr to a temp
		// once (semantically safe for getters); it does NOT desugar to If.
		if rest == "" {
			return nil, errAt(p.file, pos, "{#case} requires an expression")
		}
		// Only whitespace may sit between {#case expr} and the first {:when}; a
		// stray element/interpolation there is a positioned error.
		lead, perr := p.parseChildren(openCtx{kind: ctxBlockCase, pos: pos})
		if perr != nil {
			return nil, perr
		}
		if perr := p.requireBlankLead(lead); perr != nil {
			return nil, perr
		}
		var clauses []WhenClause
		for p.cur.Type == TokWhen {
			wpos := tokPos(p.cur)
			values, verr := parseWhenValues(p.cur.Value, wpos, p.file)
			if verr != nil {
				return nil, verr
			}
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			body, e := p.parseChildren(openCtx{kind: ctxBlockCase, pos: pos})
			if e != nil {
				return nil, e
			}
			clauses = append(clauses, WhenClause{Values: values, Body: body, Pos: wpos})
		}
		var elseNodes []Node
		if p.cur.Type == TokElse {
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
			en, e := p.parseChildren(openCtx{kind: ctxBlockCase, pos: pos})
			if e != nil {
				return nil, e
			}
			elseNodes = en
		}
		// {:else} must be the last clause — a {:when} after it is misplaced.
		if p.cur.Type == TokWhen {
			return nil, errAt(p.file, tokPos(p.cur),
				"{:when} after {:else} in {#case} opened at %d:%d — {:else} must be the last clause",
				pos.Line, pos.Col)
		}
		if p.cur.Type != TokBlockClose || p.cur.Value != "case" {
			return nil, errAt(p.file, pos, "unclosed {#case} opened at %d:%d", pos.Line, pos.Col)
		}
		if err := p.advance(); err != nil {
			return nil, toPE(err)
		}
		if len(clauses) == 0 {
			return nil, errAt(p.file, pos, "{#case} has no {:when} clauses")
		}
		return &Case{Expr: rest, Clauses: clauses, Else: elseNodes, Pos: pos}, nil

	case "svg":
		// {#svg 'path'} is a VOID block (v1.14, D46): it inlines a file at compile
		// time and never opens a context, so it returns the node directly — no
		// parseChildren, no {/svg} expected. A stray {/svg} is caught in checkCloser.
		svg, perr := parseSvgHeader(rest, pos, p.file)
		if perr != nil {
			return nil, perr
		}
		return svg, nil

	case "for":
		f, perr := parseForHeader(rest, pos, p.file)
		if perr != nil {
			return nil, perr
		}
		body, e := p.parseChildren(openCtx{kind: ctxBlockFor, pos: pos})
		if e != nil {
			return nil, e
		}
		if p.cur.Type != TokBlockClose || p.cur.Value != "for" {
			return nil, errAt(p.file, pos, "unclosed {#for} opened at %d:%d", pos.Line, pos.Col)
		}
		if err := p.advance(); err != nil {
			return nil, toPE(err)
		}
		f.Body = body
		return f, nil

	default:
		return nil, errAt(p.file, pos, "unknown block {#%s} (expected {#if}, {#unless}, {#for}, {#case}, or {#svg})", kw)
	}
}

// requireBlankLead verifies the nodes between {#case expr} and its first {:when}
// are whitespace only. Comments are already dropped by the lexer/parser, so any
// surviving node other than blank text is a positioned error.
func (p *parser) requireBlankLead(nodes []Node) *ParseError {
	for _, n := range nodes {
		if t, ok := n.(*Text); ok && strings.TrimSpace(t.Value) == "" {
			continue
		}
		return errAt(p.file, nodePos(n),
			"content between {#case} and its first {:when} must be whitespace")
	}
	return nil
}

// parseWhenValues splits a {:when} header into its OR-matched value expressions
// at top-level commas (respecting quotes/nesting so a literal or call with an
// interior comma stays intact). An empty header or a stray comma is an error.
func parseWhenValues(raw string, pos Position, file string) ([]string, *ParseError) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errAt(file, pos, "{:when} requires at least one value")
	}
	var vals []string
	for _, part := range splitTopLevel(raw, ',', false) {
		v := strings.TrimSpace(part)
		if v == "" {
			return nil, errAt(file, pos, "{:when} has an empty value (check for a stray comma)")
		}
		vals = append(vals, v)
	}
	return vals, nil
}

// nodePos returns the source position of any AST node, for error reporting.
func nodePos(n Node) Position {
	switch t := n.(type) {
	case *Element:
		return t.Pos
	case *Component:
		return t.Pos
	case *Slot:
		return t.Pos
	case *Text:
		return t.Pos
	case *Interpolation:
		return t.Pos
	case *If:
		return t.Pos
	case *For:
		return t.Pos
	case *Case:
		return t.Pos
	case *InlineSVG:
		return t.Pos
	}
	return Position{Line: 1, Col: 1}
}

// parseForHeader parses the header of a {#for}: either "item in collection" or
// the range form "from...to", each with an optional trailing ", counter". The
// counter is peeled first so both forms share it.
func parseForHeader(rest string, pos Position, file string) (*For, *ParseError) {
	if rest == "" {
		return nil, errAt(file, pos, "{#for} requires 'item in items' or a range 'from...to'")
	}
	rest, counter, perr := peelForCounter(rest, pos, file)
	if perr != nil {
		return nil, perr
	}
	if isReservedLoopIdent(counter) {
		return nil, reservedLoopIdentError(counter, pos, file)
	}
	if idx := topLevelIndex(rest, "..."); idx >= 0 {
		from := strings.TrimSpace(rest[:idx])
		to := strings.TrimSpace(rest[idx+3:])
		if from == "" || to == "" {
			return nil, errAt(file, pos, "malformed range in {#for %s}", rest)
		}
		return &For{IsRange: true, RangeFrom: from, RangeTo: to, Counter: counter, Pos: pos}, nil
	}
	item, coll, ok := splitForIn(rest)
	if !ok {
		return nil, errAt(file, pos, "{#for} expects 'item in items' (got %q)", rest)
	}
	// The loop variable must be a bare JS identifier — the same rule the counter
	// is held to (isBareIdent). splitForIn only bounds the item at whitespace, so
	// a name like "todo-item" reaches here and must be rejected with a positioned
	// error rather than compiling into invalid `.map((todo-item) => …)`.
	if !isBareIdent(item) {
		return nil, errAt(file, pos, "{#for} item must be a valid identifier (got %q)", item)
	}
	if isReservedLoopIdent(item) {
		return nil, reservedLoopIdentError(item, pos, file)
	}
	if counter != "" && counter == item {
		return nil, errAt(file, pos, "{#for} loop counter %q duplicates the item name", counter)
	}
	return &For{Item: item, Collection: coll, Counter: counter, Pos: pos}, nil
}

// peelForCounter conservatively removes a trailing ", name" loop-counter binding
// from a {#for} header. The counter binds only when the text after the LAST
// top-level comma is a bare identifier; any other non-identifier tail is left
// attached so a collection literal like `[1, 2, 3]` (its commas are not
// top-level) flows into the existing range/`in` parse unchanged. A top-level
// comma with an empty tail is an error.
func peelForCounter(rest string, pos Position, file string) (head, counter string, perr *ParseError) {
	idx := lastTopLevelIndexByte(rest, ',')
	if idx < 0 {
		return rest, "", nil
	}
	tail := strings.TrimSpace(rest[idx+1:])
	if tail == "" {
		return "", "", errAt(file, pos, "{#for} loop counter is empty (trailing ',' in %q)", rest)
	}
	if !isBareIdent(tail) {
		return rest, "", nil
	}
	return strings.TrimSpace(rest[:idx]), tail, nil
}

// isBareIdent reports whether s is a single JS identifier — the shape a {#for}
// loop counter must have (letters, digits, '_', '$'; not leading with a digit).
func isBareIdent(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '_' || c == '$':
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		case c >= '0' && c <= '9':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func isReservedLoopIdent(s string) bool {
	return s == "ViewNode" || strings.HasPrefix(s, "__")
}

func reservedLoopIdentError(name string, pos Position, file string) *ParseError {
	return errAt(file, pos, "loop variable %q uses a reserved name (identifiers starting with %q and %q are reserved by the compiler)", name, "__", "ViewNode")
}

// splitForIn splits "item in collection": item is the leading whitespace-
// delimited token, "in" is a whole word, and the rest is the collection
// expression. The item is bounded at whitespace (not by a character class) so
// any first token — including a valid `$foo` or an invalid `todo-item` — reaches
// the caller intact for a single isBareIdent check.
func splitForIn(rest string) (item, coll string, ok bool) {
	i := 0
	for i < len(rest) && isSpaceByte(rest[i]) {
		i++
	}
	start := i
	for i < len(rest) && !isSpaceByte(rest[i]) {
		i++
	}
	item = rest[start:i]
	if item == "" {
		return "", "", false
	}
	j := i
	for j < len(rest) && isSpaceByte(rest[j]) {
		j++
	}
	if !(j+2 <= len(rest) && rest[j:j+2] == "in" && (j+2 == len(rest) || isSpaceByte(rest[j+2]))) {
		return "", "", false
	}
	j += 2
	coll = strings.TrimSpace(rest[j:])
	if coll == "" {
		return "", "", false
	}
	return item, coll, true
}

// parseInterpolationExpr splits an interpolation's inner text into a base
// expression and a formatter chain, splitting pipes at top level only (|| is
// not a pipe) — constellation/doc/DOC-COMPILER-DESIGN.md §c.
func parseInterpolationExpr(raw string, pos Position, file string) (*Interpolation, *ParseError) {
	segs := splitTopLevel(raw, '|', true)
	expr := strings.TrimSpace(segs[0])
	if expr == "" {
		return nil, errAt(file, pos, "empty interpolation")
	}
	var fmts []FormatterCall
	for _, seg := range segs[1:] {
		s := strings.TrimSpace(seg)
		if s == "" {
			return nil, errAt(file, pos, "empty formatter in interpolation")
		}
		fc, perr := parseFormatter(s, pos, file)
		if perr != nil {
			return nil, perr
		}
		fmts = append(fmts, fc)
	}
	return &Interpolation{Expr: expr, Formatters: fmts, Pos: pos}, nil
}

// parseFormatter parses "name" or "name(arg, arg)". Arguments split at
// depth-zero commas outside quotes and are kept as raw JS expression strings.
func parseFormatter(s string, pos Position, file string) (FormatterCall, *ParseError) {
	open := strings.IndexByte(s, '(')
	if open < 0 {
		return FormatterCall{Name: s}, nil
	}
	name := strings.TrimSpace(s[:open])
	if name == "" {
		return FormatterCall{}, errAt(file, pos, "formatter is missing a name")
	}
	if !strings.HasSuffix(s, ")") {
		return FormatterCall{}, errAt(file, pos, "formatter %q: missing closing ')'", name)
	}
	argsRaw := s[open+1 : len(s)-1]
	var args []string
	if strings.TrimSpace(argsRaw) != "" {
		for _, a := range splitTopLevel(argsRaw, ',', false) {
			args = append(args, strings.TrimSpace(a))
		}
	}
	return FormatterCall{Name: name, Args: args}, nil
}

// firstWord returns the leading identifier-ish run of s (after leading space).
func firstWord(s string) string {
	s = strings.TrimLeft(s, " \t\r\n")
	i := 0
	for i < len(s) && isNameChar(s[i]) {
		i++
	}
	return s[:i]
}

func isCapitalized(s string) bool {
	return len(s) > 0 && s[0] >= 'A' && s[0] <= 'Z'
}

func allStatic(parts []Part) bool {
	for _, p := range parts {
		if _, ok := p.(*StaticPart); !ok {
			return false
		}
	}
	return true
}

func staticText(parts []Part) string {
	var b strings.Builder
	for _, p := range parts {
		if sp, ok := p.(*StaticPart); ok {
			b.WriteString(sp.Text)
		}
	}
	return b.String()
}
