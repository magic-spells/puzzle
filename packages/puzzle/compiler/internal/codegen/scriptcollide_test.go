package codegen

import (
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// scriptcollide_test.go — the <script>-import collision warning. A template
// expression referencing an import resolves to __d.<name> (undefined at render);
// the compile surfaces a Warning while the generated JS stays unchanged.

func warningFor(ws []Warning, name string) *Warning {
	for i := range ws {
		if strings.Contains(ws[i].Message, "\""+name+"\"") {
			return &ws[i]
		}
	}
	return nil
}

func compileResult(t *testing.T, src string) *Result {
	t.Helper()
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res
}

func TestScriptImportCollisionWarns(t *testing.T) {
	res := compileResult(t, `<puzzle-view><span>{ count > MAX }</span></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView { data() { return { count: 0 }; } }
</script>
`)
	w := warningFor(res.Warnings, "MAX")
	if w == nil {
		t.Fatalf("expected a warning naming MAX, got %#v", res.Warnings)
	}
	if !strings.Contains(w.Message, "imported in <script>") || !strings.Contains(w.Message, "will be undefined") {
		t.Errorf("warning message missing expected text: %q", w.Message)
	}
	if w.File != "T.pzl" || w.Line < 1 {
		t.Errorf("warning not positioned: %+v", *w)
	}
	// Output is unchanged: the collision is out-of-band, the read is still __d.MAX.
	if !strings.Contains(res.JS, "__d.MAX") {
		t.Errorf("expected __d.MAX in generated JS (output must be unchanged):\n%s", res.JS)
	}
	// Once per file+name — a second use in the same file does not double-warn.
	res2 := compileResult(t, `<puzzle-view><span>{ MAX }</span><span>{ MAX + 1 }</span></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView {}
</script>
`)
	n := 0
	for _, w := range res2.Warnings {
		if strings.Contains(w.Message, "\"MAX\"") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("expected exactly one MAX warning across two uses, got %d", n)
	}
}

func TestNoCollisionForDataField(t *testing.T) {
	// `count` is a data() field, not imported — no warning. PuzzleView is imported
	// but never referenced in the template — no warning either.
	res := compileResult(t, `<puzzle-view><span>{ count }</span></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { count: 0 }; } }
</script>
`)
	if len(res.Warnings) != 0 {
		t.Errorf("expected no warnings for a plain data field, got %#v", res.Warnings)
	}
}

func TestNoCollisionInsideStringLiteral(t *testing.T) {
	// MAX is imported but only appears inside a string literal / static text — it
	// is never emitted as __d.MAX, so no warning (the string-aware scan holds).
	res := compileResult(t, `<puzzle-view><span>{ 'MAX is the cap' }</span><b>MAX</b></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView {}
</script>
`)
	if warningFor(res.Warnings, "MAX") != nil {
		t.Errorf("MAX inside a string/static text must not warn, got %#v", res.Warnings)
	}
}

// TestScriptImportBindings covers the binding-extraction forms directly.
func TestScriptImportBindings(t *testing.T) {
	cases := []struct {
		name    string
		scripts string
		want    []string
		notWant []string
	}{
		{
			name:    "default + named + renamed + namespace",
			scripts: "import Def, { a, b as c } from 'x';\nimport * as ns from 'y';",
			want:    []string{"Def", "a", "c", "ns"},
			notWant: []string{"b"}, // b is the exported name, local is c
		},
		{
			name:    "bare side-effect import binds nothing",
			scripts: "import './styles.css';",
			want:    nil,
			notWant: []string{"styles"},
		},
		{
			name:    "dynamic import is not a binding",
			scripts: "const p = import('./lazy.js');",
			want:    nil,
			notWant: []string{"import", "lazy", "p"},
		},
		{
			name:    "decoy import inside a string is ignored",
			scripts: "const s = \"import Fake from 'z'\";\nimport Real from 'r';",
			want:    []string{"Real"},
			notWant: []string{"Fake", "s"},
		},
		{
			name:    "decoy import inside a comment is ignored",
			scripts: "// import Fake from 'z'\nimport Real from 'r';",
			want:    []string{"Real"},
			notWant: []string{"Fake"},
		},
		{
			name:    "type-only named import binds nothing",
			scripts: "import type { ViewNode } from '@magic-spells/puzzle';",
			notWant: []string{"type", "ViewNode"},
		},
		{
			name:    "comment before type-only named import binds nothing",
			scripts: "import /* c */ type { ViewNode } from '@magic-spells/puzzle';",
			notWant: []string{"type", "ViewNode"},
		},
		{
			name:    "type-only namespace import binds nothing",
			scripts: "import type * as ViewNode from '@magic-spells/puzzle';",
			notWant: []string{"type", "ViewNode"},
		},
		{
			name:    "type-only default import binds nothing",
			scripts: "import type ViewNode from '@magic-spells/puzzle';",
			notWant: []string{"type", "ViewNode"},
		},
		{
			name:    "default import binding named type",
			scripts: "import type from './value.js';",
			want:    []string{"type"},
		},
		{
			name:    "inline type modifier binds only value imports",
			scripts: "import { type ViewNode, other } from '@magic-spells/puzzle';",
			want:    []string{"other"},
			notWant: []string{"type", "ViewNode"},
		},
		{
			name:    "inline aliased type import binds nothing",
			scripts: "import { type ViewNode as LocalViewNode } from '@magic-spells/puzzle';",
			notWant: []string{"type", "ViewNode", "LocalViewNode"},
		},
		{
			name:    "named import literally named type",
			scripts: "import { type } from './value.js';",
			want:    []string{"type"},
		},
		{
			name:    "renamed value import binds local type",
			scripts: "import { ViewNode as type } from './value.js';",
			want:    []string{"type"},
			notWant: []string{"ViewNode"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scriptImportBindings(tokenizeJS(tc.scripts))
			for _, w := range tc.want {
				if !got[w] {
					t.Errorf("expected binding %q in %v", w, got)
				}
			}
			for _, nw := range tc.notWant {
				if got[nw] {
					t.Errorf("did not expect binding %q in %v", nw, got)
				}
			}
		})
	}
}

func TestTypeOnlyReservedImportDoesNotCollide(t *testing.T) {
	res := compileResult(t, `<puzzle-view><span>{ ViewNode }</span></puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import type { ViewNode } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if warningFor(res.Warnings, "ViewNode") != nil {
		t.Errorf("type-only imports must not participate in value-scope warnings: %#v", res.Warnings)
	}
}

// TestCollisionForDefaultAndRenamedImport proves the warning fires for a default
// import and a renamed named import, but not for the pre-rename exported name.
func TestCollisionForDefaultAndRenamedImport(t *testing.T) {
	res := compileResult(t, `<puzzle-view><span>{ Helper.run() }{ bar }</span></puzzle-view>

<script>
import Helper from './helper.js';
import { foo as bar } from './mod.js';
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if warningFor(res.Warnings, "Helper") == nil {
		t.Errorf("expected a warning for the default import Helper: %#v", res.Warnings)
	}
	if warningFor(res.Warnings, "bar") == nil {
		t.Errorf("expected a warning for the renamed binding bar: %#v", res.Warnings)
	}

	// The pre-rename exported name `foo` is NOT a local binding: `{ foo }` reads a
	// data field, so it must not warn.
	res2 := compileResult(t, `<puzzle-view><span>{ foo }</span></puzzle-view>

<script>
import { foo as bar } from './mod.js';
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { foo: 1 }; } }
</script>
`)
	if warningFor(res2.Warnings, "foo") != nil {
		t.Errorf("the exported name foo (renamed to bar) must not warn: %#v", res2.Warnings)
	}
}

// TestImportScanTerminatesOnUnclassifiedToken pins the loop-progress invariant
// of collectImportClause. tokenizeJS emits a jsTok that is neither an identifier
// (ident == ""), punctuation (ch == 0), nor an opaque unit for a NUL byte in the
// <script> — every other byte lands in one of those three classes. Such a token
// once matched no branch of the clause reader, so `puzzle build` and the dev
// watcher spun a core forever instead of compiling. Each case runs under a
// deadline: a regression must fail this test in seconds, not hang CI until its
// job timeout.
func TestImportScanTerminatesOnUnclassifiedToken(t *testing.T) {
	// The NUL is placed at every position an import clause can reach: after the
	// keyword, mid-clause, inside braces, around `as`, and around `from`.
	scripts := []string{
		"import\x00 a from 'x';",
		"import a\x00 from 'x';",
		"import a \x00from 'x';",
		"import { a\x00, b } from 'x';",
		"import { a as\x00 b } from 'x';",
		"import { a \x00as b } from 'x';",
		"import * \x00as ns from 'x';",
		"import type\x00 { T } from 'x';",
		"import { type\x00 T } from 'x';",
		"import a from\x00 'x';",
		"import a from 'x'\x00;",
		"import '\x00side-effect';",
		"import\x00",
		"\x00",
		"import a, { b as c, type d } from 'x';\x00import e from 'y';",
	}

	for _, script := range scripts {
		t.Run(strings.ReplaceAll(script, "\x00", "<NUL>"), func(t *testing.T) {
			done := make(chan struct{})
			go func() {
				defer close(done)
				toks := tokenizeJS(script)
				// Both consumers of the clause reader, plus the tokenizer itself.
				_ = scriptImportBindings(toks)
				_ = scriptTopLevelBindings(toks)
			}()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				// A live-locked goroutine cannot be reclaimed; fail the process
				// rather than let the run wedge.
				t.Fatal("import scan did not terminate — collectImportClause stopped advancing")
			}
		})
	}
}

// TestNulByteScriptStillCompiles is the same defect at the level the user meets
// it: a .pzl whose <script> carries a NUL must return from Compile rather than
// hang the build. The byte itself is not the compiler's business — <script>
// bytes are opaque and esbuild reports on them — so the only contract here is
// termination.
func TestNulByteScriptStillCompiles(t *testing.T) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		compileResult(t, "<puzzle-view><span>{ n }</span></puzzle-view>\n\n<script>\n"+
			"import { PuzzleView } from '@magic-spells/puzzle';\n"+
			"import { MAX\x00 } from './limits.js';\n"+
			"export default class T extends PuzzleView { data() { return { n: MAX }; } }\n"+
			"</script>\n")
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Compile did not terminate on a <script> containing a NUL byte")
	}
}

// TestImportClauseStepAlwaysAdvances proves the invariant directly against every
// token class the type can hold, including the unclassified one. This is the
// guard that makes the class of bug unrepresentable rather than merely absent
// from today's inputs.
func TestImportClauseStepAlwaysAdvances(t *testing.T) {
	toks := []jsTok{
		{ident: "a"},                  // identifier
		{ch: '{'},                     // punctuation
		{opaque: true},                // string / regex / template literal
		{opaque: true, comment: true}, // comment
		{},                            // NUL: no ident, no ch, not opaque
		{ident: "as"},
		{ident: "from"},
		{ident: "type"},
	}
	for j := range toks {
		inNamed := false
		next, _ := importClauseStep(toks, j, &inNamed, func(string, int) {})
		if next <= j {
			t.Errorf("importClauseStep(%d) on %#v returned %d — must advance", j, toks[j], next)
		}
	}
}
