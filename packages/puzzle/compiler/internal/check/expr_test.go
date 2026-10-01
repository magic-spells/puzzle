package check

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
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
	shim := shimSource(TypeScriptVersion{Major: 5, Minor: 2})
	if strings.Contains(shim, "__LIBRARY_SIGNATURES__") {
		t.Fatal("the shim placeholder was not filled")
	}
	for _, fn := range libraryFunctionSignatures {
		if !strings.Contains(shim, "    "+fn.name+fn.signature+";\n") {
			t.Errorf("shim is missing %s", fn.name)
		}
	}
}

// The shim's signatures are the public LibraryFunctions interface with its
// type aliases spelled out, so a template call type-checks exactly as the same
// call in the app's own TypeScript. The one allowed difference is a shim
// parameter widened to `unknown` (t's key). They drifted once: t took
// `Record<string, unknown>` vars, which rejects an interface-typed value, and
// date took one locale string where the runtime takes a list.
func TestLibrarySignaturesMatchPublicTypes(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "types", "index.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	src := string(data)
	start := strings.Index(src, "export interface LibraryFunctions {")
	if start < 0 {
		t.Fatal("types/index.d.ts has no LibraryFunctions interface")
	}
	end := strings.Index(src[start:], "\n}\n")
	if end < 0 {
		t.Fatal("types/index.d.ts: LibraryFunctions has no closing brace")
	}
	aliases := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^export type (\w+) = ([^;\n]+);$`).FindAllStringSubmatch(src, -1) {
		aliases[m[1]] = m[2]
	}
	expand := func(ty string) string {
		return regexp.MustCompile(`\b\w+\b`).ReplaceAllStringFunc(ty, func(word string) string {
			if a, ok := aliases[word]; ok {
				return a
			}
			return word
		})
	}
	public := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^\t(\w+)(\(.*\): .+);$`).FindAllStringSubmatch(src[start:start+end], -1) {
		public[m[1]] = m[2]
	}
	signature := regexp.MustCompile(`^\((.*)\): (.+)$`)
	for _, fn := range libraryFunctionSignatures {
		pub, ok := public[fn.name]
		if !ok {
			t.Errorf("LibraryFunctions has no %s", fn.name)
			continue
		}
		s, p := signature.FindStringSubmatch(fn.signature), signature.FindStringSubmatch(pub)
		sParams, pParams := strings.Split(s[1], ", "), strings.Split(p[1], ", ")
		same := len(sParams) == len(pParams) && s[2] == expand(p[2])
		for i := 0; same && i < len(sParams); i++ {
			sName, sType, _ := strings.Cut(sParams[i], ": ")
			pName, pType, _ := strings.Cut(pParams[i], ": ")
			same = sName == pName && (sType == "unknown" || sType == expand(pType))
		}
		if !same {
			t.Errorf("%s: shim %s, LibraryFunctions %s", fn.name, fn.signature, pub)
		}
		delete(public, fn.name)
	}
	for name := range public {
		t.Errorf("LibraryFunctions.%s has no shim signature", name)
	}
}

// The method table's lib files are referenced whatever the app's target, and
// es2023.array from TypeScript 5.0, the first to ship it: on 5.0 and 5.1 it
// types findLast (toSorted and toReversed join it in 5.2, and no reference
// can add them earlier).
func TestShimReferencesLanguageLibs(t *testing.T) {
	for _, tc := range []struct {
		ts     TypeScriptVersion
		es2023 bool
	}{
		{TypeScriptVersion{4, 9}, false},
		{TypeScriptVersion{5, 0}, true},
		{TypeScriptVersion{5, 1}, true},
		{TypeScriptVersion{5, 2}, true},
		{TypeScriptVersion{5, 9}, true},
		{TypeScriptVersion{7, 0}, true},
	} {
		shim := shimSource(tc.ts)
		for _, lib := range []string{"es2022.array", "es2022.string", "es2021.string", "es2019.array"} {
			if !strings.Contains(shim, `/// <reference lib="`+lib+`" />`) {
				t.Errorf("TypeScript %+v: shim is missing lib %s", tc.ts, lib)
			}
		}
		if got := strings.Contains(shim, `/// <reference lib="es2023.array" />`); got != tc.es2023 {
			t.Errorf("TypeScript %+v: es2023.array referenced = %v, want %v", tc.ts, got, tc.es2023)
		}
		if !strings.HasPrefix(shim, "/// <reference types=\"@magic-spells/puzzle/puzzle-env\" />\n/// <reference lib=") {
			t.Errorf("TypeScript %+v: the lib references must lead the file:\n%s", tc.ts, shim[:200])
		}
	}
}

