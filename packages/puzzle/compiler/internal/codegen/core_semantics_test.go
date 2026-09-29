package codegen

import (
	"regexp"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// core_semantics_test.go — D173 group (b), expressions and loops, end to end:
// V1 library calls in every value position, V2 `==` keeps its JavaScript
// meaning, V4 the member guard, V8 object literals as arguments,
// V12 the loop guards — and the expression language (DESIGN-expr-v2) compiling
// in every position. The lowering rules one by one are in expr_test.go; V15
// (the script-less component's data()) is pinned in classname_test.go, and the
// runtime behavior in tests/core-semantics.test.js.

func compileCore(t *testing.T, body string) (string, error) {
	t.Helper()
	sec, err := parser.SplitSections(coreSrc(body), "T.pzl")
	if err != nil {
		return "", err
	}
	res, err := Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
	return res.JS, err
}

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

func TestLibraryCallInEveryValuePosition(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <a title={ currency(price) } data-or={ a || b }>x</a>
  <Card items={ truncate(list.join(', '), 20) } />
  <p class="x {#if on}{ capitalize(label) }{/if}">y</p>`))
	wantAll(t, got,
		// A brace-only attribute: a guarded library call.
		`title: (__f["currency"] || __f.__missing("currency"))(__d.price),`,
		// `||` stays logical OR.
		`'data-or': __d.a || __d.b,`,
		// A component prop: a library call over a method.
		`items: (__f["truncate"] || __f.__missing("truncate"))(__d.list?.join(', '), 20)`,
		// An interpolation inside an attribute value's inline {#if} branch.
		`(__f["capitalize"] || __f.__missing("capitalize"))(__d.label)`,
		// The registry read the calls need.
		"const __f = this.ctx.formatters.getAll();",
	)
	if regexp.MustCompile(`[^|]\| __[df]\.`).MatchString(got) {
		t.Errorf("a pipe compiled to a bitwise OR:\n%s", got)
	}
	nodeCheck(t, got)
}

// A condition header keeps `||` as logical OR and reads no function registry
// unless it calls a function. A `|` in one is a parse error, pinned in
// TestPipeIsACompileErrorInEveryHeader.
func TestConditionHeadersKeepJavaScriptOr(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#if tags || others}<b>a</b>{:else if a || b}<b>b</b>{/if}
  {#unless user || guest}<b>c</b>{/unless}
  {#case status || 'none'}{:when 'a'}<b>d</b>{/case}
  <p class="x {#if on || off}on{/if}">y</p>`))
	wantAll(t, got,
		"...(__d.tags || __d.others",
		"...(__d.a || __d.b",
		"...(!(__d.user || __d.guest)",
		"])(__d.status || 'none')),",
		"class: `x ${__d.on || __d.off ? 'on' : ''}`",
	)
	if strings.Contains(got, "__f") {
		t.Errorf("a condition header read the formatter registry:\n%s", got)
	}
	nodeCheck(t, got)
}

// TestPipeIsACompileErrorInEveryHeader: there are no pipes (D176). A `|` in
// any condition or branching header fails the compile with the positioned
// steer toward a call, and never falls back to a bitwise OR.
func TestPipeIsACompileErrorInEveryHeader(t *testing.T) {
	for _, tc := range []struct{ body, header string }{
		{"{#if tags | size}<b>a</b>{/if}", "an {#if} condition"},
		{"{#if ok}<b>a</b>{:else if others | size}<b>b</b>{/if}", "an {:else if} condition"},
		{"{#unless user | blank}<b>c</b>{/unless}", "an {#unless} condition"},
		{"{#case status | downcase}{:when 'a'}<b>d</b>{/case}", "a {#case} expression"},
		{`<p class="x {#if on | truthy}on{/if}">y</p>`, "an {#if} condition in an attribute value"},
	} {
		sec, err := parser.SplitSections(coreSrc("  "+tc.body), "T.pzl")
		if err == nil {
			_, err = Compile(sec, Options{Filename: "T.pzl", Mode: ModeView})
		}
		if err == nil {
			t.Errorf("%s: expected a compile error", tc.body)
			continue
		}
		want := "T.pzl:2:"
		if msg := err.Error(); !strings.Contains(msg, want) ||
			!strings.Contains(msg, "`| name` pipes were removed — write `name(value)`; bitwise OR is not available") {
			t.Errorf("%s (%s): error %q", tc.body, tc.header, msg)
		}
	}
}

