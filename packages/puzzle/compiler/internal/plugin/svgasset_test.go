package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

// TestResolveSVGAssetContainment: the {#svg} virtual-module resolver serves ONLY
// files under app/assets/. codegen never emits an escaping specifier, but this
// OnResolve handler answers for any import in the bundle — hand-written app JS
// or a dependency — so an unchecked filepath.Join would have let
// `@magic-spells/puzzle/svg-asset/../../../../etc/passwd` reach OnLoad's ReadFile.
func TestResolveSVGAssetContainment(t *testing.T) {
	assetsDir := filepath.Join(t.TempDir(), "app", "assets")

	t.Run("legitimate paths resolve inside the assets dir", func(t *testing.T) {
		for _, src := range []string{"icons/x.svg", "x.svg", "a/b/c/deep.svg"} {
			got, err := resolveSVGAsset(assetsDir, src)
			if err != nil {
				t.Fatalf("resolveSVGAsset(%q) errored: %v", src, err)
			}
			if want := filepath.Join(assetsDir, filepath.FromSlash(src)); got != want {
				t.Errorf("resolveSVGAsset(%q) = %q, want %q", src, got, want)
			}
		}
	})

	t.Run("escaping paths are refused", func(t *testing.T) {
		for _, src := range []string{
			"../../../../etc/passwd",
			"icons/../../../../etc/passwd",
			"./icons/x.svg",
			"/etc/passwd",
			"..",
			"",
		} {
			got, err := resolveSVGAsset(assetsDir, src)
			if err == nil {
				t.Errorf("resolveSVGAsset(%q) = %q, want an error", src, got)
			}
			if got != "" {
				t.Errorf("resolveSVGAsset(%q) returned a path %q alongside the error", src, got)
			}
		}
	})
}

// TestPluginSVGAssetTraversalIsBuildError proves the containment end-to-end: a
// module that imports an escaping svg-asset specifier fails the build instead of
// bundling the file it named. The target is a real, readable file OUTSIDE the app
// root, so a passing test means the loader never read it.
func TestPluginSVGAssetTraversalIsBuildError(t *testing.T) {
	const secret = "TOP_SECRET_OUTSIDE_THE_APP"
	outside := t.TempDir()
	secretPath := filepath.Join(outside, "secret.svg")
	if err := os.WriteFile(secretPath, []byte(`<svg><path d="`+secret+`"/></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}

	root := writeApp(t, map[string]string{
		"app/assets/icons/ok.svg": `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`,
	})
	// A relative escape from <root>/app/assets back out to the secret's directory.
	rel, err := filepath.Rel(filepath.Join(root, "app", "assets"), secretPath)
	if err != nil {
		t.Fatal(err)
	}
	escape := filepath.ToSlash(rel)
	if !strings.HasPrefix(escape, "../") {
		t.Fatalf("precondition: %q should escape the assets dir", escape)
	}
	appJS := "import icon from '" + codegen.SVGAssetSpecifierPrefix + escape + "';\nexport default icon;\n"
	if err := os.WriteFile(filepath.Join(root, "app", "app.js"), []byte(appJS), 0o644); err != nil {
		t.Fatal(err)
	}

	res, _ := buildApp(t, root)
	if len(res.Errors) == 0 {
		t.Fatalf("traversal specifier built cleanly; it must be a build error")
	}
	for _, f := range res.OutputFiles {
		if strings.Contains(string(f.Contents), secret) {
			t.Fatalf("the out-of-app file was READ and bundled:\n%s", f.Contents)
		}
	}
}

// TestPluginSVGAssetLegitimateSpecifierStillResolves: the containment check must
// not break the normal dedup path — a plain `icons/x.svg` specifier still loads.
func TestPluginSVGAssetLegitimateSpecifierStillResolves(t *testing.T) {
	const marker = "LEGIT_ICON_MARKER"
	root := writeApp(t, map[string]string{
		"app/app.js":             "import icon from '" + codegen.SVGAssetSpecifierPrefix + "icons/x.svg';\nexport default icon;\n",
		"app/assets/icons/x.svg": `<svg viewBox="0 0 24 24"><path d="M0 ` + marker + `"/></svg>`,
		"app/assets/icons/y.svg": `<svg viewBox="0 0 24 24"><path d="M1"/></svg>`,
	})

	res, _ := buildApp(t, root)
	if len(res.Errors) > 0 {
		t.Fatalf("unexpected build errors: %v", res.Errors)
	}
	if !strings.Contains(string(res.OutputFiles[0].Contents), marker) {
		t.Errorf("bundle is missing the resolved icon markup:\n%s", res.OutputFiles[0].Contents)
	}
}
