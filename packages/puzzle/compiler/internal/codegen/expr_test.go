package codegen

import (
	"sort"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// expr_test.go pins the AST lowering (lower.go): one line per rule of the
// lowering table, the handler forms and their D62 caching verdicts, and the
// D170 render facts read off the tree.

func scope(names ...string) scopeMap {
	m := scopeMap{}
	for _, n := range names {
		m[n] = ""
	}
	return m
}

func bindings(s scopeMap) []string {
	out := make([]string, 0, len(s))
	for k := range s {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// parseExpr parses src the way the template parser parses an expression
// position, with scope's names bound.
func parseExpr(t *testing.T, src string, s scopeMap, handler bool) expr.Node {
	t.Helper()
	n, err := expr.Parse(src, expr.Pos{Line: 1, Col: 1}, expr.Options{Bindings: bindings(s), Handler: handler})
	if err != nil {
		t.Fatalf("parse %q: %v", src, err)
	}
	return n
}

// lowerJS lowers src as a template value for the render target.
func lowerJS(t *testing.T, src string, s scopeMap, rowScopes ...string) string {
	t.Helper()
	w := &textWriter{}
	l := newLowerer(w, targetRender, s, nil)
	l.rowScopes = rowScopes
	l.value(parseExpr(t, src, s, false))
	return w.String()
}

// lowerFacts lowers src as a template value and returns what it read.
func lowerFacts(t *testing.T, src string, s scopeMap) *exprFacts {
	t.Helper()
	f := &exprFacts{}
	newLowerer(&textWriter{}, targetRender, s, f).value(parseExpr(t, src, s, false))
	return f
}

// lowerHandler lowers src as an @event value for the render target.
func lowerHandler(t *testing.T, src string, s scopeMap) (eventValue, error) {
	t.Helper()
	w := &textWriter{}
	ev, err := newLowerer(w, targetRender, s, nil).handler(parseExpr(t, src, s, true), src, false)
	ev.js = w.String()
	return ev, err
}

func TestLowering(t *testing.T) {
	row := scopeMap{"todo": "s.item", "i": "s.i"}
	cases := []struct {
		name  string
		src   string
		scope scopeMap
		want  string
	}{
		// Identifiers.
		{"data root", "newTodoText", nil, "__d.newTodoText"},
		{"template binding, bare", "todo", scope("todo"), "todo"},
		{"template binding, row rewrite", "todo", row, "s.item"},
		{"row counter", "i + 1", row, "s.i + 1"},
		{"unicode name", "café.naïve", nil, "__d.café?.naïve"},
		// Literals, as written.
		{"string single", "'a.b + c'", nil, "'a.b + c'"},
		{"string double", `"x + y"`, nil, `"x + y"`},
		{"numbers", "1e3 + .5 + 2.", nil, "1e3 + .5 + 2."},
		{"literal words", "a || null || undefined || true", nil, "__d.a || null || undefined || true"},
		{"NaN and Infinity", "x === NaN || x < Infinity", nil, "__d.x === NaN || __d.x < Infinity"},
		// Member reads: every step guarded (D173 V4).
		{"member chain", "user.profile.name", nil, "__d.user?.profile?.name"},
		{"authored optional kept", "a?.b.c", nil, "__d.a?.b?.c"},
		{"computed", "rows[i]", nil, "__d.rows?.[__d.i]"},
		{"optional computed", "a?.[0]", nil, "__d.a?.[0]"},
		{"computed index is its own chain", "rows[sel.id].label", nil, "__d.rows?.[__d.sel?.id]?.label"},
		{"row member", "todo.text", row, "s.item?.text"},
		{"chain in object position keeps its parens", "(a?.b).c", nil, "(__d.a?.b)?.c"},
		{"step off a string literal", "'abc'.length", nil, "'abc'?.length"},
		{"step off a number literal", "(5).toFixed(2)", nil, "(5)?.toFixed(2)"},
		{"length is a plain property", "items.length > 0", nil, "__d.items?.length > 0"},
		// Calls.
		{"method", "name.trim()", nil, "__d.name?.trim()"},
		{"method result", "name.trim().length", nil, "__d.name?.trim()?.length"},
		{"method with args", "tags.join(', ')", nil, "__d.tags?.join(', ')"},
		{"library function", "currency(price, '$')", nil, `(__f["currency"] || __f.__missing("currency"))(__d.price, '$')`},
		{"nested library functions", "truncate(capitalize(title), 20)", nil,
			`(__f["truncate"] || __f.__missing("truncate"))((__f["capitalize"] || __f.__missing("capitalize"))(__d.title), 20)`},
		{"library result member", "json(x).length", nil, `(__f["json"] || __f.__missing("json"))(__d.x)?.length`},
		{"Math function", "Math.round(x * 100) / 100", nil, "Math.round(__d.x * 100) / 100"},
		{"bare global", "Number(x) + parseInt(y)", nil, "Number(__d.x) + parseInt(__d.y)"},
		{"URI global", "'/search?q=' + encodeURIComponent(q)", nil, "'/search?q=' + encodeURIComponent(__d.q)"},
		{"Object.keys", "Object.keys(user).length", nil, "Object.keys(__d.user)?.length"},
		{"Math constant", "Math.PI * r", nil, "Math.PI * __d.r"},
		{"step off a Math constant", "Math.PI.toFixed(2)", nil, "Math.PI?.toFixed(2)"},
		// Arrow functions: a fresh scope whose parameters shadow everything.
		{"arrow param shadows a data root", "items.map(x => x.id)", nil, "__d.items?.map((x) => x?.id)"},
		{"arrow param shadows a row local", "items.filter(todo => todo.done)", row, "__d.items?.filter((todo) => todo?.done)"},
		{"arrow reads a row local", "items.filter(t => t.id === todo.id)", row, "__d.items?.filter((t) => t?.id === s.item?.id)"},
		{"arrow two params", "items.map((x, i) => i + x.n)", nil, "__d.items?.map((x, i) => i + x?.n)"},
		{"arrow object body", "items.map(x => ({ id: x.id }))", nil, "__d.items?.map((x) => ({ id: x?.id }))"},
		{"arrow body starting with an object", "items.map(x => ({ a: 1 }).a)", nil, "__d.items?.map((x) => ({ a: 1 }?.a))"},
		{"nested arrows", "groups.map(g => g.items.filter(x => x.on))", nil, "__d.groups?.map((g) => g?.items?.filter((x) => x?.on))"},
		{"reduce with an initial value", "items.reduce((sum, x) => sum + x.n, 0)", nil, "__d.items?.reduce((sum, x) => sum + x?.n, 0)"},
		// Operators: parentheses from precedence, never from source spacing.
		{"grouping kept where needed", "(a+b)/c", nil, "(__d.a + __d.b) / __d.c"},
		{"left associativity", "a - b - c", nil, "__d.a - __d.b - __d.c"},
		{"right operand grouped", "a - (b - c)", nil, "__d.a - (__d.b - __d.c)"},
		{"redundant grouping dropped", "(a * b) + c", nil, "__d.a * __d.b + __d.c"},
		{"unary", "!a && -b", nil, "!__d.a && -__d.b"},
		{"unary over a group", "!(a && b)", nil, "!(__d.a && __d.b)"},
		{"double negation", "-(-a)", nil, "-(-__d.a)"},
		{"double plus", "+(+a)", nil, "+(+__d.a)"},
		{"minus a negative", "a - -b", nil, "__d.a - -__d.b"},
		{"nullish", "a ?? 'x'", nil, "__d.a ?? 'x'"},
		{"?? over a grouped ||", "(a || b) ?? c", nil, "(__d.a || __d.b) ?? __d.c"},
		{"?? over a grouped &&", "a ?? (b && c)", nil, "__d.a ?? (__d.b && __d.c)"},
		{"&& binds tighter than ||", "a && b || c", nil, "__d.a && __d.b || __d.c"},
		{"|| inside &&", "a && (b || c)", nil, "__d.a && (__d.b || __d.c)"},
		{"loose equality kept", "a.b == null", nil, "__d.a?.b == null"},
		{"conditional", "a ? b : c", nil, "__d.a ? __d.b : __d.c"},
		{"conditional test grouped", "(a ? b : c) ? d : e", nil, "(__d.a ? __d.b : __d.c) ? __d.d : __d.e"},
		{"conditional alternate chains", "a ? b : c ? d : e", nil, "__d.a ? __d.b : __d.c ? __d.d : __d.e"},
		// Literals of structure.
		{"array", "[a, b.c]", nil, "[__d.a, __d.b?.c]"},
		{"array member", "[a, b][0]", nil, "[__d.a, __d.b]?.[0]"},
		{"object keys stay keys", "t('k', { height: 480, width: w })", nil,
			`(__f["t"] || __f.__missing("t"))('k', { height: 480, width: __d.w })`},
		{"object shorthand expands", "t('k', { count })", nil, `(__f["t"] || __f.__missing("t"))('k', { count: __d.count })`},
		{"object quoted key", "t('k', { 'cart.count': n, 'ok': 1 })", nil,
			`(__f["t"] || __f.__missing("t"))('k', { 'cart.count': __d.n, ok: 1 })`},
		{"object keyword keys", "t('k', { default: a, class: c })", nil,
			`(__f["t"] || __f.__missing("t"))('k', { default: __d.a, class: __d.c })`},
		{"object row shorthand", "t('k', { todo, n })", row, `(__f["t"] || __f.__missing("t"))('k', { todo: s.item, n: __d.n })`},
		{"empty object", "t('k', {})", nil, `(__f["t"] || __f.__missing("t"))('k', {})`},
		// Template literals.
		{"template literal", "`hi ${name}!`", nil, "`hi ${__d.name}!`"},
		{"template literal row local", "`${todo.id}`", row, "`${s.item?.id}`"},
		{"template literal escapes", "`a\\`b \\${c} ${d}`", nil, "`a\\`b \\${c} ${__d.d}`"},
		// `.length` is the count, an ordinary guarded member read; `.size` is
		// an ordinary field (a Map's or a file's), never special.
		{"length", "items.length", nil, "__d.items?.length"},
		{"length of a group", "(a + b).length", nil, "(__d.a + __d.b)?.length"},
		{"length of a row local", "todo.tags.length", row, "s.item?.tags?.length"},
		{"length inside an arrow", "lists.filter(l => l.length > 0)", nil, "__d.lists?.filter((l) => l?.length > 0)"},
		{"a size field", "file.size", nil, "__d.file?.size"},
		{"a root named size", "size", nil, "__d.size"},
		{"a size key", "t('k', { size: 1 })", nil, `(__f["t"] || __f.__missing("t"))('k', { size: 1 })`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := lowerJS(t, tc.src, tc.scope); got != tc.want {
				t.Errorf("lower(%q)\n  got  %s\n  want %s", tc.src, got, tc.want)
			}
		})
	}
}

// An arrow parameter spelled like a lowered row's scope object or a
// compiler-private name is renamed, so the reads around it keep reaching what
// they compile to.
func TestArrowParamMangling(t *testing.T) {
	row := scopeMap{"todo": "s.item"}
	if got, want := lowerJS(t, "items.filter(s => s.id === todo.id)", row, "s"),
		"__d.items?.filter((__pzls) => __pzls?.id === s.item?.id)"; got != want {
		t.Errorf("row-scope-named param:\n  got  %s\n  want %s", got, want)
	}
	if got, want := lowerJS(t, "items.map(__d => __d.x + y)", nil), "__d.items?.map((__pzl__d) => __pzl__d?.x + __d.y)"; got != want {
		t.Errorf("compiler-private param:\n  got  %s\n  want %s", got, want)
	}
	// Outside a row, `s` is an ordinary name.
	if got, want := lowerJS(t, "items.filter(s => s.on)", nil), "__d.items?.filter((s) => s?.on)"; got != want {
		t.Errorf("plain param:\n  got  %s\n  want %s", got, want)
	}
}

// Defense in depth: whatever reaches the lowerer, `this` is never compiled as
// the data field `__d.this`, and checkTemplateExprs rejects it with the
// parser's own words at its own position.
func TestThisSafetyNet(t *testing.T) {
	this := &expr.Identifier{Name: "this", Start: expr.Pos{Line: 3, Col: 9, Offset: 40}}
	w := &textWriter{}
	newLowerer(w, targetRender, nil, nil).value(&expr.Member{Object: this, Property: "x"})
	if strings.Contains(w.String(), "__d.this") {
		t.Errorf("lowered `this` as a data read: %s", w.String())
	}
	c := &compiler{file: "T.pzl"}
	root := &parser.Element{Tag: "puzzle-view", Children: []parser.Node{
		&parser.Interpolation{Expr: "this.x", ExprAST: &expr.Member{Object: this, Property: "x"}},
	}}
	err := c.checkTemplateExprs([]parser.Node{root}, "")
	if err == nil || err.Error() != "T.pzl:3:9: "+thisMsg {
		t.Fatalf("want the positioned `this` error, got %v", err)
	}
}

func TestLoweringFacts(t *testing.T) {
	row := scopeMap{"todo": "s.item", "i": "s.i"}
	type want struct {
		fields                          string
		deep, whole, opaque, bareInCall bool
		roots                           string
		volatile                        bool
	}
	cases := []struct {
		src  string
		want want
	}{
		{"todo.text", want{fields: "text"}},
		{"todo?.text", want{fields: "text"}},
		{"(todo).text", want{fields: "text"}},
		{"todo.author.name", want{deep: true}},
		{"todo.text.trim()", want{deep: true}},
		{"todo.tags.at(0)", want{deep: true}},
		{"todo.at(0)", want{deep: true}},
		{"todo[k]", want{deep: true, roots: "k"}},
		{"todo", want{whole: true}},
		{"fmt(todo)", want{opaque: true, bareInCall: true}},
		{"todo + 1", want{opaque: true}},
		{"`${todo}`", want{opaque: true}},
		{"[todo]", want{opaque: true}},
		{"items.filter(t => t.id === todo.id)", want{fields: "id", roots: "items"}},
		{"items.filter(todo => todo.done)", want{roots: "items"}},
		{"timeago(todo.at)", want{fields: "at", volatile: true}},
		{"todo.size", want{fields: "size"}},
		{"todo.tags.length", want{deep: true}},
		{"a.b + c[d]", want{roots: "a,c,d"}},
	}
	for _, tc := range cases {
		t.Run(tc.src, func(t *testing.T) {
			f := lowerFacts(t, tc.src, row)
			r := f.locals["todo"]
			if r == nil {
				r = &localRead{}
			}
			got := want{
				fields: strings.Join(r.fields, ","), deep: r.deep, whole: r.whole,
				opaque: r.opaque, bareInCall: r.bareInCall,
				roots: strings.Join(f.roots, ","), volatile: f.volatileRead,
			}
			if got != tc.want {
				t.Errorf("facts(%q)\n  got  %+v\n  want %+v", tc.src, got, tc.want)
			}
		})
	}
}

func TestHandlerLowering(t *testing.T) {
	cases := []struct {
		name      string
		src       string
		scope     scopeMap
		want      string
		wantCache bool // D62: data-independent
		wantRow   bool // D170: captures only template bindings
	}{
		{"bare name", "clearCompleted", nil, "(event) => this.events.clearCompleted(event)", true, false},
		{"string argument", "setFilter('all')", nil, "(event) => this.events.setFilter('all')", true, false},
		{"event argument", "addTodo(event)", nil, "(event) => this.events.addTodo(event)", true, false},
		{"no arguments", "reset()", nil, "(event) => this.events.reset()", true, false},
		{"global argument", "clamp(Math.PI)", nil, "(event) => this.events.clamp(Math.PI)", true, false},
		{"string that looks like data", "h('__d.')", nil, "(event) => this.events.h('__d.')", true, false},
		{"data argument", "save(payload)", nil, "(event) => this.events.save(__d.payload)", false, false},
		{"data argument guarded", "save(form.draft.title)", nil, "(event) => this.events.save(__d.form?.draft?.title)", false, false},
		{"binding argument", "toggle(todo)", scope("todo"), "(event) => this.events.toggle(todo)", false, true},
		{"row argument", "remove(todo.id, i)", scopeMap{"todo": "s.item", "i": "s.i"}, "(event) => this.events.remove(s.item?.id, s.i)", false, true},
		// §9 k: a chain rooted at the DOM event is written as authored.
		{"event chain", "pick(event.target.value)", nil, "(event) => this.events.pick(event.target.value)", true, false},
		{"event optional chain", "pick(event?.detail.id)", nil, "(event) => this.events.pick(event?.detail.id)", true, false},
		{"event method", "go(event.target.closest('li'))", nil, "(event) => this.events.go(event.target.closest('li'))", true, false},
		{"event computed", "go(event[key])", nil, "(event) => this.events.go(event[__d.key])", false, false},
		// A binding named `event` owns the name: the DOM parameter is renamed.
		{"event binding", "select(event)", scopeMap{"event": "s.item"}, "(__ev) => this.events.select(s.item)", false, true},
		{"event binding chain is data", "pick(event.id)", scopeMap{"event": "s.item"}, "(__ev) => this.events.pick(s.item?.id)", false, true},
		// §9 c: the handler's own call names the view's handler; a call inside
		// its arguments names the library.
		{"view handler named like a function", "date(x)", nil, "(event) => this.events.date(__d.x)", false, false},
		{"library call in an argument", "save(t('saved'))", nil, `(event) => this.events.save((__f["t"] || __f.__missing("t"))('saved'))`, false, false},
		{"method call in an argument", "save(draft.trim(), items.length)", nil, "(event) => this.events.save(__d.draft?.trim(), __d.items?.length)", false, false},
		{"arrow in an argument", "save(items.filter(t => t.done))", nil, "(event) => this.events.save(__d.items?.filter((t) => t?.done))", false, false},
		{"object argument", "save({ id: 1 })", nil, "(event) => this.events.save({ id: 1 })", true, false},
		{"object argument with reads", "save({ id: todo.id, todo, n: count })", scope("todo"),
			"(event) => this.events.save({ id: todo?.id, todo: todo, n: __d.count })", false, false},
		{"a size field in an argument", "save(file.size)", nil, "(event) => this.events.save(__d.file?.size)", false, false},
		// Conditionals: never cached; the condition is a render-time value.
		{"conditional", "ok ? save : null", nil, "(__d.ok) ? (event) => this.events.save(event) : null", false, false},
		{"conditional guarded", "user.admin ? promote(user.id) : null", nil,
			"(__d.user?.admin) ? (event) => this.events.promote(__d.user?.id) : null", false, false},
		{"conditional length", "items.length ? clear : null", nil, "(__d.items?.length) ? (event) => this.events.clear(event) : null", false, false},
		{"null", "null", nil, "null", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev, err := lowerHandler(t, tc.src, tc.scope)
			if err != nil {
				t.Fatalf("handler(%q): %v", tc.src, err)
			}
			if ev.js != tc.want {
				t.Errorf("handler(%q)\n  got  %s\n  want %s", tc.src, ev.js, tc.want)
			}
			if ev.cacheable != tc.wantCache || ev.rowCacheable != tc.wantRow {
				t.Errorf("handler(%q) cacheable = %v, rowCacheable = %v; want %v, %v", tc.src, ev.cacheable, ev.rowCacheable, tc.wantCache, tc.wantRow)
			}
		})
	}
	for _, src := range []string{"a + b", "handlers.close", "obj.trim()", "Math.max(1)", "ok ? (a ? b : c) : null", "ok ? 1 : null"} {
		if _, err := lowerHandler(t, src, nil); err == nil {
			t.Errorf("handler(%q): want an error", src)
		}
	}
}

// A handler argument that calls a library function reads the render's `__f`,
// so the module binds it — and a handler whose own call merely shares a
// library name does not.
func TestHandlerLibraryCallBindsRegistry(t *testing.T) {
	res, err := compileTemplate(t, "<puzzle-view><button @click={ save(t('saved')) }>x</button></puzzle-view>", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.JS, "const __f = this.ctx.formatters.getAll();") {
		t.Errorf("a library call in a handler argument must bind __f:\n%s", res.JS)
	}
	res, err = compileTemplate(t, "<puzzle-view><button @click={ t('saved') }>x</button></puzzle-view>", "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.JS, "__f") {
		t.Errorf("a view handler named t is not a library call:\n%s", res.JS)
	}
}

// §9 c: a view handler named like a standard function draws one positioned
// warning; the generated code is unaffected.
func TestHandlerLibraryNameCollisionWarns(t *testing.T) {
	res, err := compileTemplate(t, "<puzzle-view>\n  <button @click={ date(x) }>a</button>\n  <button @click={ ok ? time : null }>b</button>\n  <button @click={ save(date(x)) }>c</button>\n  <button @click={ in_timezone }>d</button>\n</puzzle-view>", "")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, w := range res.Warnings {
		got = append(got, w.File+":"+itoa(w.Line)+":"+itoa(w.Col)+": "+w.Message)
	}
	wants := []string{
		"T.pzl:2:20: the view handler `date` shares its name with the standard `date()` function",
		"T.pzl:3:25: the view handler `time` shares its name with the standard `time()` function",
		"T.pzl:5:20: the view handler `in_timezone` shares its name with the standard `in_timezone()` function",
	}
	if len(got) != len(wants) {
		t.Fatalf("want %d warnings, got %d:\n%s", len(wants), len(got), strings.Join(got, "\n"))
	}
	for i, w := range wants {
		if !strings.HasPrefix(got[i], w) {
			t.Errorf("warning %d\n  got  %s\n  want %s…", i, got[i], w)
		}
	}
}

// A postfix update before a division is script JavaScript, which reaches the
// output untouched. In a handler argument it is outside the expression
// grammar, so the parser rejects it at the operator.
func TestPostfixUpdateBeforeDivisionPzlCompile(t *testing.T) {
	src := `<puzzle-view><button @click={ ratio(a / b / c) }>x</button></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {
  ratio(index, total) {
    return index++ / total;
  }
}
</script>`
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split .pzl with postfix update in script: %v", err)
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if err != nil {
		t.Fatalf("compile .pzl with postfix update in script: %v", err)
	}
	if want := "return index++ / total;"; !strings.Contains(res.JS, want) {
		t.Fatalf("compiled output lost script expression %q:\n%s", want, res.JS)
	}
	if want := "(event) => this.events.ratio(__d.a / __d.b / __d.c)"; !strings.Contains(res.JS, want) {
		t.Fatalf("compiled output missing %q:\n%s", want, res.JS)
	}
	_, err = compileTemplate(t, "<puzzle-view><button @click={ ratio(a++ / b / c) }>x</button></puzzle-view>", "")
	if err == nil || !strings.Contains(err.Error(), "T.pzl:1:38: `++` and `--` are not available") {
		t.Fatalf("want the positioned `++` error, got %v", err)
	}
}

// A `}` inside a nested template literal does not close the braces, and the
// lowered literal reproduces the source.
func TestNestedTemplateLiteralExpressionCompile(t *testing.T) {
	const expr = "`outer ${`inner }`}`"
	res, err := compileTemplate(t, "<puzzle-view><button @click={ fmt("+expr+") }>x</button></puzzle-view>", "")
	if err != nil {
		t.Fatalf("compile nested template literal: %v", err)
	}
	if want := "this.events.fmt(" + expr + ")"; !strings.Contains(res.JS, want) {
		t.Fatalf("compiled expression did not preserve the source bytes %q:\n%s", want, res.JS)
	}
}

// A regex right after the opening brace is lexed as one literal — the brace
// scan must not read its `/` as division — and so reaches the expression
// grammar, which rejects it with its own message rather than a garbled parse
// error.
func TestRegexLiteralImmediatelyAfterBraceIsRejected(t *testing.T) {
	_, err := compileTemplate(t, "<puzzle-view>{/\\d+/.test(x)}</puzzle-view>", "")
	if err == nil || !strings.Contains(err.Error(), "T.pzl:1:15: regular expression literals are not available") {
		t.Fatalf("want the positioned regex-literal error, got %v", err)
	}
}

// TestObjectLiteralRejected asserts the SPEC §6 guard: a template expression
// whose braces open with an object literal fails with the shared, positioned
// compile error, because `{ {` reads as a brace inside the interpolation
// brace. Covered at both entry points — a text interpolation and a dynamic
// attribute. (An object literal as an ARGUMENT is legal, D173 V8.)
func TestObjectLiteralRejected(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		marker string // substring whose start column the error must point at
	}{
		{"text interpolation", `<puzzle-view>{ { a: 1 } }</puzzle-view>`, "{ { a"},
		{"dynamic attribute", `<puzzle-view><div x={ { a: 1 } }></div></puzzle-view>`, "x="},
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
