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
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

const shim = `/// <reference types="@magic-spells/puzzle/puzzle-env" />
__LANGUAGE_LIBS__
import type { PuzzleView } from '@magic-spells/puzzle';

declare global {
  // Composition markers are deliberately absent: the emitter never writes a
  // marker's TAG NAME into the virtual file (only its argument expressions,
  // which are checked in the surrounding view scope), so a declaration for
  // Children/Slot/Portal/Snippet would name nothing.

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

  // A <Snippet> body's parameters (D166) are filled by the marker arguments in
  // the COMPONENT's template — a different .pzl, compiled independently — so
  // there is nothing in the caller's file to infer them from. The rest
  // parameter contextually types each one as ANY, which keeps a strict app
  // tsconfig from reporting an implicit any on a binding the user never
  // annotated.
  function __puzzle_check_snippet(
    visit: (...values: any[]) => void,
  ): void;

  function __puzzle_check_range(
    from: number,
    to: number,
    visit: (value: number) => void,
  ): void;

  // P4: remove. A template value's .size (D176, TEMPORARY) is emitted as
  // __z(value), the runtime's sizeOf helper: a list's or string's count,
  // otherwise the value's own size field. Most template data is untyped, which
  // the first overload answers with a number; a typed object reads its field.
  function __z(value: readonly unknown[] | string | ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>): number;
  function __z<T extends { readonly size?: unknown }>(value: T): T['size'];
  function __z(value: unknown): any;

  // P4: remove. A TEMPORARY pipe chain is checked as nested calls.
  function __puzzle_check_formatter(
    name: string,
    value: any,
    ...args: any[]
  ): any;

  // A bare call names the function library: the standard functions typed
  // below, and any app-registered function, untyped — its arguments and its
  // result are any, as an untyped data() value is.
  interface __PuzzleFunctions {
__LIBRARY_SIGNATURES__
    [name: string]: (...args: any[]) => any;
  }
  const __puzzle_fn: __PuzzleFunctions;

  // A method call whose arguments hold an arrow function takes its receiver
  // through here. An untyped data value (any) becomes any[], so the arrow's
  // parameters are typed any instead of an implicit-any error under strict; a
  // typed receiver passes through unchanged and keeps its own checking.
  function __puzzle_check_list<T>(value: T): 0 extends (1 & T) ? any[] : T;

  type __PuzzleCheckView = PuzzleView;
}

export {};
`

// libraryFunctionSignatures are the TypeScript signatures of the standard
// function library (codegen.LibraryFunctionNames, DESIGN-expr-v2 §4), declared
// on __PuzzleFunctions in the shim. P3 publishes the same signatures in
// types/ — keep the two in sync; TestLibrarySignaturesMatchCodegen keeps this
// table and the compiler's name list identical. Values are `unknown` because
// every function accepts any template value and prints nothing for a missing
// one.
var libraryFunctionSignatures = []struct{ name, signature string }{
	{"link", "(url: unknown): string"},
	{"t", "(key: unknown, vars?: Record<string, unknown>): string"},
	{"currency", "(value: unknown, symbol?: string, places?: number): string"},
	{"percentage", "(value: unknown, places?: number): string"},
	{"number_with_delimiter", "(value: unknown, delimiter?: string): string"},
	{"compact_number", "(value: unknown): string"},
	{"pluralize", "(count: unknown, singular: string, plural?: string): string"},
	{"date", "(value: unknown, preset?: string, locale?: string): string"},
	{"time", "(value: unknown, preset?: string, locale?: string): string"},
	{"datetime", "(value: unknown, preset?: string, locale?: string): string"},
	{"timeago", "(value: unknown): string"},
	{"in_timezone", "(value: unknown, zone?: string): Date | ''"},
	{"truncate", "(value: unknown, length?: number, ellipsis?: string): string"},
	{"capitalize", "(value: unknown): string"},
	{"strip_html", "(value: unknown): string"},
	{"strip_newlines", "(value: unknown): string"},
	{"escape", "(value: unknown): string"},
	{"raw", "(value: unknown): string"},
	{"newline_to_br", "(value: unknown): string"},
	{"json", "(value: unknown): string"},
}

