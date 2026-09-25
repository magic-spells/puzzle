package codegen

import (
	"regexp"
	"strings"
	"testing"
)

// core_semantics_test.go — D173 group (b), expressions and loops: V1 formatter
// pipes in every value position, V2 `==` keeps its JavaScript meaning, V4 the
// member guard, V8 object literals as arguments, V12 the loop guards. V15 (the
// script-less component's data()) is pinned in classname_test.go, and the
// runtime behavior of all of them in tests/core-semantics.test.js.

func coreSrc(body string) string {
	return "<puzzle-view>\n" + body + "\n</puzzle-view>\n\n<script>\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"import Card from './Card.pzl';\n" +
		"export default class T extends PuzzleView {}\n</script>\n"
}

func wantAll(t *testing.T, got string, wants ...string) {
	t.Helper()
	for _, w := range wants {
		if !strings.Contains(got, w) {
			t.Errorf("missing %q in:\n%s", w, got)
		}
	}
}

// ---- V1 ---------------------------------------------------------------------

func TestPipeIsAFormatterInEveryValuePosition(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <a title={ price | currency } data-or={ a || b }>x</a>
  <Card items={ list | join(', ') | truncate(20) } />
  {#if tags | size}<b>a</b>{:else if others | size}<b>b</b>{/if}
  {#unless user | blank}<b>c</b>{/unless}
  {#case status | downcase}{:when 'a'}<b>d</b>{/case}
  <p class="x {#if on | truthy}on{/if}">y</p>`))
	wantAll(t, got,
		// A brace-only attribute: a call, never `__d.price | __d.currency`.
		`title: (__f["currency"] || __f.__missing("currency"))(__d.price),`,
		// `||` stays logical OR.
		`'data-or': __d.a || __d.b,`,
		// A component prop, with a chain applied left to right.
		`items: (__f["truncate"] || __f.__missing("truncate"))((__f["join"] || __f.__missing("join"))(__d.list, ', '), 20)`,
		// Block subjects.
		`...((__f["size"] || __f.__missing("size"))(__d.tags)`,
		`...((__f["size"] || __f.__missing("size"))(__d.others)`,
		// {#unless} negates the FORMATTED value.
		`...(!((__f["blank"] || __f.__missing("blank"))(__d.user))`,
		`])((__f["downcase"] || __f.__missing("downcase"))(__d.status))),`,
		// An attribute value's inline {#if}.
		"class: `x ${(__f[\"truthy\"] || __f.__missing(\"truthy\"))(__d.on) ? 'on' : ''}`",
		// The registry read the chain needs.
		"const __f = this.ctx.formatters.getAll();",
	)
	if regexp.MustCompile(`[^|]\| __[df]\.`).MatchString(got) {
		t.Errorf("a pipe compiled to a bitwise OR:\n%s", got)
	}
	nodeCheck(t, got)
}

// A formatted form value displays a transformed value; there is no field to
// write an edit back to, so no two-way binding is synthesized (D147).
func TestPipedFormValueIsOneWay(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <input value={ name | upcase } />`))
	if strings.Contains(got, ":bind'") {
		t.Errorf("a formatted value must not synthesize a bind:\n%s", got)
	}
	wantAll(t, got, `value: (__f["upcase"] || __f.__missing("upcase"))(__d.name)`)
}

// A chained explicit key reads `__f`, which lives inside render(), so the site
// keeps `.map` instead of hoisting the key into a module-scope arrow.
func TestPipedLoopKeyKeepsMap(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#for item in items}<li key={ item.id | slugify }>x</li>{/for}`))
	if strings.Contains(got, "__l(") {
		t.Errorf("a key reading __f must not lower:\n%s", got)
	}
	wantAll(t, got,
		"__e(__d.items).map((item) =>",
		`key: (__f["slugify"] || __f.__missing("slugify"))(item?.id)`,
	)
}

// ---- V2 ---------------------------------------------------------------------

// `==` and `!=` are JavaScript loose equality in PuzzleKit and stay exactly as
// written (D173 V2); no position rewrites them to strict equality.
func TestLooseEqualityKeepsJavaScriptMeaning(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#if count == '1'}<b>a</b>{/if}
  <p data-x={ a != null }>{ x == null ? 'none' : x }</p>`))
	wantAll(t, got,
		"...(__d.count == '1'",
		"'data-x': __d.a != null",
		"__s(__d.x == null ? 'none' : __d.x,",
	)
	if strings.Contains(got, "__d.count ===") || strings.Contains(got, "__d.a !==") || strings.Contains(got, "__d.x ===") {
		t.Errorf("loose equality must not be rewritten:\n%s", got)
	}
}

// ---- V4 ---------------------------------------------------------------------

func TestMemberGuard(t *testing.T) {
	cases := []struct {
		name  string
		expr  string
		scope scopeMap
		want  string
	}{
		{"member chain", "user.profile.name", nil, "__d.user?.profile?.name"},
		{"index step", "rows[0].label", nil, "__d.rows?.[0]?.label"},
		{"computed index is its own chain", "rows[sel.id]", nil, "__d.rows?.[__d.sel?.id]"},
		{"loop local through its rewrite", "todo.text", scopeMap{"todo": "s.item"}, "s.item?.text"},
		{"bare loop local", "todo", scopeMap{"todo": "s.item"}, "s.item"},
		{"existing optional step", "a?.b.c", nil, "__d.a?.b?.c"},
		{"existing optional index", "a?.[0]", nil, "__d.a?.[0]"},
		{"call result", "name.trim().length", nil, "__d.name?.trim()?.length"},
		{"this: first step plain", "this.ctx.router", nil, "this.ctx?.router"},
		{"global: first step plain", "Math.max(a.b, 1)", nil, "Math.max(__d.a?.b, 1)"},
		{"global call result guarded", "JSON.parse(s).k", nil, "JSON.parse(__d.s)?.k"},
		{"new callee stays plain", "new Intl.NumberFormat('en').format(n)", nil, "new Intl.NumberFormat('en')?.format(__d.n)"},
		{"new data callee", "new a.B(x).c", nil, "new __d.a.B(__d.x)?.c"},
		{"string literal member", "'abc'.length", nil, "'abc'.length"},
		{"number in a ternary", "c ? .5 : x.y", nil, "__d.c ? .5 : __d.x?.y"},
		{"spread", "[...a.b]", nil, "[...__d.a?.b]"},
		{"array literal is not a step", "[a.b, c][0]", nil, "[__d.a?.b, __d.c]?.[0]"},
		{"template literal interpolation", "`${a.b}`", nil, "`${__d.a?.b}`"},
		{"loose equality untouched", "a.b == null", nil, "__d.a?.b == null"},
		// Constructs an optional chain cannot express: emitted plain.
		{"tagged template", "tag.fn`x${a.b}`", nil, "__d.tag.fn`x${__d.a.b}`"},
		{"update operator", "a.b++", nil, "__d.a.b++"},
		{"assignment", "a.b = c.d", nil, "__d.a.b = __d.c.d"},
		{"compound assignment", "a.b ??= 1", nil, "__d.a.b ??= 1"},
		{"left shift assignment", "a.b <<= 1", nil, "__d.a.b <<= 1"},
		{"right shift assignment", "a.b >>= 1", nil, "__d.a.b >>= 1"},
		{"unsigned shift assignment", "a.b >>>= 1", nil, "__d.a.b >>>= 1"},
		// Comparisons that share those bytes stay guarded.
		{"greater-or-equal", "a.b >= c.d", nil, "__d.a?.b >= __d.c?.d"},
		{"shift then compare", "a.b >> 1 <= c.d", nil, "__d.a?.b >> 1 <= __d.c?.d"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveValueScan(tc.expr, tc.scope, nil); got != tc.want {
				t.Errorf("resolveValueScan(%q)\n  got  %q\n  want %q", tc.expr, got, tc.want)
			}
		})
	}
}

// The guard is a value-position rule: event handler arguments are PuzzleKit
// JavaScript evaluated at fire time and stay exactly as written, and the plain
// resolver (puzzle check, tests) never guards.
func TestMemberGuardSkipsHandlersAndPlainResolve(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <button @click={ save(form.draft.title) }>{ form.draft.title }</button>`))
	wantAll(t, got,
		"this.events.save(__d.form.draft.title)",
		"__s(__d.form?.draft?.title,",
	)
	if got := resolveExpr("a.b.c", nil); got != "__d.a.b.c" {
		t.Errorf("resolveExpr must stay unguarded, got %q", got)
	}
}

// The guarded pass records the same facts as the plain one, and a fallback to
// the plain form does not record them twice.
func TestMemberGuardFactsUnchanged(t *testing.T) {
	for _, expr := range []string{"todo.text + todo.author.name", "todo.a.b++"} {
		plain := &exprFacts{}
		resolveExprScan(expr, scopeMap{"todo": "s.item"}, nil, plain)
		guarded := &exprFacts{}
		resolveValueScan(expr, scopeMap{"todo": "s.item"}, guarded)
		p, g := plain.locals["todo"], guarded.locals["todo"]
		if strings.Join(p.fields, ",") != strings.Join(g.fields, ",") || p.deep != g.deep || p.opaque != g.opaque {
			t.Errorf("%q: facts differ — plain %+v, guarded %+v", expr, *p, *g)
		}
	}
}

// ---- V8 ---------------------------------------------------------------------

func TestObjectLiteralArguments(t *testing.T) {
	cases := []struct {
		name  string
		expr  string
		scope scopeMap
		want  string
	}{
		{"keys stay keys", "{ height: 480, width: w }", nil, "{ height: 480, width: __d.w }"},
		{"shorthand expands", "{ count }", nil, "{ count: __d.count }"},
		{"shorthand loop local", "{ todo, n }", scopeMap{"todo": "s.item"}, "{ todo: s.item, n: __d.n }"},
		{"nested literal", "{ a: { b: c, d }, e }", nil, "{ a: { b: __d.c, d: __d.d }, e: __d.e }"},
		{"quoted key", "{ 'cart.count': n }", nil, "{ 'cart.count': __d.n }"},
		{"computed key", "{ [k]: v }", nil, "{ [__d.k]: __d.v }"},
		{"spread", "{ ...base, x: 1 }", nil, "{ ...__d.base, x: 1 }"},
		{"keyword-named keys", "{ default: a, new: b, class: c }", nil, "{ default: __d.a, new: __d.b, class: __d.c }"},
		{"ternary value then shorthand", "{ a: x ? y : z, w }", nil, "{ a: __d.x ? __d.y : __d.z, w: __d.w }"},
		{"call value with commas", "{ a: f(x, y), b }", nil, "{ a: __d.f(__d.x, __d.y), b: __d.b }"},
		{"inside an array", "[{ id }, { id: 2 }]", nil, "[{ id: __d.id }, { id: 2 }]"},
		{"member value is guarded", "{ n: user.count }", nil, "{ n: __d.user?.count }"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveValueScan(tc.expr, tc.scope, nil); got != tc.want {
				t.Errorf("resolveValueScan(%q)\n  got  %q\n  want %q", tc.expr, got, tc.want)
			}
		})
	}
}

