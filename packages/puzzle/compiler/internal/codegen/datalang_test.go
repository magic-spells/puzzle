package codegen

import (
	"fmt"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// datalang_test.go — D176: a template value is data plus operators. `.size`
// lowers to the `__z` helper, `.length` and every JavaScript-only construct is
// a positioned compile error, handler bodies stay JavaScript, and `this` is not
// a template identifier anywhere.

func compileCore(t *testing.T, body string) (string, error) {
	t.Helper()
	sec, err := parser.SplitSections(coreSrc(body), "T.pzl")
	if err != nil {
		return "", err
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	return res.JS, err
}

func TestDataLanguageRejections(t *testing.T) {
	// A construct outside the expression grammar (puzzle-lang's expr package)
	// is now rejected by the parser, before this pre-check runs, at the
	// offending token with the grammar's message; the rows that want a
	// grammar message name it with its position. A construct inside the
	// grammar that D176 still rejects keeps this pre-check's message.
	for _, tc := range []struct {
		name, body, want string
	}{
		// (a) calls on data, in every value position.
		{"method call in text", "  <p>{ name.toUpperCase() }</p>", "T.pzl:2:6: " + dataCallMsg},
		{"function call", "  <p>{ fmt(x) }</p>", dataCallMsg},
		{"global call", "  <p>{ Math.round(x) }</p>", dataCallMsg},
		{"String()", "  <p>{ String(x) }</p>", dataCallMsg},
		{"items.at(-1)", "  <p>{ items.at(-1) }</p>", dataCallMsg},
		{"optional call", "  <p>{ a.b?.(x) }</p>", "T.pzl:2:11: optional calls (`?.(`) are not available"},
		{"call on .size", "  <p>{ items.size() }</p>", "T.pzl:2:14: `.size()` is not available"},
		{"brace attribute", "  <button disabled={ !draft.trim() }>x</button>", "T.pzl:2:11: " + dataCallMsg},
		{"quoted attribute", `  <p title="{ a.trim() } x">y</p>`, dataCallMsg},
		{"inline-if condition", `  <p class="x {#if a.has(b)}on{/if}">y</p>`, "T.pzl:2:22: `.has()` is not available"},
		{"inline-if branch", `  <p class="x {#if on}{ a.trim() }{/if}">y</p>`, dataCallMsg},
		{"component prop", "  <Card items={ list.filter(f) } />", dataCallMsg},
		{"marker argument", "  <Slot name=\"row\" item={ a.b() } />", "T.pzl:2:29: `.b()` is not available"},
		{"key", "  {#for t in todos}<li key={ t.id.toString() }>x</li>{/for}", dataCallMsg},
		{"if subject", "  {#if items.includes(x)}<b>a</b>{/if}", "T.pzl:2:3: " + dataCallMsg},
		{"else-if subject", "  {#if a}<b>a</b>{:else if b.c()}<b>b</b>{/if}", "T.pzl:2:30: `.c()` is not available"},
		{"case subject", "  {#case kind.trim()}{:when 'a'}<b>d</b>{/case}", dataCallMsg},
		{"when value", "  {#case kind}{:when a.b()}<b>d</b>{/case}", "T.pzl:2:24: `.b()` is not available"},
		{"for collection", "  {#for t in todos.slice(1)}<li>x</li>{/for}", dataCallMsg},
		{"range bound", "  {#for 1...Math.max(n, 1)}<li>x</li>{/for}", dataCallMsg},
		{"formatter argument", "  <p>{ title | truncate(n.max()) }</p>", "T.pzl:2:27: `.max()` is not available"},
		{"handler condition", "  <button @click={ a.ok() ? save : null }>x</button>", "T.pzl:2:22: `.ok()` is not available"},
		// (b)–(d) the rest of JavaScript.
		{"arrow", "  <p>{ items | join(x => x) }</p>", dataArrowMsg},
		{"template literal", "  <p>{ `${a} ${b}` }</p>", dataTemplateMsg},
		{"new", "  <p>{ new Date() }</p>", "T.pzl:2:8: `new` is not available"},
		{"typeof", "  <p>{ typeof x }</p>", "T.pzl:2:8: `typeof` is not available"},
		{"instanceof", "  {#if x instanceof y}<b>a</b>{/if}", "T.pzl:2:10: `instanceof` is not available"},
		{"in", "  {#if 'a' in obj}<b>a</b>{/if}", "T.pzl:2:12: the `in` operator is not available"},
		{"regex", "  <p>{ /a+/ }</p>", "T.pzl:2:8: regular expression literals are not available"},
		{"postfix update", "  <p>{ n++ }</p>", "T.pzl:2:9: `++` and `--` are not available"},
		{"prefix update", "  <p>{ --n }</p>", "T.pzl:2:8: `++` and `--` are not available"},
		{"assignment", "  {#if a = b}<b>a</b>{/if}", "T.pzl:2:10: assignment is not available"},
		{"compound assignment", "  <p>{ a += 1 }</p>", "T.pzl:2:10: assignment is not available"},
		{"nullish assignment", "  <p>{ a ??= 1 }</p>", "T.pzl:2:10: assignment is not available"},
		{"top-level comma", "  <Card items={ a, b } />", "T.pzl:2:18: the comma operator is not available"},
		{"bitwise and", "  <p>{ a & 1 }</p>", "T.pzl:2:10: bitwise operators are not available"},
		{"bitwise xor", "  <p>{ a ^ 1 }</p>", "T.pzl:2:10: bitwise operators are not available"},
		{"bitwise not", "  <p>{ ~a }</p>", "T.pzl:2:8: bitwise operators are not available"},
		{"shift", "  <p>{ a << 1 }</p>", "T.pzl:2:10: bitwise operators are not available"},
		{"unsigned shift", "  <p>{ a >>> 1 }</p>", "T.pzl:2:10: bitwise operators are not available"},
		{"spread", "  <Card items={ [...a, b] } />", "T.pzl:2:18: spread (`...`) is not available"},
		// .length (rule 1).
		{"length", "  <p>{ items.length }</p>", "T.pzl:2:6: " + dataLengthMsg},
		{"optional length", "  {#if user?.name.length > 3}<b>a</b>{/if}", dataLengthMsg},
		{"length in a formatter argument", "  <p>{ s | truncate(max.length) }</p>", dataLengthMsg},
		// A `|` in a handler is neither a formatter nor a bitwise OR (rule 4).
		{"pipe in a handler argument", "  <button @click={ save(x | trim) }>x</button>", "T.pzl:2:27: the `|` operator is not available"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := compileCore(t, tc.body)
			if err == nil {
				t.Fatalf("expected a compile error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q\n  want %q", err, tc.want)
			}
			if _, ok := err.(*parser.ParseError); !ok {
				t.Errorf("error must be a positioned *parser.ParseError, got %T", err)
			}
		})
	}
}

// `this` is not a template identifier (D176 rule 5): every value a template
// shows comes through data(), and a handler reaches the view through its own
// name. The error is positioned at the `this` token itself; at names the
// source text that starts there, so the expected line and column are derived
// from the body rather than hand-counted. A body that starts with
// `<puzzle-view` is the whole template section (its root attributes sit before
// the template content); every other body is wrapped by coreSrc, so it starts
// on line 2.
func TestDataLanguageRejectsThis(t *testing.T) {
	for _, tc := range []struct {
		name, body, at string
	}{
		// Every value position.
		{"interpolation", "  <p>{ this.fmt(x) }</p>", "this.fmt"},
		{"negated getter in an attribute", "  <button disabled={ !this.canAdd }>x</button>", "this.canAdd"},
		{"chain with an arrow", "  <p>{ this.items.filter(i => i.done) }</p>", "this.items"},
		{"chain with .length", "  <p>{ this.items.length }</p>", "this.items"},
		{"chain with .size", "  <p>{ this.items.size }</p>", "this.items"},
		{"template literal argument", "  <p>{ this.t(`${a}`) }</p>", "this.t"},
		{"optional member", "  <p>{ this?.x }</p>", "this?.x"},
		{"grouped", "  <p>{ (this).x }</p>", "this).x"},
		{"computed member", "  <p>{ this['x'] }</p>", "this['x']"},
		{"call on a grouped chain", "  <p>{ (this.f)(x) }</p>", "this.f)"},
		{"bare this", "  <p>{ this }</p>", "this }"},
		{"quoted attribute", `  <p title="a { this.x } b">y</p>`, "this.x"},
		{"inline-if condition", `  <p class="x {#if this.on}on{/if}">y</p>`, "this.on"},
		{"inline-if branch", `  <p class="x {#if on}{ this.x }{/if}">y</p>`, "this.x"},
		{"if subject", "  {#if this.ready}<b>a</b>{/if}", "this.ready"},
		{"unless subject", "  {#unless this.ready}<b>a</b>{/unless}", "this.ready"},
		{"else-if subject", "  {#if a}<b>a</b>{:else if this.b}<b>b</b>{/if}", "this.b"},
		{"case subject", "  {#case this.kind}{:when 'a'}<b>d</b>{/case}", "this.kind"},
		{"when value", "  {#case kind}{:when this.a}<b>d</b>{/case}", "this.a"},
		{"for collection", "  {#for t in this.items}<li>x</li>{/for}", "this.items"},
		{"range bound", "  {#for 1...this.n}<li>x</li>{/for}", "this.n"},
		{"key", "  {#for t in todos}<li key={ this.k }>x</li>{/for}", "this.k"},
		{"formatter argument", "  <p>{ title | truncate(this.max) }</p>", "this.max"},
		{"object literal value", "  <p>{ label | t({ n: this.count }) }</p>", "this.count"},
		{"component prop", "  <Card items={ this.items } />", "this.items"},
		{"marker argument", `  <Slot name="row" item={ this.item } />`, "this.item"},
		// Handler arguments and the handler ternary's condition too.
		{"handler argument", "  <button @click={ save(this.x) }>x</button>", "this.x"},
		{"handler bare argument", "  <button @click={ save(this) }>x</button>", "this)"},
		{"handler template literal argument", "  <button @click={ save(`${this.x}`) }>x</button>", "this.x"},
		{"handler ternary condition", "  <button @click={ this.ok ? save : null }>x</button>", "this.ok"},
		{"handler branch argument", "  <button @click={ ok ? save(this.x) : null }>x</button>", "this.x"},
		{"handler callee", "  <button @click={ this.save() }>x</button>", "this.save"},
		// The position is the token's own, across lines and past a name that
		// merely starts with `this`.
		{"second line", "  <p>\n    { a } { this.x }\n  </p>", "this.x"},
		{"after a longer name", "  <p>{ thisx | truncate(this) }</p>", "this)"},
		// The search stays inside the node's own brace group and skips strings,
		// comments and members named `this`.
		{"after a member named this", "  <p>{ x.this | pad(this) }</p>", "this)"},
		{"after static text in a quoted attribute", `  <p title="this { this }">y</p>`, "this }"},
		{"after a string in a quoted attribute", `  <p title="{ 'this' } { this }">y</p>`, "this }"},
		{"unless before an identical folded condition",
			"  {#unless this.r}<b>a</b>{/unless}\n  {#if !(this.r)}<b>b</b>{/if}", "this.r}<b>a"},
		{"view root attribute", "<puzzle-view class={ this.x }>\n  <p>a</p>\n</puzzle-view>", "this.x"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src, first := coreSrc(tc.body), 2
			if strings.HasPrefix(tc.body, "<puzzle-view") {
				src, first = tc.body+"\n\n<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\n"+
					"export default class T extends PuzzleView {}\n</script>\n", 1
			}
			// The expression grammar rejects `this` while parsing, so a view
			// root attribute (parsed with the sections) fails at the split.
			sec, err := parser.SplitSections(src, "T.pzl")
			if err == nil {
				_, err = Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
			}
			if err == nil {
				t.Fatalf("expected a compile error")
			}
			m := strings.Index(tc.body, tc.at)
			if m < 0 {
				t.Fatalf("bad case: %q not in body", tc.at)
			}
			line := first + strings.Count(tc.body[:m], "\n")
			col := m - strings.LastIndex(tc.body[:m], "\n")
			want := fmt.Sprintf("T.pzl:%d:%d: %s", line, col, dataThisMsg)
			if err.Error() != want {
				t.Errorf("error %q\n  want %q", err, want)
			}
			if _, ok := err.(*parser.ParseError); !ok {
				t.Errorf("error must be a positioned *parser.ParseError, got %T", err)
			}
		})
	}
}

