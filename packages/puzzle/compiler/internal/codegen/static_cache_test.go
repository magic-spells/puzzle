package codegen

import (
	"strings"
	"testing"
)

// static_cache_test.go — build-once static subtrees (D170, plan §3.3/§4.3).
// A maximal static subtree of three or more vnodes — or an island's children
// array at any size — is wrapped in the owner's cache so it is allocated once
// per instance (or once per row) instead of on every render.

// cacheSrc wraps a template body in a compilable view.
func cacheSrc(body string) string {
	return viewSrc(body,
		"import { PuzzleView } from '@magic-spells/puzzle';\n"+
			"import List from './List.pzl';\n"+
			"export default class T extends PuzzleView {}")
}

// The threshold is three vnodes: a leaf element or a one-child element costs
// more in wrapper bytes than it saves.
func TestStaticCacheThreshold(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"leaf element", `  <div class="a"></div>`, false},
		{"element plus text", `  <div class="a">hi</div>`, false},
		{"element, child, text", `  <div class="a"><span>hi</span></div>`, true},
		{"two children", `  <div class="a"><span>x</span><b>y</b></div>`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, cacheSrc(tc.body))
			if strings.Contains(got, "this.__c[") != tc.want {
				t.Errorf("cached = %v, want %v:\n%s", !tc.want, tc.want, got)
			}
		})
	}
}

// Only the MAXIMAL qualifying subtree is wrapped: a static child of a cached
// element never gets a wrapper of its own.
func TestStaticCacheMaximalSubtreeOnly(t *testing.T) {
	got := compileSrc(t, cacheSrc(`  <div class="outer"><section class="inner"><span>x</span><b>y</b></section></div>`))
	if n := strings.Count(got, "??= new ViewNode("); n != 1 {
		t.Errorf("expected exactly one cache wrapper, got %d:\n%s", n, got)
	}
	if !strings.Contains(got, "(this.__c[0] ??= new ViewNode('div', { class: 'outer' }") {
		t.Errorf("the wrapper must sit on the outermost static element:\n%s", got)
	}
}

// The wrapper is a pure PREFIX on the first line and a ')' suffix on the
// closing line; inner lines keep their indentation.
func TestStaticCacheWrapperLayout(t *testing.T) {
	got := compileSrc(t, cacheSrc(`  <div class="a"><span>x</span><b>y</b></div>`))
	want := "    (this.__c[0] ??= new ViewNode('div', { class: 'a' }, [\n" +
		"      new ViewNode('span', {}, [\n" +
		"        new ViewNode('text', { value: 'x' }),\n" +
		"      ]),\n" +
		"      new ViewNode('b', {}, [\n" +
		"        new ViewNode('text', { value: 'y' }),\n" +
		"      ]),\n" +
		"    ])),\n"
	if !strings.Contains(got, want) {
		t.Errorf("cache wrapper layout drifted:\n%s", got)
	}
}

// The prefix counts toward startCol in the attrsMultiline width decision, so a
// wrapped element wraps its attributes where an unwrapped one would not.
func TestStaticCachePrefixCountsTowardWidth(t *testing.T) {
	cls := strings.Repeat("x", 70)
	got := compileSrc(t, cacheSrc(
		`  <div class="`+cls+`"><span>a</span><b>c</b></div>`+"\n"+
			`  <p class="`+cls+`">solo</p>`,
	))
	if !strings.Contains(got, "(this.__c[0] ??= new ViewNode('div', {\n      class: '"+cls+"',") {
		t.Errorf("the wrapper prefix must push the attrs onto their own lines:\n%s", got)
	}
	// The same attribute on an UNwrapped element of the same indent stays inline
	// — the only difference is the 17-column prefix.
	if !strings.Contains(got, "new ViewNode('p', { class: '"+cls+"' }, [") {
		t.Errorf("an unwrapped element of the same width must stay inline:\n%s", got)
	}
}

// View-level indices come from one per-file counter that render() and
// renderSkeleton() share, exactly like the D62 `__h` counter.
func TestStaticCacheNumberingSharedWithSkeleton(t *testing.T) {
	src := "<puzzle-view>\n  <div class=\"a\"><span>x</span><b>y</b></div>\n</puzzle-view>\n\n" +
		"<puzzle-skeleton>\n  <div class=\"s\"><span>x</span><b>y</b></div>\n</puzzle-skeleton>\n\n" +
		"<script>\nimport { PuzzleView } from '@magic-spells/puzzle';\nexport default class T extends PuzzleView {}\n</script>\n"
	got := compileSrc(t, src)
	if !strings.Contains(got, "(this.__c[0] ??= new ViewNode('div', { class: 'a' }") {
		t.Errorf("render() must take index 0:\n%s", got)
	}
	if !strings.Contains(got, "(this.__c[1] ??= new ViewNode('div', { class: 's' }") {
		t.Errorf("renderSkeleton() must continue the same counter:\n%s", got)
	}
	if again := compileSrc(t, src); again != got {
		t.Error("cache numbering must be byte-stable across recompiles; outputs differ")
	}
}

// Inside a row the owner is the row scope, and the counter restarts per site —
// a row keeps its static subtrees even when the row itself is rebuilt.
func TestStaticCacheInsideRowUsesRowScope(t *testing.T) {
	got := compileSrc(t, cacheSrc(
		"  {#for todo in todos}\n"+
			"    <li>\n"+
			"      <div class=\"badge\"><span>A</span><em>B</em></div>\n"+
			"      <p>{ todo.text }</p>\n"+
			"    </li>\n"+
			"  {/for}",
	))
	if !strings.Contains(got, "(s.c[0] ??= new ViewNode('div', { class: 'badge' }") {
		t.Errorf("a static subtree inside a row must cache on the row scope:\n%s", got)
	}
	if strings.Contains(got, "this.__c[") {
		t.Errorf("a row subtree must not take a view-level slot:\n%s", got)
	}
}

