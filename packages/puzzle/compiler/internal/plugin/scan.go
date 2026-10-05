package plugin

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	runtimeformatters "github.com/magic-spells/puzzle/client-runtime/formatters"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

var (
	builtinOnce  sync.Once
	builtinNames []string
	builtinErr   error
)

func builtinFormatterNames() ([]string, error) {
	builtinOnce.Do(func() {
		builtinErr = json.Unmarshal(runtimeformatters.BuiltinsJSON, &builtinNames)
		if builtinErr != nil {
			builtinErr = fmt.Errorf("parsing formatter builtins allowlist: %w", builtinErr)
		}
	})
	if builtinErr != nil {
		return nil, builtinErr
	}
	return builtinNames, nil
}

func builtinAllowlist() (map[string]bool, error) {
	names, err := builtinFormatterNames()
	if err != nil {
		return nil, err
	}
	allow := make(map[string]bool, len(names))
	for _, name := range names {
		allow[name] = true
	}
	return allow, nil
}

// Usage is the build-wide feature set discovered by ScanUsage.
type Usage struct {
	Formatters  map[string]bool
	HasFlip     bool
	HasPortal   bool
	HasRawAt    bool
	HasSnippets bool
	// HasRawHTML: a template calls `raw` or `newline_to_br` (D174) as a text
	// interpolation's outermost call, which keeps the live-HTML node and the
	// sanitizer in the bundle.
	HasRawHTML bool
	// HasRawSanitize: one of those is `raw` itself, which keeps the sanitizer;
	// an app that only uses `newline_to_br` does not ship it.
	HasRawSanitize bool
	// HasLazy is the one bit that does NOT come from a template: lazy() route
	// views (D163) are declared in the app's JavaScript/TypeScript, so the walk
	// reads those files too (see scanScriptUsage).
	HasLazy bool
	// TKeys maps each string-literal key handed straight to `t` (D175) —
	// `t('cart.title')` — to the app-relative files that use it, for the build's missing-key warning. It
	// is diagnostics only and never feeds a define.
	TKeys map[string][]string
	// RootHrefs are the literal root-relative `href`s on <a>/<area> (D177), in
	// walk order. Always collected — the scan cannot see the config — and printed
	// by the build only under prefix routing. Diagnostics only.
	RootHrefs []RootHref
}

// RootHref is one literal root-relative link: `href="/about"`, or a mixed value
// whose literal head is root-relative (`href="/blog/{ slug }"`, Mixed set and
// Href holding that head). Position is the attribute's, in file coordinates.
type RootHref struct {
	File      string
	Line, Col int
	Href      string
	Mixed     bool
}

// UsesT reports whether any template calls the `t` function.
func (u Usage) UsesT() bool {
	return u.Formatters[TranslateFormatter]
}

// Features are the build-wide DCE bits — one boolean per gated runtime module —
// handed to esbuild as literal defines. Kept as a comparable struct so
// WatchBuilder can decide with one == whether the Define set frozen into its
// esbuild context went stale.
type Features struct {
	Flip        bool
	Portal      bool
	RawAt       bool
	Lazy        bool
	Snippets    bool
	RawHTML     bool
	RawSanitize bool
}

// Features projects the scan result onto the define bits. It is exported for
// the long-lived builders, which hold a Usage directly and have to decide
// whether the Defines frozen into an esbuild context went stale.
func (u Usage) Features() Features {
	return Features{
		Flip:        u.HasFlip,
		Portal:      u.HasPortal,
		RawAt:       u.HasRawAt,
		Lazy:        u.HasLazy,
		Snippets:    u.HasSnippets,
		RawHTML:     u.HasRawHTML,
		RawSanitize: u.HasRawSanitize,
	}
}

