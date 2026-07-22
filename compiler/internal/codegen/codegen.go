// Package codegen turns a parsed .pzl template (constellation/doc/DOC-COMPILER-DESIGN.md §c) into
// the generated JS module — the user's <scripts> emitted VERBATIM plus an
// injected runtime import and an appended `Name.prototype.render = function
// () {…}` (constellation/doc/DOC-COMPILER-DESIGN.md §d, constellation/doc/DOC-APP-ANATOMY.md §1). The correctness
// anchor is the Phase 1 hand-written fixture
// tests/fixtures/todos/Home.compiled.js (D14): this codegen reproduces its
// render function mechanically.
//
// Formatting is byte-exact against the fixture; the golden-file harness
// (golden_test.go) is a byte-compare. The idioms are documented inline where
// they are emitted.
//
// # Whitespace / text policy (derived from Home.pzl vs Home.compiled.js)
//
// Applied to template Text nodes only (never to attribute values, which keep
// their bytes). For each Text node:
//   - collapse every run of ASCII whitespace to a single space;
//   - strip the leading space if the original leading whitespace run contained
//     a newline (i.e. it was source indentation); strip the trailing space
//     likewise;
//   - if the result is empty, drop the node.
//
// So "\n        Made with " → "Made with " (indentation gone, the space before
// the next inline element kept) and pure inter-element indentation
// ("</h2>\n      <form>") drops entirely. Consecutive Text/Interpolation
// siblings coalesce into ONE text vnode whose value is the `+`-concatenation of
// quoted literals and `String(expr)` parts.
package codegen

