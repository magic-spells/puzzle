//go:build js && wasm

/*
Command pzl-wasm exposes Puzzle's source-only parser and code generator to
JavaScript. It deliberately excludes the esbuild-backed build pipeline.

Phase 2 worker protocol (pinned): the UI sends one structured-cloneable request

	{ id, source, options: { filename?, ts? } }

where id is an opaque value copied unchanged. The worker answers exactly once:

	{ id, result: { js, css, warnings, errors } }

The worker calls __pzlCompile(source, options) to produce result. js is the
generated module; css is the file's <style> body — wrapped in the native
@scope rule (the same wrapper the esbuild plugin emits, keyed by the same
codegen.ScopeID) when the block is `scoped`, so the returned CSS already
matches the data-<scopeId> stamp codegen puts on the template root — and "" when
the file has no <style>. Diagnostics are arrays of { message, line, col };
compilation failures are data, not thrown exceptions. __pzlVersion() supplies
the compiler/framework version for worker startup and cache negotiation. The
exported functions are synchronous inside the worker; request serialization and
cancellation belong to the wrapper.

Option handling is deliberately lenient, since options crosses a structured
clone the UI controls: a non-string (or empty) filename falls back to
defaultFilename, and a non-boolean ts is treated as false. filename is not
cosmetic — codegen.ModeForPath infers view mode (app/views/**, app/layouts/**)
versus component mode from it, so the playground's file path selector is what
decides whether the emitted render wraps a <puzzle-view> root.

Failure containment has two layers, because Go's WASM instance is single-use:

  - Recoverable faults — any Go panic raised inside compile — become a 1:1 error
    diagnostic and the instance answers the next request. A hostile options
    object counts: a throwing property getter is a JavaScript exception rather
    than a Go panic, so the options snapshot is taken with a Call (Object.assign)
    instead of a raw Get, which is what turns the throw into a recoverable panic.
    See plainCopy.
  - Unrecoverable faults are not catchable in Go: `fatal error: out of memory`
    and stack exhaustion bypass recover() and kill the instance permanently.
    Deeply nested templates reach both, because codegen's indentation grows
    O(N²) with element depth. maxSourceBytes and maxNestingDepth are the guard:
    over-limit input is rejected as a positioned diagnostic BEFORE the memory is
    ever allocated. They are generous relative to real components and exist only
    to keep a hostile paste from taking the worker down.

Belt and suspenders for the Phase 2 wrapper: the guards cannot be proven
exhaustive, so a wrapper must still detect a dead instance and respawn the
worker. A call into a dead instance throws "Go program has already exited" (the
exported function is gone and every later call fails the same way); treat any
throw out of __pzlCompile as fatal to that worker, spawn a fresh one, and retry
once.
*/
package main

