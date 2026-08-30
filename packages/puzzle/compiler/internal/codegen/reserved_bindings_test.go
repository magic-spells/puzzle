package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// reserved_bindings_test.go — the module-scope collision between a <script>
// binding and a name codegen appends its own import for. The check is per-file:
// only the names THIS module actually emits are reserved.

// compileSrcOpts compiles an in-memory .pzl and returns the compile error
// instead of failing, so the reserved-binding diagnostic can be asserted.
func compileSrcOpts(t *testing.T, src string, opts Options) (string, error) {
	t.Helper()
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	opts.Filename = "T.pzl"
	res, err := Compile(sec, opts)
	return res.JS, err
}

func TestReservedModuleScopeScriptBindings(t *testing.T) {
	const coercing = "<puzzle-view>\n  <p>{ title }</p>\n</puzzle-view>"
	const raw = `<puzzle-view>
  <div class="static" data-count={ count }>no coercion</div>
</puzzle-view>`
	const slotted = "<puzzle-view>\n  <Slot/>\n</puzzle-view>"
	const portaled = "<puzzle-view>\n  <Portal><p>x</p></Portal>\n</puzzle-view>"
	const withSnippet = "<puzzle-view>\n  <List><Snippet item>{ item }</Snippet></List>\n</puzzle-view>"

	tests := []struct {
		name     string
		template string
		script   string
		// wantIdent is the colliding name the error must name; empty means the
		// module must compile.
		wantIdent string
	}{
		{
			name:      "declared __s with a coercing interpolation",
			template:  coercing,
			script:    "const __s = 1;",
			wantIdent: "__s",
		},
		{
			name:      "imported __s with a coercing interpolation",
			template:  coercing,
			script:    "import { x as __s } from './x.js';",
			wantIdent: "__s",
		},
		{
			name:      "declared ViewNode",
			template:  raw,
			script:    "class ViewNode {}",
			wantIdent: "ViewNode",
		},
		{
			name:      "exported ViewNode function",
			template:  raw,
			script:    "export function ViewNode() {}",
			wantIdent: "ViewNode",
		},
		{
			name:      "declared SLOT_TAG with a slot in the template",
			template:  slotted,
			script:    "const SLOT_TAG = 1;",
			wantIdent: "SLOT_TAG",
		},
		{
			name:      "declared PORTAL_TAG with a portal in the template",
			template:  portaled,
			script:    "const PORTAL_TAG = 1;",
			wantIdent: "PORTAL_TAG",
		},
		{
			name:      "declared SNIPPET_TAG with a snippet",
			template:  withSnippet,
			script:    "const SNIPPET_TAG = 1;",
			wantIdent: "SNIPPET_TAG",
		},
		// Negatives: the name is only reserved when this file emits it.
		{name: "declared __s without a coercing interpolation", template: raw, script: "const __s = 1;"},
		{name: "declared __f", template: coercing, script: "const __f = 1;"},
		{name: "declared SLOT_TAG without a slot", template: coercing, script: "const SLOT_TAG = 1;"},
		{name: "declared PORTAL_TAG without a portal", template: coercing, script: "const PORTAL_TAG = 1;"},
		{name: "declared SNIPPET_TAG without a snippet", template: coercing, script: "const SNIPPET_TAG = 1;"},
		// Not module-scope bindings: a function-body declaration shadows, and a
		// named class EXPRESSION binds inside the expression only.
		{name: "function-scope __s", template: coercing, script: "function helper() { const __s = 1; return __s; }"},
		{name: "named class expression", template: raw, script: "const Local = class ViewNode {};"},
		// A TS type-only declaration is erased by the loader, so it binds nothing.
		{name: "TS declare const", template: coercing, script: "declare const __s: unknown;"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			src := tc.template + "\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\n" +
				tc.script + "\nexport default class T extends PuzzleView {}\n</script>\n"
			_, err := compileSrcOpts(t, src, Options{Mode: ModeView})
			if tc.wantIdent == "" {
				if err != nil {
					t.Fatalf("expected a clean compile, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected a reserved module-scope binding error for %q", tc.wantIdent)
			}
			msg := err.Error()
			if !strings.Contains(msg, `"`+tc.wantIdent+`"`) {
				t.Errorf("error %q should name the colliding binding %q", msg, tc.wantIdent)
			}
			if !strings.Contains(msg, "reserved by the compiler") {
				t.Errorf("error %q should say the name is reserved by the compiler", msg)
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("error must be a *parser.ParseError so the plugin positions it in the .pzl, got %T", err)
			}
			if pe.File != "T.pzl" || pe.Line <= 0 || pe.Col <= 0 {
				t.Errorf("error must be positioned in the .pzl, got %s:%d:%d", pe.File, pe.Line, pe.Col)
			}
		})
	}
}

// TestReservedBindingPositionsAtTheDeclaration pins that the diagnostic points at
// the offending <script> line, not at the section start — the whole point of
// catching the collision here is that esbuild's duplicate-binding error quotes
// the injected import line, which exists in no .pzl.
func TestReservedBindingPositionsAtTheDeclaration(t *testing.T) {
	src := "<puzzle-view>\n  <p>{ title }</p>\n</puzzle-view>\n\n<script>\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n\n" +
		"const __s = 1;\n\n" +
		"export default class T extends PuzzleView {}\n</script>\n"
	_, err := compileSrcOpts(t, src, Options{Mode: ModeView})
	if err == nil {
		t.Fatal("expected a reserved module-scope binding error")
	}
	pe, ok := err.(*parser.ParseError)
	if !ok {
		t.Fatalf("expected *parser.ParseError, got %T", err)
	}
	// <script> opens on line 5, its content starts on line 6, and `const __s` is
	// the third content line.
	if pe.Line != 8 {
		t.Errorf("error should point at the `const __s` line (8), got line %d (%v)", pe.Line, pe)
	}
	if pe.Col != 7 {
		t.Errorf("error should point at the binding identifier (col 7), got col %d (%v)", pe.Col, pe)
	}
}

// TestReservedSVGDedupBinding covers the fourth emitted name family: in dedup
// mode each unique {#svg} asset gets a module-scope `__svg_N` import binding.
func TestReservedSVGDedupBinding(t *testing.T) {
	src := "<puzzle-view>\n  <span>{#svg 'icons/heart.svg'}</span>\n</puzzle-view>\n\n<script>\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"let __svg_0 = null;\n" +
		"export default class T extends PuzzleView {}\n</script>\n"
	_, err := compileSrcOpts(t, src, Options{Mode: ModeView, AssetsDir: "testdata/assets", SVGDedup: true})
	if err == nil {
		t.Fatal("expected a reserved module-scope binding error for __svg_0")
	}
	if !strings.Contains(err.Error(), `"__svg_0"`) {
		t.Errorf("error %q should name __svg_0", err)
	}
	// Inline mode emits no such import, so the same script is legal there.
	if _, err := compileSrcOpts(t, src, Options{Mode: ModeView, AssetsDir: "testdata/assets"}); err != nil {
		t.Errorf("inline mode emits no __svg_0 binding, so the script is legal: %v", err)
	}
}
