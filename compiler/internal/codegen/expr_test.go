package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

func scope(names ...string) map[string]bool {
	m := map[string]bool{}
	for _, n := range names {
		m[n] = true
	}
	return m
}

func TestResolveExpr(t *testing.T) {
	cases := []struct {
		name  string
		expr  string
		scope map[string]bool
		want  string
	}{
		{"bare root", "newTodoText", nil, "__d.newTodoText"},
		{"member chain root only", "todos.length", nil, "__d.todos.length"},
		{"loop var stays", "todo.text", scope("todo"), "todo.text"},
		{"negation + call", "!newTodoText.trim()", nil, "!__d.newTodoText.trim()"},
		{"binary both sides", "a + b", nil, "__d.a + __d.b"},
		{"comparison keeps literal", "currentFilter === 'all'", nil, "__d.currentFilter === 'all'"},
		{"number literal untouched", "todos.length > 0", nil, "__d.todos.length > 0"},
		{"string contents untouched", "'a.b + c'", nil, "'a.b + c'"},
		{"double-quoted string", "\"x + y\"", nil, "\"x + y\""},
		{"keyword true", "true", nil, "true"},
		{"keyword this", "this", nil, "this"},
		{"null/undefined", "a || null || undefined", nil, "__d.a || null || undefined"},
		{"optional chaining property", "user.profile?.name", nil, "__d.user.profile?.name"},
		{"event in scope", "handler(event)", scope("event"), "__d.handler(event)"},
		{"template literal statics untouched, interp resolved",
			"`hi ${name}!`", nil, "`hi ${__d.name}!`"},
		{"template literal loop var", "`${todo.id}`", scope("todo"), "`${todo.id}`"},
		{"computed index is a root", "rows[i]", nil, "__d.rows[__d.i]"},
		{"computed index loop var", "rows[i]", scope("i"), "__d.rows[i]"},
		{"typeof keyword", "typeof x", nil, "typeof __d.x"},
		// JS globals must not be data-prefixed (else __d.Math is undefined →
		// runtime TypeError), but real data args inside them still are.
		{"global Math not prefixed", "Math.max(count, 1)", nil, "Math.max(__d.count, 1)"},
		{"global JSON stringify", "JSON.stringify(obj)", nil, "JSON.stringify(__d.obj)"},
		{"global Date.now", "Date.now()", nil, "Date.now()"},
		{"global Number call arg prefixed", "Number(x)", nil, "Number(__d.x)"},
		{"global Object.keys arg prefixed", "Object.keys(user)", nil, "Object.keys(__d.user)"},
		{"global Intl formatter", "Intl.NumberFormat('en').format(x)", nil, "Intl.NumberFormat('en').format(__d.x)"},
		{"global typed array", "Uint8Array.from(bytes)", nil, "Uint8Array.from(__d.bytes)"},
		{"plain data var still prefixed", "foo.bar", nil, "__d.foo.bar"},
		// Numeric literals pass through unchanged — their letters/underscores must
		// not be split off as an identifier.
		{"scientific literal", "1e3", nil, "1e3"},
		{"hex literal", "0xFF", nil, "0xFF"},
		{"separator literal", "1_000", nil, "1_000"},
		{"bigint literal", "100n", nil, "100n"},
		{"signed exponent literal", "1.5e-3", nil, "1.5e-3"},
		{"binary literal", "0b1010", nil, "0b1010"},
		{"number then data ident", "1e3 + count", nil, "1e3 + __d.count"},
		{"data ident then number", "count * 0xFF", nil, "__d.count * 0xFF"},
		// Regex literals are copied verbatim — their bodies are never tokenized
		// as identifiers, while the receiver/args around them still resolve.
		{"regex arg to replace", "name.replace(/a/g, \"b\")", nil, "__d.name.replace(/a/g, \"b\")"},
		{"regex with escaped slash", "s.match(/a\\/b/)", nil, "__d.s.match(/a\\/b/)"},
		{"regex char class with slash", "s.match(/[/]+/)", nil, "__d.s.match(/[/]+/)"},
		{"regex char class containing slashes", "s.match(/[a//b]/)", nil, "__d.s.match(/[a//b]/)"},
		{"regex at expression start with flags", "/x/gi", nil, "/x/gi"},
		{"regex after open paren", "fmt(/y/)", nil, "__d.fmt(/y/)"},
		{"regex after comma arg", "fmt(x, /y/)", nil, "__d.fmt(__d.x, /y/)"},
		{"regex method call after literal", "/a/g.test(x)", nil, "/a/g.test(__d.x)"},
		// Division must stay division — the '/' follows a value, not an operator.
		{"simple division", "a / b", nil, "__d.a / __d.b"},
		{"division chain", "a / b / c", nil, "__d.a / __d.b / __d.c"},
		{"divide assign", "count /= 2", nil, "__d.count /= 2"},
		{"parenthesized division", "(a+b)/c", nil, "(__d.a+__d.b)/__d.c"},
		{"index then division", "arr[0] / 2", nil, "__d.arr[0] / 2"},
		// Comments are copied verbatim; identifiers inside are never prefixed.
		{"line comment", "a // note about b", nil, "__d.a // note about b"},
		{"block comment", "a /* b c */ + d", nil, "__d.a /* b c */ + __d.d"},
		// Spread/rest `...`: the name after the dots is a ROOT, not a member, so it
		// is data-prefixed (the '.' of a member access still suppresses the prefix).
		{"spread array root", "[...items]", nil, "[...__d.items]"},
		{"spread call arg root", "f(...args)", nil, "__d.f(...__d.args)"},
		{"spread after member chain", "fn(...obj.list)", nil, "__d.fn(...__d.obj.list)"},
		{"spread of loop var stays", "[...list]", scope("list"), "[...list]"},
		{"member access untouched by spread fix", "a.b.c", nil, "__d.a.b.c"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveExpr(tc.expr, tc.scope); got != tc.want {
				t.Errorf("resolveExpr(%q)\n  got  %q\n  want %q", tc.expr, got, tc.want)
			}
		})
	}
}

