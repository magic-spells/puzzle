package codegen

import (
	"strings"
	"testing"
)

// listblock_test.go — item-form {#for} lowering to a persistent list block
// (D170, list blocks). The site meta const is the contract between the
// compiler and the runtime block, so each field is pinned here: it is emitted
// only when non-default, in a fixed order, and it says exactly what the body
// reads.

// listSrc wraps a template body in a compilable view whose data() names the
// roots these tests read.
func listSrc(body string) string {
	return viewSrc(body,
		"import { PuzzleView } from '@magic-spells/puzzle';\n"+
			"import Row from './Row.pzl';\n"+
			"export default class T extends PuzzleView {}")
}

func TestListBlockSyntheticKey(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li>{ todo.text }</li>{/for}"))
	// The site meta hoists the D58 resolver out of render(); the row root's
	// FIRST attribute is the block's resolved key.
	if !strings.Contains(got, "const __L0 = { key: (todo) => ViewNode.keyOf(todo), fields: ['text'] };") {
		t.Errorf("expected the synthetic-key site meta:\n%s", got)
	}
	if !strings.Contains(got, "__l(this, this, 0, __d.todos, (s) =>") {
		t.Errorf("expected the list call with `this` as owner and site 0:\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('li', { key: s.k }") {
		t.Errorf("expected `key: s.k` as the row root's first attr:\n%s", got)
	}
	if !strings.Contains(got, ", __L0)") {
		t.Errorf("expected the meta to close the list call:\n%s", got)
	}
	if strings.Contains(got, ".map((todo)") {
		t.Errorf("an item-form loop must not keep the .map emission:\n%s", got)
	}
}

// The block is reached through an IMPORT, not through a PuzzleView method, so a
// module that lowers no loop never names views/listBlock.js and the bundler
// drops it — the same tree-shaking contract `displayValue as __s` carries.
func TestListBlockImportOnlyWhenLowered(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li>{ todo.text }</li>{/for}"))
	if !strings.Contains(got, "import { ViewNode, displayValue as __s, listRows as __l } from '@magic-spells/puzzle';") {
		t.Errorf("a lowered loop must add `listRows as __l` after `displayValue as __s`:\n%s", got)
	}
	// No loop at all: the import line is byte-identical to pre-D170 output.
	none := compileSrc(t, listSrc("  <li>plain</li>"))
	if strings.Contains(none, "listRows") || strings.Contains(none, "__l(") {
		t.Errorf("a loop-free module must not import the list block:\n%s", none)
	}
	// A loop that is NOT lowered (range form) must not import it either.
	ranged := compileSrc(t, listSrc("  {#for 1...3, n}<span>{ n }</span>{/for}"))
	if strings.Contains(ranged, "listRows") || strings.Contains(ranged, "__l(") {
		t.Errorf("a range loop must not import the list block:\n%s", ranged)
	}
}

// An explicit key moves INTO the meta with the loop local left bare; the row
// root still carries `key: s.k`, so the block owns row identity either way.
func TestListBlockExplicitKey(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li key={ todo.slug }>{ todo.text }</li>{/for}"))
	if !strings.Contains(got, "const __L0 = { key: (todo) => todo.slug, fields: ['text'] };") {
		t.Errorf("explicit key must become the meta key arrow:\n%s", got)
	}
	if !strings.Contains(got, "new ViewNode('li', { key: s.k }") {
		t.Errorf("the row root must carry the block key, not the author's expression:\n%s", got)
	}
	if strings.Contains(got, "key: todo.slug,") {
		t.Errorf("the author's key must not also stay on the row root:\n%s", got)
	}
}

// An explicit key that reads the counter takes the second arrow parameter.
func TestListBlockExplicitKeyReadsCounter(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos, i}<li key={ i }>{ todo.text }</li>{/for}"))
	if !strings.Contains(got, "const __L0 = { key: (todo, i) => i, fields: ['text'] };") {
		t.Errorf("a counter-reading key must take the second arrow parameter:\n%s", got)
	}
}

