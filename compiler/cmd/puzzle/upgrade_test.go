package main

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/update"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// testLatest is the stubbed registry "latest" for tests that exercise the
// newer-version-available flow. It must always compare newer than
// version.Version — a literal current version here silently flips these tests
// onto the up-to-date short-circuit the moment the real version catches up
// (which is exactly what happened when 0.2.0 was hardcoded).
const testLatest = "99.0.0"

func TestFindProjectInstall(t *testing.T) {
	tests := []struct {
		name      string
		lockfile  string
		field     string
		manager   string
		wantDev   bool
		fromChild bool
	}{
		{name: "pnpm dependency", lockfile: "pnpm-lock.yaml", field: "dependencies", manager: "pnpm"},
		{name: "yarn dev dependency", lockfile: "yarn.lock", field: "devDependencies", manager: "yarn", wantDev: true},
		{name: "bun text lock", lockfile: "bun.lock", field: "dependencies", manager: "bun"},
		{name: "bun binary lock", lockfile: "bun.lockb", field: "devDependencies", manager: "bun", wantDev: true},
		{name: "npm lock", lockfile: "package-lock.json", field: "dependencies", manager: "npm"},
		{name: "npm default and walk up", field: "devDependencies", manager: "npm", wantDev: true, fromChild: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			mustWrite(t, filepath.Join(root, "package.json"), `{"`+tt.field+`":{"@magic-spells/puzzle":"^0.1.0"}}`)
			if tt.lockfile != "" {
				mustWrite(t, filepath.Join(root, tt.lockfile), "")
			}
			start := root
			if tt.fromChild {
				start = filepath.Join(root, "app", "nested")
				if err := os.MkdirAll(start, 0o755); err != nil {
					t.Fatal(err)
				}
			}

			got, found, err := findProjectInstall(start)
			if err != nil {
				t.Fatal(err)
			}
			if !found {
				t.Fatal("project install not found")
			}
			if got.dir != root || got.manager != tt.manager || got.dev != tt.wantDev {
				t.Fatalf("context = %#v, want dir=%q manager=%q dev=%v", got, root, tt.manager, tt.wantDev)
			}
		})
	}
}

func TestDetectInstallContextWithoutProject(t *testing.T) {
	dir := t.TempDir()
	ctx, err := detectInstallContext(dir, filepath.Join(dir, "bin", "puzzle"))
	if err != nil {
		t.Fatal(err)
	}
	if ctx.kind != installManual {
		t.Fatalf("context = %#v, want manual install", ctx)
	}

	pnpmExecutable := filepath.Join(dir, "pnpm", "node_modules", "@magic-spells", "puzzle", "bin", "puzzle")
	ctx, err = detectInstallContext(dir, pnpmExecutable)
	if err != nil {
		t.Fatal(err)
	}
	if ctx.kind != installGlobal || ctx.manager != "pnpm" {
		t.Fatalf("context = %#v, want global pnpm", ctx)
	}
}

func TestUpgradeCommandArguments(t *testing.T) {
	tests := []struct {
		name    string
		ctx     installContext
		wantBin string
		want    []string
	}{
		{name: "npm dependency", ctx: installContext{kind: installProject, manager: "npm"}, wantBin: "npm", want: []string{"install", "@magic-spells/puzzle@0.2.0"}},
		{name: "npm dev dependency", ctx: installContext{kind: installProject, manager: "npm", dev: true}, wantBin: "npm", want: []string{"install", "--save-dev", "@magic-spells/puzzle@0.2.0"}},
		{name: "pnpm dev dependency", ctx: installContext{kind: installProject, manager: "pnpm", dev: true}, wantBin: "pnpm", want: []string{"add", "-D", "@magic-spells/puzzle@0.2.0"}},
		{name: "yarn dev dependency", ctx: installContext{kind: installProject, manager: "yarn", dev: true}, wantBin: "yarn", want: []string{"add", "-D", "@magic-spells/puzzle@0.2.0"}},
		{name: "bun dev dependency", ctx: installContext{kind: installProject, manager: "bun", dev: true}, wantBin: "bun", want: []string{"add", "-d", "@magic-spells/puzzle@0.2.0"}},
		{name: "global npm", ctx: installContext{kind: installGlobal, manager: "npm"}, wantBin: "npm", want: []string{"install", "-g", "@magic-spells/puzzle@0.2.0"}},
		{name: "global pnpm", ctx: installContext{kind: installGlobal, manager: "pnpm"}, wantBin: "pnpm", want: []string{"add", "-g", "@magic-spells/puzzle@0.2.0"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bin, args := upgradeCommand(tt.ctx, "0.2.0")
			if bin != tt.wantBin || !reflect.DeepEqual(args, tt.want) {
				t.Fatalf("command = %s %#v, want %s %#v", bin, args, tt.wantBin, tt.want)
			}
		})
	}
}

