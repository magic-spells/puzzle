// Package check emits virtual JavaScript and TypeScript files for .pzl files
// and runs the app's own tsc subprocess over them. It never imports or links
// against a TypeScript API.
package check

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

const shim = `/// <reference types="@magic-spells/puzzle/puzzle-env" />

import type { PuzzleView } from '@magic-spells/puzzle';

declare global {
  const Children: unique symbol;
  const Slot: unique symbol;
  const Portal: unique symbol;

  // The collection type is captured whole and destructured with a conditional
  // so that an untyped collection yields an ANY item, not an UNKNOWN one:
  // inferring T from a plain <T>(values: readonly T[]) parameter given an any
  // collection produces unknown, which would turn every read of a loop variable
  // over a data() value into a false positive until M2 types the data() merge.
  function __puzzle_check_each<C>(
    values: C,
    visit: (
      value: C extends readonly (infer T)[] ? T : any,
      index: number,
    ) => void,
  ): void;

  function __puzzle_check_range(
    from: number,
    to: number,
    visit: (value: number) => void,
  ): void;

  function __puzzle_check_formatter(
    name: string,
    value: any,
    ...args: any[]
  ): any;

  type __PuzzleCheckView = PuzzleView;
}

export {};
`

// Result describes the generated check workspace.
type Result struct {
	Dir    string
	Tables []*SegmentTable
	// Diagnostics are the already-positioned compile errors of .pzl files that
	// could not be emitted at all. They are collected rather than returned so one
	// unparsable file does not hide every type error in the rest of the app —
	// nothing links the virtual files to each other, so the remaining ones still
	// check correctly on their own.
	Diagnostics []string
	// Files is how many .pzl files the walk found, emitted or not.
	Files int
}

type virtualFile struct {
	GeneratedPath string
	Contents      []byte
	Table         *SegmentTable
}

// sourceDir returns the app/ directory to walk, with the error a user gets for
// running the command outside a Puzzle project rather than a bare stat failure.
func sourceDir(root string) (string, error) {
	dir := filepath.Join(root, "app")
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("no app/ directory in %s — run puzzle check from a Puzzle project root", root)
	}
	return dir, nil
}

// Generate rebuilds <appRoot>/.puzzle/check from the .pzl files under app/.
func Generate(appRoot string, typescriptMajor int) (*Result, error) {
	root, err := filepath.Abs(appRoot)
	if err != nil {
		return nil, err
	}
	appDir, err := sourceDir(root)
	if err != nil {
		return nil, err
	}
	checkDir := filepath.Join(root, ".puzzle", "check")
	if err := os.RemoveAll(checkDir); err != nil {
		return nil, fmt.Errorf("clear %s: %w", checkDir, err)
	}
	if err := os.MkdirAll(filepath.Join(checkDir, "src"), 0o755); err != nil {
		return nil, err
	}

	var files []string
	err = filepath.WalkDir(appDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(path), ".pzl") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)

	result := &Result{Dir: checkDir, Files: len(files)}
	for _, sourceFile := range files {
		rel, err := filepath.Rel(appDir, sourceFile)
		if err != nil {
			return nil, err
		}
		sourcePath := filepath.ToSlash(filepath.Join("app", rel))
		generatedBase := filepath.ToSlash(filepath.Join(".puzzle", "check", "src", rel))

		source, err := os.ReadFile(sourceFile)
		if err != nil {
			return nil, err
		}
		virtualFiles, err := emitFiles(source, sourcePath, generatedBase, filepath.Join(appDir, "assets"))
		if err != nil {
			result.Diagnostics = append(result.Diagnostics, err.Error())
			continue
		}
		for _, virtual := range virtualFiles {
			virtualPath := filepath.Join(root, filepath.FromSlash(virtual.GeneratedPath))
			if err := os.MkdirAll(filepath.Dir(virtualPath), 0o755); err != nil {
				return nil, err
			}
			if err := os.WriteFile(virtualPath, virtual.Contents, 0o644); err != nil {
				return nil, err
			}
			if err := writeSegmentTable(virtualPath+".segments.json", virtual.Table); err != nil {
				return nil, err
			}
			result.Tables = append(result.Tables, virtual.Table)
		}
	}

	if err := os.WriteFile(filepath.Join(checkDir, "puzzle-check.d.ts"), []byte(shim), 0o644); err != nil {
		return nil, err
	}
	config, err := tsconfig(root, typescriptMajor)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(checkDir, "tsconfig.json"), config, 0o644); err != nil {
		return nil, err
	}
	return result, nil
}

