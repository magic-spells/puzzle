package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
)

// writeApp lays out a tiny in-memory app under root and returns nothing; each
// file's content is written verbatim.
func writeApp(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// buildApp runs esbuild over root/app/app.js with the .pzl plugin. The runtime
// specifier is marked external so the test needs no installed runtime.
func buildApp(t *testing.T, root string) (api.BuildResult, *Plugin) {
	t.Helper()
	pl := New(root)
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

const buttonPzl = `<puzzle-view>
  <button @click={ onClick }>{ label }</button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Button extends PuzzleView {}
</script>

<style>
.btn { color: blue; }
</style>
`

const homePzl = `<puzzle-view class="home">
  <h1>{ title }</h1>
  <Button label="Hi" />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Button from '../components/Button.pzl';
export default class Home extends PuzzleView {}
</script>

<style>
.home { color: red; }
</style>
`

const appJS = `import Home from './views/Home.pzl';
export default Home;
`

func TestPluginTransform(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js":                appJS,
		"app/views/Home.pzl":        homePzl,
		"app/components/Button.pzl": buttonPzl,
	})

	res, pl := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) == 0 {
		t.Fatal("no output files produced")
	}

	bundle := string(res.OutputFiles[0].Contents)

	// Both components' render functions are attached by prototype assignment.
	for _, want := range []string{"Home.prototype.render", "Button.prototype.render"} {
		if !strings.Contains(bundle, want) {
			t.Errorf("bundle missing %q", want)
		}
	}
	// The component was reached from Home's <script> import — esbuild owns the
	// module graph, so components compile for free.
	// esbuild re-prints string literals with double quotes.
	if !strings.Contains(bundle, `new ViewNode("button"`) {
		t.Errorf("bundle missing the component's compiled button element")
	}

	// CSS collected, deterministically ordered by file path: the component
	// (app/components/…) sorts before the view (app/views/…).
	css := pl.CSS()
	btnIdx := strings.Index(css, ".btn")
	homeIdx := strings.Index(css, ".home")
	if btnIdx < 0 || homeIdx < 0 {
		t.Fatalf("CSS missing collected blocks: %q", css)
	}
	if btnIdx > homeIdx {
		t.Errorf("CSS not ordered by file path (.btn should precede .home):\n%s", css)
	}
}

// TestPluginUnless drives a {#unless} view end-to-end through the plugin entry
// (parse → codegen → esbuild), confirming it desugars to the negated
// conditional and produces a clean bundle.
func TestPluginUnless(t *testing.T) {
	unlessHome := `<puzzle-view class="home">
  {#unless ready}
    <p>Loading…</p>
  {:else}
    <p>Ready</p>
  {/unless}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":         "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl": unlessHome,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) == 0 {
		t.Fatal("no output files produced")
	}
	bundle := string(res.OutputFiles[0].Contents)
	// {#unless ready} desugars to `!(ready)` resolved against the data model.
	// esbuild may minify/reformat, so match on the negated member access.
	if !strings.Contains(bundle, "!__d.ready") && !strings.Contains(bundle, "!(__d.ready)") {
		t.Errorf("bundle missing the negated {#unless} condition; got:\n%s", bundle)
	}
	if !strings.Contains(bundle, "Home.prototype.render") {
		t.Errorf("bundle missing Home.prototype.render")
	}
}

// TestPluginCase drives a {#case}/{:when} view end-to-end through the plugin
// entry (parse → codegen → esbuild), confirming it compiles to the temp-bound
// IIFE chain and produces a clean bundle.
func TestPluginCase(t *testing.T) {
	caseHome := `<puzzle-view class="home">
  {#case status}
    {:when 'a', 'b'}
      <p>Group one</p>
    {:when 'c'}
      <p>Just c</p>
    {:else}
      <p>Default</p>
  {/case}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":         "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl": caseHome,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) == 0 {
		t.Fatal("no output files produced")
	}
	bundle := string(res.OutputFiles[0].Contents)
	// The case expression binds once to `__c` in an IIFE invoked with the
	// resolved data member; esbuild may minify/reformat, so match on the arrow
	// parameter and a strict-=== comparison against a when literal.
	if !strings.Contains(bundle, "__c") {
		t.Errorf("bundle missing the case temp binding; got:\n%s", bundle)
	}
	if !strings.Contains(bundle, `=== "a"`) && !strings.Contains(bundle, "=== 'a'") {
		t.Errorf("bundle missing a strict-=== when comparison; got:\n%s", bundle)
	}
	if !strings.Contains(bundle, "Home.prototype.render") {
		t.Errorf("bundle missing Home.prototype.render")
	}
}

