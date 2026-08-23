package plugin

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

// TestPluginScopedStyles drives a scoped view + an unscoped component end-to-end
// (parse → codegen → esbuild) and asserts the v1.27 (D59) contract: the scoped
// block is collected wrapped in a native @scope rule keyed by the same scope id
// codegen stamps on the root, while the unscoped block stays verbatim.
func TestPluginScopedStyles(t *testing.T) {
	scopedHome := `<puzzle-view class="home">
  <h1>{ title }</h1>
  <Button label="Hi" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Button from '../components/Button.pzl';
export default class Home extends PuzzleView {}
</script>

<style scoped>
.home { color: red; }
</style>
`
	root := writeApp(t, map[string]string{
		"app/app.js":                "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl":        scopedHome,
		"app/components/Button.pzl": buttonPzl, // unscoped <style>, from plugin_test.go
	})

	res, pl := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}

	// The scope id is derived from the SAME app-relative path codegen compiles
	// under, so the CSS rule and the stamped attribute agree.
	id := codegen.ScopeID("app/views/Home.pzl")
	css := pl.CSS()

	// The block is wrapped verbatim (the <style> inner body keeps its own
	// surrounding newlines) inside `@scope ([data-<id>]) { … }`.
	openWrap := "@scope ([data-" + id + "]) {"
	if !strings.Contains(css, openWrap) || !strings.Contains(css, ".home { color: red; }") {
		t.Errorf("scoped block not wrapped in @scope with id %s\ngot CSS:\n%s", id, css)
	}
	if open := strings.Index(css, openWrap); open < 0 || strings.Index(css, ".home") < open {
		t.Errorf("the .home rule must sit inside the @scope wrapper\ngot CSS:\n%s", css)
	}
	// The unscoped component block is collected verbatim — no @scope wrapping.
	if !strings.Contains(css, ".btn { color: blue; }") {
		t.Errorf("unscoped block missing from CSS:\n%s", css)
	}
	if strings.Count(css, "@scope") != 1 {
		t.Errorf("expected exactly one @scope wrapper (only the scoped view):\n%s", css)
	}

	// The rule's target attribute is actually stamped on the rendered root, so
	// the two halves of the mechanism line up.
	bundle := string(res.OutputFiles[0].Contents)
	if !strings.Contains(bundle, "data-"+id) {
		t.Errorf("bundle missing the root data-%s stamp\n%s", id, bundle)
	}
}

// TestPluginScopedStylesWithSkeleton confirms a scoped view that also declares a
// <puzzle-skeleton> stamps the skeleton render too (view-mode skeletons reuse
// the stamped <puzzle-view> root attrs, D39), so both the loaded and loading
// renders match the @scope rule.
func TestPluginScopedStylesWithSkeleton(t *testing.T) {
	scopedSkel := `<puzzle-view class="post">
  <p>{ post.body }</p>
</puzzle-view>

<puzzle-skeleton>
  <div class="bg-skeleton"></div>
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Post extends PuzzleView {}
</script>

<style scoped>
.post { padding: 1rem; }
</style>
`
	root := writeApp(t, map[string]string{
		"app/app.js":         "import Post from './views/Post.pzl';\nexport default Post;\n",
		"app/views/Post.pzl": scopedSkel,
	})

	res, pl := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	id := codegen.ScopeID("app/views/Post.pzl")
	bundle := string(res.OutputFiles[0].Contents)

	renderIdx := strings.Index(bundle, "prototype.render")
	skelIdx := strings.Index(bundle, "prototype.renderSkeleton")
	if renderIdx < 0 || skelIdx < 0 {
		t.Fatalf("expected both render and renderSkeleton in bundle\n%s", bundle)
	}
	// The stamp appears in BOTH the render and the renderSkeleton tails.
	if strings.Count(bundle, "data-"+id) < 2 {
		t.Errorf("expected the scope stamp in both render and renderSkeleton\n%s", bundle)
	}
	if !strings.Contains(pl.CSS(), "@scope ([data-"+id+"])") {
		t.Errorf("CSS missing the @scope wrapper for %s\n%s", id, pl.CSS())
	}
}
