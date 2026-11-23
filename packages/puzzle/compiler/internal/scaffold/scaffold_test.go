package scaffold

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// collect returns the sorted slash paths of every regular file under root.
func collect(t *testing.T, root string) []string {
	t.Helper()
	var files []string
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	return files
}

func TestCreateDefault(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "my-app", "default", false)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if res.Dir != filepath.Join(parent, "my-app") {
		t.Errorf("Dir = %q, want %q", res.Dir, filepath.Join(parent, "my-app"))
	}

	want := []string{
		".gitignore",
		"README.md",
		"app/app.js",
		"app/assets/icons/heart.svg",
		"app/components/Counter.pzl",
		"app/layouts/Default.pzl",
		"app/public/index.html",
		"app/routes.js",
		"app/styles/styles.css",
		"app/views/Home.pzl",
		"app/views/NotFound.pzl",
		"package.json",
		"puzzle.config.js",
		"tests/Counter.test.js",
		"vitest.config.js",
	}
	got := collect(t, res.Dir)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("file set mismatch:\n got: %v\nwant: %v", got, want)
	}

	// Result.Files should mirror what is on disk.
	if strings.Join(res.Files, ",") != strings.Join(want, ",") {
		t.Errorf("Result.Files mismatch:\n got: %v\nwant: %v", res.Files, want)
	}

	// The app name is substituted into package.json (npm name) and README.
	pkg, err := os.ReadFile(filepath.Join(res.Dir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pkg), `"name": "my-app"`) {
		t.Errorf("package.json missing app name:\n%s", pkg)
	}
	if strings.Contains(string(pkg), placeholder) {
		t.Errorf("package.json still contains placeholder %q", placeholder)
	}
	readme, err := os.ReadFile(filepath.Join(res.Dir, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(readme), "my-app") || strings.Contains(string(readme), placeholder) {
		t.Errorf("README not substituted:\n%s", readme)
	}
}

// templateTree reads starters/<dir>/ from the embedded FS, placeholder
// substituted the way Create writes it.
func templateTree(t *testing.T, dir, appName string) map[string]string {
	t.Helper()
	files, err := readTree(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := make(map[string]string, len(files))
	for p, data := range files {
		out[p] = strings.ReplaceAll(string(data), placeholder, appName)
	}
	return out
}

// diskTree reads every file Create wrote under root.
func diskTree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, p := range collect(t, root) {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(p)))
		if err != nil {
			t.Fatal(err)
		}
		out[p] = string(data)
	}
	return out
}

// TestCreateJavaScriptIsTheBaseTreeExactly pins the JavaScript scaffold to
// starters/<name>/ byte for byte: the TypeScript overlay must never leak into
// it, so `puzzle init` without --typescript writes exactly what it always has.
func TestCreateJavaScriptIsTheBaseTreeExactly(t *testing.T) {
	for _, tpl := range TemplateNames() {
		res, err := Create(t.TempDir(), "my-app", tpl, false)
		if err != nil {
			t.Fatalf("Create(%q): %v", tpl, err)
		}
		want := templateTree(t, tpl, "my-app")
		got := diskTree(t, res.Dir)
		if len(got) != len(want) {
			t.Errorf("%s: wrote %d files, the template has %d", tpl, len(got), len(want))
		}
		for p, body := range want {
			if got[p] != body {
				t.Errorf("%s: %s differs from starters/%s/%s", tpl, p, tpl, p)
			}
		}
	}
}

