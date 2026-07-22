package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// scriptcollide_test.go — the <scripts>-import collision warning. A template
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

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView { data() { return { count: 0 }; } }
</scripts>
`)
	w := warningFor(res.Warnings, "MAX")
	if w == nil {
		t.Fatalf("expected a warning naming MAX, got %#v", res.Warnings)
	}
	if !strings.Contains(w.Message, "imported in <scripts>") || !strings.Contains(w.Message, "will be undefined") {
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

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView {}
</scripts>
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

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { count: 0 }; } }
</scripts>
`)
	if len(res.Warnings) != 0 {
		t.Errorf("expected no warnings for a plain data field, got %#v", res.Warnings)
	}
}

func TestNoCollisionInsideStringLiteral(t *testing.T) {
	// MAX is imported but only appears inside a string literal / static text — it
	// is never emitted as __d.MAX, so no warning (the string-aware scan holds).
	res := compileResult(t, `<puzzle-view><span>{ 'MAX is the cap' }</span><b>MAX</b></puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
import { MAX } from './limits.js';
export default class T extends PuzzleView {}
</scripts>
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
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := scriptImportBindings(tc.scripts)
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

// TestCollisionForDefaultAndRenamedImport proves the warning fires for a default
// import and a renamed named import, but not for the pre-rename exported name.
func TestCollisionForDefaultAndRenamedImport(t *testing.T) {
	res := compileResult(t, `<puzzle-view><span>{ Helper.run() }{ bar }</span></puzzle-view>

<scripts>
import Helper from './helper.js';
import { foo as bar } from './mod.js';
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</scripts>
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

<scripts>
import { foo as bar } from './mod.js';
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { foo: 1 }; } }
</scripts>
`)
	if warningFor(res2.Warnings, "foo") != nil {
		t.Errorf("the exported name foo (renamed to bar) must not warn: %#v", res2.Warnings)
	}
}