// ScanUsage walks scanRoot for first-party source usage that controls runtime
// tree-shaking. Two kinds of file contribute:
//
//   - .pzl templates are fully parsed for library function calls, flip
//     attributes, Portal nodes, and raw blocks — all TEMPLATE facts.
//   - .js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx modules are read as TEXT and pattern-
//     matched for lazy() route views (D163). That is a SCRIPT fact — `lazy()` is
//     called from routes.js, never from a template — so it is the one bit a
//     template parse could never see. The match is deliberately loose (see
//     scanScriptUsage); the cost of a false positive is one small module left in
//     the bundle, and .pzl script sections are covered because a .pzl is read
//     whole before it is split.
//
// The scan deliberately errs toward OVER-inclusion: it walks the whole project
// (not just app/) so a component imported from a sibling directory still
// contributes its usage, and it SKIPS files it cannot read or parse rather than
// failing. Rationale: a false positive only leaves a small runtime module in the
// bundle, whereas a false negative silently removes a used feature. Since v1.12
// (D43) an unseeded builtin no longer crashes the render — codegen wraps every
// call in the __missing typo-guard, so the value passes through with a
// console.error — but the scan still seeds every USED builtin so the guard stays
// a *typo* guard, not a bundling crutch: correctly-spelled builtins must resolve
// to the real formatter, not the pass-through. A genuinely broken .pzl that the
// app actually imports is still reported — with position info — by the esbuild
// .pzl OnLoad pass; the scan must not preempt that by failing the build over a
// file nothing imports. See DOC-COMPILER-DESIGN §b.
//
// A long-lived dev builder calls UsageScanner.Scan (scanmemo.go) instead, which
// is this same walk with a per-file memo in front of the parse; both share
// scanFileUsage so they cannot answer differently.
func ScanUsage(scanRoot string) (Usage, error) {
	return NewUsageScanner().Scan(scanRoot)
}

// ScanFormatters preserves the original formatter-only API for focused callers
// and tests. Build orchestration uses ScanUsage so every tree-shaking input is
// refreshed together.
func ScanFormatters(scanRoot string) (map[string]bool, error) {
	usage, err := ScanUsage(scanRoot)
	if err != nil {
		return nil, err
	}
	return usage.Formatters, nil
}

// lazyCallRe matches a call to something NAMED lazy — `lazy(`, `lazy (`, and
// `puzzle.lazy(` all count. It cannot match `lazyLoad(`, `isLazy(` or
// `app_lazy(`: the `\b` and the immediate `(` pin the token exactly.
var lazyCallRe = regexp.MustCompile(`\blazy\s*\(`)

// puzzleImportRe matches the binding clause of an `import`/`export … from
// '@magic-spells/puzzle'` statement, so a renamed binding
// (`import { lazy as page } from …`) is still recognised as lazy usage even
// though `page(` never looks like a lazy call. The clause of a module statement
// contains no quote or semicolon, so excluding both keeps the match inside one
// statement without needing a real parser. The captured clause is also what
// scanScriptUsage tests for a `*` — the whole-namespace shape.
var puzzleImportRe = regexp.MustCompile(`(?s)\b(?:import|export)\b([^;'"]*)\bfrom\s*['"]@magic-spells/puzzle['"]`)

var lazyIdentRe = regexp.MustCompile(`\blazy\b`)

// IsScanInput reports whether the usage walk READS this path — a `.pzl`
// template or a script module. It is the single source of truth for that
// question: the walk itself uses it, and so does the dev/watch builder deciding
// whether a batch of changed files can move a usage bit. Those two must never
// disagree, or a mid-session edit to a file the walk reads would rebuild against
// a stale, frozen Define set (see build.pathsHaveScanInput).
func IsScanInput(path string) bool {
	ext := filepath.Ext(path)
	return ext == ".pzl" || scriptScanExts[ext]
}

// scriptScanExts are the source extensions read as TEXT for script-level usage.
// .pzl is not here — a template file is read and parsed by scanFileUsage, which
// runs the same text match over its whole source so a `lazy()` call inside a
// .pzl <script> section counts too.
var scriptScanExts = map[string]bool{
	".js":  true,
	".mjs": true,
	".cjs": true,
	".jsx": true,
	".ts":  true,
	".mts": true,
	".cts": true,
	".tsx": true,
}

