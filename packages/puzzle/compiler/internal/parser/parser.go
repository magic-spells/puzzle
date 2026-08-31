package parser

import (
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/jsident"
)

// parser.go is the recursive-descent parser over the lexer's token stream
// (constellation/doc/DOC-COMPILER-DESIGN.md §c). It produces the AST in ast.go. Blocks and
// elements are cross-checked so a {/if} closing across an unclosed <div> (or
// vice versa) is a positioned error naming BOTH the opener and the offender
// (constellation/doc/DOC-COMPILER-DESIGN.md §e).

type parser struct {
	lex  *lexer
	file string
	cur  Token
	// hasRaw records that this top-level template/skeleton parser consumed a
	// D150 raw block. Raw bodies flatten to ordinary AST nodes, so the synthetic
	// root carries this fact to ScanUsage after parsing.
	hasRaw bool
	// raw is true for the nested parser that walks a captured {#raw} body. Inside
	// that body HTML is still structural, but nothing in it is Puzzle grammar
	// (D150): every tag is literal markup and every attribute is an authored
	// literal, so the composition markers, component resolution, and the
	// attribute-namespace reservation are all switched off.
	raw bool
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
		Tag:         "puzzle-view",
		Attrs:       sec.TemplateAttrs,
		Children:    nodes,
		Pos:         sec.ViewTagPos,
		ContainsRaw: p.hasRaw,
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
		Tag:         "puzzle-skeleton",
		Children:    nodes,
		Pos:         sec.SkeletonTagPos,
		ContainsRaw: p.hasRaw,
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
// the opaque <script> body and optional <style> body.
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
				nodes = append(nodes, &Text{Value: t.Value, Raw: p.raw, Pos: tokPos(t)})
			}
			if err := p.advance(); err != nil {
				return nil, toPE(err)
			}
		case TokRaw:
			p.hasRaw = true
			rawNodes, perr := p.parseRaw(t, ctx)
			if perr != nil {
				return nil, perr
			}
			nodes = append(nodes, rawNodes...)
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

// parseRaw reconciles D150's two simultaneous rules with the parent context the
// parser already owns: script/style are HTML RAWTEXT elements, so their whole
// captured body is one literal Text node; everywhere else HTML stays structural
// and a nested brace-disabled lexer/parser builds ordinary nodes.
//
// The nested parser also runs with `raw` set, which turns off every part of the
// grammar that is Puzzle rather than HTML: a body documenting <Children/>,
// <Slot name="…"/>, <Portal>, or <Card/> must SHOW that markup, not instantiate
// it, and a lowercase <slot>/<children> in sample markup is an ordinary element
// rather than the D134 steering error.
func (p *parser) parseRaw(t Token, ctx openCtx) ([]Node, *ParseError) {
	pos := tokPos(t)
	if ctx.kind == ctxElement && (ctx.name == "script" || ctx.name == "style") {
		if t.Value == "" {
			return nil, nil
		}
		return []Node{&Text{Value: t.Value, Raw: true, Pos: pos}}, nil
	}
	lx := newRawLexer(t.Value, pos, p.file)
	nested, err := newParser(lx, p.file)
	if err != nil {
		return nil, toPE(err)
	}
	nested.raw = true
	nodes, perr := nested.parseChildren(openCtx{kind: ctxRoot, pos: pos})
	if perr != nil {
		return nil, perr
	}
	return demoteRawMarkerLayout(nodes), nil
}

// demoteRawMarkerLayout clears the Raw flag on the whitespace-only Text nodes at
// the two ENDS of a parsed {#raw} span, so the enclosing body's ordinary
// whitespace policy applies to them.
//
// parseRaw flattens the span into the enclosing element/block's child list, so
// once it returns, nothing downstream can still tell "the edge of the raw span"
// from "inside it". The edges are the only bytes in the span that belong to the
// {#raw}/{/raw} MARKERS rather than to the captured content: writing the markers
// on their own lines is authoring layout, and the newline plus indentation it
// produces is not something an author is asking to preserve. Kept flagged raw,
// it survives as a real text vnode and pushes the single-root bodies ({#for},
// component root, component skeleton root) past their arity gate.
//
// A span whose entire content is whitespace is left alone: there is no content
// for those bytes to be laying out, so {#raw} around them can only be a request
// to keep them verbatim. Nothing here rewrites bytes — a demoted node still
// carries its exact authored text, it just stops claiming to be raw.
func demoteRawMarkerLayout(nodes []Node) []Node {
	if !rawSpanHasContent(nodes) {
		return nodes
	}
	demote := func(n Node) {
		if t, ok := n.(*Text); ok && t.Raw && strings.TrimSpace(t.Value) == "" {
			t.Raw = false
		}
	}
	demote(nodes[0])
	demote(nodes[len(nodes)-1])
	return nodes
}

