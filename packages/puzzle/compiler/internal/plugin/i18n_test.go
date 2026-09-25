package plugin

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
)

// buildI18nManifest bundles an entry that imports the virtual locale manifest
// and returns the output, over a persistent context so a rebuild can be observed.
func i18nManifestContext(t *testing.T, pl *Plugin, root string) api.BuildContext {
	t.Helper()
	ctx, err := api.Context(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Format:      api.FormatESModule,
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	})
	if err != nil {
		t.Fatalf("api.Context: %s", err.Error())
	}
	t.Cleanup(ctx.Dispose)
	return ctx
}

// TestI18nManifestModule: without i18n the manifest module is null; with it, the
// manifest source is served — and re-served fresh on every rebuild, so a locale
// edit's new hash reaches the next bundle (D175).
func TestI18nManifestModule(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js": "import manifest from '@magic-spells/puzzle/i18n/manifest';\nconsole.log(manifest);\n",
	})
	pl := New(root)
	ctx := i18nManifestContext(t, pl, root)
	out := func() string {
		res := ctx.Rebuild()
		if len(res.Errors) > 0 {
			t.Fatalf("rebuild errors: %v", res.Errors)
		}
		return string(res.OutputFiles[0].Contents)
	}

	if got := out(); !strings.Contains(got, "= null") || pl.I18nEnabled() {
		t.Fatalf("no i18n must serve a null manifest:\n%s", got)
	}

	pl.SetI18n(true, "")
	if got := out(); !strings.Contains(got, "= null") {
		t.Fatalf("i18n on with no manifest loaded yet serves null:\n%s", got)
	}

	pl.SetI18n(true, `export default {"defaultLocale":"en","locales":{"en":"locales/en.AAAAAAAA.json"}};`+"\n")
	if got := out(); !strings.Contains(got, "locales/en.AAAAAAAA.json") {
		t.Fatalf("manifest not served:\n%s", got)
	}
	pl.SetI18n(true, `export default {"defaultLocale":"en","locales":{"en":"locales/en.BBBBBBBB.json"}};`+"\n")
	if got := out(); !strings.Contains(got, "locales/en.BBBBBBBB.json") || strings.Contains(got, "AAAAAAAA") {
		t.Fatalf("the manifest must be fresh on every rebuild:\n%s", got)
	}
	if !pl.I18nEnabled() {
		t.Fatal("I18nEnabled() = false after SetI18n(true, …)")
	}
}

// TestScanUsageTranslateKeys: `t` use is recorded even though it is not a
// manifest builtin, and every string-literal key piped straight into it is
// collected per file — in text, quoted and brace-only attributes, inline ifs,
// and skeletons.
// Runtime-built keys and `t` later in a chain are not checkable and are skipped.
func TestScanUsageTranslateKeys(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view>
  <h1>{ 'home.title' | t }</h1>
  <p title="{ "home.hint" | t }">{ 'items' | t({ count: n }) }</p>
  <p>{ ('status.' + s) | t }</p>
  <p>{ 'x' | upcase | t }</p>
  <p>{ 'it\'s' | t }</p>
  {#if a}<b>{ 'in.if' | t }</b>{/if}
  <input placeholder={ 'search.hint' | t } />
</puzzle-view>
<puzzle-skeleton><p>{ 'loading' | t }</p></puzzle-skeleton>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		"app/views/Other.pzl": `<puzzle-view><p>{ 'home.title' | t }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Other extends PuzzleView {}
</script>
`,
		"app/views/Plain.pzl": `<puzzle-view><p>{ name | upcase }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Plain extends PuzzleView {}
</script>
`,
	})
	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatal(err)
	}
	if !usage.UsesT() {
		t.Fatal("t usage not recorded")
	}
	want := map[string][]string{
		"home.title":  {"app/views/Home.pzl", "app/views/Other.pzl"},
		"home.hint":   {"app/views/Home.pzl"},
		"items":       {"app/views/Home.pzl"},
		"in.if":       {"app/views/Home.pzl"},
		"loading":     {"app/views/Home.pzl"},
		"search.hint": {"app/views/Home.pzl"},
	}
	for key := range usage.TKeys {
		files := usage.TKeys[key]
		// Walk order is not part of the contract.
		if len(files) == 2 && files[0] > files[1] {
			files[0], files[1] = files[1], files[0]
		}
	}
	if !reflect.DeepEqual(usage.TKeys, want) {
		t.Fatalf("TKeys = %v\nwant %v", usage.TKeys, want)
	}

	plain := writeApp(t, map[string]string{"app/views/Plain.pzl": `<puzzle-view><p>{ name | upcase }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Plain extends PuzzleView {}
</script>
`})
	none, err := ScanUsage(plain)
	if err != nil {
		t.Fatal(err)
	}
	if none.UsesT() || len(none.TKeys) != 0 {
		t.Fatalf("an app that never uses t reports %v", none.TKeys)
	}
}
