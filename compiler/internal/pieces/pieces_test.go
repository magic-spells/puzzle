package pieces

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// --- fixtures -----------------------------------------------------------------

// fixtureFile is one file in a fixture registry, keyed by its registry-relative
// slash path.
type fixtureFile struct {
	rel     string
	content string
}

// buildRegistry writes a registry on disk from a registry.json body plus files,
// and returns the root directory. Tests never touch the real puzzle-pieces repo.
func buildRegistry(t *testing.T, registryJSON string, files ...fixtureFile) string {
	t.Helper()
	root := t.TempDir()
	write(t, root, "registry.json", registryJSON)
	for _, f := range files {
		write(t, root, f.rel, f.content)
	}
	return root
}

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newApp returns an app root with a styles.css that lacks the theme marker (so
// the theme advisory fires) unless withMarker is true.
func newApp(t *testing.T, withMarker bool) string {
	t.Helper()
	app := t.TempDir()
	if err := os.MkdirAll(filepath.Join(app, "app", "styles"), 0o755); err != nil {
		t.Fatal(err)
	}
	css := "@import \"tailwindcss\";\n"
	if withMarker {
		css += "/* puzzle-pieces design tokens */\n"
	}
	if err := os.WriteFile(filepath.Join(app, "app", "styles", "styles.css"), []byte(css), 0o644); err != nil {
		t.Fatal(err)
	}
	return app
}

func plainPrinter() *ui.Printer { return ui.New(nil) }

func render(res *Result) string {
	var buf bytes.Buffer
	RenderSummary(&buf, plainPrinter(), res)
	return buf.String()
}

func sha(content string) string {
	sum := sha256.Sum256([]byte(content))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// singlePieceRegistry is the smallest useful registry: one piece, no deps.
const singlePieceRegistry = `{
  "version": 1,
  "theme": "theme/pieces.css",
  "pieces": [
    {"name":"button","description":"A button","files":["Button.pzl"],"registryDependencies":[],"dependencies":[],"targetDir":"app/components/ui"}
  ]
}`

// depChainRegistry models date-picker → calendar → lib/date-math.js, plus
// date-picker's own lib dep and npm dep — the transitive/dedupe case.
const depChainRegistry = `{
  "version": 1,
  "theme": "theme/pieces.css",
  "pieces": [
    {"name":"date-picker","description":"","files":["DatePicker.pzl"],"registryDependencies":["calendar","lib/date-math.js"],"dependencies":["@magic-spells/morph-engine"],"targetDir":"app/components/ui"},
    {"name":"calendar","description":"","files":["Calendar.pzl"],"registryDependencies":["lib/date-math.js"],"dependencies":[],"targetDir":"app/components/ui"}
  ]
}`

func pathRegistryJSON(targetDir string, files, registryDeps []string) string {
	data, _ := json.Marshal(Registry{
		Version: 1,
		Theme:   "theme/pieces.css",
		Pieces: []Piece{{
			Name:                 "button",
			Files:                files,
			RegistryDependencies: registryDeps,
			TargetDir:            targetDir,
		}},
	})
	return string(data)
}

// --- tests --------------------------------------------------------------------

func TestAddSinglePieceWritesFilesAndLock(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "BUTTON BODY\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, false)

	_, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	// File copied verbatim.
	got, err := os.ReadFile(filepath.Join(app, "app", "components", "ui", "Button.pzl"))
	if err != nil {
		t.Fatalf("Button.pzl not written: %v", err)
	}
	if string(got) != "BUTTON BODY\n" {
		t.Errorf("Button.pzl content = %q, want verbatim copy", got)
	}

	// Lock has the correct sha256.
	lock := readLockFile(t, app)
	entry, ok := lock.Pieces["button"]
	if !ok {
		t.Fatal("lock missing button entry")
	}
	if got := entry.Files["app/components/ui/Button.pzl"]; got != sha("BUTTON BODY\n") {
		t.Errorf("lock hash = %q, want %q", got, sha("BUTTON BODY\n"))
	}
	if lock.Registry != reg {
		t.Errorf("lock registry = %q, want %q", lock.Registry, reg)
	}
	if lock.Version != 1 {
		t.Errorf("lock version = %d, want 1", lock.Version)
	}
}

func TestAddRejectsUnsafeManifestPaths(t *testing.T) {
	tests := []struct {
		name         string
		targetDir    string
		files        []string
		registryDeps []string
		wantField    string
		wantValue    string
	}{
		{
			name:      "escaping targetDir",
			targetDir: "../escape",
			files:     []string{"Button.pzl"},
			wantField: "targetDir",
			wantValue: "../escape",
		},
		{
			name:      "escaping file entry",
			targetDir: "app/components/ui",
			files:     []string{"../../x"},
			wantField: "files",
			wantValue: "../../x",
		},
		{
			name:      "absolute targetDir",
			targetDir: "/escape",
			files:     []string{"Button.pzl"},
			wantField: "targetDir",
			wantValue: "/escape",
		},
		{
			name:         "escaping lib dependency",
			targetDir:    "app/components/ui",
			registryDeps: []string{"lib/../../x.js"},
			wantField:    "registryDependencies",
			wantValue:    "lib/../../x.js",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			reg := buildRegistry(t, pathRegistryJSON(tc.targetDir, tc.files, tc.registryDeps))
			app := newApp(t, true)
			_, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
			if err == nil {
				t.Fatal("expected unsafe manifest path to be rejected")
			}
			for _, want := range []string{`piece "button"`, tc.wantField, tc.wantValue} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q should contain %q", err, want)
				}
			}
			if fileExists(filepath.Join(app, LockFileName)) {
				t.Error("unsafe manifest must not write pieces.lock")
			}
		})
	}

	t.Run("normal piece still installs", func(t *testing.T) {
		reg := buildRegistry(t, pathRegistryJSON("app/components/ui", []string{"Button.pzl"}, nil),
			fixtureFile{"ui/button/Button.pzl", "BUTTON\n"},
		)
		app := newApp(t, true)
		if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)}); err != nil {
			t.Fatalf("normal piece should install: %v", err)
		}
		got, err := os.ReadFile(filepath.Join(app, "app", "components", "ui", "Button.pzl"))
		if err != nil || string(got) != "BUTTON\n" {
			t.Errorf("normal piece output = %q, err=%v", got, err)
		}
	})
}