// The site meta const sits at MODULE scope, where `__d`, `__f` and `this` do
// not exist, so a key expression reading render state cannot be hoisted. Such a
// site keeps today's `.map(…)` emission rather than emitting an arrow that
// throws on its first call.
func TestListBlockKeyReadingDataKeepsMap(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li key={ prefix + todo.id }>{ todo.text }</li>{/for}"))
	if !strings.Contains(got, "__d.todos.map((todo) =>") {
		t.Errorf("a data-reading explicit key must keep the .map emission:\n%s", got)
	}
	if strings.Contains(got, "__L0") || strings.Contains(got, "__l(") {
		t.Errorf("a data-reading explicit key must not produce a list block:\n%s", got)
	}
	if !strings.Contains(got, "key: __d.prefix + todo.id") {
		t.Errorf("the author's key must stand verbatim on the row root:\n%s", got)
	}
}

// `counter: true` is set by a BODY read of the counter, which is what makes an
// index change dirty a row.
func TestListBlockCounterFlag(t *testing.T) {
	with := compileSrc(t, listSrc("  {#for todo in todos, i}<li>{ i }. { todo.text }</li>{/for}"))
	if !strings.Contains(with, "counter: true") {
		t.Errorf("a body reading the counter must set counter: true:\n%s", with)
	}
	if !strings.Contains(with, "__s(s.i,") {
		t.Errorf("the counter must resolve to the row scope:\n%s", with)
	}
	without := compileSrc(t, listSrc("  {#for todo in todos, i}<li>{ todo.text }</li>{/for}"))
	if strings.Contains(without, "counter: true") {
		t.Errorf("an unread counter must not set counter: true:\n%s", without)
	}
}

// `ctrl: true` marks a row holding a controlled form value, which a clean pass
// must still re-assert against the live DOM.
func TestListBlockCtrlFlag(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"dynamic checked", "  {#for todo in todos}<li><input type=\"checkbox\" checked={ todo.done } /></li>{/for}", true},
		{"static value", "  {#for todo in todos}<li><input value=\"x\" /></li>{/for}", true},
		{"textarea value", "  {#for todo in todos}<li><textarea value={ todo.body }></textarea></li>{/for}", true},
		{"select value", "  {#for todo in todos}<li><select value={ todo.mode }></select></li>{/for}", true},
		{"no control", "  {#for todo in todos}<li><input type=\"text\" /></li>{/for}", false},
		{"non-control value attr", "  {#for todo in todos}<li><option value=\"x\">a</option></li>{/for}", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, listSrc(tc.body))
			if strings.Contains(got, "ctrl: true") != tc.want {
				t.Errorf("ctrl: true = %v, want %v:\n%s", !tc.want, tc.want, got)
			}
		})
	}
}

// The `roots` mask indexes the class's `__roots` array, and it counts every
// parent-root read in the body — handler arguments included, because such a
// handler stays a fresh closure over the render's `__d` snapshot.
func TestListBlockRootsMaskIncludesHandlerArgs(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}\n"+
			"    <li class=\"{#if todo.id === selectedId}on{/if}\" @click={ pick(todo, mode) }>{ todo.text }</li>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "roots: 3") {
		t.Errorf("expected both roots in the mask (bits 0 and 1):\n%s", got)
	}
	if !strings.Contains(got, "T.__roots = ['selectedId', 'mode'];") {
		t.Errorf("expected the __roots stamp in first-read order:\n%s", got)
	}
	// A handler reading render data keeps the fresh closure (D62 unchanged).
	if !strings.Contains(got, "'@click': (event) => this.events.pick(s.item, __d.mode)") {
		t.Errorf("a data-reading row handler must stay a fresh closure:\n%s", got)
	}
}