// The motivating templates (the translation formatter, the image formatter) in
// every position that takes a chain, compiled and syntax-checked end to end: the
// keys were once scoped into `{__d.height: 480}`, which only the bundler caught.
func TestObjectLiteralFormatterArgumentsCompile(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <p>{ 'cart.count' | t({ count: n }) }</p>
  <img src={ photo | resize({ height: 480, fit }) } alt="{ 'alt' | t({ name: user.name }) }" />
  <Card label={ key | t({ nested: { deep: n }, 'x-y': 1 }) } />
  {#for item in items}<li>{ 'row' | t({ item, i: item.id }) }</li>{/for}`))
	wantAll(t, got,
		`(__f["t"] || __f.__missing("t"))('cart.count', { count: __d.n })`,
		`(__f["resize"] || __f.__missing("resize"))(__d.photo, { height: 480, fit: __d.fit })`,
		`(__f["t"] || __f.__missing("t"))('alt', { name: __d.user?.name })`,
		`(__f["t"] || __f.__missing("t"))(__d.key, { nested: { deep: __d.n }, 'x-y': 1 })`,
		`(__f["t"] || __f.__missing("t"))('row', { item: s.item, i: s.item?.id })`,
	)
	if strings.Contains(got, "__d.count:") || strings.Contains(got, "__d.height") {
		t.Errorf("an object literal key was scoped:\n%s", got)
	}
	// A whole row item handed to a formatter is opaque: the site is `deep`.
	wantAll(t, got, "deep: true")
	nodeCheck(t, got)
}

// ---- V12 --------------------------------------------------------------------

// A lowered loop guards its collection inside listRows, so its module imports
// nothing extra; a `.map` loop wraps its collection in loopItems (`__e`), and a
// range loop maps loopRange (`__r`). Each import appears only when used.
func TestLoopGuardImports(t *testing.T) {
	lowered := compileSrc(t, coreSrc(`  {#for item in items}<li>{ item.name }</li>{/for}`))
	if strings.Contains(lowered, "loopItems") || strings.Contains(lowered, "loopRange") {
		t.Errorf("a lowered loop needs no loop-guard import:\n%s", lowered)
	}

	mapped := compileSrc(t, coreSrc(`  <Card><Snippet rows>{#for r in rows}<li>{ r.name }</li>{/for}</Snippet></Card>`))
	wantAll(t, mapped,
		"loopItems as __e",
		"...__e(rows).map((r) =>",
	)
	if strings.Contains(mapped, "loopRange") {
		t.Errorf("no range loop, no loopRange import:\n%s", mapped)
	}

	ranged := compileSrc(t, coreSrc(`  {#for 1...count, n}<li>{ n }</li>{/for}`))
	wantAll(t, ranged,
		"import { ViewNode, displayValue as __s, loopRange as __r } from '@magic-spells/puzzle';",
		"__r(1, __d.count).map((n) =>",
	)
	nodeCheck(t, mapped)
	nodeCheck(t, ranged)

	// Both bounds integer literals: nothing can be missing or fractional, so the
	// range is constant-folded and imports no guard.
	for src, want := range map[string]string{
		`  {#for 1...3, n}<li>{ n }</li>{/for}`:   "[1, 2, 3].map((n) =>",
		`  {#for -1...1}<li>x</li>{/for}`:         "[-1, 0, 1].map((__i) =>",
		`  {#for 3...1, n}<li>{ n }</li>{/for}`:   "[].map((n) =>",
		`  {#for 1...100, n}<li>{ n }</li>{/for}`: "Array.from({ length: 100 }, (_, __k) => __k + 1).map((n) =>",
		`  {#for 1...(2), n}<li>{ n }</li>{/for}`: "__r(1, (2)).map((n) =>",
	} {
		got := compileSrc(t, coreSrc(src))
		wantAll(t, got, want)
		if folded := !strings.Contains(want, "__r("); folded && strings.Contains(got, "loopRange") {
			t.Errorf("a literal range imports no loopRange:\n%s", got)
		}
		nodeCheck(t, got)
	}
}

// The loop-guard locals are module-scope imports, so a <script> binding one of
// them is the same positioned collision error as any other injected import —
// and only for a file that emits it.
func TestLoopGuardLocalsAreReserved(t *testing.T) {
	src := "<puzzle-view>{#for 1...count, n}<b>{ n }</b>{/for}</puzzle-view>\n<script>\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\nconst __r = 1;\n" +
		"export default class T extends PuzzleView {}\n</script>\n"
	if _, err := compileSrcOpts(t, src, Options{Mode: ModeView}); err == nil || !strings.Contains(err.Error(), "__r") {
		t.Errorf("expected a reserved-binding error naming __r, got %v", err)
	}
	loopFree := "<puzzle-view><b>x</b></puzzle-view>\n<script>\n" +
		"import { PuzzleView } from '@magic-spells/puzzle';\nconst __r = 1;\n" +
		"export default class T extends PuzzleView {}\n</script>\n"
	if _, err := compileSrcOpts(t, loopFree, Options{Mode: ModeView}); err != nil {
		t.Errorf("a loop-free file may bind __r: %v", err)
	}
}