func TestCreateTypeScriptVariants(t *testing.T) {
	cases := map[string][]string{
		"default": {
			".gitignore",
			"README.md",
			"app/app.ts",
			"app/assets/icons/heart.svg",
			"app/components/Counter.pzl",
			"app/layouts/Default.pzl",
			"app/public/index.html",
			"app/routes.ts",
			"app/styles/styles.css",
			"app/views/Home.pzl",
			"app/views/NotFound.pzl",
			"package.json",
			"puzzle.config.js",
			"tests/Counter.test.ts",
			"vitest.config.js",
		},
		"static": {
			".gitignore",
			"README.md",
			"app/app.ts",
			"app/components/Counter.pzl",
			"app/layouts/Default.pzl",
			"app/public/index.html",
			"app/routes.ts",
			"app/styles/styles.css",
			"app/views/About.pzl",
			"app/views/Home.pzl",
			"app/views/NotFound.pzl",
			"package.json",
			"puzzle.config.js",
			"tests/Home.test.ts",
			"vitest.config.js",
		},
	}
	for tpl, want := range cases {
		res, err := Create(t.TempDir(), "my-app", tpl, true)
		if err != nil {
			t.Fatalf("Create(%q, typescript): %v", tpl, err)
		}
		got := collect(t, res.Dir)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s typescript file set mismatch:\n got: %v\nwant: %v", tpl, got, want)
		}
		if strings.Join(res.Files, ",") != strings.Join(want, ",") {
			t.Errorf("%s typescript Result.Files mismatch:\n got: %v\nwant: %v", tpl, res.Files, want)
		}

		tsTree := diskTree(t, res.Dir)
		jsTree := templateTree(t, tpl, "my-app")
		for p, body := range tsTree {
			if strings.Contains(body, placeholder) {
				t.Errorf("%s typescript: %s still contains %q", tpl, p, placeholder)
			}
			// a .pzl with no script is the JavaScript template's own file
			if !strings.HasSuffix(p, ".pzl") || !strings.Contains(body, "\n<script") {
				continue
			}
			// Every component script is TypeScript, and the markup above it is
			// the JavaScript template's own: only the script is ported, so a
			// markup change must land in both trees.
			if !strings.Contains(body, "\n<script lang=\"ts\">\n") || strings.Contains(body, "\n<script>\n") {
				t.Errorf("%s typescript: %s is not a <script lang=\"ts\"> component", tpl, p)
			}
			markup := func(s string) string { return s[:strings.Index(s, "\n<script")] }
			if markup(body) != markup(jsTree[p]) {
				t.Errorf("%s typescript: %s markup differs from starters/%s/%s", tpl, p, tpl, p)
			}
		}
	}
}

// TestTypeScriptPackageJSONTracksTheBase pins each TypeScript package.json to
// its JavaScript template's: the same manifest plus exactly the `check` script
// and the typescript devDependency. The release sweep bumps the framework range
// in both (scripts/release-prep.mjs asserts each), and this catches one bumped
// without the other.
func TestTypeScriptPackageJSONTracksTheBase(t *testing.T) {
	for _, tpl := range TemplateNames() {
		var js, ts map[string]any
		if err := json.Unmarshal([]byte(templateTree(t, tpl, "x")["package.json"]), &js); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(templateTree(t, tpl+typeScriptOverlaySuffix, "x")["package.json"]), &ts); err != nil {
			t.Fatal(err)
		}
		scripts := ts["scripts"].(map[string]any)
		if scripts["check"] != "puzzle check" {
			t.Errorf("%s: TypeScript package.json scripts.check = %v, want \"puzzle check\"", tpl, scripts["check"])
		}
		delete(scripts, "check")
		dev := ts["devDependencies"].(map[string]any)
		if r, _ := dev["typescript"].(string); !strings.HasPrefix(r, "^7.") {
			t.Errorf("%s: TypeScript package.json devDependencies.typescript = %v, want ^7.x", tpl, dev["typescript"])
		}
		delete(dev, "typescript")
		if !reflect.DeepEqual(js, ts) {
			t.Errorf("%s: TypeScript package.json differs from the JavaScript one beyond check + typescript:\n js: %v\n ts: %v", tpl, js, ts)
		}
	}
}

