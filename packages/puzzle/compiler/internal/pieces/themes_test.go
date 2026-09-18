package pieces

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// --- fixtures -----------------------------------------------------------------

// multiThemeRegistry mirrors the shape puzzle-pieces ships: one default palette
// (the entry whose file IS registry.theme) plus alternates, and the mode set.
const multiThemeRegistry = `{
  "version": 1,
  "theme": "theme/pieces.css",
  "modes": ["light", "medium", "dark"],
  "themes": [
    {"name":"default","file":"theme/pieces.css","label":"Default","description":"The default palette."},
    {"name":"dim","file":"theme/dim.css","label":"Dim","description":"The low-contrast palette."},
    {"name":"void","file":"theme/void.css","label":"Void","description":"The monochrome palette."}
  ],
  "pieces": [
    {"name":"button","description":"A button","files":["Button.pzl"],"registryDependencies":[],"dependencies":[],"targetDir":"app/components/ui"}
  ]
}`

const (
	defaultThemeCSS = "/* puzzle-pieces design tokens */\n:root { --brand: #000; }\n"
	dimThemeCSS     = "/* dim */\n:root { --brand: #123; }\n"
	voidThemeCSS    = "/* void */\n:root { --brand: #fff; }\n"
)

// multiThemeFixture is the registry every theme test copies from.
func multiThemeFixture(t *testing.T) string {
	t.Helper()
	return buildRegistry(t, multiThemeRegistry,
		fixtureFile{"ui/button/Button.pzl", "x\n"},
		fixtureFile{"theme/pieces.css", defaultThemeCSS},
		fixtureFile{"theme/dim.css", dimThemeCSS},
		fixtureFile{"theme/void.css", voidThemeCSS},
	)
}

// themeOpts is the standard ThemeOptions for a fixture registry and app.
func themeOpts(reg, app string, names ...string) ThemeOptions {
	return ThemeOptions{AppRoot: app, Names: names, Fetcher: NewFetcher(reg)}
}

func renderThemes(res *ThemeResult) string {
	var buf bytes.Buffer
	RenderThemeSummary(&buf, plainPrinter(), res)
	return buf.String()
}

func renderListing(l *ThemeListing) string {
	var buf bytes.Buffer
	RenderThemeListing(&buf, plainPrinter(), l)
	return buf.String()
}

// writeStyles replaces the app's styles.css with the given body.
func writeStyles(t *testing.T, app, css string) {
	t.Helper()
	write(t, app, "app/styles/styles.css", css)
}

// themeState returns the outcome recorded for one theme name.
func themeState(t *testing.T, res *ThemeResult, name string) ThemeOutcome {
	t.Helper()
	for _, o := range res.Themes {
		if o.Name == name {
			return o
		}
	}
	t.Fatalf("no outcome for theme %q in %+v", name, res.Themes)
	return ThemeOutcome{}
}

// --- happy path ----------------------------------------------------------------

