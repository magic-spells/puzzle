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

	// ContainsRaw is set only on the synthetic template/skeleton root when its
	// source contained at least one D150 {#raw} block. The block body expands
	// into ordinary Text/Element nodes, so this preserves the exact source fact
	// needed by the build-wide usage scan.
	ContainsRaw bool

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

// Slot is a composition render target (D141). <Children> and bare <Slot> have
// an empty Name and substitute the default bucket; <Slot name="x"> carries a
// static, non-empty Name. Paired forms carry ordinary template Children that
// render as fallback content when the bucket is unfilled. Self-closing and
// empty paired forms have no fallback.
type Slot struct {
	Name     string
	Args     []Attr
	Children []Node
	Pos      Position
}

// Snippet is caller-provided parameterized composition content (D166). Fits
// routes it to a named marker (empty means the default <Children> marker),
// Params are the bare attribute declarations in source order, and Body is
// compiled into a fresh vnode-producing function at the call site.
type Snippet struct {
	Fits   string
	Params []string
	Body   []Node
	Pos    Position
}

// Portal is a <Portal>…</Portal> teleport marker (D144). It takes no
// attributes and is paired-only; Children is the subtree the runtime mounts
// into the framework-created portal outlet instead of at this position.
type Portal struct {
	Children []Node
	Pos      Position
}

// Text is literal text between tags/directives. Brace escapes (\{ \}) are
// already resolved to literal braces. Raw marks bytes captured from a D150
// {#raw} body; codegen must preserve those bytes instead of applying the normal
// template whitespace policy.
type Text struct {
	Value string
	Raw   bool
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
func (*Snippet) isNode()       {}
func (*Portal) isNode()        {}
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
// bare form and `”` for the explicit one, and the island directive (D44)
// accepts only the bare form. Valueless is the ONE way to ask "was this attr
// written without an =value?" — do not infer it from Value == "".
type StaticAttr struct {
	Name      string
	Value     string
	Valueless bool
	// LiteralName marks an attribute captured from authored literal markup:
	// inside {#raw} or on an inlined {#svg} asset root. It suppresses every
	// directive reading of the name: `ref` is not wired to this.refs, `island`
	// does not mark a frozen subtree, `key` does not suppress a synthetic {#for}
	// key, and an @-prefixed name gets the runtime-private vnode-key escape so
	// the DOM attribute is written as authored instead of binding a listener.
	LiteralName bool
	Pos         Position
}

// DynamicAttr is `name={ expr }` — a single unquoted brace expression. Binding
// classification and the property-vs-attribute distinction are downstream
// compiler/runtime concerns.
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