// An island's children are frozen after mount, so the array is cached as a unit
// at any size even when the element itself is dynamic (D44 + plan §3.3).
func TestStaticCacheIslandChildrenArray(t *testing.T) {
	got := compileSrc(t, cacheSrc(`  <div island class={ cls }><p>one</p><em>two</em></div>`))
	if !strings.Contains(got, "}, (this.__c[0] ??= [\n") {
		t.Errorf("a dynamic island's children array must be cached as a unit:\n%s", got)
	}
	if !strings.Contains(got, "    ])),\n") {
		t.Errorf("the island children wrapper must close on the array's last line:\n%s", got)
	}
	// Two vnodes' worth of children — below the subtree threshold, which does
	// not apply to an island seed.
	small := compileSrc(t, cacheSrc(`  <div island class={ cls }><p>one</p></div>`))
	if !strings.Contains(small, "(this.__c[0] ??= [") {
		t.Errorf("island children cache has no size threshold:\n%s", small)
	}
	// A fully static island qualifies as a subtree in its own right, and then
	// the element — not just its children — is cached once.
	whole := compileSrc(t, cacheSrc(`  <div island class="fixed"><p>one</p><em>two</em></div>`))
	if !strings.Contains(whole, "(this.__c[0] ??= new ViewNode('div', {") {
		t.Errorf("a fully static island must be cached as a whole element:\n%s", whole)
	}
	if strings.Count(whole, "this.__c[") != 1 {
		t.Errorf("a cached island element must not also cache its children array:\n%s", whole)
	}
	// Dynamic children are not cacheable at all, island or not.
	dynamic := compileSrc(t, cacheSrc(`  <div island class={ cls }>{ text }</div>`))
	if strings.Contains(dynamic, "this.__c[") {
		t.Errorf("an island with interpolated children must not be cached:\n%s", dynamic)
	}
}

// Framework-owned but per-instance-stable attributes survive caching; a
// D62-cacheable handler does too.
func TestStaticCacheAllowedAttrs(t *testing.T) {
	got := compileSrc(t, cacheSrc(`  <div ref="box" flip key="k" @click={ go }><span>a</span><b>c</b></div>`))
	if !strings.Contains(got, "(this.__c[0] ??= new ViewNode('div', {") {
		t.Errorf("ref/flip/key and a cacheable handler must not make a subtree dynamic:\n%s", got)
	}
}

// Everything that can differ between renders makes the subtree dynamic.
func TestStaticCacheExclusions(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"interpolation", `  <div class="a"><span>{ x }</span><b>y</b></div>`},
		{"dynamic attr", `  <div class={ cls }><span>x</span><b>y</b></div>`},
		{"mixed attr", `  <div class="a-{ x }"><span>x</span><b>y</b></div>`},
		{"non-cacheable handler", `  <div class="a" @click={ go(count) }><span>x</span><b>y</b></div>`},
		{"component child", `  <div class="a"><span>x</span><List /></div>`},
		{"composition marker", `  <div class="a"><span>x</span><Children/></div>`},
		{"control flow", `  <div class="a"><span>x</span>{#if y}<b>z</b>{/if}</div>`},
		{"portal", `  <div class="a"><span>x</span><Portal><b>z</b></Portal></div>`},
		{"controlled value", `  <div class="a"><input value="fixed" /><b>y</b></div>`},
		{"controlled checked", `  <div class="a"><input type="checkbox" checked /><b>y</b></div>`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, cacheSrc(tc.body))
			if strings.Contains(got, "this.__c[") {
				t.Errorf("this subtree must not be cached:\n%s", got)
			}
		})
	}
}

// A <Snippet> body is stamped fresh per expansion and owns no cache, so nothing
// inside one is wrapped — even a subtree that would qualify anywhere else.
func TestStaticCacheNeverInsideSnippetBody(t *testing.T) {
	got := compileSrc(t, cacheSrc(`  <List><Snippet a><div class="q"><span>x</span><b>y</b></div></Snippet></List>`))
	if strings.Contains(got, "__c[") || strings.Contains(got, ".c[") {
		t.Errorf("a snippet body must emit no cache wrapper:\n%s", got)
	}
}

// A resolved {#svg} carries string children set once via innerHTML, so it is
// static — it just needs a parent to reach the three-vnode threshold.
func TestStaticCacheResolvedSVGIsStatic(t *testing.T) {
	got := compileSrcOptsJS(t, `<puzzle-view>
  <div class="icon"><span class="w">{#svg 'icons/heart.svg'}</span></div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class T extends PuzzleView {}
</script>
`)
	if !strings.Contains(got, "(this.__c[0] ??= new ViewNode('div', { class: 'icon' }") {
		t.Errorf("a resolved {#svg} with string children must count as static:\n%s", got)
	}
}

// compileSrcOptsJS compiles an in-memory .pzl with the golden assets dir so
// {#svg} resolves.
func compileSrcOptsJS(t *testing.T, src string) string {
	t.Helper()
	js, err := compileSrcOpts(t, src, Options{Mode: ModeView, AssetsDir: "testdata/assets"})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return js
}
