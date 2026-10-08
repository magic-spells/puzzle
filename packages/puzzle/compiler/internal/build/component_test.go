package build

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

func TestComponentSlotBundleDefine(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		pl := plugin.New(t.TempDir())
		pl.SetUsage(plugin.Usage{HasComponentSlot: enabled})
		defines := bundleDefines(pl, bundleFlags{})
		want := "false"
		if enabled {
			want = "true"
		}
		if got := defines["__PUZZLE_HAS_COMPONENT_SLOT__"]; got != want {
			t.Fatalf("component define = %q, want %q", got, want)
		}
	}
}

func componentSlotFixture() ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/components/Card.pzl"] = `<puzzle-view><article>{title}<Children/></article></puzzle-view>`
	files["app/components/Other.pzl"] = `<puzzle-view><section>other:{title}</section></puzzle-view>`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <Component is={current} {...details}><b>slot-marker</b></Component>
  <Component is={cards['other']} title="map-marker"/>
  <Component is={cards['card']} title="nested-host-marker"><Component is={Other} title="nested-marker"/></Component>
  <Component is={cards['missing']}><p>hidden-map-marker</p></Component>
  <Component is={null}><i>hidden-null-marker</i></Component>
  <Component is={__d} title="private-data-marker"/>
  <Component is={__f} title={capitalize('private-formatter-marker')}/>
  {#for row in rows}<Component is={s[row.type]} title="row-map-marker"/>{/for}
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Card from '../components/Card.pzl';
import Other from '../components/Other.pzl';
const cards = { card: Card, other: Other };
const __d = Card, __f = Other;
let s = cards;
export default class Home extends PuzzleView {
  data() { return {current: Card, details: {title: 'value-marker'}, rows: [{id: 1, type: 'card'}]}; }
}
</script>`
	return files
}

func TestBuildComponentSlotAcrossOutputModes(t *testing.T) {
	requireStaticRuntime(t)
	for _, mode := range []string{"", "hybrid", "static"} {
		t.Run(mode, func(t *testing.T) {
			root := writeSSGFixture(t, componentSlotFixture())
			var meta string
			if err := Build(root, Options{Development: false, Output: mode, Metafile: &meta}); err != nil {
				t.Fatalf("component slot %q build: %v", mode, err)
			}
			if mode != "static" {
				bundle := readFile(t, filepath.Join(root, "dist", "app.js"))
				if !strings.Contains(bundle, "#component") || metafileBytesInOutput(t, meta, "client-runtime/views/componentSlot.js") == 0 {
					t.Fatalf("used component range was removed from %q bundle", mode)
				}
			}
			if mode == "" {
				return
			}
			html := readFile(t, filepath.Join(root, "dist", "index.html"))
			for _, want := range []string{"value-marker", "slot-marker", "other:map-marker", "nested-host-marker", "other:nested-marker", "private-data-marker", "Private-formatter-marker", "row-map-marker"} {
				if !strings.Contains(html, want) {
					t.Errorf("%q prerender omitted %q:\n%s", mode, want, html)
				}
			}
			if strings.Contains(html, "hidden-null-marker") || strings.Contains(html, "hidden-map-marker") || strings.Contains(html, "<Component") {
				t.Errorf("%q prerender emitted hidden or unresolved component content:\n%s", mode, html)
			}
			if mode == "static" {
				pages, err := filepath.Glob(filepath.Join(root, "dist", "_puzzle", "*.js"))
				if err != nil || len(pages) == 0 {
					t.Fatalf("static per-page bundles = %v, %v", pages, err)
				}
				found := false
				for _, page := range pages {
					found = found || strings.Contains(readFile(t, page), "#component")
				}
				chunks, err := filepath.Glob(filepath.Join(root, "dist", "_puzzle", "chunks", "*.js"))
				if err != nil {
					t.Fatal(err)
				}
				for _, chunk := range chunks {
					found = found || strings.Contains(readFile(t, chunk), "#component")
				}
				if !found {
					t.Fatal("static browser bundles dropped the component range")
				}
			}
		})
	}
}

func TestBuildWithoutComponentSlotsDropsRangeAndHelpers(t *testing.T) {
	root := writeSSGFixture(t, baseSSGFixture())
	var meta string
	if err := Build(root, Options{Development: false, Metafile: &meta}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(readFile(t, filepath.Join(root, "dist", "app.js")), "#component") {
		t.Fatal("an app without Component retains the range tag")
	}
	if bytes := metafileBytesInOutput(t, meta, "client-runtime/views/componentSlot.js"); bytes != 0 {
		t.Fatalf("unused component helpers contribute %d bytes", bytes)
	}
}