// scanScriptUsage answers the script-level feature questions from a file's raw
// bytes. Today that is one bit: does this module use D163 `lazy()` route views?
//
// Detection is regex-level ON PURPOSE. The compiler never parses script bodies
// (a public invariant — .pzl scripts are real JS/TS bytes Go does not rewrite),
// and the bias here is the same as the rest of the scan: a false positive
// leaves ~0.6 KB gzip of resolver in a bundle that does not need it, while a
// false negative compiles the resolver OUT of an app that does, breaking every
// lazy route. So two independent rules both count, and either one is enough:
//
//   - a `lazy(`-shaped call anywhere in the file, however the name was obtained
//     (bare import, namespace import, dynamic import destructuring);
//   - a `lazy` specifier in an import/export clause from '@magic-spells/puzzle',
//     which covers the renamed binding a call-shape match cannot see;
//   - a WHOLE-NAMESPACE clause from '@magic-spells/puzzle' —
//     `import * as puzzle from …` or `export * from …`. Neither statement names
//     lazy, and a binding taken off the namespace object by any route other than
//     a `lazy(`-shaped call is invisible to both rules above:
//     `const { lazy: page } = puzzle` then calls `page(`, and a star re-export
//     hands the name to another module that may rename it on the way in. A
//     namespace importer that never touches lazy pays ~0.6 KB gzip for a
//     resolver it does not use; the other side of the trade is an app whose
//     lazy routes throw "lazy support was compiled out" at route-table
//     validation, so the scan takes the bytes.
func scanScriptUsage(src string, usage *fileUsage) {
	if lazyCallRe.MatchString(src) {
		usage.hasLazy = true
		return
	}
	for _, m := range puzzleImportRe.FindAllStringSubmatch(src, -1) {
		if lazyIdentRe.MatchString(m[1]) || strings.Contains(m[1], "*") {
			usage.hasLazy = true
			return
		}
	}
}

// skipScanDir reports whether a directory should be pruned from the usage scan:
// installed packages, build output, vendor trees, and dot-directories hold no
// first-party source worth scanning (installed .pzl component packages are out
// of scope for v1 — see ScanUsage). node_modules and dot-directories are pruned
// at any depth; `dist`, `build` and `vendor` only directly under the scan root
// (atRoot), because deeper down a folder of that name is the app's own source —
// pruning app/components/vendor/ compiled `raw` and its formatters out of a
// component the app renders.
func skipScanDir(name string, atRoot bool) bool {
	switch name {
	case "node_modules":
		return true
	case "dist", "build", "vendor":
		return atRoot
	}
	return strings.HasPrefix(name, ".")
}

func collectUsage(n parser.Node, usage *Usage, allow map[string]bool) {
	switch node := n.(type) {
	case *parser.Element:
		if node.ContainsRaw {
			// Deliberately over-inclusive: any raw block keeps the D150 literal-@
			// attribute shim. A false negative would send an authored `@x` name to
			// setAttribute(), which throws; a false positive costs only the shim.
			usage.HasRawAt = true
		}
		if hasFlipAttr(node.Attrs) {
			usage.HasFlip = true
		}
		collectAttrCalls(node.Attrs, usage, allow)
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Component:
		// Components carry `flip` too: a component vnode's PROPS are its attrs
		// (ViewNode `get props()` aliases `attrs`), so the keyed patcher's
		// `'flip' in newChild.attrs` fast path fires for `<PostCard … flip>`
		// exactly as it does for a plain element. Missing this would emit
		// __PUZZLE_HAS_FLIP__=false for an app whose only flip rows are
		// components (examples/blog), silently dropping flip.js and killing the
		// animation — the false NEGATIVE this scan must never produce.
		if hasFlipAttr(node.Props) {
			usage.HasFlip = true
		}
		collectAttrCalls(node.Props, usage, allow)
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Slot:
		if len(node.Args) > 0 {
			usage.HasSnippets = true
			collectAttrCalls(node.Args, usage, allow)
		}
		// Fallback bodies compile through the ordinary child-emission path, so
		// build-wide function/feature discovery must descend into them too.
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Snippet:
		usage.HasSnippets = true
		for _, child := range node.Body {
			collectUsage(child, usage, allow)
		}
	case *parser.Portal:
		usage.HasPortal = true
		// Portaled children are ordinary compiled content — same discovery.
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Interpolation:
		collectExprCalls(node.ExprAST, nil, usage, allow)
	case *parser.If:
		collectExprCalls(node.CondAST, nil, usage, allow)
		for _, child := range node.Then {
			collectUsage(child, usage, allow)
		}
		for _, child := range node.Else {
			collectUsage(child, usage, allow)
		}
	case *parser.Case:
		collectExprCalls(node.ExprAST, nil, usage, allow)
		for _, clause := range node.Clauses {
			for _, v := range clause.ValuesAST {
				collectExprCalls(v, nil, usage, allow)
			}
			for _, child := range clause.Body {
				collectUsage(child, usage, allow)
			}
		}
		for _, child := range node.Else {
			collectUsage(child, usage, allow)
		}
	case *parser.For:
		for _, e := range []expr.Node{node.CollectionAST, node.RangeFromAST, node.RangeToAST} {
			collectExprCalls(e, nil, usage, allow)
		}
		for _, child := range node.Body {
			collectUsage(child, usage, allow)
		}
	}
}