func TestNestedTemplateLiteralExpressionCompile(t *testing.T) {
	const expr = "`outer ${`inner }`}`"
	res, err := compileTemplate(t, "<puzzle-view>{ "+expr+" }</puzzle-view>", "")
	if err != nil {
		t.Fatalf("compile nested template literal: %v", err)
	}
	if want := "String(" + expr + ")"; !strings.Contains(res.JS, want) {
		t.Fatalf("compiled expression did not preserve the source bytes %q:\n%s", want, res.JS)
	}
}

func TestRegexLiteralImmediatelyAfterBraceCompiles(t *testing.T) {
	res, err := compileTemplate(t, "<puzzle-view>{/\\d+/.test(x)}</puzzle-view>", "")
	if err != nil {
		t.Fatalf("compile no-space regex interpolation: %v", err)
	}
	if want := "String(/\\d+/.test(__d.x))"; !strings.Contains(res.JS, want) {
		t.Fatalf("compiled output missing %q:\n%s", want, res.JS)
	}
}

// TestObjectLiteralRejected asserts the FIX 2 guard (SPEC §6): a template
// expression that begins with an object literal fails with the shared,
// positioned compile error instead of emitting invalid JS. Covered at all three
// entry points — a text interpolation, a dynamic attribute, and an event-handler
// call argument. wantCol is derived from the source so the position check is not
// hand-counted; each Pos points at the construct's opening token.
func TestObjectLiteralRejected(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		marker string // substring whose start column the error must point at
	}{
		{"text interpolation", `<puzzle-view>{ { a: 1 } }</puzzle-view>`, "{ { a"},
		{"dynamic attribute", `<puzzle-view><div x={ { a: 1 } }></div></puzzle-view>`, "x="},
		{"event call argument", `<puzzle-view><button @click={ save({ id: 1 }) }></button></puzzle-view>`, "@click"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := compileTemplate(t, tc.body, "")
			if err == nil {
				t.Fatalf("expected an object-literal error for %q", tc.body)
			}
			if !strings.Contains(err.Error(), objectLiteralMsg) {
				t.Errorf("error %q missing object-literal message", err.Error())
			}
			pe, ok := err.(*parser.ParseError)
			if !ok {
				t.Fatalf("err: got %T, want *parser.ParseError", err)
			}
			wantCol := strings.Index(tc.body, tc.marker) + 1
			if pe.File != "T.pzl" || pe.Line != 1 || pe.Col != wantCol {
				t.Errorf("position: got %s:%d:%d, want T.pzl:1:%d", pe.File, pe.Line, pe.Col, wantCol)
			}
		})
	}
}

