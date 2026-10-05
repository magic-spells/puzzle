package build

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

func writeRoutesModule(t *testing.T, rel, source string) string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestWarnDeadSPARouteMeta(t *testing.T) {
	t.Run("warns for a managed key in a literal meta object", func(t *testing.T) {
		root := writeRoutesModule(t, "app/routes.js", `export default [
  { path: '/', meta: {
    title: 'Home',
    description: 'Crawler copy',
    canonical: 'https://example.com/',
  } },
];`)
		var out bytes.Buffer
		warnDeadSPARouteMeta(root, "", &out)
		for _, want := range []string{
			"app/routes.js:4:",
			"warning:",
			"meta.description",
			"output: 'hybrid' or 'static'",
		} {
			if !strings.Contains(out.String(), want) {
				t.Errorf("warning missing %q:\n%s", want, out.String())
			}
		}
	})

	t.Run("title only does not warn", func(t *testing.T) {
		root := writeRoutesModule(t, "app/routes.js",
			`export default [{ path: '/', meta: { title: 'Home' } }];`)
		var out bytes.Buffer
		warnDeadSPARouteMeta(root, "", &out)
		if out.Len() != 0 {
			t.Errorf("title-only route should not warn:\n%s", out.String())
		}
	})

	t.Run("unrelated prose and object keys do not warn", func(t *testing.T) {
		root := writeRoutesModule(t, "app/routes.js", `
const prose = "meta: { description: 'not route config' }";
const template = `+"`meta: { canonical: 'still prose' }`"+`;
const fields = { description: 'string', canonical: 'string', socialImage: 'string' };
// meta: { socialImage: 'also prose' }
export default [{ path: '/', meta: { title: 'Home' } }];
`)
		var out bytes.Buffer
		warnDeadSPARouteMeta(root, "", &out)
		if out.Len() != 0 {
			t.Errorf("unrelated prose or non-meta keys should not warn:\n%s", out.String())
		}
	})

	t.Run("prerender modes do not warn", func(t *testing.T) {
		root := writeRoutesModule(t, "app/routes.ts",
			`export default [{ path: '/', meta: { socialImage: '/og.png' } }];`)
		for _, mode := range []string{"hybrid", "static"} {
			var out bytes.Buffer
			warnDeadSPARouteMeta(root, mode, &out)
			if out.Len() != 0 {
				t.Errorf("%s output should not warn:\n%s", mode, out.String())
			}
		}
	})
}

func TestWarnUntranslatedRouteMeta(t *testing.T) {
	routes := `export default [
  { path: '/', meta: { title: { t: 'home.title' }, description: 'Plain copy' } },
  { path: '/shop', meta: {
    title: 'Shop',
    description: { vars: { n: 1 }, t: 'shop.description' },
  } },
  { path: '/x', meta: { title: { t: key } } },
];`
	root := writeRoutesModule(t, "app/routes.js", routes)
	fix := ", but puzzle.config.js configures no i18n, so the page gets no "
	tail := " — add i18n: { locales: ['en'], defaultLocale: 'en' } with app/locales/en.json, or write a plain string"

	t.Run("warns without i18n", func(t *testing.T) {
		var out bytes.Buffer
		warnUntranslatedRouteMeta(root, nil, &out)
		want := strings.Join([]string{
			"app/routes.js:2:24: warning: route meta.title is { t: 'home.title' }" + fix + "title" + tail,
			"app/routes.js:5:5: warning: route meta.description is { t: 'shop.description' }" + fix + "description" + tail,
			"app/routes.js:7:25: warning: route meta.title is { t: … }" + fix + "title" + tail,
		}, "\n") + "\n"
		if out.String() != want {
			t.Errorf("warnings =\n%s\nwant\n%s", out.String(), want)
		}
	})

	t.Run("silent with i18n", func(t *testing.T) {
		var out bytes.Buffer
		warnUntranslatedRouteMeta(root, &config.I18n{Locales: []string{"en"}, DefaultLocale: "en"}, &out)
		if out.Len() != 0 {
			t.Errorf("i18n configured, yet warned:\n%s", out.String())
		}
	})

	t.Run("plain strings, other keys and prose do not warn", func(t *testing.T) {
		root := writeRoutesModule(t, "app/routes.ts", `
const prose = "meta: { title: { t: 'x' } }";
const other = { title: { t: 'not a route meta' } };
export default [
  { path: '/', meta: { title: 'Home', canonical: { t: 'x' } } },
  { path: '/a', meta: { title: { text: 'nested', inner: { t: 'deep' } } } },
];`)
		var out bytes.Buffer
		warnUntranslatedRouteMeta(root, nil, &out)
		if out.Len() != 0 {
			t.Errorf("unexpected warning:\n%s", out.String())
		}
	})
}

func TestBuildEmitsDeadSPARouteMetaWarning(t *testing.T) {
	root := writeSSGFixture(t, headMetaSSGFixture())

	oldStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = w
	buildErr := Build(root, Options{Development: true})
	_ = w.Close()
	os.Stderr = oldStderr
	captured, readErr := io.ReadAll(r)
	_ = r.Close()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if buildErr != nil {
		t.Fatalf("SPA Build failed: %v", buildErr)
	}
	if !strings.Contains(string(captured), "route meta.description has no effect with SPA output") {
		t.Errorf("SPA build missing managed-head warning:\n%s", captured)
	}
}