func TestAddThemeCopiesAndLocksNamedTheme(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)

	res, err := AddThemes(themeOpts(reg, app, "dim"))
	if err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(app, "app", "styles", "themes", "dim.css"))
	if err != nil {
		t.Fatalf("dim.css not written: %v", err)
	}
	if string(got) != dimThemeCSS {
		t.Errorf("dim.css = %q, want a verbatim copy", got)
	}
	if st := themeState(t, res, "dim").State; st != ThemeCopied {
		t.Errorf("state = %q, want %q", st, ThemeCopied)
	}

	// Locked as a unit keyed by its REGISTRY path, same shape as the default.
	lock := readLockFile(t, app)
	entry, ok := lock.Pieces["theme/dim.css"]
	if !ok {
		t.Fatalf("lock should carry a theme/dim.css entry, got %+v", lock.Pieces)
	}
	if h := entry.Files["app/styles/themes/dim.css"]; h != sha(dimThemeCSS) {
		t.Errorf("lock hash = %q, want %q", h, sha(dimThemeCSS))
	}

	out := renderThemes(res)
	for _, want := range []string{
		"app/styles/themes/dim.css",
		"add `@import './themes/dim.css';` to app/styles/styles.css (after `@import './pieces.css';`)",
		`switch with data-scheme="dim" on <html>; modes: data-theme="light|medium|dark"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("summary missing %q, got:\n%s", want, out)
		}
	}
}

func TestAddThemeCopiesTwoAndPrintsOneSwitchLine(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)

	res, err := AddThemes(themeOpts(reg, app, "dim", "void"))
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"dim", "void"} {
		if !fileExists(filepath.Join(app, "app", "styles", "themes", name+".css")) {
			t.Errorf("%s.css not written", name)
		}
	}
	out := renderThemes(res)
	// The switch advisory is printed once for the run, not per palette.
	if n := strings.Count(out, "switch with data-scheme="); n != 1 {
		t.Errorf("switch advisory printed %d times, want 1:\n%s", n, out)
	}
	if !strings.Contains(out, `data-scheme="<name>"`) {
		t.Errorf("multi-theme run should keep the name a placeholder, got:\n%s", out)
	}
	if !strings.Contains(out, "./themes/dim.css") || !strings.Contains(out, "./themes/void.css") {
		t.Errorf("both import lines should be printed, got:\n%s", out)
	}
}

// A repeated name is copied once, not twice.
func TestAddThemeDedupesRepeatedName(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	res, err := AddThemes(themeOpts(reg, app, "dim", "dim"))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Themes) != 1 {
		t.Errorf("outcomes = %d, want 1: %+v", len(res.Themes), res.Themes)
	}
}

// --- default-theme parity with `add piece` --------------------------------------

func TestAddThemeDefaultMatchesAddPiece(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)

	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	piecesCSS := filepath.Join(app, "app", "styles", "pieces.css")
	got, err := os.ReadFile(piecesCSS)
	if err != nil {
		t.Fatalf("pieces.css not written: %v", err)
	}
	if string(got) != defaultThemeCSS {
		t.Errorf("pieces.css = %q, want the default theme verbatim", got)
	}
	if rel := themeState(t, res, "default").Rel; rel != "app/styles/pieces.css" {
		t.Errorf("default destination = %q, want app/styles/pieces.css", rel)
	}
	if lock := readLockFile(t, app); lock.Pieces["theme/pieces.css"].Files["app/styles/pieces.css"] != sha(defaultThemeCSS) {
		t.Errorf("default theme lock entry missing/wrong: %+v", lock.Pieces)
	}

	// `add piece` afterwards must be a no-op on the same file — the two commands
	// converge on one pieces.css and one lock key.
	if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)}); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(piecesCSS)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != defaultThemeCSS {
		t.Errorf("add piece rewrote pieces.css: %q", after)
	}
	lock := readLockFile(t, app)
	if _, ok := lock.Pieces["theme/pieces.css"]; !ok {
		t.Errorf("lock lost the theme entry: %+v", lock.Pieces)
	}
	if len(lock.Pieces) != 2 { // the theme and "button"
		t.Errorf("lock keys = %+v, want exactly the theme and the piece", lock.Pieces)
	}
}

// The other direction: `add piece` first, then `add theme default` finds it
// already installed and only repeats the import advisory.
func TestAddThemeDefaultAfterAddPieceIsUpToDate(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	if _, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)}); err != nil {
		t.Fatal(err)
	}
	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "default").State; st != ThemeUpToDate {
		t.Errorf("state = %q, want %q", st, ThemeUpToDate)
	}
	if out := renderThemes(res); !strings.Contains(out, "@import './pieces.css';") {
		t.Errorf("the import advisory should still be printed, got:\n%s", out)
	}
}

// styles.css carrying the tokens (the hand-merge marker) means there is nothing
// to do for the default palette at all.
func TestAddThemeDefaultQuietWhenMarkerPresent(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, true) // styles.css carries the marker
	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "default").State; st != ThemeWired {
		t.Errorf("state = %q, want %q", st, ThemeWired)
	}
	if fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("a wired app should not get a pieces.css copy")
	}
	if len(res.NextSteps) != 0 {
		t.Errorf("nothing to wire, got next steps %+v", res.NextSteps)
	}
}

// --- unknown names --------------------------------------------------------------

func TestAddThemeUnknownNameWritesNothing(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)

	// "dim" is valid and comes FIRST: the run must still write nothing.
	_, err := AddThemes(themeOpts(reg, app, "dim", "nope"))
	if err == nil {
		t.Fatal("expected an error for an unknown theme")
	}
	for _, want := range []string{`unknown theme "nope"`, "default, dim, void"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q should contain %q", err, want)
		}
	}
	if fileExists(filepath.Join(app, "app", "styles", "themes", "dim.css")) {
		t.Error("an unknown name must leave the valid ones unwritten")
	}
	if fileExists(filepath.Join(app, LockFileName)) {
		t.Error("an unknown name must not write pieces.lock")
	}
}

func TestAddThemeUnknownNameSuggestsDidYouMean(t *testing.T) {
	reg := multiThemeFixture(t)
	_, err := AddThemes(themeOpts(reg, newApp(t, false), "dimm"))
	if err == nil || !strings.Contains(err.Error(), `did you mean "dim"?`) {
		t.Fatalf("expected a did-you-mean, got: %v", err)
	}
}

// Names are exact and case-sensitive — "Dim" is not "dim".
func TestAddThemeNamesAreCaseSensitive(t *testing.T) {
	reg := multiThemeFixture(t)
	_, err := AddThemes(themeOpts(reg, newApp(t, false), "Dim"))
	if err == nil || !strings.Contains(err.Error(), `unknown theme "Dim"`) {
		t.Fatalf("expected an unknown-theme error, got: %v", err)
	}
}

// --- already installed ------------------------------------------------------------

func TestAddThemeUpToDateSkipsSecondRun(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	if _, err := AddThemes(themeOpts(reg, app, "dim")); err != nil {
		t.Fatal(err)
	}
	res, err := AddThemes(themeOpts(reg, app, "dim"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "dim").State; st != ThemeUpToDate {
		t.Errorf("state = %q, want %q", st, ThemeUpToDate)
	}
	if len(res.NextSteps) != 0 {
		t.Errorf("nothing copied, so no next steps; got %+v", res.NextSteps)
	}
}

func TestAddThemeDivergedRefusesThenOverwrites(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	if _, err := AddThemes(themeOpts(reg, app, "dim")); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(app, "app", "styles", "themes", "dim.css")
	if err := os.WriteFile(dest, []byte("/* my edit */\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := AddThemes(themeOpts(reg, app, "dim"))
	if err == nil {
		t.Fatal("expected a refusal for a locally modified theme")
	}
	if !strings.Contains(err.Error(), "--overwrite") || !strings.Contains(err.Error(), "app/styles/themes/dim.css") {
		t.Errorf("refusal should name the file and --overwrite, got: %v", err)
	}
	if got, _ := os.ReadFile(dest); string(got) != "/* my edit */\n" {
		t.Errorf("the refused run must not touch the file, got %q", got)
	}

	opts := themeOpts(reg, app, "dim")
	opts.Overwrite = true
	if _, err := AddThemes(opts); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(dest); string(got) != dimThemeCSS {
		t.Errorf("--overwrite should restore the registry copy, got %q", got)
	}
}

// One refused palette refuses the whole run — the other is not written either.
func TestAddThemeRefusalIsAllOrNothing(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	write(t, app, "app/styles/themes/dim.css", "/* mine */\n")

	if _, err := AddThemes(themeOpts(reg, app, "dim", "void")); err == nil {
		t.Fatal("expected a refusal")
	}
	if fileExists(filepath.Join(app, "app", "styles", "themes", "void.css")) {
		t.Error("a refusal must leave the other palettes unwritten")
	}
}

func TestAddThemeSymlinkedDestinationRefused(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevation on Windows")
	}
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	target := filepath.Join(app, "shared-dim.css")
	if err := os.WriteFile(target, []byte("/* linked */\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(app, "app", "styles", "themes"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(app, "app", "styles", "themes", "dim.css")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	_, err := AddThemes(themeOpts(reg, app, "dim"))
	if err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("expected a symlink refusal, got: %v", err)
	}
	if got, _ := os.ReadFile(target); string(got) != "/* linked */\n" {
		t.Errorf("the link target must be untouched, got %q", got)
	}

	// --overwrite is explicit intent: write THROUGH the link, never replace it.
	opts := themeOpts(reg, app, "dim")
	opts.Overwrite = true
	if _, err := AddThemes(opts); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Error("--overwrite replaced the symlink instead of writing through it")
	}
	if got, _ := os.ReadFile(target); string(got) != dimThemeCSS {
		t.Errorf("link target = %q, want the registry copy", got)
	}
}

// --- wired via the package import ---------------------------------------------------

func TestAddThemeSkipsWhenImportedFromPackage(t *testing.T) {
	for _, tc := range []struct{ name, quote string }{
		{"double quotes", `"`},
		{"single quotes", `'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reg := multiThemeFixture(t)
			app := newApp(t, false)
			writeStyles(t, app, "@import \"tailwindcss\";\n@import "+
				tc.quote+"@magic-spells/puzzle-pieces/themes/dim.css"+tc.quote+";\n")

			res, err := AddThemes(themeOpts(reg, app, "dim"))
			if err != nil {
				t.Fatal(err)
			}
			if st := themeState(t, res, "dim").State; st != ThemeWiredViaPackage {
				t.Errorf("state = %q, want %q", st, ThemeWiredViaPackage)
			}
			if fileExists(filepath.Join(app, "app", "styles", "themes", "dim.css")) {
				t.Error("a package-imported palette must not be copied")
			}
			if len(res.NextSteps) != 0 {
				t.Errorf("nothing to wire, got %+v", res.NextSteps)
			}
		})
	}
}

// The same rule for the DEFAULT palette, through `add piece`: an app importing
// themes/default.css from the package must stop getting a pieces.css copy.
func TestAddPieceSkipsThemeWhenDefaultImportedFromPackage(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	writeStyles(t, app, "@import \"tailwindcss\";\n@import '@magic-spells/puzzle-pieces/themes/default.css';\n")

	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("add piece should not copy pieces.css beside the package import")
	}
	if res.Theme != "" {
		t.Errorf("no advisory expected, got %q", res.Theme)
	}
}

func TestAddThemeDefaultReportsPackageWiring(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	writeStyles(t, app, "@import \"tailwindcss\";\n@import \"@magic-spells/puzzle-pieces/themes/default.css\";\n")

	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "default").State; st != ThemeWiredViaPackage {
		t.Errorf("state = %q, want %q", st, ThemeWiredViaPackage)
	}
}

// --- manifest validation -------------------------------------------------------------

func TestAddThemeRejectsUnsafeThemeFile(t *testing.T) {
	for _, bad := range []string{"../../.env", "/etc/passwd", "theme/../../x.css", `theme\dim.css`} {
		t.Run(bad, func(t *testing.T) {
			regJSON := `{"version":1,"theme":"theme/pieces.css","themes":[` +
				`{"name":"dim","file":"` + strings.ReplaceAll(bad, `\`, `\\`) + `","label":"Dim","description":""}],"pieces":[]}`
			reg := buildRegistry(t, regJSON, fixtureFile{"theme/pieces.css", defaultThemeCSS})
			app := newApp(t, false)
			_, err := AddThemes(themeOpts(reg, app, "dim"))
			if err == nil || !strings.Contains(err.Error(), "themes[].file") {
				t.Fatalf("expected a themes[].file rejection, got: %v", err)
			}
			if fileExists(filepath.Join(app, LockFileName)) {
				t.Error("a rejected manifest must write nothing")
			}
		})
	}
}

// A name is one path SEGMENT — it can never carry a directory.
func TestAddThemeRejectsUnsafeThemeName(t *testing.T) {
	for _, bad := range []string{"../evil", "sub/dim", ""} {
		t.Run(bad, func(t *testing.T) {
			regJSON := `{"version":1,"theme":"theme/pieces.css","themes":[` +
				`{"name":"` + bad + `","file":"theme/dim.css","label":"","description":""}],"pieces":[]}`
			reg := buildRegistry(t, regJSON, fixtureFile{"theme/dim.css", dimThemeCSS})
			if _, err := AddThemes(themeOpts(reg, newApp(t, false), "dim")); err == nil ||
				!strings.Contains(err.Error(), "invalid theme name") {
				t.Fatalf("expected a theme-name rejection, got: %v", err)
			}
		})
	}
}

// A registry predating the `themes` array still offers its single default one.
func TestAddThemeFallsBackToRegistryThemeWhenNoThemesArray(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry,
		fixtureFile{"theme/pieces.css", defaultThemeCSS},
	)
	app := newApp(t, false)
	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "default").State; st != ThemeCopied {
		t.Errorf("state = %q, want %q", st, ThemeCopied)
	}
	if !fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("the synthesized default should still copy pieces.css")
	}
}

// --- listing -----------------------------------------------------------------------

func TestListThemesReportsStatePerTheme(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	// dim installed, void imported from the package, default untouched.
	write(t, app, "app/styles/themes/dim.css", dimThemeCSS)
	writeStyles(t, app, "@import \"tailwindcss\";\n@import \"@magic-spells/puzzle-pieces/themes/void.css\";\n")

	listing, err := ListThemes(themeOpts(reg, app))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]ThemeState{
		"default": ThemeAbsent,
		"dim":     ThemeInstalled,
		"void":    ThemeWiredViaPackage,
	}
	if len(listing.Themes) != len(want) {
		t.Fatalf("listed %d themes, want %d", len(listing.Themes), len(want))
	}
	for _, o := range listing.Themes {
		if o.State != want[o.Name] {
			t.Errorf("%s state = %q, want %q", o.Name, o.State, want[o.Name])
		}
	}

	got := renderListing(listing)
	expected := "puzzle add theme · " + reg + `
  default Default · —
          The default palette.
  dim     Dim · installed
          The low-contrast palette.
  void    Void · wired via package
          The monochrome palette.

  Install · puzzle add theme <name…>
  Modes · data-theme="light|medium|dark"
`
	if got != expected {
		t.Errorf("listing output:\n%s\nwant:\n%s", got, expected)
	}
}

// The default palette hand-merged into styles.css reads as wired, not absent.
func TestListThemesReportsHandMergedDefaultAsWired(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, true) // styles.css carries the token marker
	listing, err := ListThemes(themeOpts(reg, app))
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range listing.Themes {
		if o.Name == "default" && o.State != ThemeWired {
			t.Errorf("default state = %q, want %q", o.State, ThemeWired)
		}
	}
}

// A registry omitting `modes` still prints the three modes the themes implement.
func TestListThemesFallsBackToDefaultModes(t *testing.T) {
	reg := buildRegistry(t, singlePieceRegistry, fixtureFile{"theme/pieces.css", defaultThemeCSS})
	listing, err := ListThemes(themeOpts(reg, newApp(t, false)))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(listing.Modes, "|") != "light|medium|dark" {
		t.Errorf("modes = %v, want the built-in three", listing.Modes)
	}
}

// --- the default palette obeys the same already-installed rules -------------------

// planTheme state (c) — pieces.css present but unwired — used to report "up to
// date" without ever hashing it, so a locally edited pieces.css read as current
// and --overwrite did nothing. `add theme default` now behaves like `add theme
// dim`: refuse the modified copy, replace it under --overwrite.
func TestAddThemeDefaultModifiedRefusesThenOverwrites(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	write(t, app, "app/styles/pieces.css", "/* my tokens */\n")

	_, err := AddThemes(themeOpts(reg, app, "default"))
	if err == nil {
		t.Fatal("expected a refusal for a modified pieces.css")
	}
	if !strings.Contains(err.Error(), "app/styles/pieces.css") || !strings.Contains(err.Error(), "--overwrite") {
		t.Errorf("refusal should name the file and --overwrite, got: %v", err)
	}
	dest := filepath.Join(app, "app", "styles", "pieces.css")
	if got, _ := os.ReadFile(dest); string(got) != "/* my tokens */\n" {
		t.Errorf("the refused run must not touch pieces.css, got %q", got)
	}

	opts := themeOpts(reg, app, "default")
	opts.Overwrite = true
	res, err := AddThemes(opts)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(dest); string(got) != defaultThemeCSS {
		t.Errorf("--overwrite should restore the registry copy, got %q", got)
	}
	if st := themeState(t, res, "default").State; st != ThemeCopied {
		t.Errorf("state = %q, want %q", st, ThemeCopied)
	}
	// The replacement is locked like any other copy.
	if lock := readLockFile(t, app); lock.Pieces["theme/pieces.css"].Files["app/styles/pieces.css"] != sha(defaultThemeCSS) {
		t.Errorf("lock not updated after --overwrite: %+v", lock.Pieces)
	}
}

// A hand-copied pieces.css that happens to be byte-identical is up to date even
// with no lock entry to vouch for it — there is nothing to write and nothing of
// the user's to lose.
func TestAddThemeDefaultIdenticalWithoutLockIsUpToDate(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	write(t, app, "app/styles/pieces.css", defaultThemeCSS)

	res, err := AddThemes(themeOpts(reg, app, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "default").State; st != ThemeUpToDate {
		t.Errorf("state = %q, want %q", st, ThemeUpToDate)
	}
	if fileExists(filepath.Join(app, LockFileName)) {
		t.Error("nothing was copied, so nothing should have been locked")
	}
	if out := renderThemes(res); !strings.Contains(out, "@import './pieces.css';") {
		t.Errorf("an unwired pieces.css should still be advised, got:\n%s", out)
	}
}

// The same for a named palette: identical bytes, no lock entry, no refusal.
func TestAddThemeNamedIdenticalWithoutLockIsUpToDate(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	write(t, app, "app/styles/themes/dim.css", dimThemeCSS)

	res, err := AddThemes(themeOpts(reg, app, "dim"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "dim").State; st != ThemeUpToDate {
		t.Errorf("state = %q, want %q", st, ThemeUpToDate)
	}
}

// --- a commented-out import is not wiring -------------------------------------------

func TestAddThemeCommentedOutImportIsNotWired(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	writeStyles(t, app, "@import \"tailwindcss\";\n"+
		"/* @import \"@magic-spells/puzzle-pieces/themes/dim.css\"; */\n")

	res, err := AddThemes(themeOpts(reg, app, "dim"))
	if err != nil {
		t.Fatal(err)
	}
	if st := themeState(t, res, "dim").State; st != ThemeCopied {
		t.Errorf("state = %q, want %q — a commented-out import is turned off", st, ThemeCopied)
	}
	if !fileExists(filepath.Join(app, "app", "styles", "themes", "dim.css")) {
		t.Error("the palette should have been copied")
	}
}

// The same for the DEFAULT palette, through `add piece`: a commented-out package
// import must not suppress the pieces.css copy.
func TestAddPieceCommentedOutDefaultImportStillCopiesTheme(t *testing.T) {
	reg := multiThemeFixture(t)
	app := newApp(t, false)
	writeStyles(t, app, "@import \"tailwindcss\";\n"+
		"/* @import '@magic-spells/puzzle-pieces/themes/default.css'; */\n")

	res, err := Add(Options{AppRoot: app, Names: []string{"button"}, Fetcher: NewFetcher(reg)})
	if err != nil {
		t.Fatal(err)
	}
	if !fileExists(filepath.Join(app, "app", "styles", "pieces.css")) {
		t.Error("a commented-out import should not suppress the pieces.css copy")
	}
	if res.Theme == "" {
		t.Error("expected the import advisory")
	}
}

// A mention outside an @import statement is not wiring either.
func TestThemeImportedFromPackageRequiresAnImportStatement(t *testing.T) {
	spec := "@magic-spells/puzzle-pieces/themes/dim.css"
	for _, tc := range []struct {
		name  string
		css   string
		wired bool
	}{
		{"double quotes", `@import "` + spec + `";`, true},
		{"single quotes", `@import '` + spec + `';`, true},
		{"layered import", `@import "` + spec + `" layer(theme);`, true},
		{"block comment", `/* @import "` + spec + `"; */`, false},
		{"multi-line comment", "/*\n@import \"" + spec + "\";\n*/", false},
		{"bare mention", `.a { content: "` + spec + `"; }`, false},
		{"unterminated comment", `/* @import "` + spec + `";`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := themeImportedFromPackage(tc.css, "dim"); got != tc.wired {
				t.Errorf("themeImportedFromPackage(%q) = %v, want %v", tc.css, got, tc.wired)
			}
		})
	}
}