// TestEveryTemplateShipsATestSuite pins the test scaffold (D194): every app,
// in both languages, gets an `npm test` script running Vitest once, the vitest
// and jsdom dev dependencies, a vitest.config.js wiring the .pzl plugin, and at
// least one test under tests/ that imports the testing module.
func TestEveryTemplateShipsATestSuite(t *testing.T) {
	for _, tpl := range TemplateNames() {
		for _, ts := range []bool{false, true} {
			res, err := Create(t.TempDir(), "my-app", tpl, ts)
			if err != nil {
				t.Fatalf("Create(%q, %v): %v", tpl, ts, err)
			}
			tree := diskTree(t, res.Dir)
			label := tpl
			if ts {
				label += " (typescript)"
			}

			var pkg struct {
				Scripts map[string]string `json:"scripts"`
				Dev     map[string]string `json:"devDependencies"`
			}
			if err := json.Unmarshal([]byte(tree["package.json"]), &pkg); err != nil {
				t.Fatal(err)
			}
			if pkg.Scripts["test"] != "vitest run" {
				t.Errorf("%s: scripts.test = %q, want \"vitest run\"", label, pkg.Scripts["test"])
			}
			for _, dep := range []string{"vitest", "jsdom"} {
				if pkg.Dev[dep] == "" {
					t.Errorf("%s: devDependencies has no %s", label, dep)
				}
			}

			config := tree["vitest.config.js"]
			if !strings.Contains(config, "from '@magic-spells/puzzle/vitest'") ||
				!strings.Contains(config, "plugins: [puzzle()]") ||
				!strings.Contains(config, "environment: 'jsdom'") {
				t.Errorf("%s: vitest.config.js does not wire the puzzle plugin and jsdom:\n%s", label, config)
			}

			tests := 0
			for p, body := range tree {
				if !strings.HasPrefix(p, "tests/") {
					continue
				}
				tests++
				if ts != strings.HasSuffix(p, ".test.ts") {
					t.Errorf("%s: %s has the wrong extension for this variant", label, p)
				}
				if !strings.Contains(body, "from '@magic-spells/puzzle/testing'") {
					t.Errorf("%s: %s does not use @magic-spells/puzzle/testing", label, p)
				}
			}
			if tests == 0 {
				t.Errorf("%s: no tests under tests/", label)
			}
		}
	}
}

func TestCreateDefaultsToDefaultTemplate(t *testing.T) {
	res, err := Create(t.TempDir(), "blank", "", false)
	if err != nil {
		t.Fatalf("Create with empty template: %v", err)
	}
	if !reflect.DeepEqual(diskTree(t, res.Dir), templateTree(t, DefaultTemplate, "blank")) {
		t.Errorf("an empty template did not write the %s starter", DefaultTemplate)
	}
}

func TestCreateIntoEmptyExistingDir(t *testing.T) {
	parent := t.TempDir()
	target := filepath.Join(parent, "empty-app")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(parent, "empty-app", "default", false); err != nil {
		t.Errorf("Create into an existing empty dir should succeed, got: %v", err)
	}
}

func TestRefusesNonEmptyDir(t *testing.T) {
	parent := t.TempDir()
	target := filepath.Join(parent, "occupied")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "keep.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Create(parent, "occupied", "default", false)
	if err == nil {
		t.Fatal("expected Create to refuse a non-empty target directory")
	}
	if !strings.Contains(err.Error(), "not empty") {
		t.Errorf("expected a 'not empty' error, got: %v", err)
	}
}

func TestRejectsBadNames(t *testing.T) {
	parent := t.TempDir()
	bad := []string{"", "1app", "-app", "My-App", "my_app", "my app", "app!", "MyApp"}
	for _, name := range bad {
		if _, err := Create(parent, name, "default", false); err == nil {
			t.Errorf("Create(%q) should have been rejected", name)
		}
	}
}

func TestRejectsUnknownTemplate(t *testing.T) {
	parent := t.TempDir()
	if _, err := Create(parent, "app", "react", false); err == nil {
		t.Fatal("expected an error for an unknown template")
	}
}

func TestValidateName(t *testing.T) {
	good := []string{"a", "app", "my-app", "app123", "a-b-c"}
	for _, n := range good {
		if err := ValidateName(n); err != nil {
			t.Errorf("ValidateName(%q) = %v, want nil", n, err)
		}
	}
	bad := []string{"", "1", "-a", "A", "a_b", "a.b"}
	for _, n := range bad {
		if err := ValidateName(n); err == nil {
			t.Errorf("ValidateName(%q) = nil, want error", n)
		}
	}
}
