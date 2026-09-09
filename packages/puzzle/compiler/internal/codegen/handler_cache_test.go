package codegen

import (
	"strings"
	"testing"
)

// handler_cache_test.go — D62 / SPEC §31 cached @event handlers, verified THROUGH
// compiled output (compileSrc). A data-independent handler value is wrapped in the
// per-instance cache `((this.__h ??= {})[N] ??= <arrow>)`; a handler capturing
// render data or a loop variable stays a fresh closure, byte-identical to v1.28.
// The unit-level cacheability matrix lives in expr_test.go (TestCompileEventValue);
// this file pins the emitted wrapping, site numbering, and byte-stability.

// viewSrc wraps a template body + a scripts block into a compilable view .pzl.
func viewSrc(body, scripts string) string {
	return "<puzzle-view>\n" + body + "\n</puzzle-view>\n\n<script>\n" + scripts + "\n</script>\n"
}

const plainScripts = "import { PuzzleView } from '@magic-spells/puzzle';\n" +
	"export default class T extends PuzzleView { data() { return { count: 0, items: [] }; } }"

func TestHandlerCacheCacheableForms(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string // the cached value, minus the site index
	}{
		{"bare id", `  <button @click={ h }>x</button>`, "??= (event) => this.events.h(event))"},
		{"event arg", `  <button @click={ h(event) }>x</button>`, "??= (event) => this.events.h(event))"},
		{"string literal arg", `  <button @click={ h('all') }>x</button>`, "??= (event) => this.events.h('all'))"},
		{"no args", `  <button @click={ h() }>x</button>`, "??= (event) => this.events.h())"},
		{"this member arg", `  <button @click={ h(this.x) }>x</button>`, "??= (event) => this.events.h(this.x))"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, viewSrc(tc.body, plainScripts))
			// Cacheable → wrapped at site 0 (sole handler in the file).
			want := "'@click': ((this.__h ??= {})[0] " + tc.want
			if !strings.Contains(got, want) {
				t.Errorf("expected cached handler %q in:\n%s", want, got)
			}
		})
	}
}

// A call form capturing render data must emit the PLAIN arrow (with `__d.count`)
// and never touch the per-instance cache.
func TestHandlerCacheDataArgNotCached(t *testing.T) {
	got := compileSrc(t, viewSrc(`  <button @click={ h(count) }>x</button>`, plainScripts))
	if !strings.Contains(got, "'@click': (event) => this.events.h(__d.count)") {
		t.Errorf("data-capturing handler must emit the plain arrow with __d.count:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("data-capturing handler must NOT be wrapped in the cache:\n%s", got)
	}
}

// A string literal containing "__d." is a conservative false negative: correct
// output, but not cached (the substring guard rejects it).
func TestHandlerCacheStringLiteralFalseNegative(t *testing.T) {
	got := compileSrc(t, viewSrc(`  <button @click={ h('__d.') }>x</button>`, plainScripts))
	if !strings.Contains(got, "'@click': (event) => this.events.h('__d.')") {
		t.Errorf("string-literal handler must emit correct plain output:\n%s", got)
	}
	if strings.Contains(got, "this.__h") {
		t.Errorf("string literal containing __d. must miss the cache (false negative):\n%s", got)
	}
}

// Inside a {#for}, a handler capturing the loop variable is NOT cached; a bare
// handler in the SAME loop body IS (data-independent by definition). One element
// carries both so the for body keeps its single root.
func TestHandlerCacheLoopVariable(t *testing.T) {
	got := compileSrc(t, viewSrc(
		"  {#for item in items}\n    <button @click={ h(item.id) } @mouseover={ g }>x</button>\n  {/for}",
		plainScripts,
	))
	// Loop-var capture → plain arrow, no wrapper, no __d. (item is in scope).
	if !strings.Contains(got, "'@click': (event) => this.events.h(item.id)") {
		t.Errorf("loop-var handler must emit the plain arrow:\n%s", got)
	}
	// Bare handler in the same loop → cached at site 0.
	if !strings.Contains(got, "'@mouseover': ((this.__h ??= {})[0] ??= (event) => this.events.g(event))") {
		t.Errorf("bare handler in a loop must still be cached:\n%s", got)
	}
}

// Site indices increment per cacheable site, in emission (pre-order) sequence,
// and are byte-stable across recompiles of the same source.
func TestHandlerCacheSiteNumbering(t *testing.T) {
	src := viewSrc(
		"  <button @click={ a }>A</button>\n  <button @click={ b }>B</button>\n  <button @click={ c }>C</button>",
		plainScripts,
	)
	got := compileSrc(t, src)
	for _, want := range []string{
		"(this.__h ??= {})[0] ??= (event) => this.events.a(event)",
		"(this.__h ??= {})[1] ??= (event) => this.events.b(event)",
		"(this.__h ??= {})[2] ??= (event) => this.events.c(event)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("expected sequential site %q in:\n%s", want, got)
		}
	}
	// Recompiling the identical source yields byte-identical output (per-file
	// counter resets each compile; numbering is deterministic).
	if again := compileSrc(t, src); again != got {
		t.Errorf("recompiling the same source must be byte-stable; outputs differ")
	}
}

// A NON-cacheable site interleaved between cacheable ones consumes NO index — the
// counter only advances on wrapped sites, so the cached ones stay sequential.
func TestHandlerCacheNonCacheableConsumesNoIndex(t *testing.T) {
	got := compileSrc(t, viewSrc(
		"  <button @click={ a }>A</button>\n  <button @click={ save(count) }>B</button>\n  <button @click={ c }>C</button>",
		plainScripts,
	))
	if !strings.Contains(got, "(this.__h ??= {})[0] ??= (event) => this.events.a(event)") {
		t.Errorf("first cacheable site should be index 0:\n%s", got)
	}
	if !strings.Contains(got, "'@click': (event) => this.events.save(__d.count)") {
		t.Errorf("middle data-capturing site should be a plain arrow:\n%s", got)
	}
	if !strings.Contains(got, "(this.__h ??= {})[1] ??= (event) => this.events.c(event)") {
		t.Errorf("third cacheable site should be index 1 (the data site consumed no index):\n%s", got)
	}
}

// A component-tag callback prop rides the same path: a data-independent bare prop
// gets the wrapper on its VALUE (the prop key stays `save`, not `@save`).
func TestHandlerCacheComponentCallbackProp(t *testing.T) {
	scripts := "import { PuzzleView } from '@magic-spells/puzzle';\n" +
		"import Child from './Child.pzl';\n" +
		"export default class T extends PuzzleView {}"
	got := compileSrc(t, viewSrc(`  <Child @save={ h } />`, scripts))
	if !strings.Contains(got, "save: ((this.__h ??= {})[0] ??= (event) => this.events.h(event))") {
		t.Errorf("cacheable component callback prop must be wrapped on its value:\n%s", got)
	}
}
