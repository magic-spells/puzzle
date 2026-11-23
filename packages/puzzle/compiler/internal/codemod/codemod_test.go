package codemod

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// copyTree copies the fixture app at src into a fresh temp dir and returns it,
// so a test can rewrite files without touching testdata.
func copyTree(t *testing.T, src string) string {
	t.Helper()
	dst := t.TempDir()
	err := filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

// readTree returns every file under root as app-relative path → contents.
func readTree(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		out[filepath.ToSlash(rel)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// compareTrees fails on any file that differs between got and want, or that
// only one of them has.
func compareTrees(t *testing.T, got, want map[string]string) {
	t.Helper()
	var names []string
	for k := range want {
		names = append(names, k)
	}
	for k := range got {
		if _, ok := want[k]; !ok {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		g, gok := got[name]
		w, wok := want[name]
		switch {
		case !gok:
			t.Errorf("%s: missing after the rewrite", name)
		case !wok:
			t.Errorf("%s: should not exist after the rewrite", name)
		case g != w:
			t.Errorf("%s: rewrite differs\n--- got ---\n%s\n--- want ---\n%s", name, g, w)
		}
	}
}

// rules counts the changes per rule.
func rules(res *Result) map[string]int {
	out := map[string]int{}
	for _, c := range res.Changes {
		out[c.Rule]++
	}
	return out
}

// the dry run lists every site and changes nothing on disk.
func TestDryRunListsSitesAndWritesNothing(t *testing.T) {
	dir := copyTree(t, "testdata/before")
	before := readTree(t, dir)
	res, err := Run(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	compareTrees(t, readTree(t, dir), before)

	want := map[string]int{
		// Default.pzl: one self-closing + one paired (open and close tag);
		// Shell.pzl: one forwarded through <Card>
		"outlet": 4,
		// Badge.pzl, and Row.pzl's marker that hands a value over
		"children": 2,
		// Shell.pzl's this.setData and super.setData
		"set-state": 2,
		// Shell.pzl data + share, Typed.pzl data, Row.pzl data
		"data-object": 4,
		// app.js shorthand, the test's mountView and createTestApp
		"functions-key":    3,
		"functions-module": 1,
		// app.js, the test and Row.pzl import the renamed module
		"functions-import": 3,
	}
	got := rules(res)
	for rule, n := range want {
		if got[rule] != n {
			t.Errorf("rule %s: %d changes, want %d", rule, got[rule], n)
		}
	}
	for rule, n := range got {
		if _, ok := want[rule]; !ok {
			t.Errorf("unexpected rule %s (%d changes)", rule, n)
		}
	}
	// the receiver it cannot judge, the file that defines its own setData, and
	// the data() list holding a comment
	var noteFiles []string
	for _, n := range res.Notes {
		noteFiles = append(noteFiles, n.File)
	}
	sort.Strings(noteFiles)
	if strings.Join(noteFiles, ",") != "app/components/Commented.pzl,app/lib/fake.js,app/views/Shell.pzl,tests/home.test.js" {
		t.Errorf("notes in %v", noteFiles)
	}
	if res.Files != 8 {
		t.Errorf("Files = %d, want 8", res.Files)
	}
}

// --fix rewrites the fixture app into exactly the expected tree.
func TestFixRewritesToExpected(t *testing.T) {
	dir := copyTree(t, "testdata/before")
	if _, err := Run(dir, true); err != nil {
		t.Fatal(err)
	}
	compareTrees(t, readTree(t, dir), readTree(t, "testdata/after"))
}

// a TypeScript module moves as functions.ts, and the '.js' spellings of it,
// which the bundler resolves to the .ts, follow it.
func TestFixMovesATypeScriptModule(t *testing.T) {
	dir := copyTree(t, "testdata/before")
	app := filepath.Join(dir, "app")
	if err := os.Rename(filepath.Join(app, "formatters.js"), filepath.Join(app, "formatters.ts")); err != nil {
		t.Fatal(err)
	}
	if _, err := Run(dir, true); err != nil {
		t.Fatal(err)
	}
	want := readTree(t, "testdata/after")
	want["app/functions.ts"] = want["app/functions.js"]
	delete(want, "app/functions.js")
	compareTrees(t, readTree(t, dir), want)
}

// a second run over the rewritten app finds nothing to change: every
// rewrite produces a spelling no rule matches.
func TestFixIsIdempotent(t *testing.T) {
	dir := copyTree(t, "testdata/before")
	if _, err := Run(dir, true); err != nil {
		t.Fatal(err)
	}
	once := readTree(t, dir)
	res, err := Run(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 0 {
		t.Errorf("second run changed %d sites: %+v", len(res.Changes), res.Changes)
	}
	compareTrees(t, readTree(t, dir), once)
}

// the expected tree itself is already upgraded.
func TestUpgradedAppHasNothingToFix(t *testing.T) {
	res, err := Run("testdata/after", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Changes) != 0 {
		t.Errorf("after/ still has %d sites: %+v", len(res.Changes), res.Changes)
	}
}

// a change carries the position of the old spelling in the original file.
func TestChangePositions(t *testing.T) {
	res, err := Run("testdata/before", false)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range res.Changes {
		if c.File == "app/layouts/Default.pzl" && c.Line == 5 {
			found = true
			if c.Col != 12 || c.Message != "<Slot/> → <Outlet/>" {
				t.Errorf("Default.pzl:5 change = %+v", c)
			}
		}
	}
	if !found {
		t.Error("no change at app/layouts/Default.pzl:5")
	}
}

// with no app/ directory, Run says so instead of rewriting anything.
func TestNotAnApp(t *testing.T) {
	if _, err := Run(t.TempDir(), false); err == nil {
		t.Error("Run on an empty dir: want an error")
	}
}

// an existing app/functions.js wins: the old module is left alone rather than
// overwriting the new one.
func TestFunctionsModuleIsNeverOverwritten(t *testing.T) {
	dir := copyTree(t, "testdata/before")
	if err := os.WriteFile(filepath.Join(dir, "app", "functions.js"), []byte("export default {};\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := Run(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if rules(res)["functions-module"] != 0 || rules(res)["functions-import"] != 0 {
		t.Errorf("rename ran with app/functions.js present: %+v", rules(res))
	}
	tree := readTree(t, dir)
	if tree["app/functions.js"] != "export default {};\n" || tree["app/formatters.js"] == "" {
		t.Error("an existing app/functions.js was replaced, or app/formatters.js moved")
	}
}

// the parameter mapping, case by case.
func TestObjectParams(t *testing.T) {
	cases := []struct{ in, want string }{
		{"params, props", "{ params, props }"},
		{"params", "{ params }"},
		{"_params, props", "{ params: _params, props }"},
		{"p, q", "{ params: p, props: q }"},
		{"params, props = {}", "{ params, props = {} }"},
		{"params, { title }", "{ params, props: { title } }"},
		{"{ id }, props", "{ params: { id }, props }"},
		{"params, props,", "{ params, props }"},
		{"params: P, props: Props", "{ params, props }: { params: P; props: Props }"},
		{"params: Record<string, string>, props", "{ params, props }: { params: Record<string, string>; props: any }"},
		{"params, props?: Props", "{ params, props }: { params: any; props?: Props }"},
		{"params, cb = () => {}", "{ params, props: cb = () => {} }"},
	}
	for _, c := range cases {
		got, ok := objectParams(c.in)
		if !ok || got != c.want {
			t.Errorf("objectParams(%q) = %q, %v; want %q", c.in, got, ok, c.want)
		}
	}
	for _, bad := range []string{"...args", "a, b, c", ""} {
		if got, ok := objectParams(bad); ok {
			t.Errorf("objectParams(%q) = %q; want refusal", bad, got)
		}
	}
}