func TestAddRejectsUnsafeThemePath(t *testing.T) {
	// A registry manifest whose theme escapes the registry root must be rejected
	// before anything is written — otherwise applyTheme (state b) would read the
	// file outside the registry and copy its bytes into app/styles/pieces.css.
	regJSON := `{"version":1,"theme":"../../secret.css","pieces":[
      {"name":"button","description":"","files":["Button.pzl"],"registryDependencies":[],"dependencies":[],"targetDir":"app/components/ui"}]}`
	reg := buildRegistry(t, regJSON, fixtureFile{"ui/button/Button.pzl", "BTN\n"})
	app := newApp(t, false) // unwired styles.css ⇒ the theme would be copied (state b)

	_, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err == nil {
		t.Fatal("expected an unsafe theme path to be rejected")
	}
	for _, want := range []string{"theme", "../../secret.css"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should contain %q", err, want)
		}
	}
	// Errors BEFORE any write: no piece file, no theme file, no lock.
	if fileExists(filepath.Join(app, "app", "components", "ui", "Button.pzl")) {
		t.Error("no piece file should be written when the theme is unsafe")
	}
	if fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("no theme file should be written when the theme is unsafe")
	}
	if fileExists(filepath.Join(app, LockFileName)) {
		t.Error("no lock should be written when the theme is unsafe")
	}
}