func tsconfig(appRoot string, typescriptMajor int) ([]byte, error) {
	_, err := os.Stat(filepath.Join(appRoot, "tsconfig.json"))
	hasAppConfig := err == nil
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	config := map[string]any{
		"compilerOptions": map[string]any{
			"allowJs":  true,
			"checkJs":  false,
			"noEmit":   true,
			"rootDirs": []string{"../../app", "./src"},
			// Everything below neutralizes an app tsconfig setting that would
			// otherwise turn `extends` into garbage diagnostics. Each one is a real
			// failure observed against tsc, not a precaution:
			//   rootDir      — an app rootDir of "app" makes every emitted file
			//                  "not under rootDir" (TS6059) and nothing is checked.
			//   composite    — a composite project may not disable emit.
			//   skipLibCheck — the shim pulls in the framework's .d.ts files; an app
			//                  config without a modern target/moduleResolution
			//                  reports errors inside them that the user cannot act
			//                  on and that carry no .pzl position.
			//   noUnused*    — the wrapper's synthetic bindings (a loop variable an
			//                  unused body never reads, __d in a template with no
			//                  expressions) are not authored code; flagging them
			//                  produces diagnostics with nothing to point at.
			"rootDir":            "../..",
			"composite":          false,
			"skipLibCheck":       true,
			"noUnusedLocals":     false,
			"noUnusedParameters": false,
		},
		// Extensions are spelled out rather than using src/**/*: an app that turns
		// on resolveJsonModule would otherwise pull every .segments.json sidecar
		// into the program as an input file.
		"include": []string{
			"src/**/*.ts",
			"src/**/*.js",
			"puzzle-check.d.ts",
			"../../app/**/*.ts",
			"../../app/**/*.js",
		},
		// `exclude` is inherited through `extends` with its paths rewritten
		// relative to THIS config, so an app that excludes its own build scratch
		// dirs (".puzzle" among them) would exclude the entire generated
		// workspace and tsc would fail with "No inputs were found".
		"exclude": []string{},
	}
	opts := config["compilerOptions"].(map[string]any)
	if typescriptMajor >= 7 {
		// JSON null deliberately clears either setting inherited from the app.
		// TypeScript 7 removed baseUrl and node10/node module resolution. Paths is
		// replaced too because targets inherited from a baseUrl config may be
		// non-relative, which is illegal once baseUrl is cleared.
		opts["baseUrl"] = nil
		opts["moduleResolution"] = nil
		opts["paths"] = map[string]any{"@/*": []string{"../../app/*"}}
	} else {
		// Before TypeScript 7, module: ESNext defaults to classic resolution. Keep
		// the proven node/baseUrl pair so package imports and the @ alias resolve
		// under the oldest supported compiler (4.9).
		opts["baseUrl"] = "../.."
		opts["moduleResolution"] = "node"
		opts["paths"] = map[string]any{"@/*": []string{"app/*"}}
	}
	if hasAppConfig {
		config["extends"] = "../../tsconfig.json"
	} else {
		opts["target"] = "ES2020"
		opts["module"] = "ESNext"
		opts["noImplicitAny"] = false
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

type emitter struct {
	b         *mappedBuilder
	source    string
	eventSite int
}

type sourceExpr struct {
	text   string
	offset int
}

func emitFiles(source []byte, sourcePath, generatedBase, assetsDir string) ([]virtualFile, error) {
	sec, err := parser.SplitSections(string(source), sourcePath)
	if err != nil {
		return nil, err
	}
	compiled, err := codegen.Compile(sec, codegen.Options{
		Filename:   sourcePath,
		Mode:       codegen.ModeForPath(sourcePath),
		ModulePath: sourcePath,
		AssetsDir:  assetsDir,
	})
	if err != nil {
		return nil, err
	}
	className, err := compiledClassName(compiled.JS)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", sourcePath, err)
	}
	root, err := parser.ParseTemplate(sec, sourcePath)
	if err != nil {
		return nil, err
	}
	skeleton, err := parser.ParseSkeleton(sec, sourcePath)
	if err != nil {
		return nil, err
	}

	if sec.ScriptsLang == "ts" {
		checked, err := emitCheckedFile(source, sourcePath, generatedBase+".ts", sec, root, skeleton, className, true, "")
		if err != nil {
			return nil, err
		}
		return []virtualFile{checked}, nil
	}

	// A .script infix prevents TypeScript's extension substitution from resolving
	// an import of the JS mirror back to the sibling .pzl.ts wrapper itself.
	mirror := emitJSMirror(source, sourcePath, generatedBase+".script.js", sec, className)
	importPath := "./" + filepath.Base(filepath.FromSlash(generatedBase)) + ".script.js"
	checked, err := emitCheckedFile(source, sourcePath, generatedBase+".ts", sec, root, skeleton, "__PuzzleCheckViewClass", false, importPath)
	if err != nil {
		return nil, err
	}
	return []virtualFile{mirror, checked}, nil
}

func emitJSMirror(source []byte, sourcePath, generatedPath string, sec *parser.Sections, className string) virtualFile {
	b := newMappedBuilder(sourcePath, generatedPath, source)
	if sec.Scripts != "" {
		b.WriteMapped(sec.Scripts, sec.ScriptsPos.Offset)
	}
	if strings.TrimSpace(sec.Scripts) == "" {
		if sec.Scripts != "" && !strings.HasSuffix(sec.Scripts, "\n") {
			b.WriteString("\n")
		}
		b.WriteString("import { PuzzleView } from '@magic-spells/puzzle';\n")
		b.WriteString("export default class " + className + " extends PuzzleView {}\n")
	}
	b.table.generatedBytes = []byte(b.String())
	b.table.sourceBytes = source
	return virtualFile{GeneratedPath: generatedPath, Contents: []byte(b.String()), Table: b.table}
}

func emitCheckedFile(
	source []byte,
	sourcePath string,
	generatedPath string,
	sec *parser.Sections,
	root *parser.Element,
	skeleton *parser.Element,
	className string,
	includeScript bool,
	importPath string,
) (virtualFile, error) {
	b := newMappedBuilder(sourcePath, generatedPath, source)
	if includeScript {
		if sec.Scripts != "" {
			b.WriteMapped(sec.Scripts, sec.ScriptsPos.Offset)
		}
		b.WriteString("\n")
	} else {
		b.WriteString("import " + className + " from " + strconv.Quote(importPath) + ";\n")
		b.WriteString("export default " + className + ";\n\n")
	}
	b.WriteString("// Generated by puzzle check. This function is never executed.\n")
	if includeScript && strings.TrimSpace(sec.Scripts) == "" {
		b.WriteString("declare const " + className + ": typeof import('@magic-spells/puzzle').PuzzleView;\n")
	}
	b.WriteString("void function (this: InstanceType<typeof " + className + "> & Record<string, any>): void {\n")
	b.WriteString("  const __d = this;\n")

	e := &emitter{b: b, source: string(source)}
	// The <puzzle-view> tag's own attributes are real bindings (they become the
	// root ViewNode's attributes), so they are checked like any other element's.
	if err := e.emitAttrs(root.Attrs, map[string]bool{}, 2); err != nil {
		return virtualFile{}, fmt.Errorf("%s: %w", sourcePath, err)
	}
	if err := e.emitNodes(root.Children, map[string]bool{}, 2); err != nil {
		return virtualFile{}, fmt.Errorf("%s: %w", sourcePath, err)
	}
	if skeleton != nil {
		b.WriteString("\n  // <puzzle-skeleton>\n")
		if err := e.emitNodes(skeleton.Children, map[string]bool{}, 2); err != nil {
			return virtualFile{}, fmt.Errorf("%s: %w", sourcePath, err)
		}
	}
	b.WriteString("};\n")
	b.table.generatedBytes = []byte(b.String())
	b.table.sourceBytes = source
	return virtualFile{GeneratedPath: generatedPath, Contents: []byte(b.String()), Table: b.table}, nil
}

func compiledClassName(js string) (string, error) {
	const marker = ".prototype.render = function () {"
	i := strings.LastIndex(js, marker)
	if i < 0 {
		return "", fmt.Errorf("generated render function is missing")
	}
	j := i
	for j > 0 && isIdentByte(js[j-1]) {
		j--
	}
	if j == i {
		return "", fmt.Errorf("generated render function has no class name")
	}
	return js[j:i], nil
}

func isIdentByte(c byte) bool {
	return c == '_' || c == '$' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

func (e *emitter) emitNodes(nodes []parser.Node, scope map[string]bool, indent int) error {
	for _, node := range nodes {
		switch n := node.(type) {
		case *parser.Element:
			if err := e.emitAttrs(n.Attrs, scope, indent); err != nil {
				return err
			}
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Component:
			if err := e.emitAttrs(n.Props, scope, indent); err != nil {
				return err
			}
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Slot:
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Portal:
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Interpolation:
			if err := e.emitInterpolation(n, scope, indent); err != nil {
				return err
			}
		case *parser.If:
			if err := e.emitIf(n, scope, indent); err != nil {
				return err
			}
		case *parser.For:
			if err := e.emitFor(n, scope, indent); err != nil {
				return err
			}
		case *parser.Case:
			if err := e.emitCase(n, scope, indent); err != nil {
				return err
			}
		case *parser.Text, *parser.InlineSVG:
			// Static markup has no TypeScript expression to check.
		}
	}
	return nil
}

func (e *emitter) emitAttrs(attrs []parser.Attr, scope map[string]bool, indent int) error {
	for _, attr := range attrs {
		switch a := attr.(type) {
		case *parser.DynamicAttr:
			span, err := e.attrExpr(a.Pos.Offset, a.Expr)
			if err != nil {
				return err
			}
			e.emitVoid(span, scope, indent)
		case *parser.EventAttr:
			span, err := e.attrExpr(a.Pos.Offset, a.Expr)
			if err != nil {
				return err
			}
			resolved, err := codegen.ResolveCheckEvent(a.Expr, scope)
			if err != nil {
				return err
			}
			name := fmt.Sprintf("__puzzle_check_event_%d", e.eventSite)
			e.eventSite++
			e.b.WriteString(spaces(indent) + "const " + name + ": ((event: any) => any) | null = ")
			e.b.WriteSubsequence(resolved, span.text, span.offset)
			e.b.WriteString(";\n" + spaces(indent) + "void " + name + ";\n")
		case *parser.MixedAttr:
			if err := e.emitParts(a.Parts, scope, indent); err != nil {
				return err
			}
		}
	}
	return nil
}

func (e *emitter) emitParts(parts []parser.Part, scope map[string]bool, indent int) error {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			if err := e.emitInterpolation(p.Interp, scope, indent); err != nil {
				return err
			}
		case *parser.InlineIfPart:
			span, _, err := e.conditionExpr(p.Pos.Offset, p.Cond)
			if err != nil {
				return err
			}
			e.b.WriteString(spaces(indent) + "if (")
			e.writeResolved(span, scope)
			e.b.WriteString(") {\n")
			if err := e.emitParts(p.Then, scope, indent+2); err != nil {
				return err
			}
			if len(p.Else) > 0 {
				e.b.WriteString(spaces(indent) + "} else {\n")
				if err := e.emitParts(p.Else, scope, indent+2); err != nil {
					return err
				}
			}
			e.b.WriteString(spaces(indent) + "}\n")
		}
	}
	return nil
}