// A condition that is itself a ternary is grouped, so the compiler's own
// `? then : else` cannot re-associate into the condition's false branch. Every
// other operator binds tighter, so `??` stays ungrouped.
func TestTernaryConditionIsGrouped(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#if mode === 'edit' ? canEdit : canView}<b>a</b>{:else if a ? b : c}<b>b</b>{/if}
  <p class="x {#if m ? e : v}on{/if}">y</p>
  <p class="y {#if on}a{#if p ? q : r}b{/if}{/if}">z</p>
  {#if x ?? y}<b>c</b>{/if}`))
	wantAll(t, got,
		"...((__d.mode === 'edit' ? __d.canEdit : __d.canView)\n",
		"...((__d.a ? __d.b : __d.c)\n",
		"${(__d.m ? __d.e : __d.v) ? 'on' : ''}",
		"((__d.p ? __d.q : __d.r) ? 'b' : '')",
		"...(__d.x ?? __d.y\n",
	)
	nodeCheck(t, got)
}

// A transformed form value displays a derived value; there is no field to
// write an edit back to, so no two-way binding is synthesized (D147).
func TestTransformedFormValueIsOneWay(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <input value={ name.toUpperCase() } />
  <input class="b" value={ capitalize(name) } />`))
	if strings.Contains(got, ":bind'") {
		t.Errorf("a transformed value must not synthesize a bind:\n%s", got)
	}
	wantAll(t, got,
		`value: __d.name?.toUpperCase()`,
		`value: (__f["capitalize"] || __f.__missing("capitalize"))(__d.name)`,
	)
}

// An explicit key calling a library function reads `__f`, which lives inside
// render(), so the site keeps `.map` instead of hoisting the key into a
// module-scope arrow.
func TestLibraryLoopKeyKeepsMap(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#for item in items}<li key={ slugify(item.id) }>x</li>{/for}`))
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

// Every member step is guarded in every position — handler arguments included,
// which are the same expression language — except a chain rooted at a
// handler's DOM event, which is written as authored (§9 k).
func TestMemberGuardEverywhere(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <button @click={ save(form.draft.title, event.target.value) }>{ form.draft.title }</button>`))
	wantAll(t, got,
		"this.events.save(__d.form?.draft?.title, event.target.value)",
		"__s(__d.form?.draft?.title,",
	)
	nodeCheck(t, got)
}

// ---- V8 ---------------------------------------------------------------------

// The motivating templates (the translation function, an image function) in
// every value position, compiled and syntax-checked end to end: the keys were
// once scoped into `{__d.height: 480}`, which only the bundler caught.
func TestObjectLiteralFunctionArgumentsCompile(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <p>{ t('cart.count', { count: n }) }</p>
  <img src={ resize(photo, { height: 480, fit }) } alt="{ t('alt', { name: user.name }) }" />
  <Card label={ t(key, { nested: { deep: n }, 'x-y': 1 }) } />
  {#for item in items}<li>{ t('row', { item, i: item.id }) }</li>{/for}`))
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
	// A whole row item handed to a function is opaque: the site is `deep`.
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
		// The bound's parentheses are not in the tree: it is the literal 2.
		`  {#for 1...(2), n}<li>{ n }</li>{/for}`: "[1, 2].map((n) =>",
		`  {#for 1...+2, n}<li>{ n }</li>{/for}`:  "__r(1, +2).map((n) =>",
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

// ---- the expression language ---------------------------------------------