func TestUpgradeCheckOnlyReports(t *testing.T) {
	oldFetchLatest := fetchLatest
	fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
	t.Cleanup(func() { fetchLatest = oldFetchLatest })

	oldCacheDir := update.CacheDir
	update.CacheDir = t.TempDir()
	t.Cleanup(func() { update.CacheDir = oldCacheDir })

	var stdout, stderr bytes.Buffer
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), t.TempDir(), "", true, emptyHomeEnvironment(t)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout.String(), "puzzle "+testLatest+" available (current "+version.Version+")") {
		t.Fatalf("check output missing version comparison:\n%s", stdout.String())
	}
	if _, err := update.ReadCache(); err == nil {
		t.Fatal("--check should not write the update cache")
	}
}

func TestUpgradeUpToDateOutput(t *testing.T) {
	oldFetchLatest := fetchLatest
	fetchLatest = func(time.Duration) (string, error) { return version.Version, nil }
	t.Cleanup(func() { fetchLatest = oldFetchLatest })

	var stdout bytes.Buffer
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), t.TempDir(), "", true, emptyHomeEnvironment(t)); err != nil {
		t.Fatal(err)
	}
	if got, want := stdout.String(), "✓ puzzle "+version.Version+" is up to date\n"; got != want {
		t.Fatalf("output = %q, want %q", got, want)
	}
}

func TestUpgradeManualInstallInstructions(t *testing.T) {
	oldFetchLatest := fetchLatest
	fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
	t.Cleanup(func() { fetchLatest = oldFetchLatest })

	var stdout bytes.Buffer
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), t.TempDir(), "/usr/local/bin/puzzle", false, emptyHomeEnvironment(t)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stdout.String(), "go install github.com/magic-spells/puzzle/compiler/cmd/puzzle@latest") {
		t.Fatalf("manual install output missing go install command:\n%s", stdout.String())
	}
}

func TestFindGlobalPackageJSON(t *testing.T) {
	root := t.TempDir()
	packageJSON := filepath.Join(root, "node_modules", "@magic-spells", "puzzle", "package.json")
	mustWrite(t, packageJSON, `{"version":"0.2.0"}`)
	executable := filepath.Join(root, "node_modules", "@magic-spells", "puzzle-darwin-arm64", "bin", "puzzle")
	if got := findGlobalPackageJSON(executable); got != packageJSON {
		t.Fatalf("package.json = %q, want %q", got, packageJSON)
	}
}

