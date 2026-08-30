//go:build js && wasm

/*
Command pzl-wasm exposes Puzzle's source-only parser and code generator to
JavaScript. It deliberately excludes the esbuild-backed build pipeline.

Phase 2 worker protocol (pinned): the UI sends one structured-cloneable request

	{ id, source, options: { filename?, ts? } }

where id is an opaque value copied unchanged. The worker answers exactly once:

	{ id, result: { js, warnings, errors } }

The worker calls __pzlCompile(source, options) to produce result. Diagnostics
are arrays of { message, line, col }; compilation failures are data, not thrown
exceptions. __pzlVersion() supplies the compiler/framework version for worker
startup and cache negotiation. The exported functions are synchronous inside
the worker; request serialization and cancellation belong to the wrapper.
*/
package main

import (
	"errors"
	"syscall/js"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

const (
	defaultFilename       = "app/views/Playground.pzl"
	assetsUnavailable     = "asset reads are not available in the playground"
	typescriptUnavailable = "TypeScript transpilation is not available in the playground compiler"
)

var exportedFuncs []js.Func

func main() {
	exportedFuncs = []js.Func{
		js.FuncOf(compile),
		js.FuncOf(func(js.Value, []js.Value) any { return version.Version }),
	}
	js.Global().Set("__pzlCompile", exportedFuncs[0])
	js.Global().Set("__pzlVersion", exportedFuncs[1])

	select {}
}

func compile(_ js.Value, args []js.Value) any {
	if len(args) == 0 || args[0].Type() != js.TypeString {
		return compileResult("", nil, []any{diagnostic("source must be a string", 1, 1)})
	}

	source := args[0].String()
	filename, typescript := compileOptions(args)
	sections, err := parser.SplitSections(source, filename)
	if err != nil {
		return compileResult("", nil, errorDiagnostics(err))
	}

	// D54's standalone pzlc output becomes JavaScript through esbuild's
	// Transform API. Pulling that package into this command triples the WASM
	// payload, so Phase 1 reports the unsupported transform explicitly. The ts
	// bit remains in the pinned worker protocol for a wrapper-level transformer.
	if typescript || sections.ScriptsLang == "ts" {
		line, col := sections.ScriptsPos.Line, sections.ScriptsPos.Col
		if line < 1 {
			line, col = 1, 1
		}
		return compileResult("", nil, []any{diagnostic(typescriptUnavailable, line, col)})
	}

	result, err := codegen.Compile(sections, codegen.Options{
		Filename:              filename,
		Mode:                  codegen.ModeForPath(filename),
		AssetReadsUnavailable: assetsUnavailable,
	})
	warnings := warningDiagnostics(result.Warnings)
	if err != nil {
		return compileResult("", warnings, errorDiagnostics(err))
	}
	return compileResult(result.JS, warnings, nil)
}

func compileOptions(args []js.Value) (filename string, typescript bool) {
	filename = defaultFilename
	if len(args) < 2 || args[1].Type() != js.TypeObject || args[1].IsNull() {
		return filename, false
	}
	opts := args[1]
	if value := opts.Get("filename"); value.Type() == js.TypeString && value.String() != "" {
		filename = value.String()
	}
	if value := opts.Get("ts"); value.Type() == js.TypeBoolean {
		typescript = value.Bool()
	}
	return filename, typescript
}

func compileResult(code string, warnings, compileErrors []any) map[string]any {
	if warnings == nil {
		warnings = []any{}
	}
	if compileErrors == nil {
		compileErrors = []any{}
	}
	return map[string]any{
		"js":       code,
		"warnings": warnings,
		"errors":   compileErrors,
	}
}

func warningDiagnostics(warnings []codegen.Warning) []any {
	out := make([]any, 0, len(warnings))
	for _, warning := range warnings {
		out = append(out, diagnostic(warning.Message, warning.Line, warning.Col))
	}
	return out
}

func errorDiagnostics(err error) []any {
	var list parser.ErrorList
	if errors.As(err, &list) {
		out := make([]any, 0, len(list))
		for _, item := range list {
			out = append(out, parseDiagnostic(item))
		}
		return out
	}
	var positioned *parser.ParseError
	if errors.As(err, &positioned) {
		return []any{parseDiagnostic(positioned)}
	}
	return []any{diagnostic(err.Error(), 1, 1)}
}

func parseDiagnostic(err *parser.ParseError) map[string]any {
	return diagnostic(err.Message, err.Line, err.Col)
}

func diagnostic(message string, line, col int) map[string]any {
	return map[string]any{
		"message": message,
		"line":    line,
		"col":     col,
	}
}
