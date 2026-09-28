package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// datalang_test.go — D176: a template value is data plus operators. `.size`
// lowers to the `__z` helper, `.length` and every JavaScript-only construct is
// a positioned compile error, and `this.` chains and handler bodies stay
// JavaScript.

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
	for _, tc := range []struct {
		name, body, want string
	}{
		// (a) calls on data, in every value position.
		{"method call in text", "  <p>{ name.toUpperCase() }</p>", "T.pzl:2:6: " + dataCallMsg},
		{"function call", "  <p>{ fmt(x) }</p>", dataCallMsg},
		{"global call", "  <p>{ Math.round(x) }</p>", dataCallMsg},
		{"String()", "  <p>{ String(x) }</p>", dataCallMsg},
		{"items.at(-1)", "  <p>{ items.at(-1) }</p>", dataCallMsg},
		{"optional call", "  <p>{ a.b?.(x) }</p>", dataCallMsg},
		{"call on .size", "  <p>{ items.size() }</p>", dataCallMsg},
		{"brace attribute", "  <button disabled={ !draft.trim() }>x</button>", "T.pzl:2:11: " + dataCallMsg},
		{"quoted attribute", `  <p title="{ a.trim() } x">y</p>`, dataCallMsg},
		{"inline-if condition", `  <p class="x {#if a.has(b)}on{/if}">y</p>`, dataCallMsg},
		{"inline-if branch", `  <p class="x {#if on}{ a.trim() }{/if}">y</p>`, dataCallMsg},
		{"component prop", "  <Card items={ list.filter(f) } />", dataCallMsg},
		{"marker argument", "  <Slot name=\"row\" item={ a.b() } />", dataCallMsg},
		{"key", "  {#for t in todos}<li key={ t.id.toString() }>x</li>{/for}", dataCallMsg},
		{"if subject", "  {#if items.includes(x)}<b>a</b>{/if}", "T.pzl:2:3: " + dataCallMsg},
		{"else-if subject", "  {#if a}<b>a</b>{:else if b.c()}<b>b</b>{/if}", dataCallMsg},
		{"case subject", "  {#case kind.trim()}{:when 'a'}<b>d</b>{/case}", dataCallMsg},
		{"when value", "  {#case kind}{:when a.b()}<b>d</b>{/case}", dataCallMsg},
		{"for collection", "  {#for t in todos.slice(1)}<li>x</li>{/for}", dataCallMsg},
		{"range bound", "  {#for 1...Math.max(n, 1)}<li>x</li>{/for}", dataCallMsg},
		{"formatter argument", "  <p>{ title | truncate(n.max()) }</p>", dataCallMsg},
		{"handler condition", "  <button @click={ a.ok() ? save : null }>x</button>", dataCallMsg},
		{"call on a grouped this chain", "  <p>{ (this.f)(x) }</p>", dataCallMsg},
		// (b)–(d) the rest of JavaScript.
		{"arrow", "  <p>{ items | join(x => x) }</p>", dataArrowMsg},
		{"template literal", "  <p>{ `${a} ${b}` }</p>", dataTemplateMsg},
		{"new", "  <p>{ new Date() }</p>", dataKeywordMsg("new")},
		{"typeof", "  <p>{ typeof x }</p>", dataKeywordMsg("typeof")},
		{"instanceof", "  {#if x instanceof y}<b>a</b>{/if}", dataKeywordMsg("instanceof")},
		{"in", "  {#if 'a' in obj}<b>a</b>{/if}", dataKeywordMsg("in")},
		{"regex", "  <p>{ /a+/ }</p>", dataRegexMsg},
		{"postfix update", "  <p>{ n++ }</p>", dataUpdateMsg},
		{"prefix update", "  <p>{ --n }</p>", dataUpdateMsg},
		{"assignment", "  {#if a = b}<b>a</b>{/if}", dataAssignMsg},
		{"compound assignment", "  <p>{ a += 1 }</p>", dataAssignMsg},
		{"nullish assignment", "  <p>{ a ??= 1 }</p>", dataAssignMsg},
		{"top-level comma", "  <Card items={ a, b } />", dataCommaMsg},
		{"bitwise and", "  <p>{ a & 1 }</p>", dataBitwiseMsg},
		{"bitwise xor", "  <p>{ a ^ 1 }</p>", dataBitwiseMsg},
		{"bitwise not", "  <p>{ ~a }</p>", dataBitwiseMsg},
		{"shift", "  <p>{ a << 1 }</p>", dataBitwiseMsg},
		{"unsigned shift", "  <p>{ a >>> 1 }</p>", dataBitwiseMsg},
		// .length (rule 1).
		{"length", "  <p>{ items.length }</p>", "T.pzl:2:6: " + dataLengthMsg},
		{"optional length", "  {#if user?.name.length > 3}<b>a</b>{/if}", dataLengthMsg},
		{"length in a formatter argument", "  <p>{ s | truncate(max.length) }</p>", dataLengthMsg},
		// A `|` in a handler is neither a formatter nor a bitwise OR (rule 4).
		{"pipe in a handler argument", "  <button @click={ save(x | trim) }>x</button>", "T.pzl:2:11: " + dataHandlerPipeMsg},
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

func TestDataLanguageAllows(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
	}{
		// `this.` chains are JavaScript, in full.
		{"this method", "  <p>{ this.fmt(x) }</p>", "this.fmt(__d.x)"},
		{"this chain with an arrow", "  <p>{ this.items.filter(i => i.done) }</p>", "this.items.filter("},
		{"this .length", "  <p>{ this.items.length }</p>", "this.items?.length"},
		{"this template literal", "  <p>{ this.t(`${a}`) }</p>", "this.t(`${__d.a}`)"},
		{"negated this getter", "  <button disabled={ !this.canAdd }>x</button>", "disabled: !this.canAdd"},
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
		{"spread", "  <Card items={ [...a, b] } />", "items: [...__d.a, __d.b]"},
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
		// Not a count: a `this.` chain, a call, a key, a root named size.
		{"this.items.size", "this.items?.size"},
		{"this.f(items.size)", "this.f(__d.items?.size)"},
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
// never for a `this.` chain or a handler argument — and a skeleton read counts.
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
		{"this chain", "  <p>{ this.items.size }</p>", false},
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