import (
	"fmt"
	"hash/fnv"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// ScopeID derives the stable per-file scope id for <styles scoped> (v1.27, D59):
// `pzl-` + 8 lowercase hex chars of FNV-1a-32 over the compiler-relative,
// forward-slash-normalized source path. It is the SINGLE source of the id — both
// the codegen root stamp (data-<id>) and the esbuild plugin's @scope CSS wrapper
// call this so the attribute and the rule always agree. Path-derived, so it is
// byte-stable across machines (golden reproducibility) and only changes when the
// .pzl is renamed (the stamp and CSS move together in the same build, D59).
func ScopeID(filename string) string {
	// Normalize separators explicitly (not just filepath.ToSlash, which is a
	// no-op off Windows) so a path is hashed identically regardless of the build
	// OS — the id must be byte-stable across machines.
	norm := strings.ReplaceAll(filepath.ToSlash(filename), "\\", "/")
	h := fnv.New32a()
	h.Write([]byte(norm))
	return fmt.Sprintf("pzl-%08x", h.Sum32())
}

// EmissionMode selects the render root shape (constellation/doc/DOC-DECISIONS.md D20).
type EmissionMode int

const (
	// ModeView emits a real <puzzle-view> root element carrying the template's
	// attributes — for files under app/views/** and app/layouts/**.
	ModeView EmissionMode = iota
	// ModeComponent renders inline: the render() returns the template's single
	// root element with no wrapper, and attributes on <puzzle-view> are an error.
	ModeComponent
)

// Options configure a compile.
type Options struct {
	Filename string
	Mode     EmissionMode
	// AssetsDir is the absolute (or test-relative) path of the app's assets dir
	// ({#svg} paths resolve from here, v1.14 D46). Empty means "not configured":
	// any {#svg} then fails with a "this project has no app/assets/ directory"
	// error.
	AssetsDir string

	// SVGDedup selects the dedup emission for {#svg} (v1.14 D46 amendment): each
	// use site becomes a call to a per-asset shared factory imported from a
	// virtual module (`@magic-spells/puzzle/svg-asset/<src>`) that the esbuild
	// plugin resolves + serves, so esbuild stores each unique icon ONCE across the
	// bundle. The plugin sets this true. Left false (pzlc standalone, no bundler),
	// codegen inlines the markup at every use site as before — a self-contained
	// module with no unresolved virtual imports.
	SVGDedup bool
}

// Result is the output of Compile: the generated module JS and the absolute (or
// as-joined) paths of every file inlined via {#svg} (deduped + sorted, v1.14
// D46). InlinedFiles is populated even when Compile returns an error — a missing
// svg's attempted path is recorded so the plugin can hand it to esbuild as a
// WatchFile, invalidating the cached failure once the file appears.
type Result struct {
	JS           string
	InlinedFiles []string
	// Warnings are non-fatal codegen diagnostics (v0.1 hardening): a template
	// expression that references a <scripts> import, which resolveExpr rewrites to
	// __d.<name> → undefined at render (SPEC §6). Out-of-band — the generated JS is
	// unaffected, so goldens never move. The plugin/pzlc print them to stderr.
	Warnings []Warning
}

// Warning is a positioned, non-fatal codegen diagnostic. See Result.Warnings.
type Warning struct {
	File    string
	Line    int
	Col     int
	Message string
}

// ModeForPath applies the D20 directory convention: app/views/** and
// app/layouts/** compile as views; everything else is a reusable component.
func ModeForPath(path string) EmissionMode {
	p := strings.ReplaceAll(path, "\\", "/")
	if strings.Contains(p, "app/views/") || strings.Contains(p, "app/layouts/") {
		return ModeView
	}
	return ModeComponent
}

// Compile splits are already done by the caller: it takes the Sections
// (scripts + template attrs) and produces the full generated module string plus
// the list of {#svg}-inlined files (Result). The template is parsed here so
// parse and codegen share one entry point. The returned *Result is always
// non-nil — even on error, so InlinedFiles (the {#svg} paths seen so far) is
// available to the caller for esbuild WatchFiles.
func Compile(sec *parser.Sections, opts Options) (*Result, error) {
	var inlined []string
	var warnings []Warning
	js, err := compile(sec, opts, &inlined, &warnings)
	return &Result{JS: js, InlinedFiles: uniqueSorted(inlined), Warnings: warnings}, err
}

// compile is Compile's body; it appends every {#svg} file path to *inlined (even
// on failure), collects out-of-band diagnostics into *warnings, and returns the
// generated JS (empty on error).
func compile(sec *parser.Sections, opts Options, inlined *[]string, warnings *[]Warning) (string, error) {
	root, err := parser.ParseTemplate(sec, opts.Filename)
	if err != nil {
		return "", err
	}
	// <scripts> is optional (DOC-SPEC.md §4). With no user class to bind the
	// render tail to, synthesize a minimal module — the runtime import plus an
	// empty PuzzleView subclass named from the filename — and drive the rest of
	// codegen from it exactly as if the user had written it.
	scripts := sec.Scripts
	var className string
	if strings.TrimSpace(scripts) == "" {
		className = classNameFromFilename(opts.Filename)
		scripts = "import { PuzzleView } from '@magic-spells/puzzle';\n" +
			"export default class " + className + " extends PuzzleView {}\n"
	} else {
		className, err = extractClassName(scripts, opts.Filename, sec.ScriptsPos)
		if err != nil {
			return "", err
		}
	}

	c := &compiler{file: opts.Filename, svgDedup: opts.SVGDedup}
	scope := map[string]bool{}

	// Resolve {#svg} nodes (v1.14, D46): read each referenced file and splice an
	// <svg> element carrying its attrs + raw inner markup, BEFORE emit. Run on the
	// template AST here and on the skeleton AST below.
	if err := c.resolveInlineSVG(root.Children, opts.AssetsDir, inlined); err != nil {
		return "", err
	}

	// Scoped styles (v1.27, D59): a bare `scoped` on <styles> stamps ONE static
	// data-<scopeId> attribute on the template ROOT vnode so the plugin's
	// @scope ([data-<scopeId>]) { … } CSS matches this component's subtree only.
	// Root-only — @scope's cascade covers descendants (no Vue-style per-node
	// stamping). Absent → nil, and every render below emits byte-identically to
	// pre-v1.27. View-mode skeletons reuse the stamped root attrs for free (D39).
	var scopeStamp *parser.StaticAttr
	if sec.StylesScoped {
		scopeStamp = &parser.StaticAttr{Name: "data-" + ScopeID(opts.Filename), Value: "", Valueless: true}
	}
	// View/layout root attrs are the <puzzle-view> attrs plus the stamp (copied so
	// the source AST is untouched); the skeleton's view branch reuses this same
	// slice, so a scoped view's skeleton is covered without extra work.
	viewAttrs := root.Attrs
	if scopeStamp != nil && opts.Mode == ModeView {
		viewAttrs = append(append([]parser.Attr{}, root.Attrs...), scopeStamp)
	}

	// The render root is written after "  return " (2 indent + 7), so its first
	// line starts at column 9 for the print-width test.
	const rootStartCol = 2 + len("return ")
	var rootExpr string
	switch opts.Mode {
	case ModeView:
		rootExpr, err = c.emitElement("'puzzle-view'", viewAttrs, root.Children, 2, rootStartCol, false, scope)
	case ModeComponent:
		rootExpr, err = c.emitComponentRoot(root, rootStartCol, scope, scopeStamp)
	}
	if err != nil {
		return "", err
	}

	// Optional <puzzle-skeleton> (v1.8, D39): compiled with the same emitter to
	// a second prototype method, renderSkeleton, that the runtime renders while
	// the first data() is pending. Only created()-seeded state exists then.
	skel, err := parser.ParseSkeleton(sec, opts.Filename)
	if err != nil {
		return "", err
	}
	if skel != nil {
		if err := c.resolveInlineSVG(skel.Children, opts.AssetsDir, inlined); err != nil {
			return "", err
		}
	}
	var skelExpr string
	if skel != nil {
		skelExpr, err = c.emitSkeletonRoot(skel, viewAttrs, opts.Mode, rootStartCol, scopeStamp)
		if err != nil {
			return "", err
		}
	}

	// <scripts>-import collision warnings (out-of-band; goldens unaffected). Scan
	// the emitted render expressions for `__d.<name>` reads whose <name> is an
	// import binding in <scripts> — those resolve to undefined at render (SPEC §6).
	if imports := scriptImportBindings(sec.Scripts); len(imports) > 0 {
		seen := map[string]bool{}
		var hit []string
		collectDataCollisions(rootExpr, imports, seen, &hit)
		if skel != nil {
			collectDataCollisions(skelExpr, imports, seen, &hit)
		}
		for _, name := range hit {
			*warnings = append(*warnings, Warning{
				File: opts.Filename, Line: root.Pos.Line, Col: root.Pos.Col,
				Message: fmt.Sprintf(
					"template expression references %q, which is imported in <scripts> — template expressions can only read data() fields; %q will be undefined",
					name, name),
			})
		}
	}

	importLine := "import { ViewNode } from '@magic-spells/puzzle';"
	if hasSlot(root.Children) || (skel != nil && hasSlot(skel.Children)) {
		importLine = "import { ViewNode, SLOT_TAG } from '@magic-spells/puzzle';"
	}

	var b strings.Builder
	// 1. user's <scripts>, byte-for-byte verbatim (or the synthesized module for
	//    a scriptless .pzl).
	b.WriteString(scripts)
	// 2. injected runtime import (after the scripts, before the render tail —
	//    exactly where the fixture places it, constellation/doc/DOC-APP-ANATOMY.md §1).
	b.WriteString("\n")
	b.WriteString(importLine)
	b.WriteString("\n")
	// 2b. per-asset {#svg} shared-module imports (dedup mode only, D46). Emitted
	//     after the ViewNode import, in first-seen order; empty in inline mode.
	b.WriteString(c.emitSVGImports())
	b.WriteString("\n")
	// 3. render tail, attached by prototype assignment (D10).
	b.WriteString(className)
	b.WriteString(".prototype.render = function () {\n")
	b.WriteString("  const __d = this.getData();\n")
	b.WriteString("  const __f = this.ctx.formatters.getAll();\n\n")
	b.WriteString("  return ")
	b.WriteString(rootExpr)
	b.WriteString(";\n};\n")
	// 4. skeleton tail (v1.8, D39), same prototype-assignment idiom as render().
	if skel != nil {
		b.WriteString("\n")
		b.WriteString(className)
		b.WriteString(".prototype.renderSkeleton = function () {\n")
		b.WriteString("  const __d = this.getData();\n")
		b.WriteString("  const __f = this.ctx.formatters.getAll();\n\n")
		b.WriteString("  return ")
		b.WriteString(skelExpr)
		b.WriteString(";\n};\n")
		// 5. anti-flash hold knob (v1.20, D52): one extra prototype assignment
		//    beside renderSkeleton, emitted ONLY when min-duration was given and
		//    non-zero. Absent/0 → no emission, so v1.8 skeletons stay byte-identical.
		//    The runtime reads this.skeletonMinDuration ?? 0.
		if sec.SkeletonMinDuration > 0 {
			b.WriteString("\n")
			b.WriteString(className)
			b.WriteString(".prototype.skeletonMinDuration = ")
			b.WriteString(strconv.Itoa(sec.SkeletonMinDuration))
			b.WriteString(";\n")
		}
	}
	return b.String(), nil
}

type compiler struct {
	file string

	// Per-file @event handler-cache site counter (v1.29, D62 / SPEC §31). Each
	// CACHEABLE (data-independent) @event value is emitted as
	// `((this.__h ??= {})[N] ??= <arrow>)`, where N is this counter, advanced once
	// per wrapped site. render() and renderSkeleton() are emitted by the SAME
	// compiler instance (see compile()), so indices are unique across both and the
	// numbering is deterministic — recompiling an unchanged file is byte-stable.
	// Non-cacheable sites consume no index and emit byte-identically to v1.28.
	handlerSites int

	// SVG-dedup emission state (v1.14 D46 amendment). svgDedup selects the
	// import-a-shared-module strategy over inline; svgOrder/svgIdent accumulate the
	// per-module unique asset srcs (first-seen order) → local import identifiers so
	// compile() emits exactly one import per unique asset.
	svgDedup bool
	svgOrder []string
	svgIdent map[string]string
}

// item is a processed child: either a coalesced text run (textOK), a structural
// node kept for indent-aware emission, or a synthetic placeholder (`placeholder`)
// injected by the conditional-arity padding to keep `{#if}`/`{#case}` branches the
// same static length (see padItems / condStaticLen).
type item struct {
	text        string // JS value expression when textOK
	textOK      bool
	node        parser.Node
	placeholder bool // emit a `new ViewNode('#')` arity filler
}

func (c *compiler) cgErr(pos parser.Position, msg string) error {
	return &parser.ParseError{File: c.file, Line: pos.Line, Col: pos.Col, Message: msg}
}

// emitComponentRoot enforces the D20 component-mode rules and emits the single
// inline root element. scopeStamp (v1.27, D59), when non-nil, is appended to that
// root element's attrs so a scoped component's rendered root carries the
// data-<scopeId> attribute the plugin's @scope rule targets.
func (c *compiler) emitComponentRoot(root *parser.Element, startCol int, scope map[string]bool, scopeStamp *parser.StaticAttr) (string, error) {
	if len(root.Attrs) > 0 {
		return "", c.cgErr(root.Pos, "components render inline — put attributes on your root element")
	}
	items, err := c.processChildren(root.Children, scope)
	if err != nil {
		return "", err
	}
	var only parser.Node
	for _, it := range items {
		if it.textOK {
			return "", c.cgErr(root.Pos, "a component template must have a single root element (found stray text)")
		}
		if only != nil {
			return "", c.cgErr(root.Pos, "a component template must have a single root element (found more than one)")
		}
		only = it.node
	}
	if only == nil {
		return "", c.cgErr(root.Pos, "a component template must have a single root element (found none)")
	}
	switch n := only.(type) {
	case *parser.Element:
		if n.RawInner != nil { // resolved {#svg} as the single component root
			return c.emitRawSVG(n, 2, startCol, scope)
		}
		if scopeStamp != nil {
			n.Attrs = append(n.Attrs, scopeStamp)
		}
		return c.emitElement("'"+n.Tag+"'", n.Attrs, n.Children, 2, startCol, false, scope)
	case *parser.Component:
		if scopeStamp != nil {
			n.Props = append(n.Props, scopeStamp)
		}
		return c.emitElement(n.Name, n.Props, n.Children, 2, startCol, true, scope)
	default:
		return "", c.cgErr(root.Pos, "a component template's root must be an element or component")
	}
}

// emitSkeletonRoot emits the skeleton render's root expression (v1.8, D39).
// View mode re-parents the skeleton children under the SAME <puzzle-view> root
// and attributes as the real template, so the loaded swap patches children
// only. Component mode mirrors the D20 single-root rule but requires a PLAIN
// element root — a component root would swap the whole root node instead of
// patching in place; keep the skeleton's root tag equal to the template's for
// the smoothest swap.
func (c *compiler) emitSkeletonRoot(skel *parser.Element, viewAttrs []parser.Attr, mode EmissionMode, startCol int, scopeStamp *parser.StaticAttr) (string, error) {
	scope := map[string]bool{}
	if mode == ModeView {
		// viewAttrs already carries the scoped stamp (D59) — the skeleton's
		// <puzzle-view> root matches the same @scope selector as the loaded render.
		return c.emitElement("'puzzle-view'", viewAttrs, skel.Children, 2, startCol, false, scope)
	}
	items, err := c.processChildren(skel.Children, scope)
	if err != nil {
		return "", err
	}
	var only parser.Node
	for _, it := range items {
		if it.textOK {
			return "", c.cgErr(skel.Pos, "a component skeleton must have a single root element (found stray text)")
		}
		if only != nil {
			return "", c.cgErr(skel.Pos, "a component skeleton must have a single root element (found more than one)")
		}
		only = it.node
	}
	if only == nil {
		return "", c.cgErr(skel.Pos, "a component skeleton must have a single root element (found none)")
	}
	el, ok := only.(*parser.Element)
	if !ok {
		return "", c.cgErr(skel.Pos, "a component skeleton's root must be a plain element, not a component")
	}
	if el.RawInner != nil { // resolved {#svg} as the single skeleton root
		return c.emitRawSVG(el, 2, startCol, scope)
	}
	if scopeStamp != nil {
		el.Attrs = append(el.Attrs, scopeStamp)
	}
	return c.emitElement("'"+el.Tag+"'", el.Attrs, el.Children, 2, startCol, false, scope)
}

// emitElement emits `new ViewNode(<tag>, <attrs>, <children>)`. tagStr is a
// quoted tag for elements or the bare imported identifier for components. ind
// is the layout indent (children align at ind+2, closers at ind); startCol is
// the column the first line actually starts at, used only for the print-width
// decision (the root sits after "return ", so startCol > ind there).
func (c *compiler) emitElement(tagStr string, attrs []parser.Attr, children []parser.Node, ind, startCol int, isComponent bool, scope map[string]bool) (string, error) {
	processed, err := c.processChildren(children, scope)
	if err != nil {
		return "", err
	}
	multiline, err := c.attrsMultiline(attrs, tagStr, startCol, len(processed) == 0, scope, isComponent)
	if err != nil {
		return "", err
	}
	attrsSeg, err := c.emitAttrs(attrs, ind, multiline, scope, isComponent)
	if err != nil {
		return "", err
	}

	// Sole-{#for} child: pass the .map() array directly as the children
	// argument (no [] wrapper), matching the fixture's list <div>.
	if len(processed) == 1 && processed[0].node != nil {
		if f, ok := processed[0].node.(*parser.For); ok {
			mapExpr, err := c.emitFor(f, ind+2, scope)
			if err != nil {
				return "", err
			}
			return "new ViewNode(" + tagStr + ", " + attrsSeg + ",\n" +
				sp(ind+2) + mapExpr + "\n" + sp(ind) + ")", nil
		}
	}

	childrenArr, err := c.emitArray(processed, ind+2, scope)
	if err != nil {
		return "", err
	}
	return "new ViewNode(" + tagStr + ", " + attrsSeg + ", " + childrenArr + ")", nil
}

// emitArray emits a children array `[…]` with each element at elemIndent and
// the closing bracket at elemIndent-2. Empty → "[]".
func (c *compiler) emitArray(items []item, elemIndent int, scope map[string]bool) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	var b strings.Builder
	b.WriteString("[\n")
	for _, it := range items {
		s, err := c.emitItem(it, elemIndent, scope)
		if err != nil {
			return "", err
		}
		b.WriteString(sp(elemIndent))
		b.WriteString(s)
		b.WriteString(",\n")
	}
	b.WriteString(sp(elemIndent - 2))
	b.WriteString("]")
	return b.String(), nil
}

