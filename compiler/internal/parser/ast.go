package parser

// ast.go defines the template AST produced by the parser (constellation/doc/DOC-COMPILER-DESIGN.md
// §c). Every node carries the Position of its opening token for error reporting
// and downstream codegen (Step 2). The tree is what the compiler consumes; there
// is no intermediate string form.

// Node is any template tree node.
type Node interface{ isNode() }

// Element is an HTML element, including the <puzzle-view> root. Its attributes
// are preserved (they become the root ViewNode's attributes, not a hardcoded
// div).
type Element struct {
	Tag      string
	Attrs    []Attr
	Children []Node
	Pos      Position

	// RawInner, when non-nil, carries a verbatim markup string that codegen
	// emits as the ViewNode's string children (island seed, D44) instead of
	// reconciled child vnodes — set only by codegen's {#svg} resolve pass
	// (v1.14, D46), which replaces an InlineSVG node with an <svg> Element whose
	// RawInner holds the inlined file's inner markup. nil for every parsed
	// element, so island-/svg-free templates are unaffected.
	RawInner *string

	// RawSrc carries the app/assets-relative source path of a resolved {#svg}
	// (e.g. "icons/heart.svg"), set alongside RawInner by codegen's resolve pass
	// (v1.14, D46). Empty for every parsed element. Codegen uses it in SVG-dedup
	// mode to key the per-asset shared module the use site imports rather than
	// inlining the markup at every site.
	RawSrc string
}

// Component is a capitalized tag referencing an imported component. Props reuse
// the attribute node types; callback props (@name={...}) are EventAttr values
// resolved by codegen (D16).
type Component struct {
	Name     string
	Props    []Attr
	Children []Node
	Pos      Position
}

// Slot is a slot render target. The bare form (<slot/>/<Slot/>, D16) has an
// empty Name and no Children: it substitutes the DEFAULT call-site content
// (SPEC §6). A NAMED form (<slot name="x">…fallback…</slot>, v1.21 D53) carries
// a static, non-empty Name and optional fallback Children (full template
// grammar) rendered when the call site fills nothing for that name (SPEC §24).
type Slot struct {
	Name     string
	Children []Node
	Pos      Position
}

// Text is literal text between tags/directives. Brace escapes (\{ \}) are
// already resolved to literal braces.
type Text struct {
	Value string
	Pos   Position
}

// Interpolation is `{ expr | fmt(args) | ... }`: a base expression plus an
// optional formatter chain.
type Interpolation struct {
	Expr       string
	Formatters []FormatterCall
	Pos        Position
}

// If is `{#if cond} Then {:else} Else {/if}`. Else is nil when absent. v1 has
// no {:elsif}.
type If struct {
	Cond string
	Then []Node
	Else []Node
	Pos  Position
}

// For is `{#for item in collection}` or the range form `{#for from...to}`
// (IsRange). For the range form Item is empty and codegen uses the index. An
// optional trailing `, name` binds a loop counter (Counter, empty when absent):
// the 0-based index for the item form, the current number for the range form.
type For struct {
	Item       string
	Collection string
	IsRange    bool
	RangeFrom  string
	RangeTo    string
	Counter    string
	Body       []Node
	Pos        Position
}

// Case is `{#case expr} {:when v1, v2} … {:when v3} … {:else} … {/case}`
// (Liquid-style multi-branch). Clauses are matched in declaration order with
// strict `===` against Expr; the first matching clause wins with NO fallthrough.
// Each WhenClause carries one or more OR-matched Values. Else is the optional
// trailing default branch (nil when absent). Unlike {#unless}, this does NOT
// desugar to If: codegen emits an IIFE that binds Expr to a temp ONCE, so a
// getter-backed data value is evaluated a single time.
type Case struct {
	Expr    string
	Clauses []WhenClause
	Else    []Node
	Pos     Position
}

// WhenClause is one `{:when v1, v2, …}` arm of a Case: its comma-separated
// top-level Values (OR-matched) and the Body rendered on a match.
type WhenClause struct {
	Values []string
	Body   []Node
	Pos    Position
}