// No loop reads a parent root → no stamp, and PuzzleView skips the dirty-mask
// computation entirely.
func TestListBlockNoRootsNoStamp(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li>{ todo.text }</li>{/for}"))
	if strings.Contains(got, "__roots") {
		t.Errorf("a loop reading no parent root must emit no __roots stamp:\n%s", got)
	}
	if strings.Contains(got, "roots:") {
		t.Errorf("an empty mask is the default and must be omitted:\n%s", got)
	}
}

// A root read OUTSIDE every loop never occupies a bit: the array exists only to
// index list-block masks.
func TestListBlockRootsOnlyFromLoopBodies(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  <h1>{ pageTitle }</h1>\n"+
			"  {#for todo in todos}<li>{ todo.text } { mode }</li>{/for}",
	))
	if !strings.Contains(got, "T.__roots = ['mode'];") {
		t.Errorf("only loop-body roots belong in the array:\n%s", got)
	}
	if !strings.Contains(got, "roots: 1") {
		t.Errorf("expected bit 0 for the single loop root:\n%s", got)
	}
}

// fields/deep: depth-one member reads are fields; anything the record's own
// revision cannot cover is `deep`. Passing the item WHOLE as a prop or a
// handler argument is neither — those re-read the live row.
func TestListBlockFieldsAndDeep(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		wantFields string
		wantDeep   bool
	}{
		{"depth one", "<li>{ todo.text } { todo.author }</li>", "fields: ['author', 'text']", false},
		{"sorted distinct", "<li>{ todo.b } { todo.a } { todo.b }</li>", "fields: ['a', 'b']", false},
		{"deep path", "<li>{ todo.author.name }</li>", "", true},
		{"call on item", "<li>{ todo.fullName() }</li>", "", true},
		{"dynamic member", "<li>{ todo[key] }</li>", "", true},
		{"item into a displayed call", "<li>{ fmt(todo) }</li>", "", true},
		{"whole item as a prop", "<Row todo={ todo } />", "", false},
		{"whole item as a handler arg", "<li @click={ del(todo) }>x</li>", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, listSrc("  {#for todo in todos}"+tc.body+"{/for}"))
			if tc.wantFields == "" {
				if strings.Contains(got, "fields:") {
					t.Errorf("expected no fields:\n%s", got)
				}
			} else if !strings.Contains(got, tc.wantFields) {
				t.Errorf("expected %q:\n%s", tc.wantFields, got)
			}
			if strings.Contains(got, "deep: true") != tc.wantDeep {
				t.Errorf("deep: true = %v, want %v:\n%s", !tc.wantDeep, tc.wantDeep, got)
			}
		})
	}
}

// `volatile` is the escape hatch for a body the compiler's dependency model
// cannot see through: any `this` read makes every row dirty on every pass.
func TestListBlockVolatile(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li>{ this.ctx.router.current.path } { todo.text }</li>{/for}"))
	if !strings.Contains(got, "volatile: true") {
		t.Errorf("a body reading `this` must be volatile:\n%s", got)
	}
	// `this` in a HANDLER argument is read at fire time against a stable
	// instance — D62 already calls it data-independent, so it must not make the
	// row volatile.
	handler := compileSrc(t, listSrc("  {#for todo in todos}<li @click={ h(this.x) }>{ todo.text }</li>{/for}"))
	if strings.Contains(handler, "volatile: true") {
		t.Errorf("`this` inside a handler argument must not mark the site volatile:\n%s", handler)
	}
}

// Nested loops: the inner factory parameter is `s1`, the inner call's owner is
// the enclosing scope object, and an inner body reads the outer item through
// the outer scope's name.
func TestListBlockNestedLoops(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups}\n"+
			"    <div>\n"+
			"      {#for item in group.items}<p @click={ pick(item, group) }>{ item.name }</p>{/for}\n"+
			"    </div>\n"+
			"  {/for}",
	))
	for _, want := range []string{
		"const __L0 = { key: (group) => ViewNode.keyOf(group), fields: ['items'] };",
		"const __L1 = { key: (item) => ViewNode.keyOf(item), fields: ['name'] };",
		"__l(this, this, 0, __d.groups, (s) =>",
		"__l(this, s, 1, s.item.items, (s1) =>",
		"new ViewNode('p', {\n            key: s1.k,",
		"'@click': (s1.h0 ??= (event) => this.events.pick(s1.item, s.item)),",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected %q:\n%s", want, got)
		}
	}
}