func (c *compiler) emitItem(it item, ind int, scope map[string]bool) (string, error) {
	if it.placeholder {
		// Arity-padding placeholder: an empty comment vnode holding a stable index
		// slot so a conditional's branches stay the same length (see padItems).
		return "new ViewNode('#')", nil
	}
	if it.textOK {
		return "new ViewNode('text', { value: " + it.text + " })", nil
	}
	switch n := it.node.(type) {
	case *parser.Element:
		if n.RawInner != nil { // resolved {#svg} (D46): string children, island seed
			return c.emitRawSVG(n, ind, ind, scope)
		}
		return c.emitElement("'"+n.Tag+"'", n.Attrs, n.Children, ind, ind, false, scope)
	case *parser.Component:
		return c.emitElement(n.Name, n.Props, n.Children, ind, ind, true, scope)
	case *parser.Slot:
		// Bare default marker (<children/>/<Slot/>, D74; formerly bare <slot/>):
		// emitted byte-for-byte as before so name-free templates (golden #1
		// included) are unchanged.
		if n.Name == "" && len(n.Children) == 0 {
			return "new ViewNode(SLOT_TAG)", nil
		}
		// Default marker WITH fallback (<children>…</children>, v1.41/D74): the
		// runtime renders the fallback when the default bucket is empty. Emit
		// `new ViewNode(SLOT_TAG, {}, [fallback])` via the element machinery with
		// an EMPTY attrs list. MUST precede the named branch below — a Name=="" +
		// children slot would otherwise mis-emit as `{ name: "" }`.
		if n.Name == "" {
			return c.emitElement("SLOT_TAG", nil, n.Children, ind, ind, false, scope)
		}
		// Named marker (v1.21, D53): `new ViewNode(SLOT_TAG, { name }, [fallback])`
		// — same emission style as an element, with the name attr and the fallback
		// children the ViewManager renders when the call site fills nothing.
		nameAttr := []parser.Attr{&parser.StaticAttr{Name: "name", Value: n.Name}}
		return c.emitElement("SLOT_TAG", nameAttr, n.Children, ind, ind, false, scope)
	case *parser.If:
		return c.emitIf(n, ind, scope)
	case *parser.Case:
		return c.emitCase(n, ind, scope)
	case *parser.For:
		m, err := c.emitFor(n, ind, scope)
		if err != nil {
			return "", err
		}
		return "..." + m, nil
	case *parser.InlineSVG:
		// Every {#svg} is replaced by resolveInlineSVG before emit; one surviving
		// here is a compiler bug, not a user error.
		return "", c.cgErr(n.Pos, "internal error: unresolved {#svg} reached codegen")
	default:
		return "", c.cgErr(parser.Position{Line: 1, Col: 1}, "unsupported node in template")
	}
}