// A skeleton is a template too, and its `this` error is positioned in the
// skeleton section.
func TestDataLanguageRejectsThisInSkeleton(t *testing.T) {
	src := "<puzzle-view><p>{ a }</p></puzzle-view>\n\n<puzzle-skeleton>\n  <p>{ this.label }</p>\n</puzzle-skeleton>\n\n" +
		"<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n"
	sec, err := parser.SplitSections(src, "T.pzl")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	_, err = Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	if want := "T.pzl:4:8: " + dataThisMsg; err == nil || err.Error() != want {
		t.Fatalf("want %q, got %v", want, err)
	}
}

// Defense in depth: whatever reaches the resolver without the D176 pre-check,
// `this` is never compiled as the data field `__d.this`.
func TestResolverNeverReadsThisAsData(t *testing.T) {
	outs := map[string]string{
		"resolveExpr":      resolveExpr("this.x", nil),
		"resolveValueScan": resolveValueScan("this.x", scopeMap{}, nil),
		"ResolveCheckExpr": ResolveCheckExpr("this.x", nil),
	}
	ev, err := compileEventValue("save(this.x)", nil, nil)
	if err != nil {
		t.Fatalf("compileEventValue: %v", err)
	}
	outs["compileEventValue"] = ev.js
	for name, out := range outs {
		if strings.Contains(out, "__d.this") {
			t.Errorf("%s emitted a data read of this: %q", name, out)
		}
	}
}

