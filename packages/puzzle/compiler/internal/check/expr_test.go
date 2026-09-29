package check

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

// expr_test.go — puzzle check emits TypeScript from the expression AST: methods
// are the JavaScript methods lib.d.ts types, library functions are typed by
// the shim's signature table, arrows over untyped data stay clean under
// strict, and every diagnostic lands on its authored bytes.

// The shim's signature table and the compiler's library list name the same
// functions, in the same order.
func TestLibrarySignaturesMatchCodegen(t *testing.T) {
	var names []string
	for _, fn := range libraryFunctionSignatures {
		names = append(names, fn.name)
	}
	if got, want := strings.Join(names, ","), strings.Join(codegen.LibraryFunctionNames, ","); got != want {
		t.Fatalf("signature table\n  %s\nlibrary\n  %s", got, want)
	}
	shim := shimSource(5)
	if strings.Contains(shim, "__LIBRARY_SIGNATURES__") {
		t.Fatal("the shim placeholder was not filled")
	}
	for _, fn := range libraryFunctionSignatures {
		if !strings.Contains(shim, "    "+fn.name+fn.signature+";\n") {
			t.Errorf("shim is missing %s", fn.name)
		}
	}
}

// The method table's lib files are referenced whatever the app's target, and
// es2023.array only where the compiler has it.
func TestShimReferencesLanguageLibs(t *testing.T) {
	for _, major := range []int{4, 5, 7} {
		shim := shimSource(major)
		for _, lib := range []string{"es2022.array", "es2022.string", "es2021.string", "es2019.array"} {
			if !strings.Contains(shim, `/// <reference lib="`+lib+`" />`) {
				t.Errorf("TypeScript %d: shim is missing lib %s", major, lib)
			}
		}
		if got, want := strings.Contains(shim, `/// <reference lib="es2023.array" />`), major >= 5; got != want {
			t.Errorf("TypeScript %d: es2023.array referenced = %v, want %v", major, got, want)
		}
		if !strings.HasPrefix(shim, "/// <reference types=\"@magic-spells/puzzle/puzzle-env\" />\n/// <reference lib=") {
			t.Errorf("TypeScript %d: the lib references must lead the file:\n%s", major, shim[:200])
		}
	}
}

// An app on an older target still type-checks the table's newer methods.
func TestLanguageMethodsCheckOnAnOldTarget(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true,"target":"ES2020"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	writeLiveView(t, root, `<puzzle-view>
  <p>{ tags.at(-1) } { name.replaceAll('a', 'b').at(0) } { tags.toSorted().toReversed().findLast(t => t > 'a') } { tags.flat().includes('x') }</p>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { tags: string[] = []; name = 'a'; }
</script>
`)
	if _, err := Run(root); err != nil {
		t.Fatalf("the method table must type-check on target ES2020: %v", err)
	}
}

func TestExpressionLanguageEmits(t *testing.T) {
	source := []byte(`<puzzle-view>
  <p>{ name.trim().toUpperCase() } { currency(price, '$') } { Math.round(n) }</p>
  <p>{ items.filter(t => !t.done).length } { tags?.at(0) ?? 'none' }</p>
  <button @click={ save(t('saved'), event.target.value) }>x</button>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`)
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	got := string(files[0].Contents)
	for _, want := range []string{
		"void (__d.name.trim().toUpperCase());",
		"void (__puzzle_fn.currency(__d.price, '$'));",
		"void (Math.round(__d.n));",
		"void (__puzzle_check_list(__d.items).filter((t) => !t.done).length);",
		"void (__d.tags?.at(0) ?? 'none');",
		"= (event) => this.events.save(__puzzle_fn.t('saved'), event.target.value);",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated file is missing %q:\n%s", want, got)
		}
	}
}

func TestExpressionLanguageTypeChecksWithLiveTSC(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Untyped data() values are any, so an arrow over one must not be an
	// implicit-any error; a typed field keeps its own checking.
	writeLiveView(t, root, `<puzzle-view>
  <p>{ name.trim().toUpperCase() } { currency(price, '$', 2) } { truncate(title, 20) }</p>
  <p>{ list.filter(x => x.on).map((x, i) => i + x.n).join(', ') } { list.reduce((s, x) => s + x.n, 0) }</p>
  <p>{ tags.toSorted().at(-1) ?? '' } { Object.keys(counts).length } { Math.max(0, n - 1) }</p>
  <p>{ myFormat(name).length + 1 } { myFormat(name, 2).nested.value } { `+"`${ name } x`"+` }</p>
  <button @click={ pick(tags.filter(t => t.length > 1)) } @input={ rename(event.target.value) }>x</button>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  name = 'ab';
  price = 3;
  n = 1;
  tags: string[] = [];
  counts: Record<string, number> = {};
}
</script>
`)
	if _, err := Run(root); err != nil {
		t.Fatalf("the expression language must type-check clean under strict: %v", err)
	}

	for _, tc := range []struct {
		name, template, at, message string
	}{
		// A method from the table that the receiver's type does not have.
		{"method on the wrong type", "{ n.trim() }", "trim", "Property 'trim' does not exist on type 'number'."},
		// An arrow over a typed list is typed: its parameter is a string.
		{"typed arrow parameter", "{ tags.filter(t => t.done) }", "done", "Property 'done' does not exist on type 'string'."},
		// A standard function's signature.
		{"library signature", "{ currency(price, 2) }", "2", "Argument of type 'number' is not assignable to parameter of type 'string'."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `<puzzle-view><p>` + tc.template + `</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { n = 1; price = 3; tags: string[] = []; }
</script>
`
			writeLiveView(t, root, source)
			_, err := Run(root)
			if err == nil {
				t.Fatalf("expected a type error for %s", tc.template)
			}
			line, col := pzlPosition(t, source, tc.at)
			want := fmt.Sprintf("app/views/Home.pzl:%d:%d: %s", line, col, tc.message)
			if got := err.Error(); got != want {
				t.Fatalf("diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
			}
		})
	}
}