// emitIf compiles `{#if}/{:else}` spanning siblings to a spread ternary
// `...(cond ? [then] : [else|[]])`. When both branches have provably fixed vnode
// occupancy, the shorter array is padded to the same static count so toggling
// `cond` cannot shift and remount trailing siblings. Item-form loops (nullable
// ViewNode.keyOf rows) and slot markers (0..N expansion) make occupancy unstable;
// an unstable conditional emits both branches unpadded, byte-identically to the
// pre-padding form. Nested conditionals make this decision independently.
func (c *compiler) emitIf(n *parser.If, ind int, scope map[string]bool) (string, error) {
	cond := resolveExpr(n.Cond, scope)
	thenItems, err := c.processChildren(n.Then, scope)
	if err != nil {
		return "", err
	}
	var elseItems []item
	if n.Else != nil {
		elseItems, err = c.processChildren(n.Else, scope)
		if err != nil {
			return "", err
		}
	}
	thenLen, thenStable, err := c.condStaticLen(thenItems, scope)
	if err != nil {
		return "", err
	}
	elseLen, elseStable, err := c.condStaticLen(elseItems, scope)
	if err != nil {
		return "", err
	}
	maxLen := thenLen
	if elseLen > maxLen {
		maxLen = elseLen
	}
	if thenStable && elseStable {
		thenItems = padItems(thenItems, maxLen-thenLen)
		elseItems = padItems(elseItems, maxLen-elseLen)
	}

	thenArr, err := c.emitArray(thenItems, ind+6, scope)
	if err != nil {
		return "", err
	}
	elsePart, err := c.emitArray(elseItems, ind+6, scope)
	if err != nil {
		return "", err
	}
	return "...(" + cond + "\n" +
		sp(ind+2) + "? " + thenArr + "\n" +
		sp(ind+2) + ": " + elsePart + ")", nil
}

// padItems appends n arity-padding placeholder items to items (n<=0 is a no-op,
// returning items unchanged so a balanced branch emits byte-identically).
func padItems(items []item, n int) []item {
	for i := 0; i < n; i++ {
		items = append(items, item{placeholder: true})
	}
	return items
}

// condStaticLen reports both the static vnode count and whether a processed child
// list's runtime occupancy is provably fixed. Text runs, padding placeholders,
// elements, and components each occupy exactly one slot; element/component
// children are deliberately not inspected. Nested conditionals contribute their
// max branch length and are stable only when every branch is stable. Loops
// contribute zero static slots, but are stable only for range form without an
// explicit body-root key: generated range keys never resolve null, while
// item-form ViewNode.keyOf rows and author key expressions can. Slot markers are
// unstable because the runtime expands them to 0..N nodes.
func (c *compiler) condStaticLen(items []item, scope map[string]bool) (int, bool, error) {
	n := 0
	stable := true
	for _, it := range items {
		if it.textOK || it.placeholder {
			n++
			continue
		}
		switch node := it.node.(type) {
		case *parser.For:
			provablyKeyed, err := c.forRowsProvablyKeyed(node, scope)
			if err != nil {
				return 0, false, err
			}
			if !provablyKeyed {
				stable = false
			}
		case *parser.Slot:
			stable = false
		case *parser.If:
			m, childStable, err := c.ifStaticLen(node, scope)
			if err != nil {
				return 0, false, err
			}
			n += m
			if !childStable {
				stable = false
			}
		case *parser.Case:
			m, childStable, err := c.caseStaticLen(node, scope)
			if err != nil {
				return 0, false, err
			}
			n += m
			if !childStable {
				stable = false
			}
		default:
			// Element, component, and resolved {#svg} nodes occupy one slot.
			n++
		}
	}
	return n, stable, nil
}