func TestUpgradeCommandWithStubPackageManager(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}

	tests := []struct {
		name     string
		manager  string
		lockfile string
		field    string
		wantArgs []string
	}{
		{
			name:     "npm dev dependency",
			manager:  "npm",
			lockfile: "package-lock.json",
			field:    "devDependencies",
			wantArgs: []string{"install", "--save-dev", "@magic-spells/puzzle@" + testLatest},
		},
		{
			name:     "pnpm dependency",
			manager:  "pnpm",
			lockfile: "pnpm-lock.yaml",
			field:    "dependencies",
			wantArgs: []string{"add", "@magic-spells/puzzle@" + testLatest},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldFetchLatest := fetchLatest
			fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
			t.Cleanup(func() { fetchLatest = oldFetchLatest })

			project := t.TempDir()
			mustWrite(t, filepath.Join(project, "package.json"), `{"`+tt.field+`":{"@magic-spells/puzzle":"0.1.0"}}`)
			mustWrite(t, filepath.Join(project, tt.lockfile), "")
			installedPackage := filepath.Join(project, "node_modules", "@magic-spells", "puzzle", "package.json")

			stubDir := t.TempDir()
			argsPath := filepath.Join(stubDir, "args")
			cwdPath := filepath.Join(stubDir, "cwd")
			stub := "#!/bin/sh\n" +
				"printf '%s\\n' \"$@\" > \"$PUZZLE_TEST_ARGS\"\n" +
				"pwd > \"$PUZZLE_TEST_CWD\"\n" +
				"mkdir -p \"$(dirname \"$PUZZLE_TEST_PACKAGE_JSON\")\"\n" +
				"printf '{\"version\":\"%s\"}\\n' \"$PUZZLE_TEST_VERSION\" > \"$PUZZLE_TEST_PACKAGE_JSON\"\n"
			if err := os.WriteFile(filepath.Join(stubDir, tt.manager), []byte(stub), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", stubDir+string(os.PathListSeparator)+os.Getenv("PATH"))
			t.Setenv("PUZZLE_TEST_ARGS", argsPath)
			t.Setenv("PUZZLE_TEST_CWD", cwdPath)
			t.Setenv("PUZZLE_TEST_PACKAGE_JSON", installedPackage)
			t.Setenv("PUZZLE_TEST_VERSION", testLatest)

			oldCacheDir := update.CacheDir
			update.CacheDir = t.TempDir()
			t.Cleanup(func() { update.CacheDir = oldCacheDir })

			var stdout, stderr bytes.Buffer
			if err := runUpgrade(&stdout, &stderr, plainPrinter(), project, filepath.Join(stubDir, "puzzle"), false, emptyHomeEnvironment(t)); err != nil {
				t.Fatalf("runUpgrade: %v\nstderr: %s", err, stderr.String())
			}
			gotArgs := readLines(t, argsPath)
			if !reflect.DeepEqual(gotArgs, tt.wantArgs) {
				t.Fatalf("argv = %#v, want %#v", gotArgs, tt.wantArgs)
			}
			cwd, err := os.ReadFile(cwdPath)
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(string(cwd)) != project {
				t.Fatalf("command cwd = %q, want %q", strings.TrimSpace(string(cwd)), project)
			}
			if !strings.Contains(stdout.String(), "✓ upgraded "+version.Version+" → "+testLatest) {
				t.Fatalf("success output missing:\n%s", stdout.String())
			}
			cached, err := update.ReadCache()
			if err != nil {
				t.Fatal(err)
			}
			if cached.Latest != testLatest {
				t.Fatalf("cached latest = %q, want %q", cached.Latest, testLatest)
			}
		})
	}
}

// emptyHomeEnvironment points the skill refresh at an empty home so upgrade
// tests never read (or write) the real ~/.claude.
func emptyHomeEnvironment(t *testing.T) upgradeEnvironment {
	t.Helper()
	home := t.TempDir()
	return upgradeEnvironment{homeDir: func() (string, error) { return home, nil }}
}