// TestPluginInlineSVG drives {#svg} end-to-end through the plugin: the resolved
// icon's inner markup is inlined into the bundle as the <svg> vnode's string
// children (v1.14, D46).
func TestPluginInlineSVG(t *testing.T) {
	svgHome := `<puzzle-view class="home">
  <span class="inline-block size-5">{#svg 'icons/heart.svg'}</span>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":                 "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl":         svgHome,
		"app/assets/icons/heart.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 HEART_PATH"/></svg>`,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) == 0 {
		t.Fatal("no output files produced")
	}
	bundle := string(res.OutputFiles[0].Contents)
	// esbuild re-prints the tag/attrs with double quotes; the inlined inner markup
	// survives as a string literal (search a marker inside the path data).
	if !strings.Contains(bundle, "HEART_PATH") {
		t.Errorf("bundle missing the inlined svg inner markup:\n%s", bundle)
	}
	if !strings.Contains(bundle, `ViewNode("svg"`) && !strings.Contains(bundle, "ViewNode('svg'") {
		t.Errorf("bundle missing the emitted <svg> vnode:\n%s", bundle)
	}
}

// TestPluginInlineSVGMissing: a {#svg} pointing at a missing file fails the build
// with the error located in the .pzl (the {#svg} header), not the svg file.
func TestPluginInlineSVGMissing(t *testing.T) {
	svgHome := `<puzzle-view><span>{#svg 'icons/gone.svg'}</span></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":         "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl": svgHome,
	})
	res, _ := buildApp(t, root)
	if len(res.Errors) == 0 {
		t.Fatal("expected a build error for the missing svg")
	}
	var located bool
	for _, e := range res.Errors {
		if strings.Contains(e.Text, "no such file") && e.Location != nil &&
			strings.HasSuffix(filepath.ToSlash(e.Location.File), "app/views/Home.pzl") {
			located = true
		}
	}
	if !located {
		t.Errorf("missing-svg error not located in the .pzl; errors: %v", res.Errors)
	}
}

// TestPluginInlineSVGMalformed: an svg whose root is not <svg> fails the build
// with the error located inside the svg file (not the .pzl).
func TestPluginInlineSVGMalformed(t *testing.T) {
	svgHome := `<puzzle-view><span>{#svg 'icons/bad.svg'}</span></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":               "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl":       svgHome,
		"app/assets/icons/bad.svg": `<div><span/></div>`,
	})
	res, _ := buildApp(t, root)
	if len(res.Errors) == 0 {
		t.Fatal("expected a build error for the malformed svg")
	}
	var located bool
	for _, e := range res.Errors {
		if e.Location != nil && strings.HasSuffix(filepath.ToSlash(e.Location.File), "app/assets/icons/bad.svg") {
			located = true
			if !strings.Contains(e.Text, "root element is <div>") {
				t.Errorf("malformed-svg error should name the actual root; got: %q", e.Text)
			}
		}
	}
	if !located {
		t.Errorf("malformed-svg error not located in the svg file; errors: %v", res.Errors)
	}
}