// ifStaticLen reports a nested `{#if}`'s max branch length and whether every
// branch is stable, matching emitIf's padding gate.
func (c *compiler) ifStaticLen(n *parser.If, scope map[string]bool) (int, bool, error) {
	thenItems, err := c.processChildren(n.Then, scope)
	if err != nil {
		return 0, false, err
	}
	thenLen, thenStable, err := c.condStaticLen(thenItems, scope)
	if err != nil {
		return 0, false, err
	}
	maxLen := thenLen
	stable := thenStable
	if n.Else != nil {
		elseItems, err := c.processChildren(n.Else, scope)
		if err != nil {
			return 0, false, err
		}
		elseLen, elseStable, err := c.condStaticLen(elseItems, scope)
		if err != nil {
			return 0, false, err
		}
		stable = stable && elseStable
		if elseLen > maxLen {
			maxLen = elseLen
		}
	}
	return maxLen, stable, nil
}

// caseStaticLen reports a nested `{#case}`'s max branch length and whether every
// clause plus the optional/implicit else is stable, matching emitCase's gate.
func (c *compiler) caseStaticLen(n *parser.Case, scope map[string]bool) (int, bool, error) {
	maxLen := 0
	stable := true
	for _, cl := range n.Clauses {
		items, err := c.processChildren(cl.Body, scope)
		if err != nil {
			return 0, false, err
		}
		l, branchStable, err := c.condStaticLen(items, scope)
		if err != nil {
			return 0, false, err
		}
		stable = stable && branchStable
		if l > maxLen {
			maxLen = l
		}
	}
	if n.Else != nil {
		items, err := c.processChildren(n.Else, scope)
		if err != nil {
			return 0, false, err
		}
		l, branchStable, err := c.condStaticLen(items, scope)
		if err != nil {
			return 0, false, err
		}
		stable = stable && branchStable
		if l > maxLen {
			maxLen = l
		}
	}
	return maxLen, stable, nil
}

// emitCase compiles a `{#case}/{:when}` block to a spread IIFE that binds the
// case expression to a temp (`__c`) ONCE, then chains strict-`===` ternaries —
// one per clause, its OR-matched values joined with `||` — falling through to
// the optional {:else} array (or `[]`). Binding once (vs. desugaring to nested
// {#if} that would re-emit the expression per clause) keeps evaluation to a
// single read, which matters if the data value is a getter. `__c` shadows
// cleanly in nested cases: user expressions never resolve to it, and each arm
// only ever compares its own `__c`.
func (c *compiler) emitCase(n *parser.Case, ind int, scope map[string]bool) (string, error) {
	caseExpr := resolveExpr(n.Expr, scope)

	// Pre-process every clause body + the else and compute the max static arity.
	// Padding applies only when every branch has provably fixed occupancy; an
	// item-form loop, explicit-key range loop, or slot marker makes the whole case
	// emit unpadded. Nested conditionals still decide their own padding independently.
	clauseItems := make([][]item, len(n.Clauses))
	clauseLens := make([]int, len(n.Clauses))
	maxLen := 0
	stable := true
	for i, cl := range n.Clauses {
		items, err := c.processChildren(cl.Body, scope)
		if err != nil {
			return "", err
		}
		l, branchStable, err := c.condStaticLen(items, scope)
		if err != nil {
			return "", err
		}
		stable = stable && branchStable
		clauseItems[i] = items
		clauseLens[i] = l
		if l > maxLen {
			maxLen = l
		}
	}
	var elseItems []item
	if n.Else != nil {
		items, err := c.processChildren(n.Else, scope)
		if err != nil {
			return "", err
		}
		elseItems = items
	}
	elseLen, elseStable, err := c.condStaticLen(elseItems, scope)
	if err != nil {
		return "", err
	}
	stable = stable && elseStable
	if elseLen > maxLen {
		maxLen = elseLen
	}

	var b strings.Builder
	b.WriteString("...(((__c) =>\n")
	for i, cl := range n.Clauses {
		conds := make([]string, len(cl.Values))
		for k, v := range cl.Values {
			conds[k] = "__c === (" + resolveExpr(v, scope) + ")"
		}
		condStr := strings.Join(conds, " || ")
		items := clauseItems[i]
		if stable {
			items = padItems(items, maxLen-clauseLens[i])
		}
		arr, err := c.emitArray(items, ind+8, scope)
		if err != nil {
			return "", err
		}
		if i == 0 {
			b.WriteString(sp(ind+2) + condStr + "\n")
		} else {
			b.WriteString(sp(ind+4) + ": " + condStr + "\n")
		}
		b.WriteString(sp(ind+4) + "? " + arr + "\n")
	}
	if stable {
		elseItems = padItems(elseItems, maxLen-elseLen)
	}
	elseArr, err := c.emitArray(elseItems, ind+8, scope)
	if err != nil {
		return "", err
	}
	b.WriteString(sp(ind+4) + ": " + elseArr + ")(" + caseExpr + "))")
	return b.String(), nil
}

// emitFor compiles a {#for}. Named form → `<coll>.map((item) => <body>)` with
// `key: ViewNode.keyOf(item)` prepended to the body's root element (pk-aware
// auto-key, D58). Range form → `Array.from(…, (_, __i) => <body>)` keyed by
// index. An explicit `key` attr on the body root suppresses the prepend (forBody).
// An optional trailing counter binds the 0-based index (item form) or the
// current number (range form): the item form adds the second .map parameter; the
// range form maps the generated values (`… (_, __i) => <from> + __i).map((n) =>`)
// so the body sees the number, keyed by it (range values are unique).
func (c *compiler) emitFor(f *parser.For, ind int, scope map[string]bool) (string, error) {
	if f.IsRange {
		// Parenthesize both bounds: they are spliced textually, so a composite
		// from/to (e.g. `start + 1`, `a || b`, a ternary) would otherwise bind
		// wrong — left-associative minus does not distribute over `to - from`,
		// and `from + __i` would mis-associate too.
		from := "(" + resolveExpr(f.RangeFrom, scope) + ")"
		to := "(" + resolveExpr(f.RangeTo, scope) + ")"
		gen := "Array.from({ length: " + to + " - " + from + " + 1 }, (_, __i) =>"
		if f.Counter != "" {
			body, err := c.forBody(f, scopeAdd(scope, f.Counter), f.Counter, ind+2)
			if err != nil {
				return "", err
			}
			return gen + " " + from + " + __i).map((" + f.Counter + ") =>\n" +
				sp(ind+2) + body + "\n" + sp(ind) + ")", nil
		}
		body, err := c.forBody(f, scopeAdd(scope, "__i"), "__i", ind+2)
		if err != nil {
			return "", err
		}
		return gen + "\n" +
			sp(ind+2) + body + "\n" + sp(ind) + ")", nil
	}
	coll := resolveExpr(f.Collection, scope)
	params := f.Item
	bodyScope := scopeAdd(scope, f.Item)
	if f.Counter != "" {
		params += ", " + f.Counter
		bodyScope = scopeAdd(bodyScope, f.Counter)
	}
	// The synthetic auto-key is `ViewNode.keyOf(<item>)`; ViewNode is a module
	// identifier (always imported), so mark it in-scope to keep the expression
	// resolver from rewriting it to `__d.ViewNode` (D58).
	bodyScope = scopeAdd(bodyScope, "ViewNode")
	body, err := c.forBody(f, bodyScope, "ViewNode.keyOf("+f.Item+")", ind+2)
	if err != nil {
		return "", err
	}
	return coll + ".map((" + params + ") =>\n" +
		sp(ind+2) + body + "\n" + sp(ind) + ")", nil
}