// A loop inside a <Snippet> body keeps today's `.map(…)`: the body is stamped
// fresh per expansion, so a block keyed by site id would be shared between
// stamps.
func TestListBlockSnippetBodyKeepsMap(t *testing.T) {
	got := compileSrc(t, listSrc("  <Row><Snippet rows>{#for r in rows}<li>{ r.name }</li>{/for}</Snippet></Row>"))
	if !strings.Contains(got, "rows.map((r) =>") {
		t.Errorf("a loop inside a snippet body must keep the .map emission:\n%s", got)
	}
	if strings.Contains(got, "__L0") || strings.Contains(got, "__l(") {
		t.Errorf("a snippet body must produce no list block:\n%s", got)
	}
	if !strings.Contains(got, "key: ViewNode.keyOf(r)") {
		t.Errorf("a snippet-body row must keep the inline D58 key:\n%s", got)
	}
}

// Range loops keep today's emission everywhere, with or without a counter.
func TestListBlockRangeUnchanged(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for 1...count, n}<span key={ n }>{ n }</span>{/for}"))
	if !strings.Contains(got, "Array.from({ length: (__d.count) - (1) + 1 }") {
		t.Errorf("range form must keep Array.from:\n%s", got)
	}
	if strings.Contains(got, "__L0") || strings.Contains(got, "__l(") {
		t.Errorf("a range loop must produce no list block:\n%s", got)
	}
}

// A range loop nested in a row still keeps its own emission, and a handler
// capturing the RANGE variable must not be cached on the row scope — that
// binding is re-made per iteration, so a cached closure would freeze it.
func TestListBlockRangeInsideRowNotRowCached(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}<li>{#for 1...3, n}<b @click={ pick(n) }>{ n }</b>{/for}</li>{/for}",
	))
	if !strings.Contains(got, "'@click': (event) => this.events.pick(n)") {
		t.Errorf("a range-variable handler must stay a fresh closure:\n%s", got)
	}
	if strings.Contains(got, "s.h0") {
		t.Errorf("a range-variable handler must not cache on the row scope:\n%s", got)
	}
}

// The conditional-arity gate is unchanged: an item-form site is still unstable
// occupancy (its keys may resolve null), a range site is still provable.
func TestListBlockConditionalArityUnchanged(t *testing.T) {
	item := compileSrc(t, listSrc("  {#if show}{#for todo in todos}<li>{ todo.text }</li>{/for}{/if}\n  <input placeholder=\"n\" />"))
	if strings.Contains(item, "new ViewNode('#')") {
		t.Errorf("an item-form branch must still block arity padding:\n%s", item)
	}
	rangeForm := compileSrc(t, listSrc("  {#if show}{#for 1...3}<li>x</li>{/for}{/if}\n  <input placeholder=\"n\" />"))
	if !strings.Contains(rangeForm, ": []),") {
		t.Errorf("a range-only branch has static length 0 and must stay empty:\n%s", rangeForm)
	}
}

// Site ids and scope names are deterministic, so recompiling unchanged source
// is byte-stable.
func TestListBlockByteStable(t *testing.T) {
	src := listSrc("  {#for a in xs}<li>{ a.n }</li>{/for}\n  {#for b in ys}<li>{ b.n }</li>{/for}")
	got := compileSrc(t, src)
	if !strings.Contains(got, "const __L0 = { key: (a) => ViewNode.keyOf(a), fields: ['n'] };\nconst __L1 = { key: (b) => ViewNode.keyOf(b), fields: ['n'] };") {
		t.Errorf("site metas must be emitted in source order:\n%s", got)
	}
	if again := compileSrc(t, src); again != got {
		t.Error("recompiling the same source must be byte-stable; outputs differ")
	}
}