func (e *emitter) emitInterpolation(n *parser.Interpolation, scope map[string]bool, indent int) error {
	spans, err := e.interpolationExprs(n)
	if err != nil {
		return err
	}
	e.b.WriteString(spaces(indent) + "void ")
	for i := len(n.Formatters) - 1; i >= 0; i-- {
		e.b.WriteString("__puzzle_check_formatter(" + strconv.Quote(n.Formatters[i].Name) + ", ")
	}
	e.writeResolved(spans[0], scope)
	spanIndex := 1
	for _, formatter := range n.Formatters {
		for range formatter.Args {
			e.b.WriteString(", ")
			e.writeResolved(spans[spanIndex], scope)
			spanIndex++
		}
		e.b.WriteString(")")
	}
	e.b.WriteString(";\n")
	return nil
}

func (e *emitter) emitIf(n *parser.If, scope map[string]bool, indent int) error {
	span, negate, err := e.conditionExpr(n.Pos.Offset, n.Cond)
	if err != nil {
		return err
	}
	e.b.WriteString(spaces(indent) + "if (")
	if negate {
		e.b.WriteString("!(")
	}
	e.writeResolved(span, scope)
	if negate {
		e.b.WriteString(")")
	}
	e.b.WriteString(") {\n")
	if err := e.emitNodes(n.Then, scope, indent+2); err != nil {
		return err
	}
	if len(n.Else) > 0 {
		e.b.WriteString(spaces(indent) + "} else {\n")
		if err := e.emitNodes(n.Else, scope, indent+2); err != nil {
			return err
		}
	}
	e.b.WriteString(spaces(indent) + "}\n")
	return nil
}

