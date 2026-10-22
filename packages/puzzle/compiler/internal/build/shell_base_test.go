package build

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestBuildHashedShellBaseReferences(t *testing.T) {
	requireStaticRuntime(t)
	for _, mode := range []string{"spa", "hybrid", "static"} {
		for _, prefix := range []string{"/", "/docs/", "/docs/site/"} {
			t.Run(mode+prefix, func(t *testing.T) {
				base := strings.TrimSuffix(prefix, "/")
				if base == "" {
					base = "/docs/site"
				}
				files := i18nFixture()
				files["puzzle.config.js"] = `export default { build: { splitting: true }, i18n: { locales: ['en', 'es'], defaultLocale: 'en', routing: 'prefix', detect: false } };`
				files["app/app.js"] = "import './imported.css';\n" + strings.Replace(files["app/app.js"], "target: '#app', routes", "target: '#app', routerBase: '"+base+"', routes", 1)
				files["app/app.js"] += "\nglobalThis.loadLazy = () => import('./lazy.js');\n"
				files["app/lazy.js"] = `import { PuzzleView } from '@magic-spells/puzzle'; export default class Lazy extends PuzzleView {}`
				files["app/imported.css"] = `body { color: red; }`
				files["app/public/index.html"] = fmt.Sprintf(`<!doctype html><html><head><title>Shell</title>
<link rel="stylesheet" href="%sstyles.css?theme#main">
<link rel="stylesheet" href="%sapp.css">
<script type="module" src="%svendor/app.js"></script>
</head><body><div id="app"></div><script type="module" crossorigin="anonymous" src="%sapp.js?boot#main"></script></body></html>`, prefix, prefix, prefix, prefix)
				files["app/public/vendor/app.js"] = `globalThis.vendorLoaded = true;`
				root := writeSSGFixture(t, files)
				if err := Build(root, Options{Output: mode}); err != nil {
					t.Fatal(err)
				}
				dist := filepath.Join(root, "dist")
				pages := []struct{ file, slug string }{{"index.html", "index"}}
				if mode != "spa" {
					pages = append(pages, []struct{ file, slug string }{
						{"about/index.html", "about"}, {"es/index.html", "index"},
						{"es/about/index.html", "about"}, {"404.html", "404"}, {"es/404.html", "404"},
					}...)
				}
				for _, page := range pages {
					htmlPath := filepath.Join(dist, filepath.FromSlash(page.file))
					source := readFile(t, htmlPath)
					for _, original := range []string{"styles.css", "app.css"} {
						asset := emittedAsset(t, dist, htmlPath, original)
						wantHashed := mode != "static" || original != "app.css"
						if (filepath.Base(asset) != original) != wantHashed {
							t.Fatalf("%s stylesheet %s hashed incorrectly", page.file, original)
						}
						if !strings.Contains(source, `href="`+prefix+filepath.Base(asset)) {
							t.Fatalf("%s lost stylesheet prefix %s: %s", page.file, prefix, source)
						}
						if _, err := os.Stat(asset); err != nil {
							t.Fatalf("%s references missing asset: %v", page.file, err)
						}
					}
					if !strings.Contains(source, `src="`+prefix+`vendor/app.js"`) || !strings.Contains(source, "?theme#main") {
						t.Fatalf("%s changed a public asset or stylesheet suffix", page.file)
					}
					if mode == "static" {
						if strings.Contains(source, `src="`+prefix+`app.js`) {
							t.Fatalf("%s retains discarded SPA script: %s", page.file, source)
						}
						asset := emittedAsset(t, dist, htmlPath, "_puzzle/"+page.slug+".js")
						if !strings.Contains(source, `src="`+base+`/_puzzle/`+filepath.Base(asset)+`"`) {
							t.Fatalf("%s lost its generated module base", page.file)
						}
					} else {
						match := regexp.MustCompile(`src="` + regexp.QuoteMeta(prefix) + `(app-[A-Z2-7]{8}\.js)\?boot#main"`).FindStringSubmatch(source)
						if match == nil {
							t.Fatalf("%s lost its hashed app entry: %s", page.file, source)
						}
						asset := filepath.Join(dist, match[1])
						if _, err := os.Stat(asset); err != nil {
							t.Fatal(err)
						}
					}
					hrefs := modulepreloadHrefs(source)
					if len(hrefs) == 0 {
						t.Fatalf("%s has no shared module preloads", page.file)
					}
					for _, href := range hrefs {
						preloadPrefix := prefix
						if mode == "static" {
							preloadPrefix = base + "/"
						}
						if !strings.HasPrefix(href, preloadPrefix) {
							t.Fatalf("%s preload %s lost its base", page.file, href)
						}
						if _, err := os.Stat(filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(href, preloadPrefix)))); err != nil {
							t.Fatal(err)
						}
					}
				}
			})
		}
	}
}

func TestHashedShellMissingStylesheetFailsBeforeSwap(t *testing.T) {
	requireNodeBin(t)
	root := writeSplitFixture(t, `export default { build: { hashNames: true } };`)
	if err := Build(root, Options{}); err != nil {
		t.Fatal(err)
	}
	before := readFile(t, filepath.Join(root, "dist", "index.html"))
	shell := `<head><link rel="stylesheet" href="/docs/app.css"></head><script src="/app.js"></script>`
	if err := os.WriteFile(filepath.Join(root, "app", "public", "index.html"), []byte(shell), 0o644); err != nil {
		t.Fatal(err)
	}
	err := Build(root, Options{})
	if err == nil || !strings.Contains(err.Error(), "/docs/app.css") {
		t.Fatalf("missing stylesheet diagnostic = %v", err)
	}
	if after := readFile(t, filepath.Join(root, "dist", "index.html")); after != before {
		t.Fatal("failed shell rewrite replaced dist")
	}
}