// hasFlipAttr reports whether any attribute/prop in the list is the D85 `flip`
// directive — bare (`flip`), dynamic (`flip={ … }`), or interpolated. Used for
// BOTH element attrs and component props: the runtime keyed patcher tests
// `'flip' in newChild.attrs`, and a component vnode's props ARE its attrs.
func hasFlipAttr(attrs []parser.Attr) bool {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.StaticAttr:
			if a.Name == "flip" {
				return true
			}
		case *parser.DynamicAttr:
			if a.Name == "flip" {
				return true
			}
		case *parser.MixedAttr:
			if a.Name == "flip" {
				return true
			}
		}
	}
	return false
}

func collectAttrCalls(attrs []parser.Attr, usage *Usage, allow map[string]bool) {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.MixedAttr:
			collectPartCalls(a.Parts, usage, allow)
		case *parser.DynamicAttr:
			// A brace-only attribute, prop or marker argument.
			collectExprCalls(a.ExprAST, nil, usage, allow)
		case *parser.EventAttr:
			// The handler's own call names a view handler, never the library
			// (§9 c); calls inside its arguments and its condition are library
			// calls, compiled into render().
			collectExprCalls(a.ExprAST, handlerOwnCalls(a.ExprAST), usage, allow)
		}
	}
}

// handlerOwnCalls returns the calls of an @event value that name a view
// handler: the calls among its handler forms (codegen.HandlerForms).
func handlerOwnCalls(n expr.Node) map[*expr.Call]bool {
	own := map[*expr.Call]bool{}
	for _, f := range codegen.HandlerForms(n) {
		if call, ok := f.(*expr.Call); ok {
			own[call] = true
		}
	}
	return own
}

func collectPartCalls(parts []parser.Part, usage *Usage, allow map[string]bool) {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				collectExprCalls(p.Interp.ExprAST, nil, usage, allow)
			}
		case *parser.InlineIfPart:
			collectExprCalls(p.CondAST, nil, usage, allow)
			collectPartCalls(p.Then, usage, allow)
			collectPartCalls(p.Else, usage, allow)
		}
	}
}

// collectExprCalls records every library function a tree calls — a Call whose
// callee is a bare name, skipping the calls in skip (an event handler's own
// call). A markup function anywhere keeps the live-HTML runtime (D174): codegen
// rejects every placement but the outermost call of a text interpolation, so
// only a file that fails to compile can over-include here.
func collectExprCalls(n expr.Node, skip map[*expr.Call]bool, usage *Usage, allow map[string]bool) {
	if n == nil {
		return
	}
	expr.Walk(n, func(n expr.Node) bool {
		call, ok := n.(*expr.Call)
		if !ok || skip[call] {
			return true
		}
		if id, ok := call.Callee.(*expr.Identifier); ok {
			noteFunction(id.Name, usage, allow)
		}
		return true
	})
}