// rawSpanHasContent reports whether a parsed {#raw} span holds anything beyond
// whitespace text — any structural node, or any text with a non-space byte.
func rawSpanHasContent(nodes []Node) bool {
	for _, n := range nodes {
		t, ok := n.(*Text)
		if !ok {
			return true
		}
		if strings.TrimSpace(t.Value) != "" {
			return true
		}
	}
	return false
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
// (<Children>, <Slot>, <Slot name="x">, or <Snippet>) starting at the
// current TokTagOpen.
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

	// Composition markers are reserved capitalized tags matched before component
	// resolution. Lowercase spellings remain positioned steering errors (D134).
	// Paired capitalized forms carry ordinary template children as fallback
	// content (D141); self-closing forms have no fallback.
	//
	// None of that applies inside {#raw}: the block exists so a template can show
	// markup, so every tag there — <slot>, <Children/>, <Portal>, <Card/> — is a
	// literal element built at the bottom of this function.
	var slotName string
	var slotArgs []Attr
	var snippetFits string
	var snippetParams []string
	if !p.raw {
		if name == "children" {
			return nil, errAt(p.file, pos, "the default marker is spelled <Children/> since v1.64 (D134)")
		}
		if name == "slot" {
			for _, a := range attrs {
				if attrNameOf(a) == "name" {
					return nil, errAt(p.file, pos, `named slots are spelled <Slot name="…"/> since v1.64 (D134)`)
				}
			}
			return nil, errAt(p.file, pos, "bare <slot> is not a marker — use <Children/> for call-site content or <Slot/> for the router outlet (D134)")
		}
		if name == "portal" {
			return nil, errAt(p.file, pos, "the portal marker is spelled <Portal>…</Portal> (D134/D144)")
		}
		if name == "snippet" {
			for _, a := range attrs {
				at, bare := a.(*StaticAttr)
				if attrNameOf(a) == "fits" || (bare && at.Valueless) {
					return nil, errAt(p.file, pos, `the snippet marker is spelled <Snippet ...>`)
				}
			}
		}
		if name == "Snippet" {
			var markerErr *ParseError
			snippetFits, snippetParams, markerErr = snippetMarkerAttrs(attrs, p.file)
			if markerErr != nil {
				return nil, markerErr
			}
			if selfClose {
				return nil, errAt(p.file, pos, "<Snippet/> is paired-only — a snippet needs a body to render")
			}
		}
		if name == "Portal" {
			if perr := portalMarkerAttrs(attrs, pos, p.file); perr != nil {
				return nil, perr
			}
			if selfClose {
				return nil, errAt(p.file, pos, "<Portal/> is paired-only — a portal carries the children it teleports: write <Portal>…</Portal>")
			}
		}
		if name == "Children" || name == "Slot" {
			if name == "Children" {
				var markerErr *ParseError
				slotArgs, markerErr = childrenMarkerAttrs(attrs, p.file)
				if markerErr != nil {
					return nil, markerErr
				}
			} else {
				var markerErr *ParseError
				slotName, slotArgs, markerErr = slotMarkerFromAttrs(attrs, pos, p.file)
				if markerErr != nil {
					return nil, markerErr
				}
			}
		}
		// Every capitalized tag that is not an exact marker name resolves as a
		// component, so its text has to be a legal JS expression before codegen
		// emits it verbatim (D167). The marker branches above have already run,
		// so only component names reach here.
		if isCapitalized(name) && !isCompositionMarker(name) {
			if nameErr := checkComponentName(name, pos, p.file); nameErr != nil {
				return nil, nameErr
			}
		}
	}

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

	if !p.raw {
		if name == "Children" {
			return &Slot{Args: slotArgs, Children: children, Pos: pos}, nil
		}
		if name == "Slot" {
			return &Slot{Name: slotName, Args: slotArgs, Children: children, Pos: pos}, nil
		}
		if name == "Snippet" {
			return &Snippet{Fits: snippetFits, Params: snippetParams, Body: children, Pos: pos}, nil
		}
		if name == "Portal" {
			return &Portal{Children: children, Pos: pos}, nil
		}
		if isCapitalized(name) {
			return &Component{Name: name, Props: attrs, Children: children, Pos: pos}, nil
		}
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
			// D150: EVERY attribute captured inside {#raw} is an authored literal,
			// not just the @-prefixed ones. `ref`, `island`, `key`, and `flip` are
			// framework directives in a live template and plain sample markup here,
			// so the flag has to cover them too — otherwise raw documentation of a
			// ref fails the build (refs.go) and a raw `island` freezes a subtree.
			// The namespace reservation is Puzzle grammar as well, so a pasted
			// `inkscape:label` in sample markup is literal rather than an error.
			literalName := t.Raw
			npos := tokPos(t)
			if !literalName {
				if e := checkAttrNamespace(name, npos, p.file); e != nil {
					return nil, false, e
				}
			}
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
				if strings.HasPrefix(name, "@") && !literalName {
					return nil, false, errAt(p.file, npos, "event handler %s requires an ={ ... } expression", name)
				}
				attrs = append(attrs, &StaticAttr{Name: name, Value: "", Valueless: true, LiteralName: literalName, Pos: npos})
			}
		case TokEOF:
			return nil, false, errAt(p.file, tokPos(t), "unexpected end of input inside tag")
		default:
			return nil, false, errAt(p.file, tokPos(t), "unexpected token %s in tag", t.Type)
		}
	}
}