// The key arrow lives at module scope, so it may close over NOTHING but its own
// parameters. A key reading an enclosing row's local would compile to `s.item…`
// outside render() — a ReferenceError on the block's first key call — so such a
// site keeps its `.map(…)` emission instead.
func TestListBlockKeyReadingEnclosingRowKeepsMap(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}\n"+
			"    <div>{#for tag in todo.tags}<li key={ todo.id + tag.id }>{ tag.n }</li>{/for}</div>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "s.item.tags.map((tag) =>") {
		t.Errorf("the inner loop must keep the .map emission:\n%s", got)
	}
	if strings.Contains(got, "__L1") {
		t.Errorf("the inner loop must produce no site meta:\n%s", got)
	}
	for _, line := range strings.Split(got, "\n") {
		if strings.HasPrefix(line, "const __L") && (strings.Contains(line, "s.item") || strings.Contains(line, "__d.")) {
			t.Errorf("a module-scope key arrow must close over nothing from render():\n%s", line)
		}
	}
}

// A key reading a <Snippet> parameter is the same hazard by another route.
func TestListBlockKeyReadingSnippetParamKeepsMap(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  <Row><Snippet prefix>{#for todo in todos}<li key={ prefix + todo.id }>{ todo.text }</li>{/for}</Snippet></Row>",
	))
	if strings.Contains(got, "__l(") {
		t.Errorf("a snippet body must produce no list block at all:\n%s", got)
	}
}

// --- C1: nothing inside a NON-LOWERED loop body may lower ---

// A range body is emitted once and evaluated per iteration, so an item-form loop
// inside it would take one site id and one block shared by every iteration — the
// same row vnode objects mounted at two DOM positions, so updating the source
// array only reaches the last one.
func TestListBlockNeverLowersInsideRangeBody(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for 1...2, n}\n"+
			"    <ul key={ n }>\n"+
			"      {#for item in items}<li>{ item.name }</li>{/for}\n"+
			"    </ul>\n"+
			"  {/for}",
	))
	if strings.Contains(got, "__l(") || strings.Contains(got, "__L0") {
		t.Errorf("a loop inside a range body must not lower:\n%s", got)
	}
	if !strings.Contains(got, "__d.items.map((item) =>") {
		t.Errorf("it must keep the .map emission:\n%s", got)
	}
	if strings.Contains(got, "listRows") {
		t.Errorf("a file that lowers nothing must not import the list block:\n%s", got)
	}
}

// The explicit-key `.map` fallback is a non-lowered body for exactly the same
// reason — it is emitted once and evaluated per iteration — so a loop nested
// inside one keeps `.map` too, and no static subtree inside it takes a slot.
func TestListBlockNeverLowersInsideMapFallbackBody(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups}\n"+
			"    <section key={ prefix + group.id }>\n"+
			"      <div class=\"chrome\"><span>A</span><b>B</b></div>\n"+
			"      {#for item in group.items}<li>{ item.name }</li>{/for}\n"+
			"    </section>\n"+
			"  {/for}",
	))
	if strings.Contains(got, "__l(") || strings.Contains(got, "__L0") {
		t.Errorf("neither loop may lower (the outer key reads render scope):\n%s", got)
	}
	if !strings.Contains(got, "group.items.map((item) =>") {
		t.Errorf("the nested loop must keep the .map emission:\n%s", got)
	}
	if strings.Contains(got, "this.__c[") || strings.Contains(got, ".c[") {
		t.Errorf("a static subtree inside a .map fallback body must take no slot:\n%s", got)
	}
}