// noteFunction records one library function name.
func noteFunction(name string, usage *Usage, allow map[string]bool) {
	// The markup pair never reaches the registry: codegen lowers it to the
	// live-HTML node (D174), so it has no place in the function manifest.
	if codegen.IsMarkupFormatter(name) {
		usage.HasRawHTML = true
		if name == "raw" {
			usage.HasRawSanitize = true
		}
		return
	}
	// `t` is service-bound (D175), never a manifest builtin, but the build
	// still needs to know it is used: `t` without i18n configured is a build
	// warning. The manifest only ever emits allowlisted names, so recording it
	// is inert there.
	if allow[name] || name == TranslateFormatter {
		usage.Formatters[name] = true
	}
}

// TranslateFormatter is the D175 translation function's name.
const TranslateFormatter = "t"

// collectTKeys records every STRING-LITERAL key handed straight to `t` —
// `t('cart.title')` — for the build's "key missing from the default locale"
// warning (D175). Runtime-built keys
// (`t('status.' + s)`) are not checkable and are skipped. It is its own walk
// rather than a thread through collectUsage so the function-union walk keeps
// its narrow shape.
func collectTKeys(nodes []parser.Node, keys map[string]bool) {
	for _, n := range nodes {
		switch node := n.(type) {
		case *parser.Element:
			collectAttrTKeys(node.Attrs, keys)
			collectTKeys(node.Children, keys)
		case *parser.Component:
			collectAttrTKeys(node.Props, keys)
			collectTKeys(node.Children, keys)
		case *parser.Slot:
			collectAttrTKeys(node.Args, keys)
			collectTKeys(node.Children, keys)
		case *parser.Snippet:
			collectTKeys(node.Body, keys)
		case *parser.Portal:
			collectTKeys(node.Children, keys)
		case *parser.Interpolation:
			exprTKeys(node.ExprAST, keys)
		case *parser.If:
			exprTKeys(node.CondAST, keys)
			collectTKeys(node.Then, keys)
			collectTKeys(node.Else, keys)
		case *parser.Case:
			exprTKeys(node.ExprAST, keys)
			for _, clause := range node.Clauses {
				for _, v := range clause.ValuesAST {
					exprTKeys(v, keys)
				}
				collectTKeys(clause.Body, keys)
			}
			collectTKeys(node.Else, keys)
		case *parser.For:
			for _, e := range []expr.Node{node.CollectionAST, node.RangeFromAST, node.RangeToAST} {
				exprTKeys(e, keys)
			}
			collectTKeys(node.Body, keys)
		}
	}
}

func collectAttrTKeys(attrs []parser.Attr, keys map[string]bool) {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.MixedAttr:
			collectPartTKeys(a.Parts, keys)
		case *parser.DynamicAttr:
			exprTKeys(a.ExprAST, keys)
		case *parser.EventAttr:
			exprTKeysSkipping(a.ExprAST, handlerOwnCalls(a.ExprAST), keys)
		}
	}
}

func collectPartTKeys(parts []parser.Part, keys map[string]bool) {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				exprTKeys(p.Interp.ExprAST, keys)
			}
		case *parser.InlineIfPart:
			exprTKeys(p.CondAST, keys)
			collectPartTKeys(p.Then, keys)
			collectPartTKeys(p.Else, keys)
		}
	}
}

func exprTKeys(n expr.Node, keys map[string]bool) { exprTKeysSkipping(n, nil, keys) }

// collectRootHrefs records every literal root-relative `href` on an <a> or
// <area> (D177's build warning): under prefix routing such a link skips the
// locale prefix and sends every viewer to the default language. Skipped: a
// fully dynamic value (no literal to judge), a protocol-relative `//host`, a
// literal whose last path segment has a file extension (a file that exists once,
// where the default URL is the right one), and authored literal markup ({#raw}),
// where link() cannot be written. Like collectTKeys it is its own walk.
func collectRootHrefs(nodes []parser.Node, out *[]RootHref) {
	for _, n := range nodes {
		switch node := n.(type) {
		case *parser.Element:
			if node.Tag == "a" || node.Tag == "area" {
				for _, attr := range node.Attrs {
					if h, ok := rootHref(attr); ok {
						*out = append(*out, h)
					}
				}
			}
			collectRootHrefs(node.Children, out)
		case *parser.Component:
			collectRootHrefs(node.Children, out)
		case *parser.Slot:
			collectRootHrefs(node.Children, out)
		case *parser.Snippet:
			collectRootHrefs(node.Body, out)
		case *parser.Portal:
			collectRootHrefs(node.Children, out)
		case *parser.If:
			collectRootHrefs(node.Then, out)
			collectRootHrefs(node.Else, out)
		case *parser.Case:
			for _, clause := range node.Clauses {
				collectRootHrefs(clause.Body, out)
			}
			collectRootHrefs(node.Else, out)
		case *parser.For:
			collectRootHrefs(node.Body, out)
		}
	}
}