func TestDataLanguageAllows(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
	}{
		// A member or object key NAMED `this` is a name, not the view.
		{"member named this", "  <p>{ x.this }</p>", "__d.x?.this"},
		{"optional member named this", "  <p>{ x?.this }</p>", "__d.x?.this"},
		{"object key named this", "  <p>{ label | t({ this: 1 }) }</p>", "{ this: 1 }"},
		{"string containing this", "  <p>{ 'this' }</p>", "'this'"},
		{"handler string argument", "  <button @click={ save('this') }>x</button>", "this.events.save('this')"},
		{"handler member named this", "  <button @click={ save(event.this) }>x</button>", "this.events.save(event.this)"},
		// A field named `length` through a computed step, or as a root.
		{"computed length", "  <p>{ obj['length'] }</p>", "__d.obj?.['length']"},
		{"root named length", "  <p>{ length }</p>", "__s(__d.length,"},
		// Handler bodies are JavaScript, including a conditional's branches.
		{"handler call", "  <button @click={ save(x.trim(), items.length) }>x</button>", "this.events.save(__d.x.trim(), __d.items.length)"},
		{"handler branches", "  <button @click={ ok ? save(x.trim()) : null }>x</button>", "this.events.save(__d.x.trim())"},
		{"handler logical or", "  <button @click={ save(a || b) }>x</button>", "this.events.save(__d.a || __d.b)"},
		// Formatter calls take arguments; comparisons and data operators stay.
		{"formatter with args", "  <p>{ title | truncate(20, '…') }</p>", `(__f["truncate"] || __f.__missing("truncate"))(__d.title, 20, '…')`},
		{"object literal argument", "  <p>{ label | t({ n: count, in: 1 }) }</p>", "{ n: __d.count, in: 1 }"},
		{"array literal", "  <Card items={ [a, b] } />", "items: [__d.a, __d.b]"},
		{"comparisons", "  {#if a == b && c !== d && e <= f && g >= h}<b>a</b>{/if}", "__d.a == __d.b && __d.c !== __d.d"},
		{"logic and math", "  <p>{ (a ?? b) % 2 + -c * !d }</p>", "(__d.a ?? __d.b) % 2 + -__d.c * !__d.d"},
		{"ternary", "  <p>{ a ? b : c }</p>", "__d.a ? __d.b : __d.c"},
		{"string contents", "  <p>{ 'a.b() => `x` = 1, new' }</p>", "'a.b() => `x` = 1, new'"},
		{"division", "  <p>{ a / b / c }</p>", "__d.a / __d.b / __d.c"},
		{"a size field root", "  <p>{ size }</p>", "__s(__d.size,"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := compileCore(t, tc.body)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if !strings.Contains(got, tc.want) {
				t.Errorf("missing %q in:\n%s", tc.want, got)
			}
		})
	}
}

