package main

import (
	"bytes"
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
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), t.TempDir(), "", true); err != nil {
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
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), t.TempDir(), "", true); err != nil {
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
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), t.TempDir(), "/usr/local/bin/puzzle", false); err != nil {
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
			if err := runUpgrade(&stdout, &stderr, plainPrinter(), project, filepath.Join(stubDir, "puzzle"), false); err != nil {
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