// A range nested inside a LOWERED row is the same hazard one level in: the range
// body is still emitted once and evaluated per iteration, so an item loop inside
// it must not lower even though a row scope is available to own it.
func TestListBlockRangeInsideRowDoesNotLowerNestedItemLoop(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}\n"+
			"    <li>\n"+
			"      {#for 1...2, n}\n"+
			"        <ul key={ n }>\n"+
			"          {#for tag in todo.tags}<em>{ tag.name }</em>{/for}\n"+
			"        </ul>\n"+
			"      {/for}\n"+
			"    </li>\n"+
			"  {/for}",
	))
	if n := strings.Count(got, "__l(this,"); n != 1 {
		t.Errorf("exactly one lowered site (the outer loop), got %d:\n%s", n, got)
	}
	if strings.Contains(got, "__L1") {
		t.Errorf("the loop inside the range must produce no site meta:\n%s", got)
	}
	if !strings.Contains(got, "s.item.tags.map((tag) =>") {
		t.Errorf("it must keep the .map emission, reading the row through the scope:\n%s", got)
	}
}

// --- C2: an authored bare binding must never shadow the row scope object ---

// The row scope object is `s`, so a range counter spelled `s` inside a row used
// to emit `.map((s) => … s.item.text …)` — a TypeError on the first iteration.
// The authored binding is mangled instead; the row scope name never moves.
func TestListBlockRangeCounterShadowingRowScope(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}\n"+
			"    <li>{#for 1...2, s}<i key={ s }>{ s }: { todo.text }</i>{/for}</li>\n"+
			"  {/for}",
	))
	if strings.Contains(got, ".map((s) =>") {
		t.Errorf("a range counter must not shadow the row scope object:\n%s", got)
	}
	if !strings.Contains(got, ".map((__pzls) =>") {
		t.Errorf("the colliding counter must be mangled:\n%s", got)
	}
	if !strings.Contains(got, "key: __pzls") {
		t.Errorf("the counter's reads must be rewritten to the mangled name:\n%s", got)
	}
	if !strings.Contains(got, "s.item.text") {
		t.Errorf("the row local must still read off the row scope:\n%s", got)
	}
}

// The `.map` fallback binds its item and counter bare too.
func TestListBlockFallbackItemShadowingRowScope(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}\n"+
			"    <ul>{#for s in todo.tags}<li key={ prefix + s.id }>{ s.name }{ todo.text }</li>{/for}</ul>\n"+
			"  {/for}",
	))
	if strings.Contains(got, ".map((s) =>") {
		t.Errorf("a fallback loop item must not shadow the row scope object:\n%s", got)
	}
	if !strings.Contains(got, "s.item.tags.map((__pzls) =>") {
		t.Errorf("the colliding item must be mangled:\n%s", got)
	}
	if !strings.Contains(got, "__pzls.name") {
		t.Errorf("the item's reads must be rewritten to the mangled name:\n%s", got)
	}
	if !strings.Contains(got, "s.item.text") {
		t.Errorf("the row local must still read off the row scope:\n%s", got)
	}
}

// Nested rows are `s`, `s1`, …, so the collision test is per live scope name.
func TestListBlockNestedRangeCounterShadowingInnerRowScope(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups}\n"+
			"    <ul>{#for item in group.items}\n"+
			"      <li>{#for 1...2, s1}<i key={ s1 }>{ s1 }{ item.name }</i>{/for}</li>\n"+
			"    {/for}</ul>\n"+
			"  {/for}",
	))
	if strings.Contains(got, ".map((s1) =>") {
		t.Errorf("a range counter must not shadow the inner row scope object:\n%s", got)
	}
	if !strings.Contains(got, ".map((__pzls1) =>") {
		t.Errorf("the colliding counter must be mangled:\n%s", got)
	}
	if !strings.Contains(got, "s1.item.name") {
		t.Errorf("the inner row local must still read off `s1`:\n%s", got)
	}
}