// `.size` lowers to the helper wherever a template VALUE reads it, and the
// chain around it keeps the D173 V4 guard.
func TestSizeLowering(t *testing.T) {
	for _, tc := range []struct{ expr, want string }{
		{"items.size", "__z(__d.items)"},
		{"a.b.size", "__z(__d.a?.b)"},
		{"a?.b.size", "__z(__d.a?.b)"},
		{"a.b?.size", "__z(__d.a?.b)"},
		{"a . size", "__z(__d.a)"},
		{"list[0].size", "__z(__d.list?.[0])"},
		{"a[b.size]", "__d.a?.[__z(__d.b)]"},
		{"x.size.label", "__z(__d.x)?.label"},
		{"(a + b).size", "__z((__d.a + __d.b))"},
		{"[a, b].size", "__z([__d.a, __d.b])"},
		{"'héllo'.size", "__z('héllo')"},
		{"x ? y.size : z.size - 1", "__d.x ? __z(__d.y) : __z(__d.z) - 1"},
		{"!items.size", "!__z(__d.items)"},
		{"{ n: items.size }", "{ n: __z(__d.items) }"},
		// Not a count: a call, a key, a root named size.
		{"items.size(1)", "__d.items?.size(1)"},
		{"{ size: 1 }", "{ size: 1 }"},
		{"size", "__d.size"},
	} {
		if got := resolveValueScan(tc.expr, scopeMap{}, nil); got != tc.want {
			t.Errorf("resolveValueScan(%q)\n  got  %q\n  want %q", tc.expr, got, tc.want)
		}
	}
	// A loop local keeps its rewrite inside the helper.
	if got := resolveValueScan("todo.tags.size", scopeMap{"todo": "s.item"}, nil); got != "__z(s.item?.tags)" {
		t.Errorf("row local: got %q", got)
	}
	// Handler arguments are JavaScript: `.size` stays a property read.
	if got, _ := resolveExprScan("items.size", scopeMap{}, nil, nil); got != "__d.items.size" {
		t.Errorf("handler argument: got %q", got)
	}
	// puzzle check sees the same lowering, unguarded.
	if got := ResolveCheckExpr("a.b.size > 0", nil); got != "__z(__d.a.b) > 0" {
		t.Errorf("check: got %q", got)
	}
}