func TestMatchBalanced(t *testing.T) {
	cases := []struct {
		name       string
		s          string
		open       int
		openDelim  byte
		closeDelim byte
		want       int
	}{
		{"simple parens", "(a, b)", 0, '(', ')', 5},
		{"regex with close paren in class", "(/[)]/)", 0, '(', ')', 6},
		{"regex literal arg", "(/a|b/)", 0, '(', ')', 6},
		{"paren inside string", "('a)b')", 0, '(', ')', 6},
		{"paren inside line comment", "(a // )\n)", 0, '(', ')', 8},
		{"nested parens", "(f(x))", 0, '(', ')', 5},
		{"division not regex", "(a / b)", 0, '(', ')', 6},
		{"unbalanced parens", "(a", 0, '(', ')', -1},
		{"simple braces", "{a: 1}", 0, '{', '}', 5},
		{"regex with close brace", "{/}/.test(x)}", 0, '{', '}', 12},
		{"brace inside string", "{'}'}", 0, '{', '}', 4},
		{"nested object", "{a: {b: 1}}", 0, '{', '}', 10},
		{"unbalanced braces", "{a", 0, '{', '}', -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := matchBalanced(tc.s, tc.open, tc.openDelim, tc.closeDelim); got != tc.want {
				t.Errorf("matchBalanced(%q, %d, %q, %q) = %d, want %d",
					tc.s, tc.open, tc.openDelim, tc.closeDelim, got, tc.want)
			}
		})
	}
}

func TestCompileEventValue(t *testing.T) {
	cases := []struct {
		name      string
		expr      string
		scope     map[string]bool
		want      string
		wantCache bool // expected D62 cacheability (data-independence)
		wantErr   bool
	}{
		{"bare id", "clearCompleted", nil, "(event) => this.events.clearCompleted(event)", true, false},
		{"call with string arg", "setFilter('all')", nil, "(event) => this.events.setFilter('all')", true, false},
		{"call with event arg", "addTodo(event)", nil, "(event) => this.events.addTodo(event)", true, false},
		{"call with no args", "reset()", nil, "(event) => this.events.reset()", true, false},
		{"call with this arg", "save(this.x)", nil, "(event) => this.events.save(this.x)", true, false},
		{"call with global arg", "clamp(Math.PI)", nil, "(event) => this.events.clamp(Math.PI)", true, false},
		// Loop/scope variables and data references capture render state → NOT
		// cacheable, and must emit the plain arrow byte-identical to v1.28.
		{"call with loop var arg", "toggleTodo(todo)", scope("todo"), "(event) => this.events.toggleTodo(todo)", false, false},
		{"call with data arg", "save(payload)", nil, "(event) => this.events.save(__d.payload)", false, false},
		// A string literal containing "__d." is a harmless false negative: correct
		// output, just misses the cache (the substring guard is conservative).
		{"string literal false negative", "h('__d.')", nil, "(event) => this.events.h('__d.')", false, false},
		// A regex arg with a ')' inside a [...] class must not close the call
		// early — matchBalanced has to skip the regex literal.
		{"call with regex arg closing paren in class", "handle(/[)]/)", nil, "(event) => this.events.handle(/[)]/)", true, false},
		{"call with regex arg brace in class", "handle(/[}]/)", nil, "(event) => this.events.handle(/[}]/)", true, false},
		{"member callee is error", "obj.method()", nil, "", false, true},
		{"not a call and not id is error", "a + b", nil, "", false, true},
		{"trailing junk after call is error", "f() + 1", nil, "", false, true},
		// An object-literal first argument is rejected (SPEC §6), not mangled.
		{"object literal arg is error", "save({ id: 1 })", nil, "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, cacheable, err := compileEventValue(tc.expr, tc.scope)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("compileEventValue(%q) = %q, want error", tc.expr, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("compileEventValue(%q) unexpected error: %v", tc.expr, err)
			}
			if got != tc.want {
				t.Errorf("compileEventValue(%q)\n  got  %q\n  want %q", tc.expr, got, tc.want)
			}
			if cacheable != tc.wantCache {
				t.Errorf("compileEventValue(%q) cacheable = %v, want %v", tc.expr, cacheable, tc.wantCache)
			}
		})
	}
}
