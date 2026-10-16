package build

import (
	"encoding/json"
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
			got, err := rewriteShellHTML("<head>"+tt.source+"</head>", renames, false, nil)
			if err != nil || got != "<head>"+tt.want+"</head>" {
				t.Fatalf("rewrite = %q, %v; want %q", got, err, tt.want)
			}
		})
	}
	for _, source := range []string{`<head></head>`, `<head><link href="app.js"></head>`, `<head><script src="/base/app.js"></script></head>`} {
		if _, err := rewriteShellHTML(source, renames, true, nil); err == nil || !strings.Contains(err.Error(), "build.hashNames: false") {
			t.Fatalf("missing entry error = %v", err)
		}
	}
	if _, err := rewriteShellHTML(`<script src="app.js"></script>`, renames, true, nil); err == nil || !strings.Contains(err.Error(), "</head>") {
		t.Fatalf("missing head error = %v", err)
	}
}

func TestShellPreloads(t *testing.T) {
	for _, cross := range []string{"", "crossorigin", `crossorigin = 'use-credentials'`} {
		for _, prefix := range []string{"/", "./", ""} {
			source := "<html>\n  <head>\n    <script " + cross + ` src="` + prefix + "app.js\"></script>\n  </head>\n</html>"
			got, err := rewriteShellHTML(source, nil, false, []string{"chunks/first.js", "chunks/shared.js"})
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
	// Make a second spelling of staging to exercise EvalSymlinks even on
	// machines whose temporary directory has no built-in symlink.
	for _, name := range []string{"app-HASH.js", "app-CSS.css", "chunks/a.js", "chunks/b.js", "chunks/shared.js", "chunks/last.js", "chunks/lazy.js"} {
		file := filepath.Join(staging, name)
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(t.TempDir(), "staging")
	if err := os.Symlink(staging, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	for _, base := range []string{"", alias} {
		key := func(name string) string {
			if base != "" {
				return name
			}
			cwd, err := os.Getwd()
			if err != nil {
				t.Fatal(err)
			}
			rel, err := filepath.Rel(cwd, filepath.Join(alias, name))
			if err != nil {
				t.Fatal(err)
			}
			return filepath.ToSlash(rel)
		}
		imports := func(names ...string) []bundleImport {
			var out []bundleImport
			for _, name := range names {
				out = append(out, bundleImport{Path: key(name), Kind: "import-statement"})
			}
			return out
		}
		outputs := map[string]bundleOutput{
			key("app-HASH.js"): {EntryPoint: "app/app.js", CSSBundle: key("app-CSS.css"), Imports: append(imports("chunks/a.js", "chunks/b.js"),
				bundleImport{Path: key("chunks/lazy.js"), Kind: "dynamic-import"},
				bundleImport{Path: "https://cdn/external.js", Kind: "import-statement", External: true})},
			key("chunks/a.js"):      {Imports: imports("chunks/shared.js")},
			key("chunks/b.js"):      {Imports: imports("chunks/shared.js", "chunks/last.js")},
			key("chunks/shared.js"): {Imports: imports("app-HASH.js")},
			key("chunks/last.js"):   {}, key("chunks/lazy.js"): {}, key("app-CSS.css"): {},
		}
		data, _ := json.Marshal(map[string]any{"outputs": outputs})
		got, err := bundleOutputs(string(data), base, staging)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"chunks/a.js", "chunks/b.js", "chunks/shared.js", "chunks/last.js"}
		if closure := staticImportClosure(got, "app-HASH.js"); !reflect.DeepEqual(closure, want) {
			t.Fatalf("static closure = %v, want %v", closure, want)
		}
		renames, entry := shellRenames(got, "styles-ABC.css", true)
		if entry != "app-HASH.js" || !reflect.DeepEqual(renames, map[string]string{"app.js": "app-HASH.js", "app.css": "app-CSS.css", "styles.css": "styles-ABC.css"}) {
			t.Fatalf("renames = %v, entry = %s", renames, entry)
		}
		if renames, _ := shellRenames(got, "styles.css", false); len(renames) != 0 {
			t.Fatalf("fixed names have rename table %v", renames)
		}
	}
	if _, err := bundleOutputs("{", "", staging); err == nil {
		t.Fatal("invalid metafile accepted")
	}
}

func TestRewriteStaticPage(t *testing.T) {
	for _, base := range []string{"", "/app"} {
		source := `<head></head><script type="module" src="` + base + `/_puzzle/about.js"></script>`
		got, err := rewriteStaticPage(source, "about", "_puzzle/about-HASH.js", []string{"_puzzle/chunks/shared.js"})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(got, `src="`+base+`/_puzzle/about-HASH.js"`) || !strings.Contains(got, `href="`+base+`/_puzzle/chunks/shared.js"`) {
			t.Fatalf("static page lost its base: %s", got)
		}
		fixed, err := rewriteStaticPage(source, "about", "_puzzle/about.js", nil)
		if err != nil || fixed != source {
			t.Fatalf("fixed page changed: %q, %v", fixed, err)
		}
		for _, bad := range []string{`<head></head>`, source + source} {
			if _, err := rewriteStaticPage(bad, "about", "_puzzle/about-HASH.js", nil); err == nil {
				t.Fatal("expected exactly one generated module tag")
			}
		}
	}
}