// Row-cache facts (D170) read `.size` as the field read `.length` was: the
// item's own `.size` is a depth-one field, a member's is deep.
func TestSizeRowFacts(t *testing.T) {
	facts := &exprFacts{}
	resolveValueScan("todo.size", scopeMap{"todo": "s.item"}, facts)
	if r := facts.locals["todo"]; r == nil || len(r.fields) != 1 || r.fields[0] != "size" || r.deep {
		t.Errorf("todo.size: %+v", r)
	}
	facts = &exprFacts{}
	resolveValueScan("todo.tags.size", scopeMap{"todo": "s.item"}, facts)
	if r := facts.locals["todo"]; r == nil || len(r.fields) != 0 || !r.deep {
		t.Errorf("todo.tags.size: %+v", r)
	}
}

// The helper is imported only by a module whose template reads a count —
// never for a handler argument — and a skeleton read counts.
func TestSizeHelperImport(t *testing.T) {
	const imp = "sizeOf as __z"
	for _, tc := range []struct {
		name, body string
		want       bool
	}{
		{"text", "  <p>{ items.size }</p>", true},
		{"condition", "  {#if items.size > 0}<b>a</b>{/if}", true},
		{"handler condition", "  <button @click={ items.size ? save : null }>x</button>", true},
		{"none", "  <p>{ items }</p>", false},
		{"handler argument", "  <button @click={ save(items.size) }>x</button>", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := compileCore(t, tc.body)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if strings.Contains(got, imp) != tc.want {
				t.Errorf("import %q present = %v, want %v:\n%s", imp, !tc.want, tc.want, got)
			}
			if !tc.want && strings.Contains(got, "__z(") {
				t.Errorf("emitted __z without importing it:\n%s", got)
			}
		})
	}
	src := "<puzzle-view><p>{ a }</p></puzzle-view>\n\n<puzzle-skeleton><p>{ items.size }</p></puzzle-skeleton>\n\n" +
		"<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n"
	if got := compileSrc(t, src); !strings.Contains(got, imp) {
		t.Errorf("a skeleton-only .size read must import the helper:\n%s", got)
	}
}