// forBody extracts the single root element of a {#for} body and prepends the
// synthetic `key` attribute — UNLESS the root already carries an explicit `key`
// (static or dynamic), in which case the author's attribute stands and the
// synthetic prepend is skipped entirely (D58), in both item and range forms.
func (c *compiler) forBody(f *parser.For, scope map[string]bool, keyExpr string, ind int) (string, error) {
	only, explicitKey, err := c.forBodyRoot(f, scope)
	if err != nil {
		return "", err
	}
	key := &parser.DynamicAttr{Name: "key", Expr: keyExpr}
	switch n := only.(type) {
	case *parser.Element:
		attrs := n.Attrs
		if !explicitKey {
			attrs = append([]parser.Attr{key}, attrs...)
		}
		if n.RawInner != nil { // resolved {#svg} as the sole {#for} body root
			keyed := &parser.Element{Tag: n.Tag, Attrs: attrs, RawInner: n.RawInner, RawSrc: n.RawSrc, Pos: n.Pos}
			return c.emitRawSVG(keyed, ind, ind, scope)
		}
		return c.emitElement("'"+n.Tag+"'", attrs, n.Children, ind, ind, false, scope)
	case *parser.Component:
		props := n.Props
		if !explicitKey {
			props = append([]parser.Attr{key}, props...)
		}
		return c.emitElement(n.Name, props, n.Children, ind, ind, true, scope)
	}
	return "", c.cgErr(f.Pos, "internal error: {#for} body root not an element or component after forBodyRoot")
}

// forRowsProvablyKeyed reports whether every row emitted by a loop is known to
// have a non-null key. Item-form keyOf calls and explicit author keys may resolve
// null; only a range loop using the generated __i/counter key is provable.
func (c *compiler) forRowsProvablyKeyed(f *parser.For, scope map[string]bool) (bool, error) {
	if !f.IsRange {
		return false, nil
	}
	_, explicitKey, err := c.forBodyRoot(f, scope)
	if err != nil {
		return false, err
	}
	return !explicitKey, nil
}

// forBodyRoot extracts and validates the single element/component root shared by
// loop emission and conditional-stability analysis, and reports whether that root
// carries an explicit key override.
func (c *compiler) forBodyRoot(f *parser.For, scope map[string]bool) (parser.Node, bool, error) {
	items, err := c.processChildren(f.Body, scope)
	if err != nil {
		return nil, false, err
	}
	var only parser.Node
	for _, it := range items {
		if it.textOK || only != nil {
			return nil, false, c.cgErr(f.Pos, "{#for} body must contain exactly one root element")
		}
		only = it.node
	}
	if only == nil {
		return nil, false, c.cgErr(f.Pos, "{#for} body must contain exactly one root element")
	}
	switch n := only.(type) {
	case *parser.Element:
		return only, hasKeyAttr(n.Attrs), nil
	case *parser.Component:
		return only, hasKeyAttr(n.Props), nil
	default:
		return nil, false, c.cgErr(f.Pos, "{#for} body root must be an element or component")
	}
}

// hasKeyAttr reports whether the attr list already carries a `key` (static,
// dynamic, or mixed) — the author's explicit override suppresses the synthetic
// key (D58). A MixedAttr (`key="row-{item.id}"`) is an explicit key too: without
// this arm the synthetic keyOf was ALSO prepended, doubling the key property and
// tripping the runtime duplicate-key warning.
func hasKeyAttr(attrs []parser.Attr) bool {
	for _, a := range attrs {
		switch at := a.(type) {
		case *parser.StaticAttr:
			if at.Name == "key" {
				return true
			}
		case *parser.DynamicAttr:
			if at.Name == "key" {
				return true
			}
		case *parser.MixedAttr:
			if at.Name == "key" {
				return true
			}
		}
	}
	return false
}

// printWidth is the empirically-derived line-wrap threshold for the attribute
// object. The Phase 1 fixtures are hand-formatted (not by the repo's Prettier
// config, which is tabs/printWidth 70): every single-attribute element with an
// inline first line ≤112 columns stays inline, while Default.pzl's 140-column
// <puzzle-view> root breaks to multi-line. 120 separates them.
const printWidth = 120

// attrsMultiline decides whether the attribute object breaks onto its own
// lines: always when there are ≥2 attributes or any mixed (template-literal)
// value; for a single simple attribute, only when the inline first line would
// exceed printWidth.
func (c *compiler) attrsMultiline(attrs []parser.Attr, tagStr string, startCol int, emptyChildren bool, scope map[string]bool, isComponent bool) (bool, error) {
	if len(attrs) == 0 {
		return false, nil
	}
	if len(attrs) >= 2 || anyMixed(attrs) {
		return true, nil
	}
	kv, err := c.attrKV(attrs[0], scope, isComponent, false)
	if err != nil {
		return false, err
	}
	childrenTok := "["
	if emptyChildren {
		childrenTok = "[])"
	}
	firstLine := "new ViewNode(" + tagStr + ", { " + kv + " }, " + childrenTok
	return startCol+len(firstLine) > printWidth, nil
}

