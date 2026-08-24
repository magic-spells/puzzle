package scaffold

import (
	"os"
	"path/filepath"
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
	res, err := Create(parent, "my-app", "default")
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
	res, err := Create(parent, "tasks", "todos")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	want := []string{
		".gitignore",
		"README.md",
		"app/adapter.js",
		"app/app.js",
		"app/components/TodoItem.pzl",
		"app/layouts/Default.pzl",
		"app/models/index.js",
		"app/models/todo.js",
		"app/public/api/todos.json",
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

// TestTodosEndpointIsBackedByAShippedFile pins the D161 contract for the todos
// template: `Home.pzl` calls `store.findMany('todo')` inside data(), so with the
// adapter capability installed that tracked read FAULTS and fetches before the
// view may commit. A scaffolded app ships no backend, so the URL it fetches must
// resolve to a static file inside app/public/ — otherwise `puzzle dev` serves the
// SPA fallback (200 text/html), _loadMany rejects on the non-array body, and
// navigation #0 renders a blank page. Assert the declared apiURL + endpoint join
// to a file that actually exists rather than trusting the two literals to agree.
func TestTodosEndpointIsBackedByAShippedFile(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "tasks", "todos")
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

	// Pull the two literals out of the scaffolded source.
	find := func(src, key, file string) string {
		i := strings.Index(src, key)
		if i < 0 {
			t.Fatalf("%s does not declare %s", file, key)
		}
		rest := src[i+len(key):]
		start := strings.IndexAny(rest, "'\"")
		if start < 0 {
			t.Fatalf("%s: %s has no string literal", file, key)
		}
		quote := rest[start]
		end := strings.IndexByte(rest[start+1:], quote)
		if end < 0 {
			t.Fatalf("%s: %s literal is unterminated", file, key)
		}
		return rest[start+1 : start+1+end]
	}

	apiURL := find(read("app/app.js"), "apiURL:", "app/app.js")
	endpoint := find(read("app/models/todo.js"), "endpoint:", "app/models/todo.js")

	url := strings.TrimSuffix(apiURL, "/") + "/" + strings.TrimPrefix(endpoint, "/")
	if !strings.HasPrefix(url, "/") {
		t.Fatalf("joined read URL %q is not app-absolute (apiURL %q + endpoint %q)", url, apiURL, endpoint)
	}

	// Everything under app/public/ is copied to the site root at build time, so
	// the joined URL must name a file there.
	backing := filepath.Join(res.Dir, "app", "public", filepath.FromSlash(strings.TrimPrefix(url, "/")))
	if _, err := os.Stat(backing); err != nil {
		t.Fatalf("todos template fetches %q (apiURL %q + endpoint %q) but ships no file at app/public%s: %v",
			url, apiURL, endpoint, url, err)
	}

	// A JSON array is what _loadMany requires; anything else rejects the settle
	// pass and blanks the first navigation.
	body := read("app/public" + url)
	if trimmed := strings.TrimLeft(body, " \t\r\n"); !strings.HasPrefix(trimmed, "[") {
		t.Errorf("app/public%s must be a JSON array for loadMany('todo'); got: %.40s", url, trimmed)
	}
}

func TestCreateDefaultsToDefaultTemplate(t *testing.T) {
	parent := t.TempDir()
	res, err := Create(parent, "blank", "")
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
	if _, err := Create(parent, "empty-app", "default"); err != nil {
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
	_, err := Create(parent, "occupied", "default")
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
		if _, err := Create(parent, name, "default"); err == nil {
			t.Errorf("Create(%q) should have been rejected", name)
		}
	}
}

func TestRejectsUnknownTemplate(t *testing.T) {
	parent := t.TempDir()
	if _, err := Create(parent, "app", "react"); err == nil {
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
