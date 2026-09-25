// Package codegen turns a parsed .pzl template (constellation/doc/DOC-COMPILER-DESIGN.md §c) into
// the generated JS module — the user's <script> emitted VERBATIM plus an
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
// # Whitespace / text policy (D168, the core rule of D173 V10)
//
// Applied to template Text nodes only (never to attribute values, which keep
// their bytes). For each Text node:
//   - collapse every run of ASCII whitespace to a single space;
//   - strip the leading space if the original leading whitespace run contained
//     a newline (i.e. it was source indentation); strip the trailing space
//     likewise;
//   - if the result is empty, drop the node.
//
// Consecutive Text/Interpolation siblings coalesce into ONE text vnode whose
// value is the `+`-concatenation of quoted literals and shared display-coercion
// calls.
//
// Stripping is a PARENT-EDGE rule. A stripped edge gets exactly one space back
// whenever it borders anything other than the parent's edge:
//   - another member of the same run (an interpolation, or a text segment
//     across a dropped whitespace-only node): `{ first }\n{ last }` renders
//     "John Doe";
//   - a sibling element, component, marker, portal, snippet or {#svg}:
//     `tokens —\n<code>a</code>,\n<code>b</code>\nand more` renders
//     "tokens — a, b and more", as a browser renders the same markup;
//   - a sibling control-flow block ({#if}, {#for}, {#case}): the space lands
//     outside the block, so it renders whether or not the branch does.
//
// A run edge that is the first or last child of its parent (an element, a
// component's children, a marker fallback, a snippet body, or a control
// block's own body) keeps the strip: it is indentation. Whitespace-only text
// with a newline between two non-text siblings drops entirely, so stacked
// buttons and stacked conditionals get no gap. Nothing is invented where the
// source had no whitespace: `{ a }{ b }` and `<b>x</b>{ y }` stay adjacent.
//
// A <pre> or <textarea> body is preserved exactly: every Text node in its
// subtree is emitted byte for byte, whitespace-only nodes included, except the
// one newline directly after the start tag, which HTML's parser drops too. A
// {#for} body's own children still drop their whitespace there, because a loop
// body is a single root element and cannot hold text.
package codegen