// A <Snippet> parameter is destructured by its AUTHORED name — the marker
// argument contract — but binds a mangled local when it would shadow a row.
func TestListBlockSnippetParamShadowingRowScope(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for todo in todos}<li><Row><Snippet s>{ s }{ todo.text }</Snippet></Row></li>{/for}",
	))
	if !strings.Contains(got, "params: ['s']") {
		t.Errorf("the snippet's declared parameter name must stay authored:\n%s", got)
	}
	if !strings.Contains(got, "fn: ({ s: __pzls }) =>") {
		t.Errorf("the colliding parameter must bind a mangled local:\n%s", got)
	}
	if !strings.Contains(got, "__s(__pzls,") {
		t.Errorf("the parameter's reads must be rewritten to the mangled name:\n%s", got)
	}
	if !strings.Contains(got, "s.item.text") {
		t.Errorf("the row local must still read off the row scope:\n%s", got)
	}
}

// --- C3: an inner row rebuilds when the enclosing row's item or counter moves ---

// A nested block only runs at all when its enclosing row runs, so "this body
// reads something the outer row supplies" is exact. Without it the inner rows
// come back cached (their own item did not change) while `group.label` moved.
func TestListMetaEnclosingLocalMakesInnerVolatile(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups}\n"+
			"    <section>\n"+
			"      {#for item in group.items}<p>{ group.label }: { item.name }</p>{/for}\n"+
			"    </section>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "const __L1 = { key: (item) => ViewNode.keyOf(item), fields: ['name'], volatile: true };") {
		t.Errorf("the inner site must be volatile:\n%s", got)
	}
	if !strings.Contains(got, "const __L0 = { key: (group) => ViewNode.keyOf(group), fields: ['items', 'label'] };") {
		t.Errorf("the owning site records the read as its own field and stays non-volatile:\n%s", got)
	}
}

// An enclosing COUNTER read is the same dependency by another name.
func TestListMetaEnclosingCounterMakesInnerVolatile(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups, gi}\n"+
			"    <section>{#for item in group.items}<p>{ gi }: { item.name }</p>{/for}</section>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "const __L1 = { key: (item) => ViewNode.keyOf(item), fields: ['name'], volatile: true };") {
		t.Errorf("a site reading the enclosing counter must be volatile:\n%s", got)
	}
	if !strings.Contains(got, "const __L0 = { key: (group) => ViewNode.keyOf(group), counter: true, fields: ['items'] };") {
		t.Errorf("the owning site records the counter read:\n%s", got)
	}
}

// The mark propagates to EVERY site between the reader and the owner: a middle
// site that cached its rows would never re-invoke the innermost block.
func TestListMetaEnclosingLocalPropagatesThroughMiddleSite(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for a in as}\n"+
			"    <ul>{#for b in a.bs}\n"+
			"      <li>{#for c in b.cs}<em>{ a.label }{ c.n }</em>{/for}</li>\n"+
			"    {/for}</ul>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "const __L1 = { key: (b) => ViewNode.keyOf(b), fields: ['cs'], volatile: true };") {
		t.Errorf("the middle site must be volatile too:\n%s", got)
	}
	if !strings.Contains(got, "const __L2 = { key: (c) => ViewNode.keyOf(c), fields: ['n'], volatile: true };") {
		t.Errorf("the reading site must be volatile:\n%s", got)
	}
	if strings.Contains(got, "const __L0 = { key: (a) => ViewNode.keyOf(a), fields: ['bs', 'label'], volatile: true };") {
		t.Errorf("the owner must not be marked volatile by its own local:\n%s", got)
	}
}

// A nested site reading only its OWN locals stays non-volatile, and a handler
// ARGUMENT reading an enclosing local is a fire-time read that does not count —
// the same carve-out `this` in a handler argument already has.
func TestListMetaOwnLocalsStayNonVolatile(t *testing.T) {
	got := compileSrc(t, listSrc(
		"  {#for group in groups}\n"+
			"    <section>{#for item in group.items}<p @click={ pick(item, group) }>{ item.name }</p>{/for}</section>\n"+
			"  {/for}",
	))
	if strings.Contains(got, "volatile: true") {
		t.Errorf("no site here may be volatile:\n%s", got)
	}
}

// --- C4: opaque whole-value reads are conservative ---