func TestParseTypeScriptVersion(t *testing.T) {
	for _, tc := range []struct {
		output string
		want   TypeScriptVersion
		ok     bool
	}{
		{"Version 5.7.3\n", TypeScriptVersion{5, 7}, true},
		{"Version 5.2.2", TypeScriptVersion{5, 2}, true},
		{"Version 5.1.6", TypeScriptVersion{5, 1}, true},
		{"Version 4.9.5", TypeScriptVersion{4, 9}, true},
		{"Version 7.0.2", TypeScriptVersion{7, 0}, true},
		{"Version 5.3.0-beta", TypeScriptVersion{5, 3}, true},
		{"Version 5.10.1", TypeScriptVersion{5, 10}, true},
		{"Version 5", TypeScriptVersion{}, false},
		{"tsc: command not found", TypeScriptVersion{}, false},
		{"", TypeScriptVersion{}, false},
	} {
		got, err := parseTypeScriptVersion(tc.output)
		if (err == nil) != tc.ok || got != tc.want {
			t.Errorf("parseTypeScriptVersion(%q) = %+v, %v; want %+v, ok %v", tc.output, got, err, tc.want, tc.ok)
		}
	}
	if !(TypeScriptVersion{5, 10}).AtLeast(TypeScriptVersion{5, 2}) || (TypeScriptVersion{5, 1}).AtLeast(TypeScriptVersion{5, 2}) ||
		!(TypeScriptVersion{6, 0}).AtLeast(TypeScriptVersion{5, 2}) {
		t.Error("AtLeast compares major, then minor")
	}
}

// The arrow wrapper ends the optional chain it cuts through, so the method
// step takes the `?.` over; a parenthesized chain stays its own chain, and
// TypeScript reports its possibly-undefined result as it would in JavaScript.
func TestCheckListWrapperKeepsOptionalChain(t *testing.T) {
	source := []byte(`<puzzle-view>
  <p>{ user?.posts.filter(p => p.published).length }</p>
  <p>{ user.posts?.map(p => p.id) }</p>
  <p>{ (user?.posts).filter(p => p.published) }</p>
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
		"void (__puzzle_check_list(__d.user?.posts)?.filter((p) => p.published).length);",
		"void (__puzzle_check_list(__d.user.posts)?.map((p) => p.id));",
		"void (__puzzle_check_list(__d.user?.posts).filter((p) => p.published));",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated file is missing %q:\n%s", want, got)
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
  <p>{ Object.keys(counts).length } { myFormat(name) }</p>
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
		"void (Object.keys(__d.counts).length);",
		`void (__puzzle_app_fn("myFormat")(__d.name));`,
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
  <p>{ pluralize(n, 'comment') } { pluralize(n, 'child', 'children') }</p>
  <p>{ user?.posts.filter(p => p.published).length } { user?.posts.map(p => p.title.trim()).at(0) }</p>
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
  user?: { posts: { published: boolean; title: string }[] };
  events = { pick: (_tags: string[]) => {}, rename: (_name: string) => {} };
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

// The library calls the public types accept check clean: translation vars are
// any object — an interface or a class instance carries no index signature, so
// a Record type rejected both — or null, and a date locale may be a list. A
// preset outside the four is an error, as it is in the app's own code.
func TestLibraryCallsAcceptThePublicArgumentsWithLiveTSC(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	view := func(template string) string {
		return `<puzzle-view><p>` + template + `</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
interface User { name: string }
class Account { name = 'a'; }
export default class Home extends PuzzleView {
  user: User = { name: 'a' };
  account = new Account();
  when = new Date();
}
</script>
`
	}
	writeLiveView(t, root, view(`{ t('greeting', user) } { t('greeting', account) } { t('x', null) } { date(when, 'long', ['de-DE', 'en']) } { datetime(when, 'iso', 'en') }`))
	if _, err := Run(root); err != nil {
		t.Fatalf("library calls the public types accept must check clean: %v", err)
	}
	writeLiveView(t, root, view(`{ date(when, 'longest') }`))
	if _, err := Run(root); err == nil || !strings.Contains(err.Error(), `'"longest"'`) {
		t.Fatalf("an unknown date preset must be a type error, got %v", err)
	}
}

// An app function is typed through a call (`__puzzle_app_fn("name")(…)`), not an
// index signature, so it stays callable under the two strict index-signature
// flags — noUncheckedIndexedAccess typed an index-signature member as possibly
// undefined ("Cannot invoke an object which is possibly 'undefined'"). The
// standard functions keep their declared signatures. An Object global keeps
// the author's spelling here (the render target's `?? {}` default is not
// emitted), so a literal argument is not a TypeScript 5.6+ "left operand is
// never nullish" error.
func TestAppFunctionsTypeCheckUnderStrictIndexFlags(t *testing.T) {
	root := liveTSCApp(t)
	cfg := `{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"noPropertyAccessFromIndexSignature":true}}`
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	writeLiveView(t, root, `<puzzle-view>
  <p>{ myFormat(name) } { myFormat(name, 2).nested.value } { currency(price, '$') }</p>
  <p>{ Object.keys({ a: 1 }).length } { Object.values(settings).filter(v => v).length }</p>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  name = 'ab';
  price = 3;
  settings: Record<string, boolean> = {};
}
</script>
`)
	if _, err := Run(root); err != nil {
		t.Fatalf("app and standard function calls must type-check under the strict index flags: %v", err)
	}

	// The standard signatures are not loosened with them.
	bad := `<puzzle-view><p>{ myFormat(name) } { currency(price, 2) }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { name = 'ab'; price = 3; }
</script>
`
	writeLiveView(t, root, bad)
	_, err := Run(root)
	if err == nil {
		t.Fatal("expected the standard signature to reject a number symbol")
	}
	line, col := pzlPosition(t, bad, "2) }")
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Argument of type 'number' is not assignable to parameter of type 'string'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}