func (e *emitter) emitFor(n *parser.For, scope map[string]bool, indent int) error {
	spans, err := e.forExprs(n)
	if err != nil {
		return err
	}
	if n.IsRange {
		e.b.WriteString(spaces(indent) + "__puzzle_check_range(")
		e.writeResolved(spans[0], scope)
		e.b.WriteString(", ")
		e.writeResolved(spans[1], scope)
		param := "__puzzle_check_value"
		if n.Counter != "" {
			param = n.Counter
		}
		e.b.WriteString(", (" + param + ") => {\n")
		bodyScope := cloneScope(scope)
		if n.Counter != "" {
			bodyScope[n.Counter] = true
		}
		if err := e.emitNodes(n.Body, bodyScope, indent+2); err != nil {
			return err
		}
		e.b.WriteString(spaces(indent) + "});\n")
		return nil
	}

	e.b.WriteString(spaces(indent) + "__puzzle_check_each(")
	e.writeResolved(spans[0], scope)
	e.b.WriteString(", (" + n.Item)
	if n.Counter != "" {
		e.b.WriteString(", " + n.Counter)
	}
	e.b.WriteString(") => {\n")
	bodyScope := cloneScope(scope)
	bodyScope[n.Item] = true
	if n.Counter != "" {
		bodyScope[n.Counter] = true
	}
	if err := e.emitNodes(n.Body, bodyScope, indent+2); err != nil {
		return err
	}
	e.b.WriteString(spaces(indent) + "});\n")
	return nil
}