// TestPluginSVGDedup: the same icon referenced from TWO different .pzl files (and
// twice within one of them) is stored ONCE in the bundle — a shared virtual
// module keyed by the resolved asset path — with every use site becoming a
// factory call. Proves the D46 dedup optimization end-to-end through esbuild.
func TestPluginSVGDedup(t *testing.T) {
	const marker = "UNIQUE_DEDUP_PATH_MARKER"
	homePzl := `<puzzle-view class="home">
  <span>{#svg 'icons/star.svg'}</span>
  <span>{#svg 'icons/star.svg'}</span>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Side from '../components/Side.pzl';
export default class Home extends PuzzleView {}
</script>
`
	sidePzl := `<puzzle-view><i>{#svg 'icons/star.svg'}</i></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Side extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":                "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl":        homePzl,
		"app/components/Side.pzl":   sidePzl,
		"app/assets/icons/star.svg": `<svg viewBox="0 0 24 24"><path d="M12 ` + marker + `"/></svg>`,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	bundle := string(res.OutputFiles[0].Contents)

	// The icon markup — three use sites across two files — is stored exactly once.
	if n := strings.Count(bundle, marker); n != 1 {
		t.Errorf("expected the icon markup stored ONCE (dedup), found %d copies:\n%s", n, bundle)
	}
	// The <svg> vnode factory is defined once and every use site calls it.
	if n := strings.Count(bundle, "ViewNode(\"svg\""); n > 1 {
		t.Errorf("expected a single <svg> vnode definition, found %d:\n%s", n, bundle)
	}
	if !strings.Contains(bundle, "ViewNode(\"svg\"") && !strings.Contains(bundle, "ViewNode('svg'") {
		t.Errorf("bundle missing the shared <svg> vnode factory:\n%s", bundle)
	}
}

func TestPluginTemplateError(t *testing.T) {
	badHome := `<puzzle-view class="home">
  <h1>{ title }</h1>
  {#if open}
    <p>still open</p>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	root := writeApp(t, map[string]string{
		"app/app.js":         "import Home from './views/Home.pzl';\nexport default Home;\n",
		"app/views/Home.pzl": badHome,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) == 0 {
		t.Fatal("expected a build error for the unclosed {#if}, got none")
	}
	if len(res.OutputFiles) != 0 {
		t.Errorf("expected no output for a failed build, got %d files", len(res.OutputFiles))
	}

	var located bool
	for _, e := range res.Errors {
		if e.Location != nil && strings.HasSuffix(filepath.ToSlash(e.Location.File), "app/views/Home.pzl") {
			if e.Location.Line <= 0 {
				t.Errorf("error message missing line number: %+v", e.Location)
			}
			located = true
		}
	}
	if !located {
		t.Errorf("no positioned error pointing at Home.pzl; errors: %v", res.Errors)
	}
}

func TestScanFormatters(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view>
  <h1 class="state { status | downcase }">{ title | upcase | custom }</h1>
  {#if show}
    <p>{ amount | currency('$') }</p>
  {/if}
  {#for todo in todos}
    <span>{ todo.name | truncate(5) }</span>
  {/for}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
	})

	got, err := ScanFormatters(filepath.Join(root, "app"))
	if err != nil {
		t.Fatalf("ScanFormatters: %v", err)
	}

	for _, want := range []string{"downcase", "upcase", "currency", "truncate"} {
		if !got[want] {
			t.Errorf("ScanFormatters missing built-in formatter %q in %#v", want, got)
		}
	}
	for _, notWant := range []string{"custom", "escape"} {
		if got[notWant] {
			t.Errorf("ScanFormatters should not include %q in %#v", notWant, got)
		}
	}
}

func TestScanUsageFlip(t *testing.T) {
	for _, tt := range []struct {
		name string
		attr string
		want bool
	}{
		{name: "bare", attr: " flip", want: true},
		{name: "dynamic", attr: " flip={ flipOptions }", want: true},
		{name: "absent"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := writeApp(t, map[string]string{
				"app/views/Home.pzl": `<puzzle-view>
  <div` + tt.attr + `>row</div>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
			})

			usage, err := ScanUsage(root)
			if err != nil {
				t.Fatalf("ScanUsage: %v", err)
			}
			if usage.HasFlip != tt.want {
				t.Errorf("HasFlip = %v, want %v", usage.HasFlip, tt.want)
			}
		})
	}
}

// `flip` on a COMPONENT must be detected too. A component vnode's props ARE its
// attrs (ViewNode `get props()` aliases `attrs`), so the runtime keyed patcher's
// `'flip' in newChild.attrs` fast path fires for `<PostCard … flip>` exactly as
// for a plain element — examples/blog relies on this. Missing it would emit
// __PUZZLE_HAS_FLIP__=false, DCE flip.js, and silently kill the animation: the
// false NEGATIVE the usage scan must never produce.
func TestScanUsageFlipOnComponent(t *testing.T) {
	for _, tt := range []struct {
		name string
		attr string
		want bool
	}{
		{name: "bare on component", attr: " flip", want: true},
		{name: "dynamic on component", attr: " flip={ flipOptions }", want: true},
		{name: "absent on component"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := writeApp(t, map[string]string{
				"app/views/Posts.pzl": `<puzzle-view>
  <PostCard post={ post } index={ i }` + tt.attr + `></PostCard>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import PostCard from '../components/PostCard.pzl';
export default class Posts extends PuzzleView {}
</script>
`,
			})

			usage, err := ScanUsage(root)
			if err != nil {
				t.Fatalf("ScanUsage: %v", err)
			}
			if usage.HasFlip != tt.want {
				t.Errorf("HasFlip = %v, want %v", usage.HasFlip, tt.want)
			}
		})
	}
}

func TestScanUsageHeadTags(t *testing.T) {
	for _, tt := range []struct {
		name string
		file string
		body string
	}{
		{
			name: "javascript route meta",
			file: "app/routes.js",
			body: "export default [{ meta: { description: 'A page' } }];\n",
		},
		{
			name: "pzl script body",
			file: "app/views/Home.pzl",
			body: `<puzzle-view><h1>Home</h1></puzzle-view>
<script>
const socialImage = '/card.png';
</script>
`,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			root := writeApp(t, map[string]string{tt.file: tt.body})
			usage, err := ScanUsage(root)
			if err != nil {
				t.Fatalf("ScanUsage: %v", err)
			}
			if !usage.HasHeadTags {
				t.Error("HasHeadTags = false, want true")
			}
		})
	}
}

func TestScanUsageAllAbsent(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/routes.ts": "export default [{ meta: { title: 'Home' } }];\n",
		"app/views/Home.pzl": `<puzzle-view><h1>Home</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
	})

	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage: %v", err)
	}
	if usage.HasFlip {
		t.Error("HasFlip = true without a flip attribute")
	}
	if usage.HasHeadTags {
		t.Error("HasHeadTags = true without a managed-head token")
	}
}

func TestScanUsageToleratesBrokenFileAndPrunesNodeModules(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view><h1>Home</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		"app/components/Broken.pzl":  `<puzzle-view>{#if oops}<p>broken</p></puzzle-view>`,
		"node_modules/pkg/Thing.pzl": `<puzzle-view><div flip>vendored</div></puzzle-view>`,
		"node_modules/pkg/routes.js": `export default [{ meta: { canonical: '/vendored' } }];`,
	})

	usage, err := ScanUsage(root)
	if err != nil {
		t.Fatalf("ScanUsage must tolerate a broken .pzl, got error: %v", err)
	}
	if usage.HasFlip {
		t.Error("ScanUsage walked node_modules and found a vendored flip attribute")
	}
	if usage.HasHeadTags {
		t.Error("ScanUsage walked node_modules and found a vendored head token")
	}
}

// A component imported from a sibling directory (outside app/) still ships its
// formatters: the scan walks the whole project so `upcase` is seeded and the
// generated render's guarded `(__f["upcase"] || __f.__missing("upcase"))(...)` call
// resolves to the real formatter instead of the D43 pass-through.
func TestScanFormattersOutsideAppDir(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view><h1>{ title | downcase }</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		"shared/Card.pzl": `<puzzle-view><span>{ label | upcase }</span></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Card extends PuzzleView {}
</script>
`,
	})

	got, err := ScanFormatters(root)
	if err != nil {
		t.Fatalf("ScanFormatters: %v", err)
	}
	for _, want := range []string{"downcase", "upcase"} {
		if !got[want] {
			t.Errorf("ScanFormatters missing %q from project-wide scan: %#v", want, got)
		}
	}
}