// languageLibs are the lib.d.ts files that type the expression language's
// method table (puzzle-lang expr.StringMethods/ArrayMethods, DESIGN-expr-v2
// §3) and its Object globals. A template method is checked as the same
// JavaScript method, so its declaration must be in the program whatever the
// app's own target: an app on `target: ES2020` would otherwise see `.at()`,
// `.replaceAll()`, and `.toSorted()` reported as missing. A `/// <reference
// lib>` adds a file without replacing the app's `lib` list. es2023.array
// types findLast from TypeScript 5.0 but toSorted and toReversed only from
// 5.2, so it is referenced from 5.2 on (on 5.0 and 5.1 those two report as
// missing, as they would in the app's own code); every other file exists in
// 4.9, the oldest compiler puzzle check supports.
var languageLibs = []struct {
	lib string
	min TypeScriptVersion
}{
	{"es2016.array.include", TypeScriptVersion{}}, // includes
	{"es2017.object", TypeScriptVersion{}},        // Object.values, Object.entries
	{"es2017.string", TypeScriptVersion{}},        // padStart, padEnd
	{"es2019.array", TypeScriptVersion{}},         // flat
	{"es2019.string", TypeScriptVersion{}},        // trimStart, trimEnd
	{"es2021.string", TypeScriptVersion{}},        // replaceAll
	{"es2022.array", TypeScriptVersion{}},         // at
	{"es2022.string", TypeScriptVersion{}},        // at
	{"es2023.array", TypeScriptVersion{5, 2}},     // findLast, toSorted, toReversed
}

// shimSource is the shim for the app's TypeScript version, with the method
// table's lib files and the library signatures filled in.
func shimSource(ts TypeScriptVersion) string {
	var libs strings.Builder
	for _, l := range languageLibs {
		if ts.AtLeast(l.min) {
			libs.WriteString("/// <reference lib=\"" + l.lib + "\" />\n")
		}
	}
	var sigs strings.Builder
	for _, fn := range libraryFunctionSignatures {
		sigs.WriteString("    " + fn.name + fn.signature + ";\n")
	}
	out := strings.Replace(shim, "__LANGUAGE_LIBS__", libs.String(), 1)
	return strings.Replace(out, "__LIBRARY_SIGNATURES__\n", sigs.String(), 1)
}

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

// tableIndex keys this run's segment tables by absolute generated path, the way
// remapTSCOutput looks them up. Remapping reads the bytes this run emitted, in
// memory: re-reading them after tsc exits would remap against whatever the
// developer saved while it ran.
func (r *Result) tableIndex(root string) map[string]*SegmentTable {
	tables := make(map[string]*SegmentTable, len(r.Tables))
	for _, t := range r.Tables {
		tables[filepath.Clean(filepath.Join(root, filepath.FromSlash(t.Generated)))] = t
	}
	return tables
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

// Generate rebuilds <appRoot>/.puzzle/check from the .pzl files under app/
// for the app's TypeScript compiler version.
func Generate(appRoot string, ts TypeScriptVersion) (*Result, error) {
	root, err := filepath.Abs(appRoot)
	if err != nil {
		return nil, err
	}
	appDir, err := sourceDir(root)
	if err != nil {
		return nil, err
	}
	// The RemoveAll below must not reach through a symlinked .puzzle.
	if err := fsutil.RejectSymlink(filepath.Join(root, ".puzzle")); err != nil {
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

	if err := os.WriteFile(filepath.Join(checkDir, "puzzle-check.d.ts"), []byte(shimSource(ts)), 0o644); err != nil {
		return nil, err
	}
	config, err := tsconfig(root, ts.Major)
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
	eventSite int
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

	e := &emitter{b: b}
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
			// A marker's arguments (D166) are ordinary bindings evaluated at every
			// render — codegen puts them in the marker vnode's args object — so they
			// are checked exactly like an element's attributes. The fallback children
			// are a separate body, checked after them in the same scope.
			if err := e.emitAttrs(n.Args, scope, indent); err != nil {
				return err
			}
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Snippet:
			if err := e.emitSnippet(n, scope, indent); err != nil {
				return err
			}
		case *parser.Portal:
			if err := e.emitNodes(n.Children, scope, indent); err != nil {
				return err
			}
		case *parser.Interpolation:
			e.emitVoid(n.ExprAST, n.Formatters, scope, indent) // P4: remove
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
			e.emitVoid(a.ExprAST, a.Formatters, scope, indent) // P4: remove
		case *parser.EventAttr:
			name := fmt.Sprintf("__puzzle_check_event_%d", e.eventSite)
			e.eventSite++
			e.b.WriteString(spaces(indent) + "const " + name + ": ((event: any) => any) | null = ")
			if err := codegen.WriteCheckEvent(e.b, a.ExprAST, a.Expr, scope); err != nil {
				return err
			}
			e.b.WriteString(";\n" + spaces(indent) + "void " + name + ";\n")
		case *parser.MixedAttr:
			e.emitParts(a.Parts, scope, indent)
		}
	}
	return nil
}