func (e *emitter) emitCase(n *parser.Case, scope map[string]bool, indent int) error {
	caseSpan, err := e.directiveExpr(n.Pos.Offset, "case", n.Expr)
	if err != nil {
		return err
	}
	e.b.WriteString(spaces(indent) + "switch (")
	e.writeResolved(caseSpan, scope)
	e.b.WriteString(") {\n")
	for _, clause := range n.Clauses {
		values, err := e.whenExprs(clause.Pos.Offset, clause.Values)
		if err != nil {
			return err
		}
		for _, value := range values {
			e.b.WriteString(spaces(indent+2) + "case ")
			e.writeResolved(value, scope)
			e.b.WriteString(":\n")
		}
		if err := e.emitNodes(clause.Body, scope, indent+4); err != nil {
			return err
		}
		e.b.WriteString(spaces(indent+4) + "break;\n")
	}
	if len(n.Else) > 0 {
		e.b.WriteString(spaces(indent+2) + "default:\n")
		if err := e.emitNodes(n.Else, scope, indent+4); err != nil {
			return err
		}
	}
	e.b.WriteString(spaces(indent) + "}\n")
	return nil
}

func (e *emitter) emitVoid(span sourceExpr, scope map[string]bool, indent int) {
	e.b.WriteString(spaces(indent) + "void (")
	e.writeResolved(span, scope)
	e.b.WriteString(");\n")
}