// checkAttrNamespace rejects a reserved `prefix:name` attribute (D147 reserves the
// directive-namespace space the grammar deliberately never opened). Event attrs own
// the colon for their modifier channel (`@click:prevent`), so they are exempt and
// validated by parseEventModifiers instead.
//
// Callers run this at the attribute NAME, before branching on `=`, because the two
// forms must agree: validating inside buildAttr — which only runs once a value
// follows — let the VALUELESS spelling `<input bind:value>` through as an ordinary
// boolean attribute, so the one syntax the reservation exists to reject compiled
// silently to `{ 'bind:value': true }`.
func checkAttrNamespace(name string, npos Position, file string) *ParseError {
	if strings.HasPrefix(name, "@") {
		return nil
	}
	i := strings.IndexByte(name, ':')
	if i < 0 {
		return nil
	}
	switch name[:i] {
	case "xml", "xlink", "xmlns":
		return nil
	}
	// Two very different authors land here, so the steer is chosen from the name.
	// Someone typing `bind:value`/`value:bind`/`v-model:` arrived from another
	// framework and needs to know binding is automatic; someone with `inkscape:label`
	// pasted an SVG export and needs the file-asset escape. One generic message
	// misdirects whichever one it is not written for.
	prefix, local := name[:i], name[i+1:]
	if isDirectiveWord(prefix) || isDirectiveWord(local) {
		return errAt(file, npos,
			"attribute namespace %q is reserved — two-way binding needs no prefix. Write `value={ expr }` (or `checked={ expr }`) on a plain <input>/<textarea>/<select> and the compiler synthesizes the write-back; see template SPEC §6",
			prefix+":")
	}
	return errAt(file, npos,
		"attribute namespace %q is reserved — only xml:, xlink:, and xmlns: are allowed. SVG exported from an editor (inkscape:, sodipodi:, serif:) needs those attributes stripped, or load the file as an asset with {#svg}",
		prefix+":")
}

// isDirectiveWord reports whether a `prefix:name` half looks like another
// framework's two-way-binding directive, in which case the reservation error
// should teach Puzzle's keyword-free form rather than the SVG escape.
func isDirectiveWord(s string) bool {
	switch strings.ToLower(s) {
	case "bind", "model", "v-model", "vmodel", "sync", "value", "checked":
		return true
	}
	return false
}