// rootHref reports whether attr is a literal root-relative href worth warning
// about, and the entry to record (File is filled in by the caller's file).
func rootHref(attr parser.Attr) (RootHref, bool) {
	switch a := attr.(type) {
	case *parser.StaticAttr:
		if a.Name != "href" || a.Valueless || a.LiteralName || !isRootRelative(a.Value) || hasFileExtension(a.Value) {
			return RootHref{}, false
		}
		return RootHref{Line: a.Pos.Line, Col: a.Pos.Col, Href: a.Value}, true
	case *parser.MixedAttr:
		if a.Name != "href" || len(a.Parts) == 0 {
			return RootHref{}, false
		}
		head, ok := a.Parts[0].(*parser.StaticPart)
		if !ok || !isRootRelative(head.Text) {
			return RootHref{}, false
		}
		if hasFileExtension(mixedPathTail(a.Parts)) {
			return RootHref{}, false
		}
		return RootHref{Line: a.Pos.Line, Col: a.Pos.Col, Href: head.Text, Mixed: true}, true
	}
	return RootHref{}, false
}

// mixedPathTail returns the static text that ends a mixed value's PATH, for the
// extension check: the static part that opens the query or fragment, cut at its
// `?`/`#` (empty when the path itself ends in an expression), else the last
// static part. `/files/{ n }.pdf?v={ q }` gives `.pdf`, which the value's final
// part — an expression — never shows.
func mixedPathTail(parts []parser.Part) string {
	tail := ""
	for _, part := range parts {
		p, ok := part.(*parser.StaticPart)
		if !ok {
			tail = ""
			continue
		}
		if i := strings.IndexAny(p.Text, "?#"); i >= 0 {
			return p.Text[:i]
		}
		tail = p.Text
	}
	return tail
}

// isRootRelative: starts with one `/`, not `//` or `/\` (both protocol-relative
// to a browser).
func isRootRelative(v string) bool {
	return strings.HasPrefix(v, "/") && !strings.HasPrefix(v, "//") && !strings.HasPrefix(v, `/\`)
}

// hasFileExtension reports whether v's last path segment (query and fragment
// dropped) ends in a dot and one or more letters or digits — `/files/resume.pdf`,
// or the `.pdf` tail of `/files/{ name }.pdf`. A heuristic that only quiets the
// warning, so a wrong guess costs one missed warning, never a broken link.
func hasFileExtension(v string) bool {
	if i := strings.IndexAny(v, "?#"); i >= 0 {
		v = v[:i]
	}
	seg := v[strings.LastIndexByte(v, '/')+1:]
	dot := strings.LastIndexByte(seg, '.')
	if dot < 0 || dot == len(seg)-1 {
		return false
	}
	for _, r := range seg[dot+1:] {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

// exprTKeysSkipping records the string-literal first argument of every `t`
// call in n, skipping the calls in skip (an event handler's own call).
func exprTKeysSkipping(n expr.Node, skip map[*expr.Call]bool, keys map[string]bool) {
	if n == nil {
		return
	}
	expr.Walk(n, func(n expr.Node) bool {
		call, ok := n.(*expr.Call)
		if !ok || skip[call] || len(call.Args) == 0 {
			return true
		}
		if id, ok := call.Callee.(*expr.Identifier); !ok || id.Name != TranslateFormatter {
			return true
		}
		if lit, ok := call.Args[0].(*expr.Literal); ok && lit.Kind == expr.LitString {
			keys[lit.Str] = true
		}
		return true
	})
}