func (e *emitter) writeResolved(span sourceExpr, scope map[string]bool) {
	resolved := codegen.ResolveCheckExpr(span.text, scope)
	e.b.WriteResolved(resolved, span.text, span.offset)
}

func cloneScope(scope map[string]bool) map[string]bool {
	out := make(map[string]bool, len(scope)+2)
	for name := range scope {
		out[name] = true
	}
	return out
}

func spaces(n int) string { return strings.Repeat(" ", n) }

func (e *emitter) interpolationExprs(n *parser.Interpolation) ([]sourceExpr, error) {
	inner, start, _, err := braceInner(e.source, n.Pos.Offset)
	if err != nil {
		return nil, err
	}
	baseAt := strings.Index(inner, n.Expr)
	if baseAt < 0 {
		return nil, fmt.Errorf("cannot locate template expression %q", n.Expr)
	}
	spans := []sourceExpr{{text: n.Expr, offset: start + baseAt}}
	cursor := baseAt + len(n.Expr)
	for _, formatter := range n.Formatters {
		nameAt := strings.Index(inner[cursor:], formatter.Name)
		if nameAt < 0 {
			return nil, fmt.Errorf("cannot locate formatter %q", formatter.Name)
		}
		cursor += nameAt + len(formatter.Name)
		if len(formatter.Args) == 0 {
			continue
		}
		open := strings.IndexByte(inner[cursor:], '(')
		if open < 0 {
			return nil, fmt.Errorf("cannot locate arguments for formatter %q", formatter.Name)
		}
		cursor += open + 1
		args, err := locateSequential(inner[cursor:], start+cursor, formatter.Args)
		if err != nil {
			return nil, err
		}
		spans = append(spans, args...)
		last := args[len(args)-1]
		cursor = last.offset - start + len(last.text)
	}
	return spans, nil
}

func (e *emitter) attrExpr(anchor int, expr string) (sourceExpr, error) {
	open := strings.IndexByte(e.source[anchor:], '{')
	if open < 0 {
		return sourceExpr{}, fmt.Errorf("cannot locate attribute expression %q", expr)
	}
	inner, start, _, err := braceInner(e.source, anchor+open)
	if err != nil {
		return sourceExpr{}, err
	}
	trimmed := strings.TrimSpace(inner)
	if trimmed != expr {
		return sourceExpr{}, fmt.Errorf("attribute expression mismatch: parsed %q, source %q", expr, trimmed)
	}
	leading := len(inner) - len(strings.TrimLeft(inner, " \t\r\n"))
	return sourceExpr{text: expr, offset: start + leading}, nil
}

func (e *emitter) conditionExpr(anchor int, parsed string) (sourceExpr, bool, error) {
	inner, start, _, err := braceInner(e.source, anchor)
	if err != nil {
		return sourceExpr{}, false, err
	}
	trimmed := strings.TrimSpace(inner)
	prefixes := []struct {
		prefix string
		negate bool
	}{
		{"#unless", true},
		{"#if", false},
		{":else if", false},
	}
	for _, item := range prefixes {
		if strings.HasPrefix(trimmed, item.prefix) {
			rest := trimmed[len(item.prefix):]
			expr := strings.TrimSpace(rest)
			leadingInner := len(inner) - len(strings.TrimLeft(inner, " \t\r\n"))
			leadingRest := len(rest) - len(strings.TrimLeft(rest, " \t\r\n"))
			offset := start + leadingInner + len(item.prefix) + leadingRest
			return sourceExpr{text: expr, offset: offset}, item.negate, nil
		}
	}
	spans, err := locateSequential(inner, start, []string{parsed})
	if err != nil {
		return sourceExpr{}, false, err
	}
	return spans[0], false, nil
}

