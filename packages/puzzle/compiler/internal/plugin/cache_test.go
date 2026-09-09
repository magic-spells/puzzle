package plugin

import (
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
)

// buildAppWithCache is buildApp with a caller-supplied memo, so a test can run
// the SAME app through two plugin instances that share one cache (the second is
// then an all-hits pass, exactly like a build's prerender pass) or through two
// with none.
func buildAppWithCache(t *testing.T, root string, cache *CompileCache) (api.BuildResult, *Plugin) {
	t.Helper()
	pl := New(root)
	pl.SetCompileCache(cache)
	res := api.Build(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Format:      api.FormatESModule,
		Target:      api.ES2020,
		External:    []string{"@magic-spells/puzzle"},
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	})
	return res, pl
}

// cacheFixture exercises the parts of the transform the memo has to carry
// across passes: a plain view, a scoped <style> (whose @scope wrapper is derived
// from the app-relative name), an unstyled component, and a TypeScript script
// (whose loader choice is part of the memoized result).
func cacheFixture() map[string]string {
	return map[string]string{
		"app/app.js":         appJS,
		"app/views/Home.pzl": homePzl,
		"app/components/Button.pzl": `<puzzle-view>
  <button @click={ onClick }>{ label }</button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Badge from './Badge.pzl';
export default class Button extends PuzzleView {}
</script>

<style scoped>
.btn { color: blue; }
</style>
`,
		"app/components/Badge.pzl": `<puzzle-view>
  <span>{ text }</span>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
const n: number = 1;
export default class Badge extends PuzzleView {}
</script>
`,
	}
}

// A pass that HITS the memo must be indistinguishable from one that computed the
// transform itself: same bundled JS, same collected CSS (the @scope wrappers
// included), same absence of errors. This is the whole safety claim of the
// build-scoped cache — the three passes of one build share results, so a hit that
// differed would ship different bytes from the pass that produced them.
func TestCachedPassMatchesUncachedPass(t *testing.T) {
	root := writeApp(t, cacheFixture())

	// Two cold passes (no memo at all) — today's behavior, the reference.
	coldA, plColdA := buildAppWithCache(t, root, nil)
	coldB, plColdB := buildAppWithCache(t, root, nil)
	for _, r := range []api.BuildResult{coldA, coldB} {
		if len(r.Errors) > 0 {
			t.Fatalf("unexpected build errors: %v", r.Errors)
		}
	}

	// Two passes sharing ONE memo: the first computes every file, the second is
	// all hits.
	cache := NewCompileCache()
	warm, plWarm := buildAppWithCache(t, root, cache)
	hits, plHits := buildAppWithCache(t, root, cache)
	for _, r := range []api.BuildResult{warm, hits} {
		if len(r.Errors) > 0 {
			t.Fatalf("unexpected build errors with a shared cache: %v", r.Errors)
		}
	}

	want := outputText(t, coldA)
	for name, got := range map[string]string{
		"second uncached pass":  outputText(t, coldB),
		"cache-populating pass": outputText(t, warm),
		"cache-hit pass":        outputText(t, hits),
	} {
		if got != want {
			t.Errorf("%s emitted different JS than an uncached pass\n--- want ---\n%s\n--- got ---\n%s", name, want, got)
		}
	}

	wantCSS := plColdA.CSS()
	if wantCSS == "" || !strings.Contains(wantCSS, "@scope") {
		t.Fatalf("fixture should collect a scoped <style> block, got %q", wantCSS)
	}
	for name, pl := range map[string]*Plugin{
		"second uncached pass":  plColdB,
		"cache-populating pass": plWarm,
		"cache-hit pass":        plHits,
	} {
		if got := pl.CSS(); got != wantCSS {
			t.Errorf("%s collected different CSS\n--- want ---\n%s\n--- got ---\n%s", name, wantCSS, got)
		}
	}
}