// A .pzl that fails to parse must NOT fail the scan (esbuild reports it if the
// app actually imports it), and vendored trees are pruned entirely.
func TestScanFormattersTolerantAndPrunes(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view><h1>{ title | downcase }</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
		// Malformed template (unclosed {#if}) — previously fatal to the build.
		"app/components/Broken.pzl": `<puzzle-view>{#if oops}<p>{ x | upcase }</p></puzzle-view>`,
		// Vendored .pzl must be pruned, not scanned.
		"node_modules/pkg/Thing.pzl": `<puzzle-view>{ v | currency('$') }</puzzle-view>`,
	})

	got, err := ScanFormatters(root)
	if err != nil {
		t.Fatalf("ScanFormatters must tolerate a broken .pzl, got error: %v", err)
	}
	if !got["downcase"] {
		t.Errorf("ScanFormatters dropped a valid file's formatter: %#v", got)
	}
	if got["currency"] {
		t.Errorf("ScanFormatters walked node_modules (found currency): %#v", got)
	}
}

// Guard the implicit contract between scan.go (collectFormatters) and codegen
// (applyFormatters): the scanner must see a formatter in EVERY position codegen
// emits one, else the name is seeded nowhere and its guarded call falls through
// to the D43 __missing pass-through instead of the real builtin — a silent wrong
// render the JS suite can't catch (it aliases to builtins-all). One distinct
// formatter per emit site: text run, quoted-attr interpolation, and an
// inline-{#if} branch inside an attribute value.
func TestScanFormattersCoversAllEmitSites(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view>
  <p>{ title | downcase }</p>
  <h1 class="s { status | upcase }">x</h1>
  <div class="{#if on}{ label | trim }{/if}">y</div>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
	})
	got, err := ScanFormatters(root)
	if err != nil {
		t.Fatalf("ScanFormatters: %v", err)
	}
	// downcase = text run, upcase = attr interpolation, trim = inline-if branch.
	for site, want := range map[string]string{"text": "downcase", "attr": "upcase", "inline-if": "trim"} {
		if !got[want] {
			t.Errorf("scanner missed formatter %q at emit site %q; collectFormatters is out of sync with codegen.applyFormatters: %#v", want, site, got)
		}
	}
}

