package plugin

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
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
	Formatters  map[string]bool
	HasFlip     bool
	HasHeadTags bool
}

// ScanUsage walks scanRoot for first-party source usage that controls runtime
// tree-shaking. It parses .pzl templates for formatter chains and flip
// attributes, and searches raw .js/.ts/.pzl bytes for managed-head field names.
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
func ScanUsage(scanRoot string) (Usage, error) {
	allow, err := builtinAllowlist()
	if err != nil {
		return Usage{}, err
	}

	usage := Usage{Formatters: map[string]bool{}}
	root := filepath.Clean(scanRoot)
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if path != root && skipScanDir(d.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if ext != ".js" && ext != ".ts" && ext != ".pzl" {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return nil // unreadable file: skip, don't fail the scan
		}
		raw := string(src)
		if strings.Contains(raw, "description") ||
			strings.Contains(raw, "canonical") ||
			strings.Contains(raw, "socialImage") {
			usage.HasHeadTags = true
		}
		if ext != ".pzl" {
			return nil
		}
		if strings.TrimSpace(string(src)) == "" {
			return nil
		}
		name := filepath.ToSlash(path)
		if rel, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(rel, "..") {
			name = filepath.ToSlash(rel)
		}

		sec, err := parser.SplitSections(raw, name)
		if err != nil {
			return nil // unparseable: skip; esbuild OnLoad reports it if imported
		}
		tree, err := parser.ParseTemplate(sec, name)
		if err != nil {
			return nil
		}
		collectUsage(tree, &usage, allow)
		// Codegen also emits formatter calls inside renderSkeleton() for the
		// <puzzle-skeleton> section, so a builtin used ONLY in a skeleton must be
		// seeded too — else the runtime logs `unknown formatter` and shows the raw
		// value. Parse the skeleton with the same fail-soft handling as the template.
		if sec.HasSkeleton {
			if skel, serr := parser.ParseSkeleton(sec, name); serr == nil && skel != nil {
				collectUsage(skel, &usage, allow)
			}
		}
		return nil
	})
	if err != nil {
		return Usage{}, err
	}
	return usage, nil
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