// skillHome builds a home with a config dir per name, each already carrying an
// installed skill directory.
func skillHome(t *testing.T, names ...string) string {
	t.Helper()
	home := t.TempDir()
	for _, name := range names {
		if err := os.MkdirAll(filepath.Join(home, name, "skills", "puzzle"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

func TestUpgradeSkillRefreshNonInteractiveHint(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := skillHome(t, ".claude")
	stdout := runUpgradeWithStubs(t, home, false, nil)

	dest := filepath.Join(home, ".claude", "skills", "puzzle")
	if !strings.Contains(stdout, dest) || !strings.Contains(stdout, "puzzle upgrade skills") {
		t.Fatalf("non-TTY upgrade should print the manual skill hint, got:\n%s", stdout)
	}
}

func TestUpgradeSkillRefreshLeavesSymlinkedInstall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
		t.Fatal(err)
	}
	checkout := t.TempDir()
	dest := filepath.Join(home, ".claude", "skills", "puzzle")
	if err := os.Symlink(checkout, dest); err != nil {
		t.Fatal(err)
	}

	stdout := runUpgradeWithStubs(t, home, false, nil)
	if !strings.Contains(stdout, dest+" is a symlink") {
		t.Fatalf("symlinked skill install should be reported, got:\n%s", stdout)
	}
	if strings.Contains(stdout, "puzzle upgrade skills") {
		t.Fatalf("a symlink-only home has nothing to refresh, got:\n%s", stdout)
	}
	// The link itself must survive untouched — writing through it would rewrite
	// files in the linked checkout.
	info, err := os.Lstat(dest)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("symlink replaced: info=%v err=%v", info, err)
	}
	if entries, err := os.ReadDir(checkout); err != nil || len(entries) != 0 {
		t.Fatalf("linked checkout was written into: %v (err %v)", entries, err)
	}
}

func TestUpgradeSkillRefreshRunsUpgradedBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := skillHome(t, ".claude", ".cursor")
	skillArgs := filepath.Join(t.TempDir(), "skill-args")
	t.Setenv("PUZZLE_TEST_SKILL_ARGS", skillArgs)

	var asked []skillTarget
	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(_ io.Reader, _ io.Writer, targets []skillTarget, latest string) (bool, error) {
		asked = targets
		if latest != testLatest {
			t.Errorf("prompt offered %q, want %q", latest, testLatest)
		}
		return true, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	runUpgradeWithStubs(t, home, true, nil)

	if len(asked) != 2 || asked[0].Root != filepath.Join(home, ".claude") || asked[1].Root != filepath.Join(home, ".cursor") {
		t.Fatalf("prompt targets = %#v, want the two installed roots", asked)
	}
	want := []string{
		"add", "skills", "--overwrite",
		"--skill-root", filepath.Join(home, ".claude"),
		"--skill-root", filepath.Join(home, ".cursor"),
	}
	if got := readLines(t, skillArgs); !reflect.DeepEqual(got, want) {
		t.Fatalf("skill refresh argv = %#v, want %#v", got, want)
	}
}

func TestUpgradeSkillRefreshDeclined(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := skillHome(t, ".claude")
	skillArgs := filepath.Join(t.TempDir(), "skill-args")
	t.Setenv("PUZZLE_TEST_SKILL_ARGS", skillArgs)

	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) { return false, nil }
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	runUpgradeWithStubs(t, home, true, nil)
	if fsFileExists(skillArgs) {
		t.Fatal("declining the prompt still ran the skill install")
	}
}

// TestUpgradeSkillRefreshSkipsStaleBinary covers the reason the refresh re-execs
// at all: this process embeds the OLD skill, so a binary that does not report the
// new version must never be used to install it.
func TestUpgradeSkillRefreshSkipsStaleBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := skillHome(t, ".claude")
	skillArgs := filepath.Join(t.TempDir(), "skill-args")
	t.Setenv("PUZZLE_TEST_SKILL_ARGS", skillArgs)

	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) { return true, nil }
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	stdout := runUpgradeWithStubs(t, home, true, func(project string) {
		mustWriteExecutable(t, filepath.Join(project, "node_modules", ".bin", "puzzle"),
			"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'puzzle version 0.0.1'; exit 0; fi\n"+
				"printf '%s\\n' \"$@\" > \"$PUZZLE_TEST_SKILL_ARGS\"\n")
	})

	if fsFileExists(skillArgs) {
		t.Fatal("a stale binary was used to install the skill")
	}
	if !strings.Contains(stdout, "puzzle upgrade skills") {
		t.Fatalf("expected a fallback hint when no upgraded binary is found, got:\n%s", stdout)
	}
}

// forbidFetchLatest fails the test if anything reaches the registry. `upgrade
// skills` refreshes from THIS binary's embedded payload, so there is nothing to
// check for and no reason to be offline-hostile.
func forbidFetchLatest(t *testing.T) {
	t.Helper()
	previous := fetchLatest
	fetchLatest = func(time.Duration) (string, error) {
		t.Error("upgrade skills must not check the registry")
		return "", errors.New("unexpected network call")
	}
	t.Cleanup(func() { fetchLatest = previous })
}