// A builtin formatter used ONLY inside a <puzzle-skeleton> section is emitted by
// codegen's renderSkeleton() but was never seeded by the scan (which parsed only
// the template body) — so the runtime logged `unknown formatter` and showed the
// raw value. The scan now also parses the skeleton section.
func TestScanFormattersCoversSkeleton(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/views/Home.pzl": `<puzzle-view>
  <h1>{ title }</h1>
</puzzle-view>

<puzzle-skeleton>
  <p>{ when | date('long') }</p>
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  async data() { return { title: 'x', when: new Date() }; }
}
</script>
`,
	})
	got, err := ScanFormatters(filepath.Join(root, "app"))
	if err != nil {
		t.Fatalf("ScanFormatters: %v", err)
	}
	if !got["date"] {
		t.Errorf("scanner missed builtin %q used only inside <puzzle-skeleton>: %#v", "date", got)
	}
}

// TestPruneCSS proves PruneCSS drops css entries whose source is absent from the
// keep set (the current module graph) while preserving those present — the
// mechanism behind Fix 2's un-imported-but-on-disk pruning. Keys are matched
// after symlink resolution, so a keep-set derived from a cwd-relative metafile
// key still matches an absolute args.Path css key.
func TestPruneCSS(t *testing.T) {
	dir := t.TempDir()
	kept := filepath.Join(dir, "Kept.pzl")
	dropped := filepath.Join(dir, "Dropped.pzl")
	// Both files exist on disk (so the os.Stat prune in CSS() would keep BOTH);
	// only the module-graph prune distinguishes them.
	if err := os.WriteFile(kept, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dropped, []byte("y"), 0o644); err != nil {
		t.Fatal(err)
	}

	pl := New(dir)
	pl.css[kept] = ".kept{color:red}"
	pl.css[dropped] = ".dropped{color:blue}"

	// keep contains only the still-imported file.
	pl.PruneCSS(map[string]bool{kept: true})

	css := pl.CSS()
	if !strings.Contains(css, ".kept") {
		t.Errorf("PruneCSS dropped an in-graph file's CSS:\n%s", css)
	}
	if strings.Contains(css, ".dropped") {
		t.Errorf("PruneCSS kept an un-imported file's CSS:\n%s", css)
	}
}

// TestFormatterManifestFreshAcrossIncrementalRebuilds documents that the virtual
// formatter manifest re-emits the CURRENT used-formatter set on every incremental
// ctx.Rebuild(): a formatter first used mid-session reaches the bundle on the next
// rebuild, no `puzzle dev` restart required.
//
// This is the empirical answer to the "dev staleness" concern from code-review
// round 1. esbuild (v0.19.x) does not cache a namespaced OnLoad result across
// Rebuild() — it has no on-disk mtime to check freshness against, so it re-runs
// the callback every time. The manifest OnLoad therefore always reads the freshly
// scanned pl.formatters. If a future esbuild upgrade starts caching virtual
// modules this test fails, flagging that the OnLoad would then need WatchFiles.
func TestFormatterManifestFreshAcrossIncrementalRebuilds(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js": `import Home from './views/Home.pzl';
import manifest from '@magic-spells/puzzle/formatters/manifest';
console.log(Home, manifest);
`,
		"app/views/Home.pzl": `<puzzle-view><h1>{ title | upcase }</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
	})
	runtimeDir := filepath.Join(root, "client-runtime")
	builtinsPath := filepath.ToSlash(filepath.Join(runtimeDir, "formatters", "builtins.js"))
	home := filepath.Join(root, "app", "views", "Home.pzl")

	pl := New(root)
	pl.SetRuntimeDir(runtimeDir)

	// rescan mirrors what `puzzle dev` runs before each incremental Rebuild.
	rescan := func() {
		used, err := ScanFormatters(filepath.Join(root, "app"))
		if err != nil {
			t.Fatalf("ScanFormatters: %v", err)
		}
		pl.SetFormatters(used)
	}

	ctx, cerr := api.Context(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Format:      api.FormatESModule,
		Target:      api.ES2020,
		// The runtime is external (no install here); builtinsPath external keeps the
		// manifest import literal. The plugin's OnResolve still intercepts the
		// manifest subpath (plugin resolvers run before external matching).
		External: []string{"@magic-spells/puzzle", builtinsPath},
		Plugins:  []api.Plugin{pl.ESBuild()},
		LogLevel: api.LogLevelSilent,
	})
	if cerr != nil {
		t.Fatalf("api.Context: %s", cerr.Error())
	}
	defer ctx.Dispose()

	rebuild := func(phase string) string {
		res := ctx.Rebuild()
		if len(res.Errors) > 0 {
			t.Fatalf("%s rebuild errors: %v", phase, res.Errors)
		}
		if len(res.OutputFiles) != 1 {
			t.Fatalf("%s: expected one output file, got %d", phase, len(res.OutputFiles))
		}
		return string(res.OutputFiles[0].Contents)
	}

	rescan()
	first := rebuild("first")
	if !strings.Contains(first, "upcase") {
		t.Fatalf("first manifest missing the used formatter upcase:\n%s", first)
	}
	if strings.Contains(first, "timeago") {
		t.Fatalf("first manifest unexpectedly already imports timeago:\n%s", first)
	}

	// Add a NEW formatter usage mid-session, rescan, and rebuild the same context.
	if err := os.WriteFile(home, []byte(`<puzzle-view><h1>{ title | upcase } <span>{ when | timeago }</span></h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`), 0o644); err != nil {
		t.Fatal(err)
	}
	rescan()
	second := rebuild("second")
	if !strings.Contains(second, "timeago") {
		t.Errorf("virtual manifest did not pick up a formatter first used mid-session across an incremental rebuild; the OnLoad result is stale-cached:\n%s", second)
	}
	if !strings.Contains(second, "upcase") {
		t.Errorf("second manifest dropped the still-used upcase:\n%s", second)
	}
}

