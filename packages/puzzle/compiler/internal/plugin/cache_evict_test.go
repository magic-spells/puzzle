package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// svgConsumerFixture is a view that inlines an icon with {#svg}. The .pzl's own
// bytes never change in the test below — only the icon does — which is exactly
// the case a content-hash-keyed memo cannot see.
func svgConsumerFixture(marker string) map[string]string {
	return map[string]string{
		"app/app.js": `import Home from './views/Home.pzl';
export default Home;
`,
		"app/views/Home.pzl": `<puzzle-view>
  <div>{#svg 'icons/logo.svg'}</div>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		"app/assets/icons/logo.svg": `<svg viewBox="0 0 24 24"><path d="M0 ` + marker + `"/></svg>`,
	}
}

// TestCompileCacheEvictsOnInlinedSVGChange is the correctness statement for a
// cross-rebuild cache: an edited {#svg} asset must reach the output even though
// the .pzl that inlines it is byte-identical.
func TestCompileCacheEvictsOnInlinedSVGChange(t *testing.T) {
	root := writeApp(t, svgConsumerFixture("FIRST"))
	cache := NewCompileCache()

	res, _ := buildAppWithCache(t, root, cache)
	if len(res.Errors) > 0 {
		t.Fatalf("first build failed: %v", res.Errors)
	}
	if !strings.Contains(string(res.OutputFiles[0].Contents), "FIRST") {
		t.Fatal("first build did not inline the icon")
	}

	icon := filepath.Join(root, "app", "assets", "icons", "logo.svg")
	if err := os.WriteFile(icon, []byte(`<svg viewBox="0 0 24 24"><path d="M0 SECOND"/></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}

	// Without eviction the memo answers from the pre-edit scan: the .pzl hashes
	// the same, so nothing else can notice.
	stale, _ := buildAppWithCache(t, root, cache)
	if len(stale.Errors) > 0 {
		t.Fatalf("stale build failed: %v", stale.Errors)
	}
	if !strings.Contains(string(stale.OutputFiles[0].Contents), "FIRST") {
		t.Skip("this build path no longer memoizes the icon; the eviction below is then moot")
	}

	cache.Evict([]string{icon})
	fresh, _ := buildAppWithCache(t, root, cache)
	if len(fresh.Errors) > 0 {
		t.Fatalf("post-eviction build failed: %v", fresh.Errors)
	}
	out := string(fresh.OutputFiles[0].Contents)
	if !strings.Contains(out, "SECOND") {
		t.Fatal("eviction did not refresh the inlined icon")
	}
	if strings.Contains(out, "FIRST") {
		t.Fatal("post-eviction output still carries the pre-edit icon")
	}
}

// TestCompileCacheEvictDropsEntries checks the bookkeeping: evicting a path
// removes its entries and its index rows, so a long session's map stays
// proportional to the tree rather than to the number of saves.
func TestCompileCacheEvictDropsEntries(t *testing.T) {
	root := writeApp(t, cacheFixture())
	cache := NewCompileCache()
	if res, _ := buildAppWithCache(t, root, cache); len(res.Errors) > 0 {
		t.Fatalf("build failed: %v", res.Errors)
	}

	home := filepath.Join(root, "app", "views", "Home.pzl")
	before := len(cache.entries)
	if before == 0 {
		t.Fatal("expected the cache to hold transforms")
	}
	if len(cache.byFile[resolveSymlinks(home)]) == 0 {
		t.Fatalf("expected an index row for %s", home)
	}

	cache.Evict([]string{home})
	if len(cache.entries) != before-1 {
		t.Errorf("evicting one file should drop exactly its entry: %d → %d", before, len(cache.entries))
	}
	if _, ok := cache.byFile[resolveSymlinks(home)]; ok {
		t.Error("index row survived eviction")
	}

	// Evicting an unknown path, an empty batch, and a nil cache are all no-ops.
	cache.Evict([]string{filepath.Join(root, "nope.pzl")})
	cache.Evict(nil)
	var nilCache *CompileCache
	nilCache.Evict([]string{home})
}
