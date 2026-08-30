package plugin

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	runtimeformatters "github.com/magic-spells/puzzle/client-runtime/formatters"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
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
	Formatters map[string]bool
	HasFlip    bool
	HasPortal  bool
	HasRawAt   bool
	// HasLazy is the one bit that does NOT come from a template: lazy() route
	// views (D163) are declared in the app's JavaScript/TypeScript, so the walk
	// reads those files too (see scanScriptUsage).
	HasLazy bool
}

// Features are the build-wide DCE bits — one boolean per gated runtime module —
// handed to esbuild as literal defines. Kept as a comparable struct so
// WatchBuilder can decide with one == whether the Define set frozen into its
// esbuild context went stale.
type Features struct {
	Flip   bool
	Portal bool
	RawAt  bool
	Lazy   bool
}

// Features projects the scan result onto the define bits. It is exported for
// the long-lived builders, which hold a Usage directly and have to decide
// whether the Defines frozen into an esbuild context went stale.
func (u Usage) Features() Features {
	return Features{
		Flip:   u.HasFlip,
		Portal: u.HasPortal,
		RawAt:  u.HasRawAt,
		Lazy:   u.HasLazy,
	}
}

// ScanUsage walks scanRoot for first-party source usage that controls runtime
// tree-shaking. Two kinds of file contribute:
//
//   - .pzl templates are fully parsed for formatter chains, flip attributes,
//     Portal nodes, and raw blocks — all TEMPLATE facts.
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
// statement without needing a real parser.
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
//     which covers the renamed binding a call-shape match cannot see.
func scanScriptUsage(src string, usage *fileUsage) {
	if lazyCallRe.MatchString(src) {
		usage.hasLazy = true
		return
	}
	for _, m := range puzzleImportRe.FindAllStringSubmatch(src, -1) {
		if lazyIdentRe.MatchString(m[1]) {
			usage.hasLazy = true
			return
		}
	}
}

// skipScanDir reports whether a directory should be pruned from the usage scan:
// build output, VCS/vendor trees, and dot-directories hold no first-party source
// worth scanning (installed .pzl component packages are out of scope for v1 —
// see ScanUsage).
func skipScanDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "vendor":
		return true
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
		collectAttrFormatters(node.Attrs, usage.Formatters, allow)
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
		collectAttrFormatters(node.Props, usage.Formatters, allow)
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Slot:
		// Fallback bodies compile through the ordinary child-emission path, so
		// build-wide formatter/feature discovery must descend into them too.
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Portal:
		usage.HasPortal = true
		// Portaled children are ordinary compiled content — same discovery.
		for _, child := range node.Children {
			collectUsage(child, usage, allow)
		}
	case *parser.Interpolation:
		collectFormatterCalls(node.Formatters, usage.Formatters, allow)
	case *parser.If:
		for _, child := range node.Then {
			collectUsage(child, usage, allow)
		}
		for _, child := range node.Else {
			collectUsage(child, usage, allow)
		}
	case *parser.Case:
		for _, clause := range node.Clauses {
			for _, child := range clause.Body {
				collectUsage(child, usage, allow)
			}
		}
		for _, child := range node.Else {
			collectUsage(child, usage, allow)
		}
	case *parser.For:
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

func collectAttrFormatters(attrs []parser.Attr, used, allow map[string]bool) {
	for _, attr := range attrs {
		if mixed, ok := attr.(*parser.MixedAttr); ok {
			collectPartFormatters(mixed.Parts, used, allow)
		}
	}
}

func collectPartFormatters(parts []parser.Part, used, allow map[string]bool) {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if p.Interp != nil {
				collectFormatterCalls(p.Interp.Formatters, used, allow)
			}
		case *parser.InlineIfPart:
			collectPartFormatters(p.Then, used, allow)
			collectPartFormatters(p.Else, used, allow)
		}
	}
}

func collectFormatterCalls(calls []parser.FormatterCall, used, allow map[string]bool) {
	for _, call := range calls {
		if allow[call.Name] {
			used[call.Name] = true
		}
	}
}