func TestFormatterManifestGolden(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js": `import manifest from '@magic-spells/puzzle/formatters/manifest';
console.log(manifest);
`,
	})
	runtimeDir := filepath.Join(root, "client-runtime")
	builtinsPath := filepath.ToSlash(filepath.Join(runtimeDir, "formatters", "builtins.js"))

	pl := New(root)
	pl.SetRuntimeDir(runtimeDir)
	pl.SetFormatters(map[string]bool{
		"upcase": true,
		"join":   true,
	})

	res := api.Build(api.BuildOptions{
		EntryPoints: []string{filepath.Join(root, "app", "app.js")},
		Bundle:      true,
		Write:       false,
		Format:      api.FormatESModule,
		Target:      api.ES2020,
		External:    []string{builtinsPath},
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	})
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) != 1 {
		t.Fatalf("expected one output file, got %d", len(res.OutputFiles))
	}

	got := string(res.OutputFiles[0].Contents)
	wantImport := `import { escape, upcase, join } from "` + builtinsPath + `";`
	wantMap := "var manifest_default = { escape, upcase, join };"
	if !strings.Contains(got, wantImport) {
		t.Errorf("bundle missing virtual manifest import\nwant: %s\ngot:\n%s", wantImport, got)
	}
	if !strings.Contains(got, wantMap) {
		t.Errorf("bundle missing virtual manifest default map\nwant: %s\ngot:\n%s", wantMap, got)
	}
	if strings.Contains(got, "date") || strings.Contains(got, "timeago") {
		t.Errorf("virtual manifest bundle includes unused formatter names:\n%s", got)
	}
}

// tsHomePzl is a view whose <script lang="ts"> uses TypeScript-only syntax: an
// interface, a typed local, and a typed class field / method signature. None of
// this is valid JavaScript — a clean build proves esbuild stripped the types
// under LoaderTS (v1.22, D54).
const tsHomePzl = `<puzzle-view class="home">
  <h1>{ title }</h1>
</puzzle-view>

<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

interface HomeModel {
  title: string;
}

export default class Home extends PuzzleView {
  private count: number = 1;

  data(): HomeModel {
    const x: number = this.count;
    return { title: 'Hello ' + x };
  }
}
</script>
`

// TestPluginTypeScript drives a <script lang="ts"> view through the plugin and
// asserts the bundle compiles cleanly with all TS syntax stripped (v1.22, D54).
func TestPluginTypeScript(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js":         appJS,
		"app/views/Home.pzl": tsHomePzl,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if len(res.OutputFiles) == 0 {
		t.Fatal("no output files produced")
	}
	bundle := string(res.OutputFiles[0].Contents)

	// Render tail still attached — the generated JS mixed cleanly with the TS body.
	if !strings.Contains(bundle, "Home.prototype.render") {
		t.Errorf("bundle missing Home.prototype.render")
	}
	// TS-only syntax must be gone: no `interface`, no type annotations like
	// `: number` or `: HomeModel`, no `private` field modifier.
	for _, banned := range []string{"interface HomeModel", ": HomeModel", "private count", ": number"} {
		if strings.Contains(bundle, banned) {
			t.Errorf("bundle still contains TypeScript syntax %q:\n%s", banned, bundle)
		}
	}
}

// TestPluginTypeScriptError confirms a bad `lang` value fails the build with a
// positioned error pointing at the .pzl (v1.22, D54).
func TestPluginTypeScriptError(t *testing.T) {
	root := writeApp(t, map[string]string{
		"app/app.js": appJS,
		"app/views/Home.pzl": `<puzzle-view><h1>hi</h1></puzzle-view>
<script lang="typescript">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) == 0 {
		t.Fatal("expected a build error for lang=\"typescript\"")
	}
	found := false
	for _, e := range res.Errors {
		if strings.Contains(e.Text, "did you mean \"ts\"?") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a did-you-mean error; errors: %v", res.Errors)
	}
}
