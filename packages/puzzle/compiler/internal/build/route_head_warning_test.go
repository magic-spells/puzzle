package build

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