func TestUpgradeSkillsRefreshesInstalledTargetsOnly(t *testing.T) {
	home := skillHome(t, ".claude", ".cursor")
	// A config dir with no skill is a first install, which `add skills` owns.
	if err := os.Mkdir(filepath.Join(home, ".codex"), 0o755); err != nil {
		t.Fatal(err)
	}
	forbidFetchLatest(t)

	var asked []skillTarget
	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(_ io.Reader, _ io.Writer, targets []skillTarget, latest string) (bool, error) {
		asked = targets
		if latest != version.Version {
			t.Errorf("prompt offered %q, want this binary's version %q", latest, version.Version)
		}
		return true, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	var buf bytes.Buffer
	env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, interactive: true}
	if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
		t.Fatalf("upgrade skills: %v", err)
	}

	if len(asked) != 2 {
		t.Fatalf("prompt targets = %#v, want the two installed roots", asked)
	}
	for _, name := range []string{".claude", ".cursor"} {
		dest := filepath.Join(home, name, "skills", "puzzle")
		if !fsFileExists(filepath.Join(dest, "SKILL.md")) {
			t.Errorf("%s was not refreshed", dest)
		}
		if stamped, ok := installedSkillVersion(dest); !ok || stamped != version.Version {
			t.Errorf("%s stamp = %q (found %v), want %q", dest, stamped, ok, version.Version)
		}
	}
	if codex := filepath.Join(home, ".codex", "skills", "puzzle"); fsFileExists(codex) {
		t.Errorf("upgrade skills must not perform a first install at %s", codex)
	}
}

// The command names the intent, so a non-TTY refreshes rather than hinting — the
// opposite of `add skills`, where clobbering would be a side effect.
func TestUpgradeSkillsNonInteractiveInstallsWithoutPrompting(t *testing.T) {
	home := skillHome(t, ".claude")
	forbidFetchLatest(t)

	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		t.Error("a non-TTY must never prompt")
		return false, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	var buf bytes.Buffer
	env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, interactive: false}
	if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
		t.Fatalf("upgrade skills: %v", err)
	}
	if !fsFileExists(filepath.Join(home, ".claude", "skills", "puzzle", "SKILL.md")) {
		t.Error("non-TTY upgrade skills should have refreshed the install")
	}
}

func TestUpgradeSkillsUpToDateAndSymlinkAndEmptyHomes(t *testing.T) {
	forbidFetchLatest(t)
	oldConfirm := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		t.Error("nothing here should prompt")
		return false, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = oldConfirm })

	t.Run("up to date", func(t *testing.T) {
		home := skillHome(t, ".claude")
		dest := filepath.Join(home, ".claude", "skills", "puzzle")
		if err := os.WriteFile(filepath.Join(dest, skillVersionFile), []byte(version.Version+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, interactive: true}
		if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
			t.Fatalf("upgrade skills: %v", err)
		}
		out := buf.String()
		if !strings.Contains(out, "up to date") || !strings.Contains(out, "puzzle add skills --overwrite") {
			t.Errorf("expected an up-to-date line and the reinstall hint, got:\n%s", out)
		}
		if fsFileExists(filepath.Join(dest, "SKILL.md")) {
			t.Error("an up-to-date install was rewritten")
		}
	})

	t.Run("symlink", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("symlink creation needs elevation on Windows")
		}
		home := t.TempDir()
		if err := os.MkdirAll(filepath.Join(home, ".claude", "skills"), 0o755); err != nil {
			t.Fatal(err)
		}
		checkout := t.TempDir()
		dest := filepath.Join(home, ".claude", "skills", "puzzle")
		if err := os.Symlink(checkout, dest); err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, interactive: true}
		if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
			t.Fatalf("upgrade skills: %v", err)
		}
		if !strings.Contains(buf.String(), "is a symlink") {
			t.Errorf("expected the symlink notice, got:\n%s", buf.String())
		}
		if entries, err := os.ReadDir(checkout); err != nil || len(entries) != 0 {
			t.Errorf("linked checkout was written into: %v (err %v)", entries, err)
		}
	})

	t.Run("nothing installed", func(t *testing.T) {
		home := t.TempDir()
		if err := os.Mkdir(filepath.Join(home, ".claude"), 0o755); err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, interactive: true}
		if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
			t.Fatalf("upgrade skills: %v", err)
		}
		if !strings.Contains(buf.String(), "puzzle add skills") {
			t.Errorf("expected a pointer to the first-install command, got:\n%s", buf.String())
		}
	})
}

