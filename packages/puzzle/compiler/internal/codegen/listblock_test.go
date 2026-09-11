package codegen

import (
	"strings"
	"testing"
)

// listblock_test.go — item-form {#for} lowering to a persistent list block
// (D170, plan §3.2/§4.3). The site meta const is the contract between the
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
	if !strings.Contains(got, "this.__list(this, 0, __d.todos, (s) =>") {
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
	if strings.Contains(got, "__L0") || strings.Contains(got, "this.__list(") {
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
		"this.__list(this, 0, __d.groups, (s) =>",
		"this.__list(s, 1, s.item.items, (s1) =>",
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
	if strings.Contains(got, "__L0") || strings.Contains(got, "this.__list(") {
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
	if strings.Contains(got, "__L0") || strings.Contains(got, "this.__list(") {
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
	if strings.Contains(got, "this.__list(") {
		t.Errorf("a snippet body must produce no list block at all:\n%s", got)
	}
}