// buildAttr classifies an attribute given its name and value token.
func buildAttr(name string, npos Position, v Token, file string) (Attr, *ParseError) {
	vpos := tokPos(v)
	if v.Raw {
		// Inside {#raw} the value bytes are literal AND so is the name (D150) — see
		// parseAttrs. Every raw-body value token carries Raw, so this one branch
		// covers the quoted, bare, and brace-delimited spellings alike.
		return &StaticAttr{Name: name, Value: v.Value, LiteralName: true, Pos: npos}, nil
	}
	// Template comments (D70) are not template structure — an unquoted
	// attr={##…} / attr={#comment…} would otherwise be treated as a JS expression.
	if v.Type == TokAttrBrace && isTemplateCommentInner(v.Value) {
		return nil, errAt(file, vpos, "template comments are not allowed in attribute values")
	}
	if v.Type == TokAttrBrace && isTemplateRawInner(v.Value) {
		return nil, errAt(file, vpos, "{#raw} blocks are not allowed in attribute values")
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

// eventGenericMods are the modifiers valid on any event. `outside` (v1.52, D86)
// is event-generic by design: the runtime's containment gate is event-agnostic
// (@pointerdown:outside, @focusin:outside), so restricting it would only grow
// the compile-error matrix with no corresponding failure mode.
var eventGenericMods = map[string]bool{
	"prevent": true,
	"stop":    true,
	"once":    true,
	"outside": true,
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
	case *Snippet:
		return t.Pos
	case *Portal:
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
	if perr := loopBindingIdentError(counter, pos, file); perr != nil {
		return nil, perr
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
	if perr := loopBindingIdentError(item, pos, file); perr != nil {
		return nil, perr
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

// Compiler-emitted runtime imports cannot be shadowed by a binding introduced
// in generated render code.
func loopBindingIdentError(name string, pos Position, file string) *ParseError {
	return generatedBindingIdentError(name, pos, file, "loop variable")
}

func snippetParamIdentError(name string, pos Position, file string) *ParseError {
	return generatedBindingIdentError(name, pos, file, "snippet parameter")
}

func generatedBindingIdentError(name string, pos Position, file, kind string) *ParseError {
	if name == "ViewNode" || name == "SLOT_TAG" || name == "SNIPPET_TAG" || name == "PORTAL_TAG" || strings.HasPrefix(name, "__") {
		return errAt(file, pos, "%s %q uses a reserved name (identifiers starting with %q and the names %q, %q, %q and %q are reserved by the compiler)", kind, name, "__", "ViewNode", "SLOT_TAG", "SNIPPET_TAG", "PORTAL_TAG")
	}
	if jsident.IsReservedBindingIdentifier(name) {
		return errAt(file, pos, "%s %q is not a legal binding identifier in strict-mode JavaScript", kind, name)
	}
	return nil
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

// isCompositionMarker reports whether name is one of the reserved capitalized
// composition markers (D134/D141/D144/D166). Markers are exact-match: a dotted
// name is never a marker, which is why checkComponentName rejects a marker root
// rather than routing it here.
func isCompositionMarker(name string) bool {
	switch name {
	case "Children", "Slot", "Snippet", "Portal":
		return true
	}
	return false
}

// checkComponentName validates a capitalized tag as a component name (D167).
// The grammar is Ident('.'Ident)* with each segment [A-Za-z_][A-Za-z0-9_]* — a
// plain component (<Card>) or a family member (<Frame.Wrapper>). The lexer's
// tag-name scanner accepts '-', ':', and '.' so lowercase custom elements and
// namespaced SVG tags keep working, which used to let a capitalized <Frame-x>
// or <Frame.> through to codegen, where the tag text is emitted verbatim as a
// JS expression and produced syntactically broken output instead of an error.
func checkComponentName(name string, pos Position, file string) *ParseError {
	segments := strings.Split(name, ".")
	if len(segments) > 1 && isCompositionMarker(segments[0]) {
		return errAt(file, pos,
			"<%s> is not a component — %s is a reserved composition marker and cannot be a component family root (D134/D167)",
			name, segments[0])
	}
	for _, seg := range segments {
		if seg == "" {
			return errAt(file, pos,
				"component tag <%s> has an empty name segment — a component name is an identifier or a dotted family member like <Frame.Wrapper> (D167)",
				name)
		}
		if !isIdentSegment(seg) {
			return errAt(file, pos,
				"component tag <%s> is not a valid component name — %q is not an identifier. A capitalized tag names a component (<Frame>) or a family member (<Frame.Wrapper>); lowercase the tag for a custom element (D167)",
				name, seg)
		}
	}
	return nil
}

// isIdentSegment reports whether seg is a bare JS identifier by shape:
// [A-Za-z_][A-Za-z0-9_]*. Deliberately ASCII-only and '$'-free — a component
// name is also a filename in the family convention.
func isIdentSegment(seg string) bool {
	for i := 0; i < len(seg); i++ {
		c := seg[i]
		switch {
		case c == '_':
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		case c >= '0' && c <= '9':
			if i == 0 {
				return false
			}
		default:
			return false
		}
	}
	return len(seg) > 0
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
