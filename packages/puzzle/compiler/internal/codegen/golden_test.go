package codegen

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

var update = flag.Bool("update", false, "regenerate golden files")

// compileFile splits + compiles a .pzl file at the given emission mode.
func compileFile(t *testing.T, path string, mode EmissionMode) string {
	t.Helper()
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	sec, err := parser.SplitSections(string(src), filepath.Base(path))
	if err != nil {
		t.Fatalf("split %s: %v", path, err)
	}
	res, err := Compile(sec, Options{Filename: filepath.Base(path), Mode: mode, AssetsDir: "testdata/assets"})
	if err != nil {
		t.Fatalf("compile %s: %v", path, err)
	}
	return res.JS
}

// TestGoldens runs the per-construct golden files: testdata/NAME.pzl compiled
// and byte-compared against testdata/NAME.golden.js. Files whose name contains
// "inline_component" compile in component (inline) mode; the rest as views.
func TestGoldens(t *testing.T) {
	matches, err := filepath.Glob("testdata/*.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) == 0 {
		t.Fatal("no testdata/*.pzl golden inputs found")
	}
	for _, in := range matches {
		in := in
		name := strings.TrimSuffix(filepath.Base(in), ".pzl")
		t.Run(name, func(t *testing.T) {
			mode := ModeView
			if strings.Contains(name, "inline_component") {
				mode = ModeComponent
			}
			got := compileFile(t, in, mode)
			goldenPath := "testdata/" + name + ".golden.js"
			if *update {
				if err := os.WriteFile(goldenPath, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(goldenPath)
			if err != nil {
				t.Fatalf("read golden (run -update?): %v", err)
			}
			if got != string(want) {
				t.Errorf("golden mismatch for %s\n%s", name, firstDiff(string(want), got))
			}
		})
	}
}

// TestFormatterMissingGuard asserts the D43 emission contract explicitly: every
// library call reads the registry through its own get(), `__f.get("name")(…)`,
// with a JSON-quoted name, and nothing else reads `__f`. get() returns the
// registered function or the __missing pass-through, so a direct `__f[…]` or
// `__f.name` read would skip the guard. This guards the golden from a blind
// `-update` silently reverting the contract.
func TestFormatterMissingGuard(t *testing.T) {
	got := compileFile(t, "testdata/formatter_chain.pzl", ModeView)
	for _, want := range []string{
		`__f.get("capitalize")(__d.title)`,
		`__f.get("truncate")(`,
		`__f.get("currency")(__d.price, '$', 2)`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("compiled output missing guarded formatter call %q\n%s", want, got)
		}
	}
	for _, m := range formatterReadRE.FindAllStringIndex(got, -1) {
		if !strings.HasPrefix(got[m[0]:], `__f.get("`) {
			t.Errorf("compiled output reads __f other than through get():\n%s", got)
		}
	}
}

// formatterReadRE matches a read off the registry binding, `__f.` or `__f[`.
var formatterReadRE = regexp.MustCompile(`__f[.[]`)

// TestFunctionNameIsQuotedKey pins that a library call names its registry key
// as a JSON-quoted string, so any identifier the grammar accepts — a Unicode
// name, a `$` — is the key as written, and a missing one reaches the D43
// __missing guard.
func TestFunctionNameIsQuotedKey(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
  <p>{ größe(x) } { $fmt(x) }</p>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView { data() { return { x: '' }; } }
</script>
`)
	for _, want := range []string{
		`__f.get("größe")(__d.x)`,
		`__f.get("$fmt")(__d.x)`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
}

// normalizeFixture reduces a hand-written fixture (or generated output) to its
// structural form for the golden-#1 comparison. Documented normalizations for
// the compiler golden strategy (constellation/doc/DOC-COMPILER-DESIGN.md / constellation/doc/DOC-TESTING.md):
//  1. leading header comment / all full-line `//` comments removed;
//  2. blank lines removed;
//  3. the fixture's relative runtime import specifiers mapped to
//     '@magic-spells/puzzle'.
//
// Full-line-comment stripping is required because the fixture is hand-annotated
// (editorial banners in render(), and a differently-worded setFilter comment in
// <script>); the compiler emits neither. It is symmetric (applied to both
// sides) and only drops lines whose first non-space token is `//`, so URLs and
// `//` inside strings are untouched.
func normalizeFixture(s string) string {
	s = strings.ReplaceAll(s, "'../../../client-runtime/index.js'", "'@magic-spells/puzzle'")
	s = strings.ReplaceAll(s, "'../../../client-runtime/views/ViewNode.js'", "'@magic-spells/puzzle'")
	// Cross-component import: the hand fixture points at the sibling COMPILED
	// module (runnable JS the fixture lane imports directly); the compiler emits
	// the <script> specifier verbatim ('../components/TodoItem.pzl'). Same
	// import, different specifier — map the fixture form to the compiler form so
	// the golden compare stays structural (symmetric with the runtime mapping).
	s = strings.ReplaceAll(s, "'./TodoItem.compiled.js'", "'../components/TodoItem.pzl'")
	var kept []string
	for _, line := range strings.Split(s, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// TestGoldenHome is golden file #1 (FILE-TESTS-FIXTURES-TODOS-HOME-COMPILED): the real examples/todos Home.pzl must
// compile to tests/fixtures/todos/Home.compiled.js (modulo the documented
// normalizations). If this fails, the codegen is wrong — the fixture wins.
func TestGoldenHome(t *testing.T) {
	got := compileFile(t, "../../../examples/todos/app/views/Home.pzl", ModeView)
	want, err := os.ReadFile("../../../tests/fixtures/todos/Home.compiled.js")
	if err != nil {
		t.Fatal(err)
	}
	g, w := normalizeFixture(got), normalizeFixture(string(want))
	if g != w {
		t.Errorf("Home golden mismatch\n%s", firstDiff(w, g))
	}
}

// TestGoldenDefault is the layout-mode companion (Slot + SLOT_TAG import).
func TestGoldenDefault(t *testing.T) {
	got := compileFile(t, "../../../examples/todos/app/layouts/Default.pzl", ModeView)
	want, err := os.ReadFile("../../../tests/fixtures/todos/Default.compiled.js")
	if err != nil {
		t.Fatal(err)
	}
	g, w := normalizeFixture(got), normalizeFixture(string(want))
	if g != w {
		t.Errorf("Default golden mismatch\n%s", firstDiff(w, g))
	}
}

// TestGoldenTodoItem pins the component-mode fixture the Home fixture imports.
func TestGoldenTodoItem(t *testing.T) {
	got := compileFile(t, "../../../examples/todos/app/components/TodoItem.pzl", ModeComponent)
	want, err := os.ReadFile("../../../tests/fixtures/todos/TodoItem.compiled.js")
	if err != nil {
		t.Fatal(err)
	}
	g, w := normalizeFixture(got), normalizeFixture(string(want))
	if g != w {
		t.Errorf("TodoItem golden mismatch\n%s", firstDiff(w, g))
	}
}

// TestNodeCheck syntax-checks the compiled real Home module with `node --check`.
// CI runs node, so this is a plain exec test; it skips gracefully if node is
// absent so a node-less environment still passes `go test`.
func TestNodeCheck(t *testing.T) {
	nodeBin, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not available; skipping syntax check")
	}
	got := compileFile(t, "../../../examples/todos/app/views/Home.pzl", ModeView)
	// Neutralize the bare-specifier import so `node --check` (which only parses)
	// is happy; it does not resolve modules but the specifier must be syntactic.
	dir := t.TempDir()
	f := filepath.Join(dir, "Home.compiled.mjs")
	if err := os.WriteFile(f, []byte(got), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(nodeBin, "--check", f).CombinedOutput()
	if err != nil {
		t.Fatalf("node --check failed: %v\n%s", err, out)
	}
}

// firstDiff returns a compact description of the first differing line.
func firstDiff(want, got string) string {
	wl := strings.Split(want, "\n")
	gl := strings.Split(got, "\n")
	n := len(wl)
	if len(gl) < n {
		n = len(gl)
	}
	for i := 0; i < n; i++ {
		if wl[i] != gl[i] {
			return "first diff at line " + itoa(i+1) + ":\n  want: " + quote(wl[i]) + "\n  got:  " + quote(gl[i])
		}
	}
	if len(wl) != len(gl) {
		return "line count differs: want " + itoa(len(wl)) + " got " + itoa(len(gl))
	}
	return "(no line diff; trailing bytes differ)"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}

func quote(s string) string { return "\"" + s + "\"" }