// emitAttrs emits the attribute object either inline `{ k: v }` or multi-line
// (one attribute per line, trailing comma), per the precomputed decision.
func (c *compiler) emitAttrs(attrs []parser.Attr, ind int, multiline bool, scope map[string]bool, isComponent bool) (string, error) {
	if len(attrs) == 0 {
		return "{}", nil
	}
	if !multiline {
		kv, err := c.attrKV(attrs[0], scope, isComponent, true)
		if err != nil {
			return "", err
		}
		return "{ " + kv + " }", nil
	}
	var b strings.Builder
	b.WriteString("{\n")
	for _, a := range attrs {
		kv, err := c.attrKV(a, scope, isComponent, true)
		if err != nil {
			return "", err
		}
		b.WriteString(sp(ind + 2))
		b.WriteString(kv)
		b.WriteString(",\n")
	}
	b.WriteString(sp(ind))
	b.WriteString("}")
	return b.String(), nil
}

// attrKV compiles a single attribute to a `key: value` pair. `emit` distinguishes
// the REAL emission pass (emitAttrs) from the attrsMultiline width-measurement
// trial: only the real pass advances the D62 handler-cache counter, so the trial
// reads the SAME site index the real emission will use (matching bytes for the
// width decision) without consuming it.
func (c *compiler) attrKV(a parser.Attr, scope map[string]bool, isComponent bool, emit bool) (string, error) {
	switch at := a.(type) {
	case *parser.StaticAttr:
		if at.Name == "ref" {
			// Element ref (v1.39, D72): a framework-owned static attr — never a DOM
			// attribute. It is emitted as a per-instance cached setter call so the
			// runtime can wire this.refs.<name> to the mounted node. The parser has
			// already guaranteed a non-empty bare-identifier name (validateRefs), so
			// the emitted string needs no further escaping.
			return fmt.Sprintf("ref: this.__ref(%q)", at.Value), nil
		}
		if at.Valueless {
			return jsKey(at.Name) + ": true", nil // bare boolean attr (autofocus)
		}
		// An EXPLICIT empty value (value="") stays the empty string — keying on
		// Value == "" here compiled it to `true`, so the runtime set the literal
		// string "true" on inputs and passed true instead of '' as a component prop.
		return jsKey(at.Name) + ": " + jsString(at.Value), nil
	case *parser.DynamicAttr:
		if startsWithObjectLiteral(at.Expr) {
			return "", c.cgErr(at.Pos, objectLiteralMsg)
		}
		return jsKey(at.Name) + ": " + resolveExpr(at.Expr, scope), nil
	case *parser.MixedAttr:
		return jsKey(at.Name) + ": " + c.emitMixed(at.Parts, scope), nil
	case *parser.EventAttr:
		val, cacheable, err := compileEventValue(at.Expr, scope)
		if err != nil {
			return "", c.cgErr(at.Pos, err.Error())
		}
		// A data-independent handler is the same function object on every render, so
		// wrap it in the per-instance cache (v1.29, D62 / SPEC §31). Done BEFORE the
		// isComponent split so both DOM listeners and component callback props share
		// one cached closure — a cached callback prop shallow-compares equal across
		// parent re-renders, so the child stops re-running data() on phantom prop
		// changes. Non-cacheable sites (loop/data captures) fall through
		// byte-identical to v1.28. The counter advances only on the real emit pass
		// (see attrKV's `emit` doc); the width-trial peeks the same index.
		if cacheable {
			val = fmt.Sprintf("((this.__h ??= {})[%d] ??= %s)", c.handlerSites, val)
			if emit {
				c.handlerSites++
			}
		}
		// DOM listener → '@name' key; component callback prop → bare `name`
		// (constellation/doc/DOC-DECISIONS.md D16, constellation/doc/DOC-APP-ANATOMY.md §1).
		if isComponent {
			if len(at.Modifiers) > 0 {
				return "", c.cgErr(at.Pos, "event modifiers are not allowed on component callback props")
			}
			return jsKey(at.Name) + ": " + val, nil
		}
		// Modifiers ride in the vnode KEY only (Option A): '@event:mod:mod'.
		// A modifier-free binding emits the byte-identical '@event' key of before.
		key := "@" + at.Name
		if len(at.Modifiers) > 0 {
			key += ":" + strings.Join(at.Modifiers, ":")
		}
		return jsKey(key) + ": " + val, nil
	default:
		return "", c.cgErr(parser.Position{Line: 1, Col: 1}, "unsupported attribute")
	}
}

// emitMixed compiles a mixed attribute value (constellation/doc/DOC-COMPILER-DESIGN.md §c) to a
// template literal; inline `{#if}` parts become `${cond ? '…' : ”}` ternaries.
func (c *compiler) emitMixed(parts []parser.Part, scope map[string]bool) string {
	var b strings.Builder
	b.WriteByte('`')
	for _, p := range parts {
		switch pp := p.(type) {
		case *parser.StaticPart:
			b.WriteString(tplEscape(pp.Text))
		case *parser.InterpPart:
			expr := applyFormatters(resolveExpr(pp.Interp.Expr, scope), pp.Interp.Formatters, scope)
			b.WriteString("${")
			b.WriteString(expr)
			b.WriteString("}")
		case *parser.InlineIfPart:
			cond := resolveExpr(pp.Cond, scope)
			thenS := c.branchToStr(pp.Then, scope)
			elseS := "''"
			if pp.Else != nil {
				elseS = c.branchToStr(pp.Else, scope)
			}
			b.WriteString("${")
			b.WriteString(cond)
			b.WriteString(" ? ")
			b.WriteString(thenS)
			b.WriteString(" : ")
			b.WriteString(elseS)
			b.WriteString("}")
		}
	}
	b.WriteByte('`')
	return b.String()
}

// branchToStr compiles an inline-if branch (static/interp/nested-if parts only)
// to a single string-valued JS expression.
func (c *compiler) branchToStr(parts []parser.Part, scope map[string]bool) string {
	var segs []string
	for _, p := range parts {
		switch pp := p.(type) {
		case *parser.StaticPart:
			segs = append(segs, jsString(pp.Text))
		case *parser.InterpPart:
			expr := applyFormatters(resolveExpr(pp.Interp.Expr, scope), pp.Interp.Formatters, scope)
			segs = append(segs, "String("+expr+")")
		case *parser.InlineIfPart:
			cond := resolveExpr(pp.Cond, scope)
			thenS := c.branchToStr(pp.Then, scope)
			elseS := "''"
			if pp.Else != nil {
				elseS = c.branchToStr(pp.Else, scope)
			}
			segs = append(segs, "("+cond+" ? "+thenS+" : "+elseS+")")
		}
	}
	if len(segs) == 0 {
		return "''"
	}
	return strings.Join(segs, " + ")
}