// Methods, library functions, JavaScript globals, arrow functions, template
// literals and `.length` compile in every value position (DESIGN-expr-v2 §1).
func TestExpressionLanguageInEveryPosition(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
	}{
		{"method in text", "  <p>{ name.toUpperCase() }</p>", "__s(__d.name?.toUpperCase(),"},
		{"library function in text", "  <p>{ currency(price) }</p>", `__s((__f["currency"] || __f.__missing("currency"))(__d.price),`},
		{"Math", "  <p>{ Math.round(x) }</p>", "__s(Math.round(__d.x),"},
		{"at(-1)", "  <p>{ items.at(-1) }</p>", "__d.items?.at(-1)"},
		{"brace attribute", "  <button disabled={ !draft.trim() }>x</button>", "disabled: !__d.draft?.trim()"},
		{"quoted attribute", `  <p title="{ a.trim() } x">y</p>`, "title: `${__s(__d.a?.trim(), "},
		{"inline-if condition", `  <p class="x {#if tags.includes(b)}on{/if}">y</p>`, "${__d.tags?.includes(__d.b) ? 'on' : ''}"},
		{"component prop with an arrow", "  <Card items={ list.filter(x => x.on) } />", "items: __d.list?.filter((x) => x?.on)"},
		{"marker argument", `  <Slot name="row" item={ rows.at(0) } />`, "item: __d.rows?.at(0)"},
		{"key", "  {#for t in todos}<li key={ t.id.toString() }>x</li>{/for}", "key: (t) => t?.id?.toString()"},
		{"if subject", "  {#if items.includes(x)}<b>a</b>{/if}", "...(__d.items?.includes(__d.x)"},
		{"case subject", "  {#case kind.trim()}{:when 'a'}<b>d</b>{/case}", "])(__d.kind?.trim()))"},
		{"when value", "  {#case kind}{:when modes.at(0)}<b>d</b>{/case}", "__c === (__d.modes?.at(0))"},
		{"for collection", "  {#for t in todos.filter(t => !t.done)}<li>x</li>{/for}", "__l(this, this, 0, __d.todos?.filter((t) => !t?.done), (s) =>"},
		{"range bound", "  {#for 1...Math.max(n, 1)}<li>x</li>{/for}", "__r(1, Math.max(__d.n, 1))"},
		{"template literal", "  <p>{ `${a} ${b}` }</p>", "__s(`${__d.a} ${__d.b}`,"},
		{"length", "  <p>{ items.length }</p>", "__s(__d.items?.length,"},
		{"length condition", "  {#if items.length}<b>a</b>{/if}", "...(__d.items?.length\n"},
		{"nullish fallback", "  <p>{ name ?? 'anon' }</p>", "__s(__d.name ?? 'anon',"},
		{"handler condition", "  <button @click={ items.some(i => i.on) ? save : null }>x</button>", "(__d.items?.some((i) => i?.on)) ? (event) => this.events.save(event) : null"},
		{"handler arguments", "  <button @click={ save(x.trim(), items.length) }>x</button>", "this.events.save(__d.x?.trim(), __d.items?.length)"},
		{"member named this", "  <p>{ x.this }</p>", "__d.x?.this"},
		{"computed length", "  <p>{ obj['length'] }</p>", "__d.obj?.['length']"},
		{"root named length", "  <p>{ length }</p>", "__s(__d.length,"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := compileCore(t, tc.body)
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			if !strings.Contains(got, tc.want) {
				t.Errorf("missing %q in:\n%s", tc.want, got)
			}
			nodeCheck(t, got)
		})
	}
}

// A form value written as a call displays a transformed value, as a piped one
// does: there is no field to write an edit back to, so it stays one-way (D147).
func TestCalledFormValueIsOneWay(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <input value={ capitalize(name) } />`))
	if strings.Contains(got, ":bind'") {
		t.Errorf("a called value must not synthesize a bind:\n%s", got)
	}
}

// A key calling a library function reads `__f`, which lives inside render(),
// so the site keeps `.map` — as a piped key does.
func TestCalledLoopKeyKeepsMap(t *testing.T) {
	got := compileSrc(t, coreSrc(`  {#for item in items}<li key={ slugify(item.id) }>x</li>{/for}`))
	if strings.Contains(got, "__l(") {
		t.Errorf("a key reading __f must not lower:\n%s", got)
	}
	wantAll(t, got,
		"__e(__d.items).map((item) =>",
		`key: (__f["slugify"] || __f.__missing("slugify"))(item?.id)`,
	)
}

// `.size` is an ordinary member read (a Map's or a file's own field), never
// the count: no module imports a size helper, and the count is `.length`.
func TestSizeIsAnOrdinaryField(t *testing.T) {
	got := compileSrc(t, coreSrc(`  <p>{ file.size } { items.length }</p>
  {#if items.length > 0}<b>a</b>{/if}`))
	wantAll(t, got, "__d.file?.size", "__d.items?.length", "...(__d.items?.length > 0")
	if strings.Contains(got, "sizeOf") || strings.Contains(got, "__z") {
		t.Errorf("no module imports a size helper:\n%s", got)
	}
}