// A file that fails to compile must stay a failure on a hit — with the same
// positioned messages — and must not leak a stale <style> block into the pass's
// collector (the pre-cache code returned before touching the map on any error).
func TestCachedFailureStaysAFailure(t *testing.T) {
	files := cacheFixture()
	files["app/views/Home.pzl"] = `<puzzle-view>
  <h1>{ title }</h1>
</puzzle-view>

<script>
// no default class export at all
</script>

<style>
.home { color: red; }
</style>
`
	root := writeApp(t, files)

	cache := NewCompileCache()
	first, plFirst := buildAppWithCache(t, root, cache)
	second, plSecond := buildAppWithCache(t, root, cache)

	if len(first.Errors) == 0 || len(second.Errors) == 0 {
		t.Fatalf("a broken .pzl must fail both passes (first=%d second=%d errors)", len(first.Errors), len(second.Errors))
	}
	if got, want := messageText(second.Errors), messageText(first.Errors); got != want {
		t.Errorf("cache-hit pass reported different errors\nwant: %s\ngot:  %s", want, got)
	}
	for name, pl := range map[string]*Plugin{"first": plFirst, "hit": plSecond} {
		if css := pl.CSS(); strings.Contains(css, ".home") {
			t.Errorf("%s pass collected the failed file's <style> block: %q", name, css)
		}
	}
}

// Editing a file mid-build (or any two files that happen to share a path across
// roots) must not serve stale bytes: the key carries a content hash, so new bytes
// are a new entry.
func TestCacheKeyedOnContent(t *testing.T) {
	root := writeApp(t, cacheFixture())
	cache := NewCompileCache()

	pl := New(root)
	pl.SetCompileCache(cache)
	path := filepath.Join(root, "app", "components", "Badge.pzl")

	first := cache.load(pl.appRoot, path, []byte(cacheFixture()["app/components/Badge.pzl"]), func() pzlResult {
		return pl.transformPZL(path, []byte(cacheFixture()["app/components/Badge.pzl"]))
	})
	changed := []byte(`<puzzle-view>
  <span>{ other }</span>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Badge extends PuzzleView {}
</script>
`)
	second := cache.load(pl.appRoot, path, changed, func() pzlResult {
		return pl.transformPZL(path, changed)
	})

	if first.js == second.js {
		t.Error("different bytes at the same path returned the same generated module")
	}
	if first.loader != api.LoaderTS || second.loader != api.LoaderJS {
		t.Errorf("loader must follow the CONTENT, got first=%v second=%v", first.loader, second.loader)
	}
}

// esbuild calls onLoad concurrently; the memo must compute a given file exactly
// once even when several goroutines race for it, and hand every racer the same
// result.
func TestCacheComputesOncePerKeyUnderRace(t *testing.T) {
	root := writeApp(t, cacheFixture())
	pl := New(root)
	cache := NewCompileCache()
	path := filepath.Join(root, "app", "views", "Home.pzl")
	src := []byte(homePzl)

	var mu sync.Mutex
	computes := 0
	var wg sync.WaitGroup
	results := make([]string, 16)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res := cache.load(pl.appRoot, path, src, func() pzlResult {
				mu.Lock()
				computes++
				mu.Unlock()
				return pl.transformPZL(path, src)
			})
			results[i] = res.js
		}(i)
	}
	wg.Wait()

	if computes != 1 {
		t.Errorf("transform ran %d times for one file, want 1", computes)
	}
	for i, got := range results {
		if got != results[0] {
			t.Fatalf("racer %d got a different module than racer 0", i)
		}
	}
}

// outputText concatenates an esbuild result's output files for comparison.
func outputText(t *testing.T, res api.BuildResult) string {
	t.Helper()
	var b strings.Builder
	for _, f := range res.OutputFiles {
		b.Write(f.Contents)
	}
	return b.String()
}

// messageText renders esbuild messages (text + position) as a comparable string.
func messageText(msgs []api.Message) string {
	var parts []string
	for _, m := range msgs {
		line, col := 0, 0
		if m.Location != nil {
			line, col = m.Location.Line, m.Location.Column
		}
		parts = append(parts, m.Text+"@"+itoa(line)+":"+itoa(col))
	}
	return strings.Join(parts, " | ")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