import (
	"errors"
	"fmt"
	"syscall/js"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/parser"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

const (
	defaultFilename       = "app/views/Playground.pzl"
	assetsUnavailable     = "asset reads are not available in the playground"
	typescriptUnavailable = "TypeScript transpilation is not available in the playground compiler"

	// maxSourceBytes caps the accepted source. A .pzl an order of magnitude
	// past the largest file in examples/ is still far below this; the limit is
	// a hostile-paste guard, not a style rule.
	maxSourceBytes = 512 * 1024
	// maxNestingDepth caps template nesting (elements, components, slots,
	// portals, and block bodies each count as one level). Real components live
	// around a dozen levels deep; codegen starts allocating quadratically well
	// before this and reaches an unrecoverable OOM a few hundred levels past it.
	maxNestingDepth = 200
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

func compile(_ js.Value, args []js.Value) (result any) {
	// Every panic below — including one raised by a JS property getter inside
	// compileOptions — becomes a diagnostic instead of killing the instance for
	// good. A js.FuncOf callback that panics unwinds through the Go runtime and
	// exits the program: every later __pzlCompile call would then throw
	// "Go program has already exited".
	defer func() {
		if r := recover(); r != nil {
			result = compileResult("", "", nil, []any{
				diagnostic(fmt.Sprintf("playground compiler error: %v", r), 1, 1),
			})
		}
	}()

	if len(args) == 0 || args[0].Type() != js.TypeString {
		return compileResult("", "", nil, []any{diagnostic("source must be a string", 1, 1)})
	}

	// Reject on the JS-side length first: args[0].String() copies the whole
	// string into Go memory, so checking only afterwards pays for the copy.
	if n := args[0].Get("length").Int(); n > maxSourceBytes {
		return compileResult("", "", nil, []any{diagnostic(
			fmt.Sprintf("source exceeds playground limit of %d bytes (got %d)", maxSourceBytes, n), 1, 1)})
	}

	source := args[0].String()
	// Kept: UTF-16 units are not bytes, so a multi-byte source can pass above.
	if len(source) > maxSourceBytes {
		return compileResult("", "", nil, []any{diagnostic(
			fmt.Sprintf("source exceeds playground limit of %d bytes (got %d)", maxSourceBytes, len(source)), 1, 1)})
	}

	filename, typescript := compileOptions(args)
	sections, err := parser.SplitSections(source, filename)
	if err != nil {
		return compileResult("", "", nil, errorDiagnostics(err))
	}

	css := styleText(sections, filename)

	// D54's standalone pzlc output becomes JavaScript through esbuild's
	// Transform API. Pulling that package into this command triples the WASM
	// payload, so Phase 1 reports the unsupported transform explicitly. The ts
	// bit remains in the pinned worker protocol for a wrapper-level transformer.
	if typescript || sections.ScriptsLang == "ts" {
		line, col := sections.ScriptsPos.Line, sections.ScriptsPos.Col
		if line < 1 {
			line, col = 1, 1
		}
		return compileResult("", css, nil, []any{diagnostic(typescriptUnavailable, line, col)})
	}

	// Nesting is measured on the token stream, not on a parsed tree: the
	// recursive-descent parser exhausts the stack on a pathologically deep source
	// before any walk of its AST could run, and a stack overflow is exactly the
	// kind of fault recover() cannot contain.
	if pos, over := parser.OverNestingDepth(sections, filename, maxNestingDepth); over {
		return compileResult("", css, nil, []any{depthDiagnostic(pos)})
	}

	out, err := codegen.Compile(sections, codegen.Options{
		Filename:              filename,
		Mode:                  codegen.ModeForPath(filename),
		AssetReadsUnavailable: assetsUnavailable,
	})
	warnings := warningDiagnostics(out.Warnings)
	if err != nil {
		return compileResult("", css, warnings, errorDiagnostics(err))
	}
	return compileResult(out.JS, css, warnings, nil)
}

func depthDiagnostic(pos parser.Position) map[string]any {
	line, col := pos.Line, pos.Col
	if line < 1 {
		line, col = 1, 1
	}
	return diagnostic(
		fmt.Sprintf("template nesting exceeds playground limit of %d levels", maxNestingDepth), line, col)
}

// styleText returns the CSS the wrapper should inject for this file: the
// <style> body verbatim, or — for <style scoped> (D59) — the same @scope
// wrapper the esbuild plugin emits, keyed by the same codegen.ScopeID that
// codegen stamped on the template root.
func styleText(sec *parser.Sections, filename string) string {
	if !sec.HasStyles {
		return ""
	}
	if sec.StylesScoped {
		return codegen.ScopedCSS(filename, sec.Styles)
	}
	return sec.Styles
}

func compileOptions(args []js.Value) (filename string, typescript bool) {
	filename = defaultFilename
	if len(args) < 2 || args[1].Type() != js.TypeObject || args[1].IsNull() {
		return filename, false
	}
	opts := plainCopy(args[1])
	if opts.Type() != js.TypeObject {
		return filename, false
	}
	if value := opts.Get("filename"); value.Type() == js.TypeString && value.String() != "" {
		filename = value.String()
	}
	if value := opts.Get("ts"); value.Type() == js.TypeBoolean {
		typescript = value.Bool()
	}
	return filename, typescript
}

// plainCopy snapshots the caller's options into a plain object via
// Object.assign, and every later read is of a data property on that copy.
//
// This is not paranoia about shapes, it is the only way to CATCH a hostile
// options object. js.Value.Get is a raw property read: a JS getter that throws
// unwinds the WASM frames as a JavaScript exception, which is not a Go panic
// and so is invisible to recover() — the throw lands in the caller and the
// instance is left mid-call. js.Value.Call is different: the js/wasm bridge
// wraps the call in try/catch and turns a thrown value into a Go panic, which
// compile's recover() converts into an ordinary diagnostic. So the ONE read
// that can touch attacker-controlled getters is made through a Call.
func plainCopy(opts js.Value) js.Value {
	object := js.Global().Get("Object")
	if object.Type() != js.TypeFunction {
		return js.Undefined()
	}
	return object.Call("assign", object.New(), opts)
}

func compileResult(code, css string, warnings, compileErrors []any) map[string]any {
	if warnings == nil {
		warnings = []any{}
	}
	if compileErrors == nil {
		compileErrors = []any{}
	}
	return map[string]any{
		"js":       code,
		"css":      css,
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
