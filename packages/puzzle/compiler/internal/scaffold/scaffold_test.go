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

func TestCreateTodos(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "tasks", "todos", false)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	want := []string{
		".gitignore",
		"README.md",
		"app/app.js",
		"app/components/TodoItem.pzl",
		"app/layouts/Default.pzl",
		"app/models/index.js",
		"app/models/todo.js",
		"app/public/index.html",
		"app/routes.js",
		"app/styles/styles.css",
		"app/views/Home.pzl",
		"app/views/NotFound.pzl",
		"package.json",
		"puzzle.config.js",
	}
	got := collect(t, res.Dir)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("todos file set mismatch:\n got: %v\nwant: %v", got, want)
	}

	pkg, err := os.ReadFile(filepath.Join(res.Dir, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pkg), `"name": "tasks"`) {
		t.Errorf("todos package.json missing app name:\n%s", pkg)
	}
}

// TestTodosSeedsInsteadOfFetching pins the todos template's data story: the
// starter ships no backend, so the store is seeded in app.js and every read is
// local. A declared endpoint would make the model server-backed, so `Home.pzl`'s
// tracked `findMany('todo')` would fault and fetch: under `puzzle dev` that URL
// answers with the SPA fallback (200 text/html), _loadMany rejects on the
// non-array body, and navigation #0 has nothing to commit; under a prerender it
// fails outright, an app-relative URL having no page origin to resolve against
// under Node.
func TestTodosSeedsInsteadOfFetching(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "tasks", "todos", false)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	read := func(rel string) string {
		b, err := os.ReadFile(filepath.Join(res.Dir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}

	// A whole-file substring search, so the token must not appear anywhere — prose
	// describing the upgrade path has to word around it, comments included.
	model := read("app/models/todo.js")
	if strings.Contains(model, "endpoint:") {
		t.Errorf("app/models/todo.js declares an endpoint; the todos starter has no server:\n%s", model)
	}
	if strings.Contains(model, "static adapter") {
		t.Errorf("app/models/todo.js declares a static adapter block; the todos starter has no server:\n%s", model)
	}

	appJS := read("app/app.js")
	if strings.Contains(appJS, "apiURL:") {
		t.Errorf("app/app.js declares an apiURL; the todos starter has no server:\n%s", appJS)
	}
	// The seed is what fills the store Home.pzl reads with findMany('todo').
	if !strings.Contains(appJS, "beforeMount") {
		t.Errorf("app/app.js has no beforeMount hook to seed the store:\n%s", appJS)
	}
	if !strings.Contains(appJS, "createRecord('todo'") {
		t.Errorf("app/app.js seeds no todo records:\n%s", appJS)
	}

	// The TypeScript variant tells the same data story from its app/app.ts entry.
	tsRes, err := Create(t.TempDir(), "tasks", "todos", true)
	if err != nil {
		t.Fatalf("Create (typescript): %v", err)
	}
	tsModel, err := os.ReadFile(filepath.Join(tsRes.Dir, "app", "models", "todo.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(tsModel), "endpoint:") || strings.Contains(string(tsModel), "static adapter") {
		t.Errorf("app/models/todo.ts declares a server location; the todos starter has no server:\n%s", tsModel)
	}
	appTS, err := os.ReadFile(filepath.Join(tsRes.Dir, "app", "app.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(appTS), "apiURL:") ||
		!strings.Contains(string(appTS), "beforeMount") ||
		!strings.Contains(string(appTS), "createRecord('todo'") {
		t.Errorf("app/app.ts must seed the store in beforeMount and declare no apiURL:\n%s", appTS)
	}
}

// templateTree reads templates/<dir>/ from the embedded FS, placeholder
// substituted the way Create writes it.
func templateTree(t *testing.T, dir, appName string) map[string]string {
	t.Helper()
	files, err := readTree("templates/" + dir)
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
// templates/<name>/ byte for byte: the TypeScript overlay must never leak into
// it, so `puzzle init` without --typescript writes exactly what it always has.
func TestCreateJavaScriptIsTheBaseTreeExactly(t *testing.T) {
	for _, tpl := range Templates {
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
				t.Errorf("%s: %s differs from templates/%s/%s", tpl, p, tpl, p)
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
		},
		"todos": {
			".gitignore",
			"README.md",
			"app/app.ts",
			"app/components/TodoItem.pzl",
			"app/layouts/Default.pzl",
			"app/models/index.ts",
			"app/models/todo.ts",
			"app/public/index.html",
			"app/routes.ts",
			"app/styles/styles.css",
			"app/views/Home.pzl",
			"app/views/NotFound.pzl",
			"package.json",
			"puzzle.config.js",
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
			if !strings.HasSuffix(p, ".pzl") {
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
				t.Errorf("%s typescript: %s markup differs from templates/%s/%s", tpl, p, tpl, p)
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
	for _, tpl := range Templates {
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

func TestCreateDefaultsToDefaultTemplate(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "blank", "", false)
	if err != nil {
		t.Fatalf("Create with empty template: %v", err)
	}
	// Counter.pzl is unique to the default template.
	if _, err := os.Stat(filepath.Join(res.Dir, "app", "components", "Counter.pzl")); err != nil {
		t.Errorf("empty template did not fall back to default: %v", err)
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