func (e *emitter) emitParts(parts []parser.Part, scope map[string]bool, indent int) {
	for _, part := range parts {
		switch p := part.(type) {
		case *parser.InterpPart:
			e.emitVoid(p.Interp.ExprAST, p.Interp.Formatters, scope, indent) // P4: remove
		case *parser.InlineIfPart:
			e.b.WriteString(spaces(indent) + "if (")
			codegen.WriteCheckValue(e.b, p.CondAST, nil, scope)
			e.b.WriteString(") {\n")
			e.emitParts(p.Then, scope, indent+2)
			if len(p.Else) > 0 {
				e.b.WriteString(spaces(indent) + "} else {\n")
				e.emitParts(p.Else, scope, indent+2)
			}
			e.b.WriteString(spaces(indent) + "}\n")
		}
	}
}

// emitVoid checks one value position as an expression statement. The
// parentheses are load-bearing: `void` binds tighter than every binary
// operator, so an unparenthesized `void a + 1` type-checks `undefined + 1` and
// reports "Object is possibly 'undefined'" on a correct template under
// strictNullChecks — while checking nothing about `a + 1` itself.
func (e *emitter) emitVoid(n expr.Node, fmts []parser.FormatterCall, scope map[string]bool, indent int) {
	e.b.WriteString(spaces(indent) + "void (")
	codegen.WriteCheckValue(e.b, n, fmts, scope)
	e.b.WriteString(");\n")
}

func (e *emitter) emitIf(n *parser.If, scope map[string]bool, indent int) error {
	// An {#unless} condition is already `!(…)` in the tree.
	e.b.WriteString(spaces(indent) + "if (")
	codegen.WriteCheckValue(e.b, n.CondAST, nil, scope)
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
	if n.IsRange {
		e.b.WriteString(spaces(indent) + "__puzzle_check_range(")
		codegen.WriteCheckValue(e.b, n.RangeFromAST, nil, scope)
		e.b.WriteString(", ")
		codegen.WriteCheckValue(e.b, n.RangeToAST, nil, scope)
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
	codegen.WriteCheckValue(e.b, n.CollectionAST, nil, scope)
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

// emitSnippet walks a D166 snippet body under a scope that declares the
// snippet's parameters, so a parameter read stays a bare identifier — shadowing
// caller data of the same name, exactly as codegen scopes it — while every
// other name still resolves against the caller's view instance.
//
// The parameters are typed `any`, unlike a loop variable: an each-loop's item
// type is inferred from the collection expression standing right there in the
// same file, but a snippet parameter's values come from the marker arguments in
// the COMPONENT's template, a different .pzl that this check compiles
// independently. There is nothing in this file to infer from, and guessing
// would report errors the user cannot act on.
func (e *emitter) emitSnippet(n *parser.Snippet, scope map[string]bool, indent int) error {
	e.b.WriteString(spaces(indent) + "__puzzle_check_snippet((" + strings.Join(n.Params, ", ") + ") => {\n")
	bodyScope := cloneScope(scope)
	for _, param := range n.Params {
		bodyScope[param] = true
	}
	if err := e.emitNodes(n.Body, bodyScope, indent+2); err != nil {
		return err
	}
	e.b.WriteString(spaces(indent) + "});\n")
	return nil
}

func (e *emitter) emitCase(n *parser.Case, scope map[string]bool, indent int) error {
	e.b.WriteString(spaces(indent) + "switch (")
	codegen.WriteCheckValue(e.b, n.ExprAST, nil, scope)
	e.b.WriteString(") {\n")
	for _, clause := range n.Clauses {
		for _, value := range clause.ValuesAST {
			e.b.WriteString(spaces(indent+2) + "case ")
			codegen.WriteCheckValue(e.b, value, nil, scope)
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

func cloneScope(scope map[string]bool) map[string]bool {
	out := make(map[string]bool, len(scope)+2)
	for name := range scope {
		out[name] = true
	}
	return out
}

func spaces(n int) string { return strings.Repeat(" ", n) }