import (
	"fmt"
	"hash/fnv"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// ScopeID derives the stable per-file scope id for <style scoped> (v1.27, D59):
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

// ScopedCSS wraps a <style scoped> body in the native @scope rule keyed by
// ScopeID(filename) — the same id the root stamp uses, so the rule and the
// data-<scopeId> attribute always agree. It is the SINGLE source of the wrapper
// text: the esbuild plugin emits it during a real build, and cmd/pzl-wasm emits
// it for the playground, which has no build pipeline to run.
func ScopedCSS(filename, styles string) string {
	return "@scope ([data-" + ScopeID(filename) + "]) {\n" + styles + "\n}"
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

	// ModulePath is the app-root-relative, forward-slashed path of the source
	// .pzl (e.g. "app/views/Home.pzl"), stamped onto the compiled class as
	// `Class.__pzlModule = "<path>"` so the static-pages build (D81) can map a
	// route's view/layout classes back to their source modules for per-page entry
	// generation. The esbuild plugin threads its app-relative `name` in here.
	// Empty means "no app root is known" (the standalone pzlc single-file path and
	// the codegen goldens): the stamp then falls back to the plain basename of
	// Filename.
	ModulePath string
	// AssetsDir is the absolute (or test-relative) path of the app's assets dir
	// ({#svg} paths resolve from here, v1.14 D46). Empty means "not configured":
	// any {#svg} then fails with a "this project has no app/assets/ directory"
	// error.
	AssetsDir string
	// AssetReadsUnavailable, when non-empty, rejects every filesystem-backed
	// asset reference before path resolution or reading. The value is the
	// environment-specific explanation appended to the positioned diagnostic.
	// Browser compilation sets this because its source is intentionally
	// filesystem-free; ordinary CLI/plugin builds leave it empty.
	AssetReadsUnavailable string

	// SVGDedup selects the dedup emission for {#svg} (v1.14 D46 amendment): each
	// use site becomes a call to a per-asset shared factory imported from a
	// virtual module (`@magic-spells/puzzle/svg-asset/<src>`) that the esbuild
	// plugin resolves + serves, so esbuild stores each unique icon ONCE across the
	// bundle. The plugin sets this true. Left false (pzlc standalone, no bundler),
	// codegen inlines the markup at every use site as before — a self-contained
	// module with no unresolved virtual imports.
	SVGDedup bool

	// SVGCache memoizes {#svg} asset reads + scans across every file compiled in
	// one build (svgcache.go). The esbuild plugin creates one per build and shares
	// it with its shared-asset module loader; left nil, every use site reads and
	// scans its file exactly as before.
	SVGCache *SVGCache
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
	// expression that references a <script> import, which resolveExpr rewrites to
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
	if strings.HasPrefix(p, "app/views/") || strings.Contains(p, "/app/views/") ||
		strings.HasPrefix(p, "app/layouts/") || strings.Contains(p, "/app/layouts/") {
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
	// Accessibility warnings (v1.48, D82): a read-only walk over the fresh AST,
	// BEFORE resolveInlineSVG splices never-parsed raw markup in. Out-of-band
	// like every Warning — the generated JS is byte-identical.
	collectA11yWarnings(root.Children, opts.Filename, warnings)
	// <script> is optional (DOC-SPEC.md §4). With no user class to bind the
	// render tail to, synthesize a minimal module — the runtime import plus an
	// empty PuzzleView subclass named from the filename — and drive the rest of
	// codegen from it exactly as if the user had written it.
	scripts := sec.Scripts
	// ONE tokenization of the <script> body per compile. Three consumers used to
	// lex these same bytes independently: the class-name extraction, the
	// import-collision warning scan, and the reserved-binding check.
	scriptToks := tokenizeJS(sec.Scripts)
	var className string
	if strings.TrimSpace(scripts) == "" {
		className = classNameFromFilename(opts.Filename)
		// A script-less COMPONENT reads its props by name (D173 V15): the
		// synthesized data() returns them, so `{ tone }` renders the `tone` prop
		// as it does in Sites. A component with a script keeps PuzzleKit's rule —
		// its own data() decides — and views and layouts have no props.
		body := ""
		if opts.Mode == ModeComponent {
			body = "\n  data(params, props) {\n    return props;\n  }\n"
		}
		scripts = "import { PuzzleView } from '@magic-spells/puzzle';\n" +
			"export default class " + className + " extends PuzzleView {" + body + "}\n"
	} else {
		className, err = extractClassName(scripts, scriptToks, opts.Filename, sec.ScriptsPos)
		if err != nil {
			return "", err
		}
	}

	c := &compiler{
		file:                  opts.Filename,
		svgDedup:              opts.SVGDedup,
		svgCache:              opts.SVGCache,
		assetReadsUnavailable: opts.AssetReadsUnavailable,
	}
	scope := scopeMap{}

	// Resolve {#svg} nodes (v1.14, D46): read each referenced file and splice an
	// <svg> element carrying its attrs + raw inner markup, BEFORE emit. Run on the
	// template AST here and on the skeleton AST below.
	if err := c.resolveInlineSVG(root.Children, opts.AssetsDir, inlined); err != nil {
		return "", err
	}

	// Scoped styles (v1.27, D59): a bare `scoped` on <style> stamps ONE static
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
		collectA11yWarnings(skel.Children, opts.Filename, warnings)
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

	// <script>-import collision warnings (out-of-band; goldens unaffected). Scan
	// the emitted render expressions for `__d.<name>` reads whose <name> is an
	// import binding in <script> — those resolve to undefined at render (SPEC §6).
	if imports := scriptImportBindings(scriptToks); len(imports) > 0 {
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
					"template expression references %q, which is imported in <script> — template expressions can only read data() fields; %q will be undefined",
					name, name),
			})
		}
	}

	imports := []string{"ViewNode"}
	if hasSlot(root.Children) || (skel != nil && hasSlot(skel.Children)) {
		imports = append(imports, "SLOT_TAG")
	}
	if hasSnippet(root.Children) || (skel != nil && hasSnippet(skel.Children)) {
		imports = append(imports, "SNIPPET_TAG")
	}
	if hasPortal(root.Children) || (skel != nil && hasPortal(skel.Children)) {
		imports = append(imports, "PORTAL_TAG")
	}
	if c.usesDisplayValue {
		imports = append(imports, "displayValue as __s")
	}
	// The list block is imported ONLY by a module that lowered at least one
	// item-form {#for} (D170), exactly as displayValue is imported only by a
	// module that emits a display coercion: a loop-free app must not pay for
	// views/listBlock.js in its bundle.
	if len(c.listSites) > 0 {
		imports = append(imports, "listRows as __l")
	}
	// The loop guards (D173 V12) follow the same rule: a `.map` loop imports
	// loopItems, a range loop loopRange, and a file with neither imports nothing.
	if c.usesLoopItems {
		imports = append(imports, "loopItems as __e")
	}
	if c.usesLoopRange {
		imports = append(imports, "loopRange as __r")
	}
	importLine := "import { " + strings.Join(imports, ", ") + " } from '@magic-spells/puzzle';"

	// Reserved module-scope names: everything the import line above binds locally,
	// plus one `__svg_N` per unique {#svg} asset in dedup mode. A <script> that
	// binds one of these at module scope is a duplicate declaration in the emitted
	// module, so it is a positioned compile error here rather than an esbuild error
	// against the injected line (see checkReservedScriptBindings). The list is
	// built from what THIS file emits — nothing is reserved unconditionally.
	emitted := make([]string, 0, len(imports)+len(c.svgOrder)+len(c.listSites))
	for _, spec := range imports {
		emitted = append(emitted, importLocalName(spec))
	}
	for _, src := range c.svgOrder {
		emitted = append(emitted, c.svgIdent[src])
	}
	// One `const __L<n>` per lowered {#for} site (D170) — module-scope
	// declarations exactly like the import locals, so the same collision rule
	// applies and only the names THIS file emits are reserved.
	emitted = append(emitted, c.listMetaNames()...)
	if err := checkReservedScriptBindings(sec.Scripts, scriptToks, emitted, opts.Filename, sec.ScriptsPos); err != nil {
		return "", err
	}

	var b strings.Builder
	// 1. user's <script>, byte-for-byte verbatim (or the synthesized module for
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
	// 2c. per-site list-block meta consts (D170), one per lowered item-form
	//     {#for} in source order, set off by a blank line on each side. The
	//     facts in them are compile-time static, so they are hoisted out of
	//     render() and shared by every instance of the class.
	if metas := c.emitListMetaConsts(); metas != "" {
		b.WriteString(metas)
		b.WriteString("\n")
	}
	// 3. render tail, attached by prototype assignment (D10).
	b.WriteString(className)
	b.WriteString(".prototype.render = function () {\n")
	b.WriteString("  const __d = this.getData();\n")
	// The formatter registry is read only by a formatter chain, so the binding is
	// emitted only when one was compiled (usesFormatters, set by applyFormatters).
	// rootExpr and skelExpr are both fully built above, so the flag is final here.
	if c.usesFormatters {
		b.WriteString("  const __f = this.ctx.formatters.getAll();\n")
	}
	b.WriteString("\n")
	b.WriteString("  return ")
	b.WriteString(rootExpr)
	b.WriteString(";\n};\n")
	// 3b. module stamp (v1.45, D81): the app-relative source path, stamped as a
	//     static class field immediately after the render tail. The static-pages
	//     build reads Class.__pzlModule off each route's view/layout classes to
	//     emit per-page entry imports. With no app root known (pzlc, goldens) the
	//     stamp is the plain basename. Inert for every non-static build path.
	b.WriteString(className)
	b.WriteString(".__pzlModule = ")
	b.WriteString(jsString(moduleStampPath(opts)))
	b.WriteString(";\n")
	// 3c. root dirty-mask names (D170, root dirty mask): the parent data roots some
	//     loop body reads, indexed by the `roots` bit each site meta carries.
	//     Absent when no site carries a mask, which is the common case — a view
	//     with no `__roots` skips the mask computation entirely.
	b.WriteString(c.emitRootsStamp(className))
	// 4. skeleton tail (v1.8, D39), same prototype-assignment idiom as render().
	if skel != nil {
		b.WriteString("\n")
		b.WriteString(className)
		b.WriteString(".prototype.renderSkeleton = function () {\n")
		b.WriteString("  const __d = this.getData();\n")
		if c.usesFormatters {
			b.WriteString("  const __f = this.ctx.formatters.getAll();\n")
		}
		b.WriteString("\n")
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

// moduleStampPath returns the value for the `Class.__pzlModule` stamp (D81):
// the app-relative ModulePath when the plugin supplied one, else the plain
// basename of Filename. Both are forward-slash-normalized so the stamp is
// byte-stable across build OSes (parallel to ScopeID's normalization).
func moduleStampPath(opts Options) string {
	if opts.ModulePath != "" {
		return strings.ReplaceAll(filepath.ToSlash(opts.ModulePath), "\\", "/")
	}
	norm := strings.ReplaceAll(filepath.ToSlash(opts.Filename), "\\", "/")
	if i := strings.LastIndexByte(norm, '/'); i >= 0 {
		norm = norm[i+1:]
	}
	return norm
}

type compiler struct {
	file string
	// assetReadsUnavailable is non-empty in source-only environments such as
	// the browser playground. resolveOneSVG checks it before touching filepath
	// or SVGCache, so an asset reference can never reach os.ReadFile there.
	assetReadsUnavailable string

	// svgCache memoizes {#svg} asset reads + scans for the whole build. Nil is
	// valid and means "read and scan every time" (pzlc standalone, goldens).
	svgCache *SVGCache

	// Per-file @event handler-cache site counter (v1.29, D62 / SPEC §31). Each
	// CACHEABLE (data-independent) @event value is emitted as
	// `((this.__h ??= {})[N] ??= <arrow>)`, where N is this counter, advanced once
	// per wrapped site. render() and renderSkeleton() are emitted by the SAME
	// compiler instance (see compile()), so indices are unique across both and the
	// numbering is deterministic — recompiling an unchanged file is byte-stable.
	// Non-cacheable sites consume no index and emit byte-identically to v1.28.
	handlerSites int

	// Set when an emitted text or quoted-attribute interpolation calls the
	// package-root display helper. Static-only modules and modules whose dynamic
	// values remain raw vnode attrs do not pay for an unused import.
	usesDisplayValue bool

	// Set when a `.map` item loop (usesLoopItems) or a range loop
	// (usesLoopRange) is emitted, so the runtime loop guards (D173 V12) are
	// imported only by a module that calls them.
	usesLoopItems bool
	usesLoopRange bool

	// Set when an emitted interpolation carries a non-empty formatter chain, which
	// is the only thing that reads __f. It gates the `const __f =
	// this.ctx.formatters.getAll()` line in BOTH render() and renderSkeleton() —
	// module-wide, so a formatter in either body emits the line in both. A third
	// tracker of the same signal is internal/plugin/scan.go collectFormatterCalls
	// (the built-in tree-shaking allow-list); the two are kept in sync by
	// plugin_test.go's built-in sync tests.
	usesFormatters bool

	// SVG-dedup emission state (v1.14 D46 amendment). svgDedup selects the
	// import-a-shared-module strategy over inline; svgOrder/svgIdent accumulate the
	// per-module unique asset srcs (first-seen order) → local import identifiers so
	// compile() emits exactly one import per unique asset.
	svgDedup bool
	svgOrder []string
	svgIdent map[string]string

	// --- persistent list blocks + static subtree caches (D170 emission contract) ---

	// loops is the stack of LOWERED {#for} sites being emitted, innermost last.
	// Range loops and loops inside a <Snippet> body never push.
	loops []*loopSite
	// listSites holds every lowered site in source order; compile() emits one
	// `const __L<id> = {…};` per entry after the injected import line.
	listSites []*loopSite
	// viewCacheSites is the per-file `this.__c[n]` counter for view-level static
	// subtree caches. render() and renderSkeleton() share it, like `__h`.
	viewCacheSites int
	// rootOrder/rootIndex are the file-level `__roots` array: the parent data
	// roots some loop body reads, in first-read order.
	rootOrder []string
	rootIndex map[string]int
	// analyzing > 0 during a look-ahead pass (conditional arity, {#for} body
	// root extraction). Those passes resolve expressions in a scope that is not
	// the one they will be emitted in and throw the text away, so their facts
	// must never reach a site.
	analyzing int
	// preserveWS > 0 inside a <pre> or <textarea> body, where every Text node is
	// emitted byte for byte (D168 rule 6). Every walker that descends into an
	// element's children and calls processChildren — emitElement and the static
	// subtree analysis — raises it for those two tags, so the look-ahead passes
	// count the same text vnodes emission produces.
	preserveWS int
	// snippetDepth > 0 inside a <Snippet> body: stamped fresh per expansion, so
	// it owns no cache — loops keep `.map`, and neither static subtrees nor row
	// handlers are cached there.
	snippetDepth int
	// staticCacheDepth > 0 while emitting inside an already-wrapped static
	// subtree, so only the MAXIMAL qualifying subtree gets a wrapper.
	staticCacheDepth int
	// mapDepth > 0 inside a NON-LOWERED loop body — a range {#for}, or an
	// item-form loop that fell back to `.map` because its explicit key reads
	// render scope. Such a body owns no row scope, and it is emitted ONCE but
	// evaluated per iteration, so anything inside it that keys off a site id or
	// a cache slot would be shared by every iteration: one static vnode mounted
	// at N DOM positions, or one list block serving N lists. Nothing inside one
	// is cached, and no loop inside one is lowered, at any nesting depth.
	mapDepth int
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
func (c *compiler) emitComponentRoot(root *parser.Element, startCol int, scope scopeMap, scopeStamp *parser.StaticAttr) (string, error) {
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
	case *parser.Portal:
		// The root is where call-site attributes merge and where the D59 scope
		// stamp lands; a portal teleports its children away and keeps only a
		// comment placeholder locally, so there is no element to do either job.
		return "", c.cgErr(root.Pos, `a component template's root cannot be <Portal> — wrap it in a root element (e.g. <div style="display: contents">), which stays local while the portal's children teleport`)
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
	scope := scopeMap{}
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
func (c *compiler) emitElement(tagStr string, attrs []parser.Attr, children []parser.Node, ind, startCol int, isComponent bool, scope scopeMap) (string, error) {
	tag := ""
	if !isComponent && len(tagStr) >= 2 && tagStr[0] == '\'' && tagStr[len(tagStr)-1] == '\'' {
		tag = tagStr[1 : len(tagStr)-1]
	}
	if preservesWhitespace(tag) {
		// The whole subtree, descendants included, keeps its bytes (D168).
		children = preservedBody(children)
		c.preserveWS++
		defer func() { c.preserveWS-- }()
	}
	processed, err := c.processChildren(children, scope)
	if err != nil {
		return "", err
	}
	multiline, err := c.attrsMultiline(tag, attrs, tagStr, startCol, len(processed) == 0, scope, isComponent)
	if err != nil {
		return "", err
	}
	attrsSeg, err := c.emitAttrs(tag, attrs, ind, multiline, scope, isComponent)
	if err != nil {
		return "", err
	}

	// Sole-{#for} child: pass the .map()/list array directly as the children
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

	// A STATIC island children array is cached as a unit at any size (D44 +
	// D170): the element's own attrs and listeners still patch, but a seed that
	// is identical on every mount need only be allocated once.
	islandCache := c.islandChildrenCache(attrs, children, isComponent, scope)
	if islandCache != "" {
		c.staticCacheDepth++
	}
	childrenArr, err := c.emitArray(processed, ind+2, scope)
	if islandCache != "" {
		c.staticCacheDepth--
	}
	if err != nil {
		return "", err
	}
	if islandCache != "" {
		childrenArr = islandCache + childrenArr + ")"
	}
	return "new ViewNode(" + tagStr + ", " + attrsSeg + ", " + childrenArr + ")", nil
}

// emitArray emits a children array `[…]` with each element at elemIndent and
// the closing bracket at elemIndent-2. Empty → "[]".
func (c *compiler) emitArray(items []item, elemIndent int, scope scopeMap) (string, error) {
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

func (c *compiler) emitItem(it item, ind int, scope scopeMap) (string, error) {
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
		// A maximal static subtree is built once per owner and returned by
		// reference afterwards (D170, static subtree caches). The wrapper is a prefix, so the
		// element's own layout is untouched apart from the width decision, which
		// sees the prefix through startCol.
		if prefix := c.staticCachePrefix(n, scope); prefix != "" {
			c.staticCacheDepth++
			out, err := c.emitElement("'"+n.Tag+"'", n.Attrs, n.Children, ind, ind+len(prefix), false, scope)
			c.staticCacheDepth--
			if err != nil {
				return "", err
			}
			return prefix + out + ")", nil
		}
		return c.emitElement("'"+n.Tag+"'", n.Attrs, n.Children, ind, ind, false, scope)
	case *parser.Component:
		return c.emitElement(n.Name, n.Props, n.Children, ind, ind, true, scope)
	case *parser.Slot:
		return c.emitSlot(n, ind, scope)
	case *parser.Snippet:
		return c.emitSnippet(n, ind, scope)
	case *parser.Portal:
		// <Portal>…</Portal> (D144): one vnode carrying the teleported children;
		// the runtime mounts them into the shared portal outlet and leaves a comment
		// placeholder at this position. Attribute-free by grammar.
		return c.emitElement("PORTAL_TAG", nil, n.Children, ind, ind, false, scope)
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

// emitSlot extends the existing marker shapes with a fresh args object while
// keeping every no-args spelling byte-identical to its pre-D166 output.
func (c *compiler) emitSlot(n *parser.Slot, ind int, scope scopeMap) (string, error) {
	if n.Name == "" && len(n.Args) == 0 && len(n.Children) == 0 {
		return "new ViewNode(SLOT_TAG)", nil
	}

	var attrs []string
	if n.Name != "" {
		attrs = append(attrs, "name: "+jsString(n.Name))
	}
	if len(n.Args) > 0 {
		kvs := make([]string, 0, len(n.Args))
		for _, arg := range n.Args {
			kv, err := c.attrKV(arg, scope, false, true)
			if err != nil {
				return "", err
			}
			kvs = append(kvs, kv)
		}
		attrs = append(attrs, "args: { "+strings.Join(kvs, ", ")+" }")
	}
	attrsExpr := "{}"
	if len(attrs) > 0 {
		attrsExpr = "{ " + strings.Join(attrs, ", ") + " }"
	}
	if len(n.Children) == 0 {
		return "new ViewNode(SLOT_TAG, " + attrsExpr + ")", nil
	}
	items, err := c.processChildren(n.Children, scope)
	if err != nil {
		return "", err
	}
	children, err := c.emitArray(items, ind+2, scope)
	if err != nil {
		return "", err
	}
	return "new ViewNode(SLOT_TAG, " + attrsExpr + ", " + children + ")", nil
}

// emitSnippet emits the pinned D166 caller-side contract. The arrow receives
// one destructured object and closes over the caller's render scope; every
// declared parameter is added to the body scope and shadows outer bindings.
func (c *compiler) emitSnippet(n *parser.Snippet, ind int, scope scopeMap) (string, error) {
	bodyScope := scope
	// A parameter is destructured by its AUTHORED name (the marker-argument
	// contract), but the identifier it binds locally is mangled when it would
	// shadow an enclosing row scope object — `<Snippet s>` inside a lowered row.
	decls := make([]string, len(n.Params))
	for i, param := range n.Params {
		var local string
		bodyScope, local = c.bareBinding(bodyScope, param)
		decls[i] = param
		if local != param {
			decls[i] = param + ": " + local
		}
	}
	// A snippet body is stamped fresh at every expansion, so it owns no cache to
	// key by site id: loops inside keep today's `.map(…)`, static subtrees are
	// not wrapped, and a row handler is not cached on the enclosing row scope
	// (D170 emission contract). The surrounding depth is restored after the body.
	c.snippetDepth++
	items, err := c.processChildren(n.Body, bodyScope)
	if err != nil {
		c.snippetDepth--
		return "", err
	}
	body, err := c.emitArray(items, ind+6, bodyScope)
	c.snippetDepth--
	if err != nil {
		return "", err
	}
	params := make([]string, len(n.Params))
	for i, param := range n.Params {
		params[i] = jsString(param)
	}
	destructure := "{}"
	if len(decls) > 0 {
		destructure = "{ " + strings.Join(decls, ", ") + " }"
	}
	return "new ViewNode(SNIPPET_TAG, {\n" +
		sp(ind+2) + "fits: " + jsString(n.Fits) + ",\n" +
		sp(ind+2) + "params: [" + strings.Join(params, ", ") + "],\n" +
		sp(ind+2) + "fn: (" + destructure + ") => (" + body + "),\n" +
		sp(ind) + "})", nil
}

// emitIf compiles `{#if}/{:else}` spanning siblings to a spread ternary
// `...(cond ? [then] : [else|[]])`. When both branches have provably fixed vnode
// occupancy, the shorter array is padded to the same static count so toggling
// `cond` cannot shift and remount trailing siblings. Item-form loops (nullable
// ViewNode.keyOf rows) and slot markers (0..N expansion) make occupancy unstable;
// an unstable conditional emits both branches unpadded, byte-identically to the
// pre-padding form. Nested conditionals make this decision independently.
func (c *compiler) emitIf(n *parser.If, ind int, scope scopeMap) (string, error) {
	cond := c.resolveValue(n.Cond, n.Formatters, scope)
	if n.Negate {
		// `{#unless x | f}`: the chain runs first, then the negation (If.Negate).
		cond = "!(" + cond + ")"
	}
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
func (c *compiler) condStaticLen(items []item, scope scopeMap) (int, bool, error) {
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
		case *parser.Snippet:
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
func (c *compiler) ifStaticLen(n *parser.If, scope scopeMap) (int, bool, error) {
	// Arity analysis only: this pass re-processes children whose emitted form is
	// produced later by emitIf, so its facts are suppressed (see forBodyRoot).
	c.analyzing++
	defer func() { c.analyzing-- }()
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
func (c *compiler) caseStaticLen(n *parser.Case, scope scopeMap) (int, bool, error) {
	// Arity analysis only; see ifStaticLen.
	c.analyzing++
	defer func() { c.analyzing-- }()
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
func (c *compiler) emitCase(n *parser.Case, ind int, scope scopeMap) (string, error) {
	caseExpr := c.resolveValue(n.Expr, n.Formatters, scope)

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
			conds[k] = "__c === (" + c.resolve(v, scope) + ")"
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

// emitFor compiles a {#for}. Named form → `__e(<coll>).map((item) => <body>)`
// with `key: ViewNode.keyOf(item)` prepended to the body's root element
// (pk-aware auto-key, D58) — or, far more often, a lowered list block (see
// emitListCall). `__e` (the runtime's loopItems) hands back the collection when
// it is an array and an empty list otherwise, so a missing collection loops
// zero times and any other non-list does too, with a development warning
// (D173 V12). Range form → `__r(<from>, <to>).map((__i) => <body>)`: `__r` (the
// runtime's loopRange) builds the whole numbers from..to with both bounds
// truncated toward zero, and a missing or non-finite bound runs the range zero
// times. Rows are keyed by the generated VALUE, never by its position: the range
// bounds are data, so sliding the window (`5...7` → `6...8`) must not re-hand
// keys 0,1,2 to different numbers and let the reconciler patch stale rows in
// place (D58 — range keys are the generated numbers, unique by construction).
// An explicit `key` attr on the body root suppresses the prepend (forBody).
// An optional trailing counter binds the 0-based index (item form) or the
// current number (range form): the item form adds the second .map parameter;
// the range form names the value parameter after the counter.
// literalRange constant-folds a range whose bounds are both integer literals
// (`{#for 1...3}`): nothing can be missing or fractional, so the loop needs no
// `loopRange` guard or import. A short range emits its numbers as an array
// literal; a long one generates them. It reports false for any other bound.
func literalRange(from, to string) (string, bool) {
	lo, errLo := strconv.Atoi(strings.TrimSpace(from))
	hi, errHi := strconv.Atoi(strings.TrimSpace(to))
	if errLo != nil || errHi != nil || !isIntLiteral(from) || !isIntLiteral(to) {
		return "", false
	}
	n := hi - lo + 1
	switch {
	case n <= 0:
		return "[]", true
	case n <= 16:
		nums := make([]string, n)
		for i := range nums {
			nums[i] = strconv.Itoa(lo + i)
		}
		return "[" + strings.Join(nums, ", ") + "]", true
	default:
		return "Array.from({ length: " + strconv.Itoa(n) + " }, (_, __k) => __k + " + strconv.Itoa(lo) + ")", true
	}
}

// isIntLiteral accepts an optional leading `-` and decimal digits, and nothing
// else (strconv.Atoi alone would also take `+1`, which a template author writes
// as an expression).
func isIntLiteral(s string) bool {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "-")
	if s == "" || len(s) > 9 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func (c *compiler) emitFor(f *parser.For, ind int, scope scopeMap) (string, error) {
	if f.IsRange {
		gen, folded := literalRange(f.RangeFrom, f.RangeTo)
		if !folded {
			c.usesLoopRange = true
			gen = "__r(" + c.resolve(f.RangeFrom, scope) + ", " + c.resolve(f.RangeTo, scope) + ")"
		}
		gen += ".map(("
		if f.Counter != "" {
			bodyScope, counter := c.bareBinding(scope, f.Counter)
			c.mapDepth++
			body, err := c.forBody(f, bodyScope, f.Counter, ind+2, nil)
			c.mapDepth--
			if err != nil {
				return "", err
			}
			return gen + counter + ") =>\n" +
				sp(ind+2) + body + "\n" + sp(ind) + ")", nil
		}
		// Counterless range: the generated value binds as the compiler-private
		// `__i` and keys the row.
		c.mapDepth++
		body, err := c.forBody(f, scopeAdd(scope, "__i"), "__i", ind+2, nil)
		c.mapDepth--
		if err != nil {
			return "", err
		}
		return gen + "__i) =>\n" +
			sp(ind+2) + body + "\n" + sp(ind) + ")", nil
	}
	// Item form lowers to a persistent list block (D170, list blocks) unless the
	// site cannot own one: a <Snippet> body is stamped fresh per expansion, a
	// non-lowered loop body is emitted once and evaluated per iteration (so one
	// block would serve every iteration's list), and an explicit key that reads
	// render-scope state cannot become a module-scope arrow. All three keep
	// today's `.map(…)`.
	if c.snippetDepth == 0 && c.mapDepth == 0 {
		keyArrow, lowerable, err := c.listKeyArrow(f, scope)
		if err != nil {
			return "", err
		}
		if lowerable {
			return c.emitListCall(f, ind, scope, keyArrow)
		}
	}

	coll := c.resolve(f.Collection, scope)
	bodyScope, itemParam := c.bareBinding(scope, f.Item)
	params := itemParam
	if f.Counter != "" {
		var counterParam string
		bodyScope, counterParam = c.bareBinding(bodyScope, f.Counter)
		params += ", " + counterParam
	}
	// The synthetic auto-key is `ViewNode.keyOf(<item>)`; ViewNode is a module
	// identifier (always imported), so mark it in-scope to keep the expression
	// resolver from rewriting it to `__d.ViewNode` (D58).
	bodyScope = scopeAdd(bodyScope, "ViewNode")
	// This body is NOT lowered: nothing inside it may take a site id or a cache
	// slot, because the one it took would be shared by every iteration.
	c.mapDepth++
	body, err := c.forBody(f, bodyScope, "ViewNode.keyOf("+f.Item+")", ind+2, nil)
	c.mapDepth--
	if err != nil {
		return "", err
	}
	c.usesLoopItems = true
	return "__e(" + coll + ").map((" + params + ") =>\n" +
		sp(ind+2) + body + "\n" + sp(ind) + ")", nil
}

// forBody extracts the single root element of a {#for} body and prepends the
// synthetic `key` attribute — UNLESS the root already carries an explicit `key`
// (static or dynamic), in which case the author's attribute stands and the
// synthetic prepend is skipped entirely (D58), in both item and range forms.
//
// A LOWERED site (site != nil) inverts that: the row's key is always the
// block's resolved `key: s.k`, because an explicit key has already moved into
// the site meta's key function, so the author's attribute is dropped from the
// root instead of suppressing the prepend (D170 emission contract).
func (c *compiler) forBody(f *parser.For, scope scopeMap, keyExpr string, ind int, site *loopSite) (string, error) {
	only, explicitKey, err := c.forBodyRoot(f, scope)
	if err != nil {
		return "", err
	}
	if site != nil {
		explicitKey = false
	}
	key := &parser.DynamicAttr{Name: "key", Expr: keyExpr}
	switch n := only.(type) {
	case *parser.Element:
		attrs := n.Attrs
		if site != nil {
			attrs = dropKeyAttrs(attrs)
		}
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
		if site != nil {
			props = dropKeyAttrs(props)
		}
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
func (c *compiler) forRowsProvablyKeyed(f *parser.For, scope scopeMap) (bool, error) {
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
func (c *compiler) forBodyRoot(f *parser.For, scope scopeMap) (parser.Node, bool, error) {
	// A look-ahead: the body is processed in the ENCLOSING scope (its own loop
	// locals are not bound yet) and every emitted byte is discarded — only the
	// root node and the explicit-key verdict are used. Facts collected here
	// would register the loop's own locals as parent data roots.
	//
	// Inside a <pre>/<textarea> the body's own whitespace still drops: a loop
	// body is one root element and cannot hold text. Only this one children
	// list is exempt; the root's descendants are preserved as usual.
	c.analyzing++
	preserve := c.preserveWS
	c.preserveWS = 0
	items, err := c.processChildren(f.Body, scope)
	c.preserveWS = preserve
	c.analyzing--
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
			// A literal `key` captured inside {#raw} or on a {#svg} asset root is
			// authored markup, not the directive, so it must not suppress the
			// synthetic key.
			if at.Name == "key" && !at.LiteralName {
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

// reservedVnodeAttrs are the four attribute names the runtime intercepts by
// name, unconditionally, in every path that could write them out: setAttr,
// removeAttr, and the SSG serializer all drop them before markup is produced.
var reservedVnodeAttrs = map[string]bool{"key": true, "island": true, "ref": true, "flip": true}

// dropReservedLiteralAttrs removes authored-literal attributes captured inside
// {#raw} or on a {#svg} asset root whose names the runtime reserves anyway.
//
// Emitting them can only do harm and never good. It cannot render the authored
// attribute: the runtime's interception is keyed on the bare name, and the
// vnode-key escape that solves this for @-attributes (`@@click`) is decoded by
// stripping ONE '@', so it can express no name that does not start with '@'. But
// it can still trigger the directive: `key` becomes ViewNode.key (and, on a
// {#for} row root, a second `key` property overriding the synthetic one),
// `island` freezes the subtree, `flip` enrolls the element in FLIP measurement.
// Dropping them leaves the rendered output exactly as it is today while making
// the raw body inert, which is what the D150 contract asks for. Rendering them
// as authored additionally needs a runtime-side literal escape that can encode
// an arbitrary name.
func dropReservedLiteralAttrs(attrs []parser.Attr) []parser.Attr {
	keep := attrs
	dropped := false
	for i, a := range attrs {
		at, ok := a.(*parser.StaticAttr)
		if !ok || !at.LiteralName || !reservedVnodeAttrs[at.Name] {
			if dropped {
				keep = append(keep, a)
			}
			continue
		}
		if !dropped {
			// First drop: copy the prefix so the caller's slice is never rewritten.
			keep = append([]parser.Attr(nil), attrs[:i]...)
			dropped = true
		}
	}
	return keep
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
func (c *compiler) attrsMultiline(tag string, attrs []parser.Attr, tagStr string, startCol int, emptyChildren bool, scope scopeMap, isComponent bool) (bool, error) {
	attrs = dropReservedLiteralAttrs(attrs)
	bind := detectAutoBind(tag, attrs, scope)
	attrCount := len(attrs)
	if bind != nil {
		attrCount++
	}
	if attrCount == 0 {
		return false, nil
	}
	if attrCount >= 2 || anyMixed(attrs) {
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
func (c *compiler) emitAttrs(tag string, attrs []parser.Attr, ind int, multiline bool, scope scopeMap, isComponent bool) (string, error) {
	attrs = dropReservedLiteralAttrs(attrs)
	bind := detectAutoBind(tag, attrs, scope)
	attrCount := len(attrs)
	if bind != nil {
		attrCount++
	}
	if attrCount == 0 {
		return "{}", nil
	}
	if !multiline {
		kvs := make([]string, 0, attrCount)
		for _, a := range attrs {
			kv, err := c.attrKV(a, scope, isComponent, true)
			if err != nil {
				return "", err
			}
			kvs = append(kvs, kv)
		}
		if bind != nil {
			kvs = append(kvs, autoBindKV(bind, scope))
		}
		return "{ " + strings.Join(kvs, ", ") + " }", nil
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
	if bind != nil {
		b.WriteString(sp(ind + 2))
		b.WriteString(autoBindKV(bind, scope))
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
func (c *compiler) attrKV(a parser.Attr, scope scopeMap, isComponent bool, emit bool) (string, error) {
	switch at := a.(type) {
	case *parser.StaticAttr:
		// LiteralName means the name came from authored-literal markup rather than
		// framework grammar — so a literal `ref` is never this.refs wiring.
		if at.Name == "ref" && !at.LiteralName {
			// Element ref (v1.39, D72): a framework-owned static attr — never a DOM
			// attribute. It is emitted as a per-instance cached setter call so the
			// runtime can wire this.refs.<name> to the mounted node. The parser has
			// already guaranteed a non-empty bare-identifier name (validateRefs), so
			// the emitted string needs no further escaping.
			return fmt.Sprintf("ref: this.__ref(%q)", at.Value), nil
		}
		name := at.Name
		if at.LiteralName && !isComponent && strings.HasPrefix(name, "@") {
			// Runtime-private escape for an authored literal @-attribute.
			// `@@click` cannot collide with source grammar and decodes to `@click`.
			// The escape is only defined for @-prefixed names — every other literal
			// name is a legal DOM attribute and is emitted as authored.
			name = "@" + name
		}
		if at.Valueless {
			return jsKey(name) + ": true", nil // bare boolean attr (autofocus)
		}
		// An EXPLICIT empty value (value="") stays the empty string — keying on
		// Value == "" here compiled it to `true`, so the runtime set the literal
		// string "true" on inputs and passed true instead of '' as a component prop.
		return jsKey(name) + ": " + jsString(at.Value), nil
	case *parser.DynamicAttr:
		if startsWithObjectLiteral(at.Expr) {
			return "", c.cgErr(at.Pos, objectLiteralMsg)
		}
		return jsKey(at.Name) + ": " + c.resolveValue(at.Expr, at.Formatters, scope), nil
	case *parser.MixedAttr:
		return jsKey(at.Name) + ": " + c.emitMixed(at.Parts, scope), nil
	case *parser.EventAttr:
		facts := c.factSink()
		ev, err := compileEventValue(at.Expr, scope, facts)
		if err != nil {
			return "", c.cgErr(at.Pos, err.Error())
		}
		// A row handler's arguments are part of the loop body: the roots they
		// read must dirty the row, because a fresh closure over `__d` is exactly
		// what keeps them correct (D170 emission contract).
		c.absorb(facts, scope)
		val, cacheable := ev.js, ev.cacheable
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
		} else if ev.rowCacheable && c.rowStableRefs(ev.refs, scope) {
			// A handler capturing ONLY loop locals is identity-stable for the
			// life of the row once the locals are read off the row scope at fire
			// time, so it caches there instead of being rebuilt per render
			// (D62 amended by D170, stable loop handlers). Numbering is per loop site, an
			// independent counter from `__h`. Component callback props ride the
			// same path — that is what stops a row's child re-running data() on
			// every parent render.
			if site := c.rowScope(); site != nil {
				val = fmt.Sprintf("(%s.h%d ??= %s)", site.scope, site.handlerSites, val)
				if emit {
					site.handlerSites++
				}
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
func (c *compiler) emitMixed(parts []parser.Part, scope scopeMap) string {
	f := c.factSink()
	out := c.emitMixedFacts(parts, scope, f)
	c.absorb(f, scope)
	return out
}

// emitMixedFacts is emitMixed's body with an explicit fact collector, so the
// site-meta key arrow can classify a mixed `key="row-{ item.id }"` without its
// reads landing on an enclosing loop site.
func (c *compiler) emitMixedFacts(parts []parser.Part, scope scopeMap, facts *exprFacts) string {
	var b strings.Builder
	b.WriteByte('`')
	for _, p := range parts {
		switch pp := p.(type) {
		case *parser.StaticPart:
			b.WriteString(tplEscape(pp.Text))
		case *parser.InterpPart:
			resolved := c.resolveInterpBase(pp.Interp.Expr, pp.Interp.Formatters, scope, facts)
			expr := c.applyFormatters(resolved, pp.Interp.Formatters, scope, facts)
			b.WriteString("${")
			b.WriteString(c.displayValue(expr, pp.Interp.Expr))
			b.WriteString("}")
		case *parser.InlineIfPart:
			cond := c.resolveChain(pp.Cond, pp.Formatters, scope, facts)
			thenS := c.branchToStr(pp.Then, scope, facts)
			elseS := "''"
			if pp.Else != nil {
				elseS = c.branchToStr(pp.Else, scope, facts)
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
func (c *compiler) branchToStr(parts []parser.Part, scope scopeMap, facts *exprFacts) string {
	var segs []string
	for _, p := range parts {
		switch pp := p.(type) {
		case *parser.StaticPart:
			segs = append(segs, jsString(pp.Text))
		case *parser.InterpPart:
			resolved := c.resolveInterpBase(pp.Interp.Expr, pp.Interp.Formatters, scope, facts)
			expr := c.applyFormatters(resolved, pp.Interp.Formatters, scope, facts)
			segs = append(segs, c.displayValue(expr, pp.Interp.Expr))
		case *parser.InlineIfPart:
			cond := c.resolveChain(pp.Cond, pp.Formatters, scope, facts)
			thenS := c.branchToStr(pp.Then, scope, facts)
			elseS := "''"
			if pp.Else != nil {
				elseS = c.branchToStr(pp.Else, scope, facts)
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
// pure inter-element whitespace, returning items in source order. It classifies
// one children list only; descendants are processed as they are emitted.
func (c *compiler) processChildren(children []parser.Node, scope scopeMap) ([]item, error) {
	var items []item
	var run []parser.Node
	// leftSibling: a sibling node, not the parent's edge, sits immediately
	// before the run being collected, so a stripped leading edge is a word
	// boundary rather than indentation (see the package doc).
	leftSibling := false
	flush := func(rightSibling bool) error {
		if len(run) == 0 {
			return nil
		}
		val, ok, err := c.buildTextRun(run, scope, leftSibling, rightSibling)
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
			if err := flush(true); err != nil {
				return nil, err
			}
			items = append(items, item{node: ch})
			leftSibling = true
		}
	}
	if err := flush(false); err != nil {
		return nil, err
	}
	return items, nil
}

// normalizeNewlines turns CRLF and a lone CR into LF, the HTML input-stream
// rule, for text whose bytes are otherwise kept.
func normalizeNewlines(s string) string {
	if !strings.Contains(s, "\r") {
		return s
	}
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}

// preservesWhitespace reports whether an element's body keeps its source
// whitespace byte for byte (D168 rule 6).
func preservesWhitespace(tag string) bool {
	return tag == "pre" || tag == "textarea"
}

// preservedBody returns a <pre>/<textarea> body without the one newline that
// HTML's parser drops directly after the start tag, so `<pre>` + newline +
// `code` renders the same in the browser runtime as the same markup parsed.
// Only a first-child Text node can carry that newline, and a {#raw} body's text
// never does: `<pre>{#raw}` + newline keeps its bytes (D150), since the newline
// does not follow the start tag in the source.
func preservedBody(children []parser.Node) []parser.Node {
	if len(children) == 0 {
		return children
	}
	t, ok := children[0].(*parser.Text)
	if !ok || t.Raw {
		return children
	}
	v := t.Value
	switch {
	case strings.HasPrefix(v, "\r\n"):
		v = v[2:]
	case strings.HasPrefix(v, "\n"), strings.HasPrefix(v, "\r"):
		v = v[1:]
	default:
		return children
	}
	if v == "" {
		return children[1:]
	}
	out := make([]parser.Node, len(children))
	copy(out, children)
	out[0] = &parser.Text{Value: v, Raw: t.Raw, Pos: t.Pos}
	return out
}

// buildTextRun coalesces a run of Text/Interpolation siblings into a single
// text-vnode value expression. Returns ("", false, nil) when the run reduces to
// nothing (pure whitespace); a positioned error when an interpolation is an
// object literal (SPEC §6). leftSibling/rightSibling report that the run is
// bounded by a sibling node rather than the parent's edge, which makes that
// edge a word boundary for padding purposes (D168).
func (c *compiler) buildTextRun(run []parser.Node, scope scopeMap, leftSibling, rightSibling bool) (string, bool, error) {
	facts := c.factSink()
	defer func() { c.absorb(facts, scope) }()
	type seg struct {
		js         string // non-static segments
		text       string // static segments, quoted at join time
		static     bool
		padL, padR bool // a space was stripped at this edge
		gap        bool // emit a standalone ' ' before this segment
	}
	var segs []seg
	// leadPad records a strip at the run's leading edge that no seg carries —
	// a whitespace-only node dropped before anything else in the run.
	leadPad := false
	for _, n := range run {
		switch t := n.(type) {
		case *parser.Text:
			if t.Raw || c.preserveWS > 0 {
				// {#raw} bytes, and every Text node inside a <pre>/<textarea>
				// body, are emitted as authored (D150, D168) — except line
				// endings, which normalize to LF as HTML's input stream does, so
				// a CRLF checkout emits the same bundle and the mounted text
				// matches the prerendered page.
				segs = append(segs, seg{text: normalizeNewlines(t.Value), static: true})
				continue
			}
			s, keep, padL, padR := processText(t.Value)
			if !keep {
				// A dropped whitespace-only node still separates its neighbours.
				if len(segs) == 0 {
					leadPad = leadPad || padL
					continue
				}
				if padR {
					segs[len(segs)-1].padR = true
				}
				continue
			}
			segs = append(segs, seg{text: s, static: true, padL: padL, padR: padR})
		case *parser.Interpolation:
			if startsWithObjectLiteral(t.Expr) {
				return "", false, c.cgErr(t.Pos, objectLiteralMsg)
			}
			resolved := c.resolveInterpBase(t.Expr, t.Formatters, scope, facts)
			expr := c.applyFormatters(resolved, t.Formatters, scope, facts)
			segs = append(segs, seg{js: c.displayValue(expr, t.Expr), static: false})
		}
	}
	if len(segs) == 0 {
		return "", false, nil
	}
	// Restore exactly one space at every run-INTERNAL boundary whose whitespace
	// was stripped as indentation. Run edges keep the strip.
	for i := 1; i < len(segs); i++ {
		if !segs[i-1].padR && !segs[i].padL {
			continue
		}
		switch {
		case segs[i-1].static:
			segs[i-1].text += " "
		case segs[i].static:
			segs[i].text = " " + segs[i].text
		default:
			segs[i].gap = true
		}
	}
	// A sibling node breaks the run without ending the line of prose, so a
	// stripped edge that borders one is padded exactly like an internal
	// boundary. Only the parent's edges keep the strip.
	trailGap := false
	if leftSibling && (leadPad || segs[0].padL) {
		if segs[0].static {
			segs[0].text = " " + segs[0].text
		} else {
			segs[0].gap = true
		}
	}
	if rightSibling && segs[len(segs)-1].padR {
		last := len(segs) - 1
		if segs[last].static {
			segs[last].text += " "
		} else {
			trailGap = true
		}
	}
	parts := make([]string, 0, len(segs)+2)
	for _, s := range segs {
		if s.gap {
			parts = append(parts, "' '")
		}
		if s.static {
			parts = append(parts, jsString(s.text))
		} else {
			parts = append(parts, s.js)
		}
	}
	if trailGap {
		parts = append(parts, "' '")
	}
	return strings.Join(parts, " + "), true, nil
}

// displayValue emits the one shared display-coercion call. The raw expression
// name reaches development builds for an actionable undefined warning, while
// the bundle-time define folds the argument to 0 in production and lets esbuild
// remove the name completely.
func (c *compiler) displayValue(expr, source string) string {
	c.usesDisplayValue = true
	label := jsString(strings.TrimSpace(source))
	return "__s(" + expr + ", typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__ ? " + label + " : 0)"
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
//
// An empty chain returns base untouched and records nothing: c.usesFormatters
// gates the `const __f` line, so only a real formatter call pays for the
// registry read.
func (c *compiler) applyFormatters(base string, fmts []parser.FormatterCall, scope scopeMap, facts *exprFacts) string {
	if len(fmts) == 0 {
		return base
	}
	c.usesFormatters = true
	out := base
	for _, fc := range fmts {
		if facts != nil && clockFormatters[fc.Name] {
			// A built-in that reads the clock is not a pure function of its
			// input, so a cached row would freeze its output (D170 volatile).
			facts.volatileRead = true
		}
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
			arg := resolveValueScan(a, scope, facts)
			b.WriteString(arg)
		}
		b.WriteString(")")
		out = b.String()
	}
	return out
}

// resolveInterpBase resolves an interpolation's base expression into facts. A
// FORMATTER PIPE makes a whole-value read of a loop local OPAQUE: the formatter
// is handed the record itself and may read anything off it (`{ post |
// authorName }` reaching `post.author.name`), which the row revision cannot
// cover, so the site goes conservative exactly as a relation read makes it.
// `{ post }` alone — the display of the record — stays on identity.
func (c *compiler) resolveInterpBase(expr string, fmts []parser.FormatterCall, scope scopeMap, facts *exprFacts) string {
	if facts == nil || len(fmts) == 0 {
		return resolveValueScan(expr, scope, facts)
	}
	sub := &exprFacts{}
	out := resolveValueScan(expr, scope, sub)
	for _, read := range sub.locals {
		if read.whole {
			read.opaque = true
		}
	}
	facts.merge(sub)
	return out
}

// resolveChain resolves a value position's base expression and applies its
// formatter chain. Every position that takes a chain (D173 V1) emits through
// it: text and quoted-attribute interpolations, brace-only attributes, props
// and marker arguments, and the `{#if}`/`{#unless}`/`{#case}` subjects. An
// empty chain emits exactly what resolving the expression alone would.
func (c *compiler) resolveChain(expr string, fmts []parser.FormatterCall, scope scopeMap, facts *exprFacts) string {
	return c.applyFormatters(c.resolveInterpBase(expr, fmts, scope, facts), fmts, scope, facts)
}

// resolveValue is resolveChain with the emitter's fact sink, the chained form
// of c.resolve.
func (c *compiler) resolveValue(expr string, fmts []parser.FormatterCall, scope scopeMap) string {
	f := c.factSink()
	out := c.resolveChain(expr, fmts, scope, f)
	c.absorb(f, scope)
	return out
}

var wsRun = regexp.MustCompile(`[ \t\r\n]+`)

// processText applies the whitespace policy to one Text node's value. See the
// package doc for the exact rule. Returns ("", false) when the node is dropped.
// padL/padR report that a leading/trailing space WAS stripped, so a run-internal
// boundary at that edge still separates words (see the package doc). A dropped
// whitespace-only node reports both.
func processText(raw string) (s string, keep, padL, padR bool) {
	if strings.TrimSpace(raw) == "" {
		if strings.ContainsAny(raw, "\n\r") {
			return "", false, true, true
		}
		return " ", true, false, false
	}
	leadingNL := leadingWSHasNewline(raw)
	trailingNL := trailingWSHasNewline(raw)
	s = wsRun.ReplaceAllString(raw, " ")
	if leadingNL && strings.HasPrefix(s, " ") {
		s, padL = s[1:], true
	}
	if trailingNL && strings.HasSuffix(s, " ") {
		s, padR = s[:len(s)-1], true
	}
	if s == "" {
		return "", false, padL, padR
	}
	return s, true, padL, padR
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

// hasPortal reports whether any <Portal> appears in the tree (→ PORTAL_TAG
// import). Mirrors hasSlot's shape.
func hasPortal(nodes []parser.Node) bool {
	for _, n := range nodes {
		switch t := n.(type) {
		case *parser.Portal:
			return true
		case *parser.Slot:
			if hasPortal(t.Children) {
				return true
			}
		case *parser.Snippet:
			if hasPortal(t.Body) {
				return true
			}
		case *parser.Element:
			if hasPortal(t.Children) {
				return true
			}
		case *parser.Component:
			if hasPortal(t.Children) {
				return true
			}
		case *parser.If:
			if hasPortal(t.Then) || hasPortal(t.Else) {
				return true
			}
		case *parser.For:
			if hasPortal(t.Body) {
				return true
			}
		case *parser.Case:
			for _, cl := range t.Clauses {
				if hasPortal(cl.Body) {
					return true
				}
			}
			if hasPortal(t.Else) {
				return true
			}
		}
	}
	return false
}

// hasSlot reports whether any composition marker (<Children/> or <Slot/>) appears
// in the tree (→ SLOT_TAG import). Both reserved tags parse as *parser.Slot.
func hasSlot(nodes []parser.Node) bool {
	for _, n := range nodes {
		switch t := n.(type) {
		case *parser.Slot:
			return true
		case *parser.Portal:
			if hasSlot(t.Children) {
				return true
			}
		case *parser.Snippet:
			if hasSlot(t.Body) {
				return true
			}
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

// hasSnippet reports whether any <Snippet> marker appears in the tree
// (→ SNIPPET_TAG import). Every ordinary child-bearing node recurses so a
// marker at any legal call-site depth retains the import.
func hasSnippet(nodes []parser.Node) bool {
	for _, n := range nodes {
		switch t := n.(type) {
		case *parser.Snippet:
			return true
		case *parser.Slot:
			if hasSnippet(t.Children) {
				return true
			}
		case *parser.Portal:
			if hasSnippet(t.Children) {
				return true
			}
		case *parser.Element:
			if hasSnippet(t.Children) {
				return true
			}
		case *parser.Component:
			if hasSnippet(t.Children) {
				return true
			}
		case *parser.If:
			if hasSnippet(t.Then) || hasSnippet(t.Else) {
				return true
			}
		case *parser.For:
			if hasSnippet(t.Body) {
				return true
			}
		case *parser.Case:
			for _, cl := range t.Clauses {
				if hasSnippet(cl.Body) {
					return true
				}
			}
			if hasSnippet(t.Else) {
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

// scopeAdd binds name as an ordinary lexical name (emitted bare).
func scopeAdd(scope scopeMap, name string) scopeMap {
	return scopeAddAs(scope, name, "")
}

// scopeAddAs binds name to the JS it resolves to — "" for an ordinary binding,
// or a rewrite such as "s.item" for a lowered {#for} row local (the D170
// emission contract).
func scopeAddAs(scope scopeMap, name, js string) scopeMap {
	out := cloneScope(scope)
	if name != "" {
		out[name] = js
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
