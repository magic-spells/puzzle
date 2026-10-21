package build

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestRewriteShellReferences(t *testing.T) {
	renames := map[string]string{"app.js": "app-HASH.js", "app.css": "app-CSS.css", "styles.css": "styles-HASH.css"}
	for _, tt := range []struct{ source, want string }{
		{`<script src="/app.js?x=1#boot"></script>`, `<script src="/app-HASH.js?x=1#boot"></script>`},
		{`<script src='./app.js'></script>`, `<script src='./app-HASH.js'></script>`},
		{`<script src=app.js></script>`, `<script src=app-HASH.js></script>`},
		{`<LINK rel=preload href=styles.css?x#y>`, `<LINK rel=preload href=styles-HASH.css?x#y>`},
		{`<link href='/app.css'>`, `<link href='/app-CSS.css'>`},
		{`<script data-note="src='app.js' >" src="/app.js"></script>`, `<script data-note="src='app.js' >" src="/app-HASH.js"></script>`},
		{`<script src="/vendor/app.js"></script><link href="https://cdn/app.js"><link href="//cdn/styles.css">`, `<script src="/vendor/app.js"></script><link href="https://cdn/app.js"><link href="//cdn/styles.css">`},
		{`<img src="app.js"><scripture src="app.js">text app.js`, `<img src="app.js"><scripture src="app.js">text app.js`},
	} {
		t.Run(tt.source, func(t *testing.T) {
			got, _, err := rewriteShellHTML("<head>"+tt.source+"</head>", renames, nil, map[string]bool{"vendor/app.js": true})
			if err != nil || got != "<head>"+tt.want+"</head>" {
				t.Fatalf("rewrite = %q, %v; want %q", got, err, tt.want)
			}
		})
	}
	for _, source := range []string{`<head></head>`, `<head><link href="app.js"></head>`} {
		if _, found, err := rewriteShellHTML(source, renames, nil, nil); err != nil || found {
			t.Fatalf("entry found = %v, error = %v", found, err)
		}
	}
	if _, _, err := rewriteShellHTML(`<script src="app.js"></script>`, renames, nil, nil); err == nil || !strings.Contains(err.Error(), "</head>") {
		t.Fatalf("missing head error = %v", err)
	}
}