// InlineSVG is `{#svg 'icons/heart.svg'}` (v1.14, D46): the framework's first
// void block tag — self-contained, with no `{/svg}` closer. The referenced file
// is inlined at compile time by codegen, which reads it and splices an <svg>
// element carrying the file's root attrs and its inner markup as a raw seed
// string (island semantics, D44). The parser only records the request. Src is
// the quoted static path with its quotes stripped; SrcPos points at the path
// literal in the header (so codegen's missing-file error lands there); Pos is
// the `{#svg}` opener.
type InlineSVG struct {
	Src    string
	SrcPos Position
	Pos    Position
}

func (*Element) isNode()       {}
func (*Component) isNode()     {}
func (*Slot) isNode()          {}
func (*Text) isNode()          {}
func (*Interpolation) isNode() {}
func (*If) isNode()            {}
func (*For) isNode()           {}
func (*Case) isNode()          {}
func (*InlineSVG) isNode()     {}

// FormatterCall is one link in an interpolation's formatter chain. Args are raw
// JS expression strings (e.g. "'short'", "', '") emitted as-is by codegen; they
// participate in scope resolution like any other expression.
type FormatterCall struct {
	Name string
	Args []string
}

// Attr is an element attribute or component prop.
type Attr interface{ isAttr() }

// StaticAttr is a plain string attribute (class="btn") or a valueless boolean
// attribute (autofocus → Value "", Valueless true). Valueless is what
// distinguishes the bare form from an EXPLICIT empty value (value="" → Value "",
// Valueless false): both leave Value empty, but codegen emits `true` for the
// bare form and `''` for the explicit one, and the island directive (D44)
// accepts only the bare form. Valueless is the ONE way to ask "was this attr
// written without an =value?" — do not infer it from Value == "".
type StaticAttr struct {
	Name      string
	Value     string
	Valueless bool
	Pos       Position
}

// DynamicAttr is `name={ expr }` — a single unquoted brace expression. This
// covers dynamic attributes and two-way bindings alike (value={var}); the
// property-vs-attribute distinction is a runtime concern.
type DynamicAttr struct {
	Name string
	Expr string
	Pos  Position
}

// EventAttr is `@name={ expr }` with optional `:modifier` suffixes
// (`@keydown:enter:prevent={ … }`). On a DOM element it is a listener; on a
// component tag codegen turns it into a callback prop (D16) and rejects any
// modifiers. Name is the bare event (excludes '@' and modifiers); Modifiers
// holds the validated modifier list in written order (empty when none).
type EventAttr struct {
	Name      string
	Modifiers []string
	Expr      string
	Pos       Position
}

// MixedAttr is a quoted attribute value that interleaves static text,
// interpolations, and inline {#if} blocks (constellation/doc/DOC-COMPILER-DESIGN.md §c
// attribute-value mini-grammar). Codegen concatenates the parts.
type MixedAttr struct {
	Name  string
	Parts []Part
	Pos   Position
}

func (*StaticAttr) isAttr()  {}
func (*DynamicAttr) isAttr() {}
func (*EventAttr) isAttr()   {}
func (*MixedAttr) isAttr()   {}

// Part is one segment of a MixedAttr value.
type Part interface{ isPart() }

// StaticPart is literal text inside an attribute value.
type StaticPart struct {
	Text string
}

// InterpPart is an interpolation inside an attribute value.
type InterpPart struct {
	Interp *Interpolation
}

// InlineIfPart is `{#if cond} Then {:else} Else {/if}` inside an attribute
// value. Then/Else may contain only static text and interpolations — no
// elements and no {#for} (parse error otherwise).
type InlineIfPart struct {
	Cond string
	Then []Part
	Else []Part
	Pos  Position
}

func (*StaticPart) isPart()   {}
func (*InterpPart) isPart()   {}
func (*InlineIfPart) isPart() {}
