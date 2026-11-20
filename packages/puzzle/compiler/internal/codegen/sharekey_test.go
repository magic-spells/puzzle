package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// sharekey_test.go — the D197 share() stamp (`Filter.__share = "filter";`) and
// the warning for a component named like a key of the data() input object.

// TestShareKey holds the camelcase rule to the runtime's shareKey regex.
func TestShareKey(t *testing.T) {
	cases := map[string]string{
		"Filter":      "filter",
		"FilterPanel": "filterPanel",
		"URLFilter":   "urlFilter",
		"UI":          "ui",
		"AB1":         "aB1",
		"filter":      "filter",
		"Übersicht":   "übersicht",
		"X":           "x",
	}
	for in, want := range cases {
		if got := shareKey(in); got != want {
			t.Errorf("shareKey(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestDeclaresShare: a method or a field named share counts; a property access,
// a comparison and a mention in a string or comment do not.
func TestDeclaresShare(t *testing.T) {
	yes := []string{
		"class A { share() { return {}; } }",
		"class A { share({ props }) { return {}; } }",
		"class A { share = () => ({}) }",
		"class A { share /* why */ () {} }",
	}
	no := []string{
		"class A { data() { return this.share(); } }",
		"class A { data() { return x?.share(); } }",
		"class A { data() { return share == 1; } }",
		"class A { data() { return 'share()'; } }",
		"class A { // share()\n }",
		"class A { shareThing() {} }",
	}
	for _, src := range yes {
		if !declaresShare(tokenizeJS(src)) {
			t.Errorf("expected a share declaration in %q", src)
		}
	}
	for _, src := range no {
		if declaresShare(tokenizeJS(src)) {
			t.Errorf("expected no share declaration in %q", src)
		}
	}
}

func compileShare(t *testing.T, src, file string) *Result {
	t.Helper()
	sec, err := parser.SplitSections(src, file)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: file, Mode: ModeComponent})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res
}

// TestShareStamp: a view that declares share() gets its camelcase key stamped;
// one that does not gets nothing.
func TestShareStamp(t *testing.T) {
	sharing := `<puzzle-view><div><Children/></div></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class FilterPanel extends PuzzleView {
  share({ props }) {
    return { value: props.value };
  }
}
</script>
`
	got := compileShare(t, sharing, "app/components/FilterPanel.pzl").JS
	if !strings.Contains(got, `FilterPanel.__share = 'filterPanel';`) {
		t.Errorf("expected the share stamp, got:\n%s", got)
	}

	plain := `<puzzle-view><div>{ value }</div></puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Plain extends PuzzleView {
  data({ props }) {
    return { value: this.share ? 1 : 0 };
  }
}
</script>
`
	if got := compileShare(t, plain, "app/components/Plain.pzl").JS; strings.Contains(got, "__share") {
		t.Errorf("expected no share stamp, got:\n%s", got)
	}
}

// TestReservedComponentNameWarning: Params, Props and Shared draw a positioned
// warning at the class name; a scriptless Shared.pzl warns at the file start.
func TestReservedComponentNameWarning(t *testing.T) {
	for _, name := range []string{"Params", "Props", "Shared"} {
		src := "<puzzle-view><div></div></puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class " + name + " extends PuzzleView {}\n</script>\n"
		res := compileShare(t, src, "app/components/"+name+".pzl")
		if len(res.Warnings) != 1 || !strings.Contains(res.Warnings[0].Message, "reserved keys") {
			t.Fatalf("%s: expected one reserved-name warning, got %#v", name, res.Warnings)
		}
		if res.Warnings[0].Line != 5 || res.Warnings[0].Col != 22 {
			t.Errorf("%s: warning at %d:%d, want 5:22", name, res.Warnings[0].Line, res.Warnings[0].Col)
		}
	}
	res := compileShare(t, "<puzzle-view><div></div></puzzle-view>\n", "app/components/Shared.pzl")
	if len(res.Warnings) != 1 || res.Warnings[0].Line != 1 {
		t.Fatalf("scriptless Shared.pzl: expected one warning at line 1, got %#v", res.Warnings)
	}
	if res := compileShare(t, "<puzzle-view><div></div></puzzle-view>\n", "app/components/PropsTable.pzl"); len(res.Warnings) != 0 {
		t.Errorf("PropsTable: expected no warning, got %#v", res.Warnings)
	}
}

// TestPositionalDataWarning: the pre-0.10 positional data(params, props) draws
// a warning at the method name (D197); the object form, a single non-params
// name, a typescript generic with a comma and property calls do not.
func TestPositionalDataWarning(t *testing.T) {
	wrap := func(body string) string {
		return "<puzzle-view><div></div></puzzle-view>\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class Card extends PuzzleView {\n" + body + "\n}\n</script>\n"
	}
	warns := []string{
		"  data(params, props) { return props; }",
		"  data(_params, props) { return props; }",
		"  data(params) { return { id: params.id }; }",
		"  data(params: Record<string, string>): any { return params; }",
		"  share(params, props) { return {}; }",
	}
	for _, body := range warns {
		res := compileShare(t, wrap(body), "app/components/Card.pzl")
		if len(res.Warnings) != 1 || !strings.Contains(res.Warnings[0].Message, "takes one object") {
			t.Fatalf("%q: expected one positional warning, got %#v", body, res.Warnings)
		}
		if res.Warnings[0].Line != 6 || res.Warnings[0].Col != 3 {
			t.Errorf("%q: warning at %d:%d, want 6:3", body, res.Warnings[0].Line, res.Warnings[0].Col)
		}
	}
	quiet := []string{
		"  data({ params, props }) { return props; }",
		"  data() { return {}; }",
		"  data(input) { return input.props; }",
		"  data({ props }: DataInput<A, B>): any { return props; }",
		"  data({ props, shared: { tabs = {} } }) { return props; }",
		"  created() { this.ctx.store.data(1, 2); }",
	}
	for _, body := range quiet {
		if res := compileShare(t, wrap(body), "app/components/Card.pzl"); len(res.Warnings) != 0 {
			t.Errorf("%q: expected no warning, got %#v", body, res.Warnings)
		}
	}
}