// runUpgradeWithStubs drives a full project upgrade against a stub npm and a stub
// upgraded binary, returning everything printed. seedProject replaces the default
// node_modules/.bin/puzzle stub when a test needs a different one.
func runUpgradeWithStubs(t *testing.T, home string, interactive bool, seedProject func(project string)) string {
	t.Helper()

	oldFetchLatest := fetchLatest
	fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
	t.Cleanup(func() { fetchLatest = oldFetchLatest })

	oldCacheDir := update.CacheDir
	update.CacheDir = t.TempDir()
	t.Cleanup(func() { update.CacheDir = oldCacheDir })

	project := t.TempDir()
	mustWrite(t, filepath.Join(project, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"0.1.0"}}`)
	mustWrite(t, filepath.Join(project, "package-lock.json"), "")

	stubDir := t.TempDir()
	mustWriteExecutable(t, filepath.Join(stubDir, "npm"),
		"#!/bin/sh\nmkdir -p \"$(dirname \"$PUZZLE_TEST_PACKAGE_JSON\")\"\n"+
			"printf '{\"version\":\"%s\"}\\n' \"$PUZZLE_TEST_VERSION\" > \"$PUZZLE_TEST_PACKAGE_JSON\"\n")
	t.Setenv("PATH", stubDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PUZZLE_TEST_PACKAGE_JSON", filepath.Join(project, "node_modules", "@magic-spells", "puzzle", "package.json"))
	t.Setenv("PUZZLE_TEST_VERSION", testLatest)

	if seedProject != nil {
		seedProject(project)
	} else {
		mustWriteExecutable(t, filepath.Join(project, "node_modules", ".bin", "puzzle"),
			"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"puzzle version $PUZZLE_TEST_VERSION\"; exit 0; fi\n"+
				"printf '%s\\n' \"$@\" > \"$PUZZLE_TEST_SKILL_ARGS\"\n")
	}

	var stdout, stderr bytes.Buffer
	env := upgradeEnvironment{
		homeDir:     func() (string, error) { return home, nil },
		interactive: interactive,
	}
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), project, filepath.Join(stubDir, "puzzle"), false, env); err != nil {
		t.Fatalf("runUpgrade: %v\nstderr: %s", err, stderr.String())
	}
	return stdout.String()
}

func mustWriteExecutable(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

// TestConfirmSkillRefreshAnswers pins the real prompt (the one confirmSkillUpdate
// indirects) to the user's answer — the refresh must be a genuine gate, not a
// form that reports its default whatever is typed.
func TestConfirmSkillRefreshAnswers(t *testing.T) {
	t.Setenv("TERM", "dumb")
	targets := []skillTarget{{Name: "Claude Code", Root: filepath.Join(t.TempDir(), ".claude")}}
	for _, tt := range []struct {
		input string
		want  bool
	}{{"y\n", true}, {"n\n", false}} {
		got, err := confirmSkillRefresh(strings.NewReader(tt.input), io.Discard, targets, testLatest)
		if err != nil {
			t.Fatalf("confirm with %q: %v", tt.input, err)
		}
		if got != tt.want {
			t.Errorf("confirm with %q = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestBinaryReportsVersionExactMatch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script stub")
	}
	bin := filepath.Join(t.TempDir(), "puzzle")
	mustWriteExecutable(t, bin, "#!/bin/sh\necho 'puzzle version 0.2.10'\n")

	if binaryReportsVersion(bin, "0.2.1") {
		t.Error("0.2.10 must not satisfy a 0.2.1 check")
	}
	if !binaryReportsVersion(bin, "0.2.10") {
		t.Error("exact version should match")
	}
	if binaryReportsVersion(filepath.Join(t.TempDir(), "missing"), "0.2.10") {
		t.Error("a missing binary should not report a version")
	}
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "\n")
}