func TestDirFetcherRejectsEscapingRel(t *testing.T) {
	// Defense in depth: even if a manifest path slipped past validateManifestPath,
	// the dirFetcher itself must refuse to read outside the registry root.
	base := t.TempDir()
	root := filepath.Join(base, "registry")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// A secret sitting one level above the registry root.
	secret := filepath.Join(base, "escape-secret.txt")
	if err := os.WriteFile(secret, []byte("TOP SECRET\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	f := NewFetcher(root)
	if _, err := f.Fetch("../escape-secret.txt"); err == nil {
		t.Fatal("dirFetcher should refuse a rel that escapes the registry root")
	} else if !strings.Contains(err.Error(), "outside the registry root") {
		t.Errorf("error should explain the containment failure, got: %v", err)
	}

	// A contained rel still reads normally (guarding against an over-broad check).
	write(t, root, "registry.json", singlePieceRegistry)
	got, err := f.Fetch("registry.json")
	if err != nil {
		t.Fatalf("contained fetch should succeed: %v", err)
	}
	if string(got) != singlePieceRegistry {
		t.Errorf("contained fetch returned %q, want the registry body", got)
	}
}

func TestAddRejectsDestinationThroughEscapingSymlink(t *testing.T) {
	reg := buildRegistry(t, pathRegistryJSON("linked", []string{"Button.pzl"}, nil),
		fixtureFile{"ui/button/Button.pzl", "BUTTON\n"},
	)
	app := newApp(t, true)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(app, "linked")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	_, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err == nil {
		t.Fatal("expected an escaping destination symlink to be rejected")
	}
	for _, want := range []string{`piece "button"`, "files", "destination resolves outside the project root"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should contain %q", err, want)
		}
	}
	if fileExists(filepath.Join(outside, "Button.pzl")) {
		t.Error("piece file escaped through the destination symlink")
	}
}

func TestAddLockIsStableIndentedWithTrailingNewline(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "x\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true)
	if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(app, LockFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasSuffix(data, []byte("\n")) {
		t.Error("pieces.lock must end with a trailing newline")
	}
	if !bytes.Contains(data, []byte("\n  \"pieces\": {")) {
		t.Errorf("pieces.lock should be 2-space indented, got:\n%s", data)
	}
}

func TestAddTransitiveResolutionDedupes(t *testing.T) {
	reg := buildRegistry(t, depChainRegistry,
		fixtureFile{"ui/date-picker/DatePicker.pzl", "DATEPICKER\n"},
		fixtureFile{"ui/calendar/Calendar.pzl", "CALENDAR\n"},
		fixtureFile{"lib/date-math.js", "DATEMATH\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	// Marker present so the theme copy stays out of this test's lock-count math —
	// the focus here is piece/lib transitive dedupe, not theme handling.
	app := newApp(t, true)

	res, err := Add(Options{AppRoot: app, Names: []string{"date-picker"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	// All three files copied; lib to app/lib.
	for _, want := range []string{
		"app/components/ui/DatePicker.pzl",
		"app/components/ui/Calendar.pzl",
		"app/lib/date-math.js",
	} {
		if _, err := os.Stat(filepath.Join(app, filepath.FromSlash(want))); err != nil {
			t.Errorf("expected %s copied: %v", want, err)
		}
	}

	// Three lock entries (piece + piece + lib), the lib appears once despite two
	// pieces depending on it.
	lock := readLockFile(t, app)
	if len(lock.Pieces) != 3 {
		t.Errorf("expected 3 lock entries, got %d: %v", len(lock.Pieces), lock.Pieces)
	}
	if _, ok := lock.Pieces["lib/date-math.js"]; !ok {
		t.Error("lock should key the lib by its registry path")
	}

	// Lib unit appears exactly once in the result.
	libCount := 0
	for _, u := range res.Units {
		if u.Name == "lib/date-math.js" {
			libCount++
		}
	}
	if libCount != 1 {
		t.Errorf("lib should be a single unit, got %d", libCount)
	}
}

func TestAddPieceNameVsLibPathDistinction(t *testing.T) {
	reg := buildRegistry(t, depChainRegistry,
		fixtureFile{"ui/date-picker/DatePicker.pzl", "DP\n"},
		fixtureFile{"ui/calendar/Calendar.pzl", "CAL\n"},
		fixtureFile{"lib/date-math.js", "DM\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, false)
	res, err := Add(Options{AppRoot: app, Names: []string{"date-picker"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range res.Units {
		switch u.Name {
		case "calendar":
			if u.IsLib {
				t.Error("calendar is a piece, not a lib")
			}
			if u.Files[0].Rel != "app/components/ui/Calendar.pzl" {
				t.Errorf("calendar dest = %q", u.Files[0].Rel)
			}
		case "lib/date-math.js":
			if !u.IsLib {
				t.Error("lib/date-math.js should be a lib")
			}
			if u.Files[0].Rel != "app/lib/date-math.js" {
				t.Errorf("lib dest = %q", u.Files[0].Rel)
			}
		}
	}
}

func TestAddNpmDepsAccumulateDedupedInOutput(t *testing.T) {
	reg := buildRegistry(t, depChainRegistry,
		fixtureFile{"ui/date-picker/DatePicker.pzl", "DP\n"},
		fixtureFile{"ui/calendar/Calendar.pzl", "CAL\n"},
		fixtureFile{"lib/date-math.js", "DM\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true) // marker present ⇒ no theme advisory noise
	res, err := Add(Options{AppRoot: app, Names: []string{"date-picker"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.NpmDeps) != 1 || res.NpmDeps[0] != "@magic-spells/morph-engine" {
		t.Errorf("npm deps = %v, want [@magic-spells/morph-engine]", res.NpmDeps)
	}
	out := render(res)
	if !strings.Contains(out, "npm install @magic-spells/morph-engine") {
		t.Errorf("output missing npm install line:\n%s", out)
	}
}

// themeFixture is the standard one-piece registry whose theme carries the marker,
// reused across the theme-state tests.
func themeFixture(t *testing.T) string {
	t.Helper()
	return buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "x\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n:root { --brand: #000; }\n"},
	)
}

// State (b): neither the marker nor a pieces.css import present, and no
// app/styles/pieces.css yet — copy the theme verbatim, lock it, advise the import.
func TestAddThemeCopiesAndLocksWhenNeither(t *testing.T) {
	reg := themeFixture(t)
	app := newApp(t, false) // styles.css imports tailwind only — not wired
	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}

	// pieces.css copied verbatim from the registry theme.
	got, err := os.ReadFile(filepath.Join(app, "app", "styles", "pieces.css"))
	if err != nil {
		t.Fatalf("pieces.css not written: %v", err)
	}
	want := "/* puzzle-pieces design tokens */\n:root { --brand: #000; }\n"
	if string(got) != want {
		t.Errorf("pieces.css = %q, want verbatim theme copy", got)
	}

	// Locked as a unit keyed by its registry path, with the sha256 of the copy.
	lock := readLockFile(t, app)
	entry, ok := lock.Pieces["theme/pieces.css"]
	if !ok {
		t.Fatal("lock should carry a theme/pieces.css entry")
	}
	if h := entry.Files["app/styles/pieces.css"]; h != sha(want) {
		t.Errorf("theme lock hash = %q, want %q", h, sha(want))
	}

	// Shown as a ✓ line and advised as a next step.
	out := render(res)
	if !strings.Contains(out, "theme/pieces.css") {
		t.Errorf("summary should show the theme unit, got:\n%s", out)
	}
	if res.Theme == "" || !strings.Contains(res.Theme, "@import './pieces.css';") {
		t.Errorf("expected the @import advisory, got %q", res.Theme)
	}
	if !strings.Contains(out, "app/styles/styles.css") {
		t.Errorf("advisory should name styles.css, got:\n%s", out)
	}
}

// State (b) via a missing styles.css — treated as "not wired".
func TestAddThemeCopiesWhenStylesMissing(t *testing.T) {
	reg := themeFixture(t)
	app := t.TempDir() // no app/styles/styles.css at all
	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if !fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("missing styles.css should still copy the theme to pieces.css")
	}
	if res.Theme == "" {
		t.Error("missing styles.css should still advise the import")
	}
}

// State (a) via the manual-merge marker — quiet, and no pieces.css written.
func TestAddThemeQuietWhenMarkerPresent(t *testing.T) {
	reg := themeFixture(t)
	app := newApp(t, true) // styles.css carries the marker
	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if res.Theme != "" {
		t.Errorf("marker present ⇒ no advisory, got %q", res.Theme)
	}
	if fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("marker present ⇒ pieces.css should not be copied")
	}
	if _, ok := readLockFile(t, app).Pieces["theme/pieces.css"]; ok {
		t.Error("marker present ⇒ no theme entry in the lock")
	}
}

// State (a) via an existing pieces.css import — quiet, and the file is untouched.
func TestAddThemeQuietWhenStylesImportsPiecesCss(t *testing.T) {
	reg := themeFixture(t)
	app := t.TempDir()
	stylesDir := filepath.Join(app, "app", "styles")
	if err := os.MkdirAll(stylesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// styles.css already wires the import; no marker needed.
	if err := os.WriteFile(filepath.Join(stylesDir, "styles.css"),
		[]byte("@import \"tailwindcss\";\n@import './pieces.css';\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A pieces.css the user maintains — must not be overwritten.
	existing := "/* my customized tokens */\n"
	if err := os.WriteFile(filepath.Join(stylesDir, "pieces.css"), []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if res.Theme != "" {
		t.Errorf("import already wired ⇒ no advisory, got %q", res.Theme)
	}
	if got, _ := os.ReadFile(filepath.Join(stylesDir, "pieces.css")); string(got) != existing {
		t.Errorf("pieces.css must be left untouched, got %q", got)
	}
}

// State (c): pieces.css exists but styles.css neither carries the marker nor
// imports it — advise only, never rewrite the existing pieces.css, and it is not
// treated as an overwrite conflict.
func TestAddThemeAdvisesOnlyWhenPiecesCssExistsUnwired(t *testing.T) {
	reg := themeFixture(t)
	app := newApp(t, false) // tailwind-only styles.css, unwired
	piecesPath := filepath.Join(app, "app", "styles", "pieces.css")
	existing := "/* someone's earlier pieces.css */\n"
	if err := os.WriteFile(piecesPath, []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	// Not passing --overwrite: an existing pieces.css must NOT be a pre-flight conflict.
	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatalf("existing pieces.css must not block the add: %v", err)
	}
	if res.Theme == "" || !strings.Contains(res.Theme, "@import './pieces.css';") {
		t.Errorf("expected the import advisory, got %q", res.Theme)
	}
	if got, _ := os.ReadFile(piecesPath); string(got) != existing {
		t.Errorf("existing pieces.css must be left untouched, got %q", got)
	}
	// No theme unit is added — we didn't copy anything.
	if _, ok := readLockFile(t, app).Pieces["theme/pieces.css"]; ok {
		t.Error("no theme entry should be locked when pieces.css already exists")
	}
}

func TestAddOverwriteRefusalListsConflictsWritesNothing(t *testing.T) {
	reg := buildRegistry(t, depChainRegistry,
		fixtureFile{"ui/date-picker/DatePicker.pzl", "NEW-DP\n"},
		fixtureFile{"ui/calendar/Calendar.pzl", "NEW-CAL\n"},
		fixtureFile{"lib/date-math.js", "NEW-DM\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, false)

	// Pre-place a conflicting file (Calendar.pzl) with distinct content.
	calPath := filepath.Join(app, "app", "components", "ui", "Calendar.pzl")
	if err := os.MkdirAll(filepath.Dir(calPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(calPath, []byte("ORIGINAL-CAL\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := Add(Options{AppRoot: app, Names: []string{"date-picker"}, Fetcher: NewFetcher(reg)})
	if err == nil {
		t.Fatal("expected a refusal when a destination exists")
	}
	if !strings.Contains(err.Error(), "app/components/ui/Calendar.pzl") {
		t.Errorf("error should list the conflicting path, got: %v", err)
	}
	if !strings.Contains(err.Error(), "--overwrite") {
		t.Errorf("error should mention --overwrite, got: %v", err)
	}

	// Pre-flight: NOTHING else was written, and the conflicting file is intact.
	if got, _ := os.ReadFile(calPath); string(got) != "ORIGINAL-CAL\n" {
		t.Errorf("conflicting file was modified: %q", got)
	}
	if fileExists(filepath.Join(app, "app", "components", "ui", "DatePicker.pzl")) {
		t.Error("DatePicker.pzl should not have been written (all-or-nothing)")
	}
	if fileExists(filepath.Join(app, "app", "lib", "date-math.js")) {
		t.Error("lib should not have been written (all-or-nothing)")
	}
	if fileExists(filepath.Join(app, LockFileName)) {
		t.Error("pieces.lock should not have been written on refusal")
	}
}

func TestAddOverwriteReplacesAndUpdatesLock(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "NEW\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true)
	btn := filepath.Join(app, "app", "components", "ui", "Button.pzl")
	if err := os.MkdirAll(filepath.Dir(btn), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(btn, []byte("OLD\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg), Overwrite: true}); err != nil {
		t.Fatalf("Add with overwrite: %v", err)
	}
	if got, _ := os.ReadFile(btn); string(got) != "NEW\n" {
		t.Errorf("overwrite should replace content, got %q", got)
	}
	lock := readLockFile(t, app)
	if got := lock.Pieces["button"].Files["app/components/ui/Button.pzl"]; got != sha("NEW\n") {
		t.Errorf("lock hash should reflect new content, got %q", got)
	}
}

func TestAddLockMergePreservesExistingEntries(t *testing.T) {
	// First add "button".
	regA := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "B\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true)
	if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(regA)}); err != nil {
		t.Fatal(err)
	}

	// Then add "card" from a different registry; button's entry must survive.
	regB := buildRegistry(t, `{"version":1,"theme":"theme/pieces.css","pieces":[{"name":"card","description":"","files":["Card.pzl"],"registryDependencies":[],"dependencies":[],"targetDir":"app/components/ui"}]}`,
		fixtureFile{"ui/card/Card.pzl", "C\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	if _, err := Add(Options{AppRoot: app, Names: []string{"card"}, Fetcher: NewFetcher(regB)}); err != nil {
		t.Fatal(err)
	}
	lock := readLockFile(t, app)
	if _, ok := lock.Pieces["button"]; !ok {
		t.Error("re-adding should preserve the earlier button entry")
	}
	if _, ok := lock.Pieces["card"]; !ok {
		t.Error("new card entry should be present")
	}
}

func TestAddMalformedLockErrors(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "x\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true)
	if err := os.WriteFile(filepath.Join(app, LockFileName), []byte("{ not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err == nil || !strings.Contains(err.Error(), "malformed") {
		t.Fatalf("expected a malformed-lock error, got: %v", err)
	}
}

func TestAddUnknownPieceSuggestsDidYouMean(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"ui/button/Button.pzl", "x\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, false)
	_, err := Add(Options{AppRoot: app, Names: []string{"buton"}, Fetcher: NewFetcher(reg)})
	if err == nil {
		t.Fatal("expected an unknown-piece error")
	}
	if !strings.Contains(err.Error(), "buton") || !strings.Contains(err.Error(), `"button"`) {
		t.Errorf("expected did-you-mean button, got: %v", err)
	}
	// An unknown-name failure must write nothing.
	if fileExists(filepath.Join(app, LockFileName)) {
		t.Error("no lock should be written when a name is unknown")
	}
}

func TestAddHTTPFetcher(t *testing.T) {
	files := map[string]string{
		"/registry.json":        singlePieceRegistry,
		"/ui/button/Button.pzl": "HTTP-BUTTON\n",
		"/theme/pieces.css":     "/* puzzle-pieces design tokens */\n",
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	app := newApp(t, true)
	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(srv.URL)})
	if err != nil {
		t.Fatalf("Add over http: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(app, "app", "components", "ui", "Button.pzl"))
	if err != nil || string(got) != "HTTP-BUTTON\n" {
		t.Errorf("http-fetched file wrong: %q err=%v", got, err)
	}
	if res.Source != strings.TrimRight(srv.URL, "/") {
		t.Errorf("source = %q, want %q", res.Source, srv.URL)
	}
}

func TestAddHTTPFetcherNon200NamesURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	f := NewFetcher(srv.URL)
	_, err := f.Fetch("registry.json")
	if err == nil || !strings.Contains(err.Error(), srv.URL+"/registry.json") {
		t.Fatalf("expected error naming the URL, got: %v", err)
	}
}

func TestResolveSourcePrecedence(t *testing.T) {
	// flag wins over env and default.
	t.Setenv("PUZZLE_PIECES_REGISTRY", "/env/path")
	if got := ResolveSource("/flag/path"); got != "/flag/path" {
		t.Errorf("flag should win, got %q", got)
	}
	// env wins over default.
	if got := ResolveSource(""); got != "/env/path" {
		t.Errorf("env should win over default, got %q", got)
	}
	// default when both empty.
	os.Unsetenv("PUZZLE_PIECES_REGISTRY")
	if got := ResolveSource(""); got != defaultRegistry {
		t.Errorf("default expected, got %q", got)
	}
}

func TestNewFetcherKind(t *testing.T) {
	if _, ok := NewFetcher("https://example.com/r").(*httpFetcher); !ok {
		t.Error("https source should give an httpFetcher")
	}
	if _, ok := NewFetcher("/local/dir").(*dirFetcher); !ok {
		t.Error("local path should give a dirFetcher")
	}
}

func TestCycleSafeResolution(t *testing.T) {
	// a → b → a: must terminate and copy both once.
	reg := buildRegistry(t, `{"version":1,"theme":"theme/pieces.css","pieces":[
      {"name":"a","description":"","files":["A.pzl"],"registryDependencies":["b"],"dependencies":[],"targetDir":"app/components/ui"},
      {"name":"b","description":"","files":["B.pzl"],"registryDependencies":["a"],"dependencies":[],"targetDir":"app/components/ui"}]}`,
		fixtureFile{"ui/a/A.pzl", "A\n"},
		fixtureFile{"ui/b/B.pzl", "B\n"},
		fixtureFile{"theme/pieces.css", "/* puzzle-pieces design tokens */\n"},
	)
	app := newApp(t, true)
	res, err := Add(Options{AppRoot: app, Names: []string{"a"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatalf("cyclic resolution should terminate: %v", err)
	}
	if len(res.Units) != 2 {
		t.Errorf("expected 2 units for a cycle, got %d", len(res.Units))
	}
}

// --- helpers ------------------------------------------------------------------

func readLockFile(t *testing.T, app string) *Lock {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(app, LockFileName))
	if err != nil {
		t.Fatalf("reading lock: %v", err)
	}
	var lock Lock
	if err := json.Unmarshal(data, &lock); err != nil {
		t.Fatalf("lock not valid JSON: %v", err)
	}
	return &lock
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// failFetcher errors on every Fetch while reporting an arbitrary Source, so the
// default-registry hint path is testable without touching the network.
type failFetcher struct{ source string }

func (f *failFetcher) Fetch(rel string) ([]byte, error) {
	return nil, fmt.Errorf("fetching %s/%s: HTTP 404", f.source, rel)
}
func (f *failFetcher) Source() string        { return f.source }
func (f *failFetcher) Ref(rel string) string { return f.source + "/" + rel }

func TestAddDefaultRegistryFailureHintsAtOverrides(t *testing.T) {
	// The default public source failing must name both overrides — that error is
	// the first thing a pre-publish user sees with no env var set.
	_, err := Add(Options{AppRoot: t.TempDir(), Names: []string{"button"}, Fetcher: &failFetcher{source: defaultRegistry}})
	if err == nil {
		t.Fatal("expected error")
	}
	for _, want := range []string{"--registry", "PUZZLE_PIECES_REGISTRY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("default-source error should mention %s, got: %v", want, err)
		}
	}
	// A non-default source keeps the plain error: the user chose it, no hint needed.
	_, err = Add(Options{AppRoot: t.TempDir(), Names: []string{"button"}, Fetcher: &failFetcher{source: "/my/registry"}})
	if err == nil || strings.Contains(err.Error(), "PUZZLE_PIECES_REGISTRY") {
		t.Errorf("non-default source should not carry the override hint, got: %v", err)
	}
}