// processChildren applies the whitespace policy, coalesces text runs, and drops
// pure inter-element whitespace, returning items in source order.
func (c *compiler) processChildren(children []parser.Node, scope map[string]bool) ([]item, error) {
	var items []item
	var run []parser.Node
	flush := func() error {
		if len(run) == 0 {
			return nil
		}
		val, ok, err := c.buildTextRun(run, scope)
		run = run[:0]
		if err != nil {
			return err
		}
		if ok {
			items = append(items, item{text: val, textOK: true})
		}
		return nil
	}
	for _, ch := range children {
		switch ch.(type) {
		case *parser.Text, *parser.Interpolation:
			run = append(run, ch)
		default:
			if err := flush(); err != nil {
				return nil, err
			}
			items = append(items, item{node: ch})
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return items, nil
}

// buildTextRun coalesces a run of Text/Interpolation siblings into a single
// text-vnode value expression. Returns ("", false, nil) when the run reduces to
// nothing (pure whitespace); a positioned error when an interpolation is an
// object literal (SPEC §6).
func (c *compiler) buildTextRun(run []parser.Node, scope map[string]bool) (string, bool, error) {
	type seg struct {
		js     string
		static bool
	}
	var segs []seg
	for _, n := range run {
		switch t := n.(type) {
		case *parser.Text:
			s, keep := processText(t.Value)
			if keep {
				segs = append(segs, seg{js: jsString(s), static: true})
			}
		case *parser.Interpolation:
			if startsWithObjectLiteral(t.Expr) {
				return "", false, c.cgErr(t.Pos, objectLiteralMsg)
			}
			expr := applyFormatters(resolveExpr(t.Expr, scope), t.Formatters, scope)
			segs = append(segs, seg{js: "String(" + expr + ")", static: false})
		}
	}
	if len(segs) == 0 {
		return "", false, nil
	}
	if len(segs) == 1 {
		return segs[0].js, true, nil
	}
	parts := make([]string, len(segs))
	for i, s := range segs {
		parts[i] = s.js
	}
	return strings.Join(parts, " + "), true, nil
}

// applyFormatters nests a formatter chain as calls into the raw formatter map:
// `{ x | a | b(c) }` → `(__f["b"] || __f.__missing("b"))((__f["a"] || __f.__missing("a"))(x), c)`.
// Access is BRACKETED with a JSON-quoted name, uniformly for every formatter —
// matching the runtime registry, whose keys are arbitrary strings (so a
// hyphenated `foo-bar` is a legitimate name). Dot access (`__f.foo-bar`) would
// have parsed as subtraction: valid JS, silent at build, then a runtime
// ReferenceError before the D43 guard could engage. Every call is wrapped in the
// __missing typo-guard (v1.12, D43 — supersedes the D25 bare-call deferral): a
// name absent from the runtime registry resolves to __f.__missing(name), a
// factory that warns once (naming the offender, with a did-you-mean) and returns
// a pass-through formatter, so a typo'd formatter renders the raw value instead
// of crashing the view. The name is passed as a JS string literal so the runtime
// error can identify it. See DOC-SPEC §6.
func applyFormatters(base string, fmts []parser.FormatterCall, scope map[string]bool) string {
	out := base
	for _, fc := range fmts {
		name := strconv.Quote(fc.Name)
		var b strings.Builder
		b.WriteString("(__f[")
		b.WriteString(name)
		b.WriteString("] || __f.__missing(")
		b.WriteString(name)
		b.WriteString("))(")
		b.WriteString(out)
		for _, a := range fc.Args {
			b.WriteString(", ")
			b.WriteString(resolveExpr(a, scope))
		}
		b.WriteString(")")
		out = b.String()
	}
	return out
}

var wsRun = regexp.MustCompile(`[ \t\r\n]+`)

// processText applies the whitespace policy to one Text node's value. See the
// package doc for the exact rule. Returns ("", false) when the node is dropped.
func processText(raw string) (string, bool) {
	if strings.TrimSpace(raw) == "" {
		if strings.ContainsAny(raw, "\n\r") {
			return "", false
		}
		return " ", true
	}
	leadingNL := leadingWSHasNewline(raw)
	trailingNL := trailingWSHasNewline(raw)
	s := wsRun.ReplaceAllString(raw, " ")
	if leadingNL {
		s = strings.TrimPrefix(s, " ")
	}
	if trailingNL {
		s = strings.TrimSuffix(s, " ")
	}
	if s == "" {
		return "", false
	}
	return s, true
}

func leadingWSHasNewline(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' || s[i] == '\r' {
			return true
		}
		if s[i] != ' ' && s[i] != '\t' {
			return false
		}
	}
	return false
}

func trailingWSHasNewline(s string) bool {
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == '\n' || s[i] == '\r' {
			return true
		}
		if s[i] != ' ' && s[i] != '\t' {
			return false
		}
	}
	return false
}

// hasSlot reports whether any composition marker (<children/>/<Slot/>/<slot
// name>) appears in the tree (→ SLOT_TAG import). All spellings are *parser.Slot.
func hasSlot(nodes []parser.Node) bool {
	for _, n := range nodes {
		switch t := n.(type) {
		case *parser.Slot:
			return true
		case *parser.Element:
			if hasSlot(t.Children) {
				return true
			}
		case *parser.Component:
			if hasSlot(t.Children) {
				return true
			}
		case *parser.If:
			if hasSlot(t.Then) || hasSlot(t.Else) {
				return true
			}
		case *parser.Case:
			for _, cl := range t.Clauses {
				if hasSlot(cl.Body) {
					return true
				}
			}
			if hasSlot(t.Else) {
				return true
			}
		case *parser.For:
			if hasSlot(t.Body) {
				return true
			}
		}
	}
	return false
}

func anyMixed(attrs []parser.Attr) bool {
	for _, a := range attrs {
		if _, ok := a.(*parser.MixedAttr); ok {
			return true
		}
	}
	return false
}

// jsKey emits an object key: bare when a valid identifier, single-quoted
// otherwise (e.g. '@submit', 'fill-rule').
func jsKey(name string) string {
	if isJSIdentifier(name) {
		return name
	}
	return jsString(name)
}

// jsString emits a single-quoted JS string literal.
func jsString(s string) string {
	var b strings.Builder
	b.WriteByte('\'')
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\':
			b.WriteString(`\\`)
		case '\'':
			b.WriteString(`\'`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteByte(s[i])
		}
	}
	b.WriteByte('\'')
	return b.String()
}

// tplEscape escapes text for inside a template literal.
func tplEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '\\':
			b.WriteString(`\\`)
		case c == '`':
			b.WriteString("\\`")
		case c == '$' && i+1 < len(s) && s[i+1] == '{':
			b.WriteString(`\$`)
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

func scopeAdd(scope map[string]bool, name string) map[string]bool {
	out := cloneScope(scope)
	if name != "" {
		out[name] = true
	}
	return out
}

var spaces = strings.Repeat(" ", 256)

func sp(n int) string {
	if n <= 0 {
		return ""
	}
	for n > len(spaces) {
		spaces += spaces
	}
	return spaces[:n]
}
