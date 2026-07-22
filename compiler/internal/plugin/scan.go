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

// ScanFormatters walks scanRoot for .pzl files, parses templates, and returns
// the built-in formatter names used by interpolation formatter chains.
//
// The scan deliberately errs toward OVER-inclusion: it walks the whole project
// (not just app/) so a component imported from a sibling directory still
// contributes its formatters, and it SKIPS files it cannot read or parse rather
// than failing. Rationale: a superset of formatters only bloats the bundle,
// whereas a missing one is seeded nowhere. Since v1.12 (D43) an unseeded builtin
// no longer crashes the render — codegen wraps every call in the __missing
// typo-guard, so the value passes through with a console.error — but the scan
// still seeds every USED builtin so the guard stays a *typo* guard, not a
// bundling crutch: correctly-spelled builtins must resolve to the real formatter,
// not the pass-through. A genuinely broken .pzl that the app actually imports is
// still reported — with position info — by the esbuild .pzl OnLoad pass; the scan
// must not preempt that by failing the build over a file nothing imports. See
// DOC-COMPILER-DESIGN §b.
func ScanFormatters(scanRoot string) (map[string]bool, error) {
	allow, err := builtinAllowlist()
	if err != nil {
		return nil, err
	}

	used := map[string]bool{}
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
		if filepath.Ext(path) != ".pzl" {
			return nil
		}

		src, err := os.ReadFile(path)
		if err != nil {
			return nil // unreadable file: skip, don't fail the scan
		}
		if strings.TrimSpace(string(src)) == "" {
			return nil
		}
		name := filepath.ToSlash(path)
		if rel, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(rel, "..") {
			name = filepath.ToSlash(rel)
		}

		sec, err := parser.SplitSections(string(src), name)
		if err != nil {
			return nil // unparseable: skip; esbuild OnLoad reports it if imported
		}
		tree, err := parser.ParseTemplate(sec, name)
		if err != nil {
			return nil
		}
		collectFormatters(tree, used, allow)
		// Codegen also emits formatter calls inside renderSkeleton() for the
		// <puzzle-skeleton> section, so a builtin used ONLY in a skeleton must be
		// seeded too — else the runtime logs `unknown formatter` and shows the raw
		// value. Parse the skeleton with the same fail-soft handling as the template.
		if sec.HasSkeleton {
			if skel, serr := parser.ParseSkeleton(sec, name); serr == nil && skel != nil {
				collectFormatters(skel, used, allow)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return used, nil
}

// skipScanDir reports whether a directory should be pruned from the formatter
// scan: build output, VCS/vendor trees, and dot-directories hold no first-party
// .pzl sources worth scanning (installed .pzl component packages are out of
// scope for v1 — see ScanFormatters).
func skipScanDir(name string) bool {
	switch name {
	case "node_modules", "dist", "build", "vendor":
		return true
	}
	return strings.HasPrefix(name, ".")
}

func collectFormatters(n parser.Node, used, allow map[string]bool) {
	switch node := n.(type) {
	case *parser.Element:
		collectAttrFormatters(node.Attrs, used, allow)
		for _, child := range node.Children {
			collectFormatters(child, used, allow)
		}
	case *parser.Component:
		collectAttrFormatters(node.Props, used, allow)
		for _, child := range node.Children {
			collectFormatters(child, used, allow)
		}
	case *parser.Interpolation:
		collectFormatterCalls(node.Formatters, used, allow)
	case *parser.If:
		for _, child := range node.Then {
			collectFormatters(child, used, allow)
		}
		for _, child := range node.Else {
			collectFormatters(child, used, allow)
		}
	case *parser.Case:
		for _, clause := range node.Clauses {
			for _, child := range clause.Body {
				collectFormatters(child, used, allow)
			}
		}
		for _, child := range node.Else {
			collectFormatters(child, used, allow)
		}
	case *parser.For:
		for _, child := range node.Body {
			collectFormatters(child, used, allow)
		}
	}
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