func (e *emitter) directiveExpr(anchor int, keyword, expr string) (sourceExpr, error) {
	inner, start, _, err := braceInner(e.source, anchor)
	if err != nil {
		return sourceExpr{}, err
	}
	prefix := "#" + keyword
	trimmed := strings.TrimSpace(inner)
	if !strings.HasPrefix(trimmed, prefix) {
		return sourceExpr{}, fmt.Errorf("expected {%s} at byte %d", prefix, anchor)
	}
	rest := trimmed[len(prefix):]
	if strings.TrimSpace(rest) != expr {
		return sourceExpr{}, fmt.Errorf("directive expression mismatch: parsed %q, source %q", expr, strings.TrimSpace(rest))
	}
	leadingInner := len(inner) - len(strings.TrimLeft(inner, " \t\r\n"))
	leadingRest := len(rest) - len(strings.TrimLeft(rest, " \t\r\n"))
	return sourceExpr{text: expr, offset: start + leadingInner + len(prefix) + leadingRest}, nil
}

func (e *emitter) forExprs(n *parser.For) ([]sourceExpr, error) {
	inner, start, _, err := braceInner(e.source, n.Pos.Offset)
	if err != nil {
		return nil, err
	}
	// Search past the `#for` keyword: a one-letter loop variable or range bound
	// would otherwise match a letter of the keyword itself and map the expression
	// to the wrong column.
	if lead := strings.Index(inner, "#for"); lead >= 0 {
		skip := lead + len("#for")
		inner, start = inner[skip:], start+skip
	}
	if n.IsRange {
		return locateSequential(inner, start, []string{n.RangeFrom, n.RangeTo})
	}
	itemAt := strings.Index(inner, n.Item)
	if itemAt < 0 {
		return nil, fmt.Errorf("cannot locate loop item %q", n.Item)
	}
	afterItem := itemAt + len(n.Item)
	collectionAt := strings.Index(inner[afterItem:], n.Collection)
	if collectionAt < 0 {
		return nil, fmt.Errorf("cannot locate loop collection %q", n.Collection)
	}
	return []sourceExpr{{text: n.Collection, offset: start + afterItem + collectionAt}}, nil
}

func (e *emitter) whenExprs(anchor int, values []string) ([]sourceExpr, error) {
	inner, start, _, err := braceInner(e.source, anchor)
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(inner)
	const prefix = ":when"
	if !strings.HasPrefix(trimmed, prefix) {
		return nil, fmt.Errorf("expected {%s} at byte %d", prefix, anchor)
	}
	leadingInner := len(inner) - len(strings.TrimLeft(inner, " \t\r\n"))
	rest := trimmed[len(prefix):]
	return locateSequential(rest, start+leadingInner+len(prefix), values)
}

func locateSequential(container string, base int, texts []string) ([]sourceExpr, error) {
	spans := make([]sourceExpr, 0, len(texts))
	cursor := 0
	for _, text := range texts {
		i := strings.Index(container[cursor:], text)
		if i < 0 {
			return nil, fmt.Errorf("cannot locate template expression %q", text)
		}
		i += cursor
		spans = append(spans, sourceExpr{text: text, offset: base + i})
		cursor = i + len(text)
	}
	return spans, nil
}

// braceInner returns the bytes inside the balanced template brace at open and
// their absolute source offset. The public LexSkip seam keeps JS literals,
// regexes, comments, and nested template literals opaque exactly as the parser
// and codegen do.
func braceInner(source string, open int) (string, int, int, error) {
	if open < 0 || open >= len(source) || source[open] != '{' {
		return "", 0, 0, fmt.Errorf("expected '{' at byte %d", open)
	}
	depth := 0
	prevEndsExpr := false
	for i := open; i < len(source); {
		if next, pee, consumed := parser.LexSkip(source, i, prevEndsExpr); consumed {
			prevEndsExpr = pee
			i = next
			continue
		}
		switch source[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return source[open+1 : i], open + 1, i, nil
			}
		}
		prevEndsExpr = parser.LexPlainEndsExpr(source[i], prevEndsExpr)
		i++
	}
	return "", 0, 0, fmt.Errorf("unclosed '{' at byte %d", open)
}