func TestShellPreloads(t *testing.T) {
	for _, cross := range []string{"", "crossorigin", `crossorigin = 'use-credentials'`} {
		for _, prefix := range []string{"/", "./", "", "/docs/site/"} {
			source := "<html>\n  <head>\n    <script " + cross + ` src="` + prefix + "app.js\"></script>\n  </head>\n</html>"
			got, _, err := rewriteShellHTML(source, nil, []string{"chunks/first.js", "chunks/shared.js"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			attrs := ""
			if cross != "" {
				attrs = " " + cross
			}
			want := `  <link rel="modulepreload" href="` + prefix + `chunks/first.js"` + attrs + ">\n" +
				`  <link rel="modulepreload" href="` + prefix + `chunks/shared.js"` + attrs + ">\n  </head>"
			if !strings.Contains(got, want) {
				t.Fatalf("preloads missing indentation/prefix/credentials:\n%s\nwant %s", got, want)
			}
		}
	}
	got, err := insertModulepreloads("<head></head>", "/", []string{"chunks/a.js"}, "")
	if err != nil || got != "<head>\n<link rel=\"modulepreload\" href=\"/chunks/a.js\">\n</head>" {
		t.Fatalf("inline head = %q, %v", got, err)
	}
}

func TestBundleOutputsAndStaticClosure(t *testing.T) {
	staging := t.TempDir()
	for _, name := range []string{"app-HASH.js", "app-CSS.css", "chunks/a.js", "chunks/b.js", "chunks/shared.js", "chunks/last.js", "chunks/lazy.js"} {
		file := filepath.Join(staging, name)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Exercise EvalSymlinks even when the temporary directory has no symlink.
	alias := filepath.Join(t.TempDir(), "staging")
	if err := os.Symlink(staging, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(cwd, alias)
	if err != nil {
		// Windows runners keep the temp dir on a different drive than the checkout.
		t.Skipf("no relative path to temp dir: %v", err)
	}
	const metafile = `{"outputs": {
		"DIST/app-HASH.js": {"entryPoint":"app/app.js", "cssBundle":"DIST/app-CSS.css", "imports": [
			{"path":"DIST/chunks/a.js", "kind":"import-statement"},
			{"path":"DIST/chunks/b.js", "kind":"import-statement"},
			{"path":"DIST/chunks/lazy.js", "kind":"dynamic-import"},
			{"path":"https://cdn/external.js", "kind":"import-statement", "external":true}]},
		"DIST/chunks/a.js": {"imports":[{"path":"DIST/chunks/shared.js", "kind":"import-statement"}]},
		"DIST/chunks/b.js": {"imports":[{"path":"DIST/chunks/shared.js", "kind":"import-statement"},
			{"path":"DIST/chunks/last.js", "kind":"import-statement"}]},
		"DIST/chunks/shared.js": {"imports":[{"path":"DIST/app-HASH.js", "kind":"import-statement"}]},
		"DIST/chunks/last.js": {}, "DIST/chunks/lazy.js": {}, "DIST/app-CSS.css": {}
	}}`
	for _, tt := range []struct{ base, prefix string }{{"", filepath.ToSlash(rel) + "/"}, {alias, ""}} {
		got, err := bundleOutputs(strings.ReplaceAll(metafile, "DIST/", tt.prefix), tt.base, staging)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"chunks/a.js", "chunks/b.js", "chunks/shared.js", "chunks/last.js"}
		if closure := staticImportClosure(got, "app-HASH.js"); !reflect.DeepEqual(closure, want) {
			t.Fatalf("static closure = %v, want %v", closure, want)
		}
		if got["app-HASH.js"].CSSBundle != "app-CSS.css" {
			t.Fatalf("CSS bundle = %s", got["app-HASH.js"].CSSBundle)
		}
	}
	if _, err := bundleOutputs("{", "", staging); err == nil {
		t.Fatal("invalid metafile accepted")
	}
}

func TestRewriteStaticPage(t *testing.T) {
	for _, base := range []string{"", "/app"} {
		source := `<head></head><script type="module" src="` + base + `/_puzzle/about.js"></script>`
		got, err := rewriteStaticPage(source, "_puzzle/about.js", "_puzzle/about-HASH.js", []string{"_puzzle/chunks/shared.js"})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(got, `src="`+base+`/_puzzle/about-HASH.js"`) || !strings.Contains(got, `href="`+base+`/_puzzle/chunks/shared.js"`) {
			t.Fatalf("static page lost its base: %s", got)
		}
		fixed, err := rewriteStaticPage(source, "_puzzle/about.js", "_puzzle/about.js", nil)
		if err != nil || fixed != source {
			t.Fatalf("fixed page changed: %q, %v", fixed, err)
		}
		for _, bad := range []string{`<head></head>`, source + source} {
			if _, err := rewriteStaticPage(bad, "_puzzle/about.js", "_puzzle/about-HASH.js", nil); err == nil {
				t.Fatal("expected exactly one generated module tag")
			}
		}
	}
}

func TestShellRenames(t *testing.T) {
	for _, entryPoint := range []string{"app/app.js", "app/app.ts", ".puzzle/fixtures/app.js"} {
		outputs := map[string]bundleOutput{
			"nested/app-HASH.js": {EntryPoint: entryPoint, CSSBundle: "nested/app-CSS.css"},
			"lazy.js":            {EntryPoint: "app/lib/app.js"},
			"nested/app-CSS.css": {EntryPoint: entryPoint},
		}
		renames, entry := shellRenames(outputs, "styles-ABC.css", entryPoint)
		want := map[string]string{"app.js": "nested/app-HASH.js", "app.css": "nested/app-CSS.css", "styles.css": "styles-ABC.css"}
		if entry != "nested/app-HASH.js" || !reflect.DeepEqual(renames, want) {
			t.Fatalf("renames = %v, entry = %s", renames, entry)
		}
	}
	renames, entry := shellRenames(map[string]bundleOutput{"app.js": {EntryPoint: "app/app.js"}}, "styles.css", "app/app.js")
	if entry != "app.js" || !reflect.DeepEqual(renames, map[string]string{"app.js": "app.js", "styles.css": "styles.css"}) {
		t.Fatalf("fixed renames = %v, entry = %s", renames, entry)
	}
}

func TestRewriteShellReadErrors(t *testing.T) {
	staging := t.TempDir()
	if err := os.Mkdir(filepath.Join(staging, "index.html"), 0o755); err != nil {
		t.Fatal(err)
	}
	err := rewriteShell(staging, "", "styles.css", "app/app.js", true, false, nil)
	if err == nil || !strings.Contains(err.Error(), "reading public/index.html:") || strings.Contains(err.Error(), "hashNames") {
		t.Fatalf("shell read error = %v", err)
	}
}