// A bare record local is on identity ONLY as a direct member access or as the
// whole expression. Anywhere else the compiler cannot see what the value reaches.
func TestListMetaOpaqueRecordReads(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		wantDeep bool
	}{
		{"formatter pipe", "<li>{ post | authorName }</li>", true},
		{"parenthesised member access", "<li>{ (post).author.name }</li>", true},
		{"comment-separated member access", "<li>{ post /* c */ .author.name }</li>", true},
		{"template-literal interpolation", "<li>{ `by ${post}` }</li>", true},
		{"call argument", "<li>{ fmt(post) }</li>", true},
		{"operand of a larger expression", "<li>{ 'by ' + post }</li>", true},
		{"deep path", "<li>{ post.author.name }</li>", true},
		{"display of the record", "<li>{ post }</li>", false},
		{"depth-one member", "<li>{ post.title }</li>", false},
		{"formatted member", "<li>{ post.title | upcase }</li>", false},
		{"whole record as a prop", "<Row post={ post } />", false},
		{"whole record as a handler arg", "<li @click={ del(post) }>x</li>", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, listSrc("  {#for post in posts}"+tc.body+"{/for}"))
			if strings.Contains(got, "deep: true") != tc.wantDeep {
				t.Errorf("deep: true = %v, want %v:\n%s", !tc.wantDeep, tc.wantDeep, got)
			}
		})
	}
}

// --- C5: mutable globals and clock-reading built-ins make a site volatile ---

// A cached row holding `{ window.location.hash }` would show `#old` forever.
func TestListMetaVolatileGlobals(t *testing.T) {
	cases := []struct {
		name         string
		body         string
		wantVolatile bool
	}{
		{"window", "<li>{ window.location.hash }{ todo.text }</li>", true},
		{"document", "<li>{ document.title }{ todo.text }</li>", true},
		{"Date.now", "<li>{ Date.now() }{ todo.text }</li>", true},
		{"new Date", "<li>{ new Date().getFullYear() }{ todo.text }</li>", true},
		{"Math.random", "<li>{ Math.random() }{ todo.text }</li>", true},
		{"globalThis", "<li>{ globalThis.x }{ todo.text }</li>", true},
		{"Math.max stays pure", "<li>{ Math.max(todo.a, 1) }</li>", false},
		{"JSON stays pure", "<li>{ JSON.stringify(todo.a) }</li>", false},
		{"Number stays pure", "<li>{ Number(todo.a) }</li>", false},
		{"Intl stays pure", "<li>{ Intl.NumberFormat }{ todo.text }</li>", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, listSrc("  {#for todo in todos}"+tc.body+"{/for}"))
			if strings.Contains(got, "volatile: true") != tc.wantVolatile {
				t.Errorf("volatile: true = %v, want %v:\n%s", !tc.wantVolatile, tc.wantVolatile, got)
			}
		})
	}
	// A mutable global in a HANDLER ARGUMENT is read at fire time, so it does
	// not make the row volatile — the same rule `this` already follows.
	handler := compileSrc(t, listSrc("  {#for todo in todos}<li @click={ go(window.scrollY) }>{ todo.text }</li>{/for}"))
	if strings.Contains(handler, "volatile: true") {
		t.Errorf("a global inside a handler argument must not mark the site volatile:\n%s", handler)
	}
}

// A built-in formatter that reads the clock is not a pure function of its input,
// so a cached row would freeze its output at "1 second ago".
func TestListMetaClockFormatterIsVolatile(t *testing.T) {
	got := compileSrc(t, listSrc("  {#for todo in todos}<li>{ todo.createdAt | timeago }</li>{/for}"))
	if !strings.Contains(got, "volatile: true") {
		t.Errorf("a row piping through timeago must be volatile:\n%s", got)
	}
	// Every other shipped built-in is a pure function of its input.
	pure := compileSrc(t, listSrc("  {#for todo in todos}<li>{ todo.createdAt | date }</li>{/for}"))
	if strings.Contains(pure, "volatile: true") {
		t.Errorf("a pure built-in must not make the site volatile:\n%s", pure)
	}
}
