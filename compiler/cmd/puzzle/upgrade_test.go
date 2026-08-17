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

// realTempDir is t.TempDir() with symlinks resolved, so fixtures compare equal
// to the paths detection reports: detection runs the executable through
// EvalSymlinks, and macOS hands out temp dirs under the /var → /private/var
// link.
func realTempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestDetectInstallContextFromExecutable pins the whole resolution table of §41.
// Every case is a shape of executable path; none of them involves the working
// directory, which detection must not read at all.
func TestDetectInstallContextFromExecutable(t *testing.T) {
	platform := filepath.Join("@magic-spells", platformPackageName(), "bin", "puzzle")

	tests := []struct {
		name string
		// executable is built relative to a fresh root.
		executable string
		// packageJSON, when non-empty, is written at <root>/<ownerRel>.
		ownerRel    string
		packageJSON string
		lockfile    string
		// files are extra fixtures, keyed by path relative to root.
		files       map[string]string
		wantKind    installKind
		wantOwner   string // relative to root; the owning dir, or "" for a global
		wantManager string
		wantDev     bool
	}{
		{
			name:       "go install binary",
			executable: filepath.Join("bin", "puzzle"),
			wantKind:   installManual,
		},
		{
			name:       "repo-built binary",
			executable: "puzzle",
			wantKind:   installManual,
		},
		{
			name:        "hoisted project dependency",
			executable:  filepath.Join("app", "node_modules", platform),
			ownerRel:    "app",
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "package-lock.json",
			wantKind:    installProject,
			wantOwner:   "app",
			wantManager: "npm",
		},
		{
			name:        "project dev dependency keeps the field",
			executable:  filepath.Join("app", "node_modules", ".bin", "puzzle"),
			ownerRel:    "app",
			packageJSON: `{"devDependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "yarn.lock",
			wantKind:    installProject,
			wantOwner:   "app",
			wantManager: "yarn",
			wantDev:     true,
		},
		{
			// The `.pnpm` store sits INSIDE the project's node_modules, so a
			// pnpm project must not be mistaken for a pnpm global.
			name: "pnpm project through the .pnpm store",
			executable: filepath.Join("app", "node_modules", ".pnpm",
				"@magic-spells+"+platformPackageName()+"@0.6.0", "node_modules", platform),
			ownerRel:    "app",
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "pnpm-lock.yaml",
			wantKind:    installProject,
			wantOwner:   "app",
			wantManager: "pnpm",
		},
		{
			name:        "bun project without a lockfile defaults to npm",
			executable:  filepath.Join("app", "node_modules", platform),
			ownerRel:    "app",
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			wantKind:    installProject,
			wantOwner:   "app",
			wantManager: "npm",
		},
		{
			name:        "bun lockfile",
			executable:  filepath.Join("app", "node_modules", platform),
			ownerRel:    "app",
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "bun.lockb",
			wantKind:    installProject,
			wantOwner:   "app",
			wantManager: "bun",
		},
		{
			// The dependency lives in a member package; the binary is hoisted to
			// the root. Classifying that as global would install -g behind the
			// user's back and then fail against the workspace's own copy.
			name:        "npm workspaces root hoisting a member's dependency",
			executable:  filepath.Join("mono", "node_modules", platform),
			ownerRel:    "mono",
			packageJSON: `{"name":"mono","workspaces":["packages/*"]}`,
			lockfile:    "package-lock.json",
			files: map[string]string{
				filepath.Join("mono", "packages", "app", "package.json"): `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			},
			wantKind:  installWorkspace,
			wantOwner: "mono",
		},
		{
			name:        "pnpm workspace root",
			executable:  filepath.Join("mono", "node_modules", ".pnpm", "@magic-spells+puzzle@0.6.0", "node_modules", platform),
			ownerRel:    "mono",
			packageJSON: `{"name":"mono"}`,
			lockfile:    "pnpm-lock.yaml",
			files: map[string]string{
				filepath.Join("mono", "pnpm-workspace.yaml"):             "packages:\n  - 'packages/*'\n",
				filepath.Join("mono", "packages", "app", "package.json"): `{"devDependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			},
			wantKind:  installWorkspace,
			wantOwner: "mono",
		},
		{
			// A workspace root that declares the CLI itself is an ordinary
			// project: the dependency test runs before the workspace guard.
			name:        "workspace root that declares the CLI is a project",
			executable:  filepath.Join("mono", "node_modules", platform),
			ownerRel:    "mono",
			packageJSON: `{"workspaces":["packages/*"],"devDependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "pnpm-lock.yaml",
			wantKind:    installProject,
			wantOwner:   "mono",
			wantManager: "pnpm",
			wantDev:     true,
		},
		{
			name:       "npm global prefix",
			executable: filepath.Join("opt", "homebrew", "lib", "node_modules", platform),
			wantKind:   installGlobal,
			// No package.json above node_modules at all.
			wantManager: "npm",
		},
		{
			name:        "npm global prefix whose owner has an unrelated package.json",
			executable:  filepath.Join("usr", "local", "lib", "node_modules", platform),
			ownerRel:    filepath.Join("usr", "local", "lib"),
			packageJSON: `{"dependencies":{"typescript":"^5.0.0"}}`,
			wantKind:    installGlobal,
			wantManager: "npm",
		},
		{
			// pnpm's global root IS a package directory listing every global
			// install as a dependency, so it must be classified before the
			// project test — otherwise a global pnpm CLI upgrades itself with a
			// project-shaped `pnpm add`.
			name: "pnpm global root",
			executable: filepath.Join("home", "Library", "pnpm", "global", "5", "node_modules",
				".pnpm", "@magic-spells+puzzle@0.6.0", "node_modules", platform),
			ownerRel:    filepath.Join("home", "Library", "pnpm", "global", "5"),
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "pnpm-lock.yaml",
			wantKind:    installGlobal,
			wantManager: "pnpm",
		},
		{
			// A directory merely named pnpm is not pnpm's global root: a
			// project under one is classified by its own manifest, never
			// shipped to `pnpm add -g`.
			name:        "project under a directory named pnpm stays a project",
			executable:  filepath.Join("home", "pnpm", "app", "node_modules", platform),
			ownerRel:    filepath.Join("home", "pnpm", "app"),
			packageJSON: `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`,
			lockfile:    "package-lock.json",
			wantKind:    installProject,
			wantOwner:   filepath.Join("home", "pnpm", "app"),
			wantManager: "npm",
		},
	}

	// The table runs with $PNPM_HOME unset so no fixture can collide with the
	// developer's real pnpm home.
	t.Setenv("PNPM_HOME", "")

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := realTempDir(t)
			if tt.packageJSON != "" {
				mustWrite(t, filepath.Join(root, tt.ownerRel, "package.json"), tt.packageJSON)
			}
			if tt.lockfile != "" {
				mustWrite(t, filepath.Join(root, tt.ownerRel, tt.lockfile), "")
			}
			for rel, body := range tt.files {
				mustWrite(t, filepath.Join(root, rel), body)
			}

			ctx, err := detectInstallContext(filepath.Join(root, tt.executable))
			if err != nil {
				t.Fatal(err)
			}
			if ctx.kind != tt.wantKind {
				t.Fatalf("kind = %v, want %v (context %#v)", ctx.kind, tt.wantKind, ctx)
			}
			if tt.wantKind == installManual {
				return
			}
			wantDir := ""
			if tt.wantOwner != "" {
				wantDir = filepath.Join(root, tt.wantOwner)
			}
			if ctx.dir != wantDir {
				t.Errorf("dir = %q, want %q", ctx.dir, wantDir)
			}
			if ctx.manager != tt.wantManager || ctx.dev != tt.wantDev {
				t.Errorf("manager = %q dev = %v, want %q / %v", ctx.manager, ctx.dev, tt.wantManager, tt.wantDev)
			}
		})
	}
}

// TestDetectInstallContextPnpmHome covers a $PNPM_HOME that is not itself named
// pnpm: the `global/<n>` root under it must still be recognised by shape.
func TestDetectInstallContextPnpmHome(t *testing.T) {
	root := realTempDir(t)
	home := filepath.Join(root, "tools")
	t.Setenv("PNPM_HOME", home)

	owner := filepath.Join(home, "global", "5")
	mustWrite(t, filepath.Join(owner, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`)
	mustWrite(t, filepath.Join(owner, "pnpm-lock.yaml"), "")

	executable := filepath.Join(owner, "node_modules", ".pnpm", "@magic-spells+puzzle@0.6.0",
		"node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")
	ctx, err := detectInstallContext(executable)
	if err != nil {
		t.Fatal(err)
	}
	if ctx.kind != installGlobal || ctx.manager != "pnpm" {
		t.Fatalf("context = %#v, want a pnpm global install", ctx)
	}
}

// TestDetectInstallContextResolvesSymlinkedBin covers the shape a user actually
// runs: node_modules/.bin/puzzle is a link into the package directory, and the
// owner has to survive resolving it.
func TestDetectInstallContextResolvesSymlinkedBin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs elevation on Windows")
	}
	project := realTempDir(t)
	mustWrite(t, filepath.Join(project, "package.json"), `{"devDependencies":{"@magic-spells/puzzle":"^0.6.0"}}`)
	mustWrite(t, filepath.Join(project, "pnpm-lock.yaml"), "")

	real := filepath.Join(project, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")
	mustWriteExecutable(t, real, "#!/bin/sh\n")
	link := filepath.Join(project, "node_modules", ".bin", "puzzle")
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}

	ctx, err := detectInstallContext(link)
	if err != nil {
		t.Fatal(err)
	}
	if ctx.kind != installProject || ctx.dir != project || ctx.manager != "pnpm" || !ctx.dev {
		t.Fatalf("context = %#v, want a pnpm dev-dependency project at %q", ctx, project)
	}
}

// TestDetectInstallContextIgnoresWorkingDirectory is the regression this design
// exists for (D76): standing inside a Puzzle app while running a GLOBAL CLI must
// resolve to the global install, not to the app whose dependency the command
// never writes.
func TestDetectInstallContextIgnoresWorkingDirectory(t *testing.T) {
	project := realTempDir(t)
	mustWrite(t, filepath.Join(project, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"^0.5.0"}}`)
	mustWrite(t, filepath.Join(project, "pnpm-lock.yaml"), "")
	chdir(t, project)

	global := filepath.Join(realTempDir(t), "opt", "homebrew", "lib", "node_modules",
		"@magic-spells", platformPackageName(), "bin", "puzzle")
	ctx, err := detectInstallContext(global)
	if err != nil {
		t.Fatal(err)
	}
	if ctx.kind != installGlobal || ctx.manager != "npm" {
		t.Fatalf("context = %#v, want a global npm install", ctx)
	}
	if ctx.dir == project {
		t.Fatalf("detection adopted the working directory %q", project)
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
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), "", true, emptyHomeEnvironment(t)); err != nil {
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
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), "", true, emptyHomeEnvironment(t)); err != nil {
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
	binary := filepath.Join(realTempDir(t), "usr", "local", "bin", "puzzle")
	if err := runUpgrade(&stdout, &bytes.Buffer{}, plainPrinter(), binary, false, emptyHomeEnvironment(t)); err != nil {
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

			project := realTempDir(t)
			mustWrite(t, filepath.Join(project, "package.json"), `{"`+tt.field+`":{"@magic-spells/puzzle":"0.1.0"}}`)
			mustWrite(t, filepath.Join(project, tt.lockfile), "")
			installedPackage := filepath.Join(project, "node_modules", "@magic-spells", "puzzle", "package.json")
			// The CLI being upgraded is the project's own copy, and the process
			// is standing somewhere else entirely: the project is reached
			// through the executable, never through the cwd.
			executable := filepath.Join(project, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")
			chdir(t, realTempDir(t))

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
			if err := runUpgrade(&stdout, &stderr, plainPrinter(), executable, false, emptyHomeEnvironment(t)); err != nil {
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
			want := "✓ upgraded @magic-spells/puzzle " + version.Version + " → " + testLatest + " in " + project
			if !strings.Contains(stdout.String(), want) {
				t.Fatalf("success output missing %q:\n%s", want, stdout.String())
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

// TestUpgradeGlobalCLIFromInsideAProject is the launch-day regression, end to
// end: a global CLI invoked while standing in a Puzzle app must run the GLOBAL
// install command, confirm the GLOBAL package, and say so — the app's dependency
// is npm's business, not the command's.
func TestUpgradeGlobalCLIFromInsideAProject(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}

	tests := []struct {
		name       string
		manager    string
		globalRoot []string // path segments below the fixture root
		wantArgs   []string
	}{
		{
			name:       "npm global",
			manager:    "npm",
			globalRoot: []string{"opt", "homebrew", "lib"},
			wantArgs:   []string{"install", "-g", "@magic-spells/puzzle@" + testLatest},
		},
		{
			name:       "pnpm global",
			manager:    "pnpm",
			globalRoot: []string{"home", "Library", "pnpm", "global", "5"},
			wantArgs:   []string{"add", "-g", "@magic-spells/puzzle@" + testLatest},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			oldFetchLatest := fetchLatest
			fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
			t.Cleanup(func() { fetchLatest = oldFetchLatest })

			oldCacheDir := update.CacheDir
			update.CacheDir = t.TempDir()
			t.Cleanup(func() { update.CacheDir = oldCacheDir })

			// A real Puzzle app, with a real dependency on the CLI, that the
			// command must leave completely alone.
			project := realTempDir(t)
			mustWrite(t, filepath.Join(project, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"^0.5.0"}}`)
			mustWrite(t, filepath.Join(project, "package-lock.json"), "")
			chdir(t, project)

			root := append([]string{realTempDir(t)}, tt.globalRoot...)
			globalRoot := filepath.Join(root...)
			if tt.manager == "pnpm" {
				// pnpm's global root declares its installs, which is exactly why
				// it cannot be told apart from an app by package.json alone.
				mustWrite(t, filepath.Join(globalRoot, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"^0.5.0"}}`)
				mustWrite(t, filepath.Join(globalRoot, "pnpm-lock.yaml"), "")
			}
			executable := filepath.Join(globalRoot, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")

			stubDir := t.TempDir()
			argsPath := filepath.Join(stubDir, "args")
			mustWriteExecutable(t, filepath.Join(stubDir, tt.manager),
				"#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PUZZLE_TEST_ARGS\"\n"+
					"mkdir -p \"$(dirname \"$PUZZLE_TEST_PACKAGE_JSON\")\"\n"+
					"printf '{\"version\":\"%s\"}\\n' \"$PUZZLE_TEST_VERSION\" > \"$PUZZLE_TEST_PACKAGE_JSON\"\n")
			t.Setenv("PATH", stubDir+string(os.PathListSeparator)+os.Getenv("PATH"))
			t.Setenv("PUZZLE_TEST_ARGS", argsPath)
			t.Setenv("PUZZLE_TEST_PACKAGE_JSON", filepath.Join(globalRoot, "node_modules", "@magic-spells", "puzzle", "package.json"))
			t.Setenv("PUZZLE_TEST_VERSION", testLatest)

			var stdout, stderr bytes.Buffer
			if err := runUpgrade(&stdout, &stderr, plainPrinter(), executable, false, emptyHomeEnvironment(t)); err != nil {
				t.Fatalf("runUpgrade: %v\nstderr: %s", err, stderr.String())
			}
			if got := readLines(t, argsPath); !reflect.DeepEqual(got, tt.wantArgs) {
				t.Fatalf("argv = %#v, want %#v", got, tt.wantArgs)
			}
			if fsFileExists(filepath.Join(project, "node_modules")) {
				t.Error("the surrounding project was installed into")
			}
			want := "✓ upgraded the global CLI " + version.Version + " → " + testLatest
			if !strings.Contains(stdout.String(), want) {
				t.Fatalf("success output missing %q:\n%s", want, stdout.String())
			}
		})
	}
}

// TestUpgradeWorkspaceRootExplainsAndStops covers the guard end to end: a
// hoisted monorepo CLI must run no package manager at all, since neither `-g`
// nor a root install would touch the member that owns the dependency.
func TestUpgradeWorkspaceRootExplainsAndStops(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	oldFetchLatest := fetchLatest
	fetchLatest = func(time.Duration) (string, error) { return testLatest, nil }
	t.Cleanup(func() { fetchLatest = oldFetchLatest })

	oldCacheDir := update.CacheDir
	update.CacheDir = t.TempDir()
	t.Cleanup(func() { update.CacheDir = oldCacheDir })

	mono := realTempDir(t)
	mustWrite(t, filepath.Join(mono, "package.json"), `{"name":"mono","workspaces":["packages/*"]}`)
	mustWrite(t, filepath.Join(mono, "package-lock.json"), "")
	mustWrite(t, filepath.Join(mono, "packages", "app", "package.json"), `{"dependencies":{"@magic-spells/puzzle":"^0.6.0"}}`)
	// A stale hoisted copy: the version confirmation would have read this one
	// and reported a mismatch, which is the second half of the wrong behaviour.
	mustWrite(t, filepath.Join(mono, "node_modules", "@magic-spells", "puzzle", "package.json"), `{"version":"0.6.0"}`)
	executable := filepath.Join(mono, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")

	stubDir := t.TempDir()
	ranPath := filepath.Join(stubDir, "ran")
	for _, manager := range []string{"npm", "pnpm", "yarn", "bun"} {
		mustWriteExecutable(t, filepath.Join(stubDir, manager),
			"#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$PUZZLE_TEST_RAN\"\n")
	}
	t.Setenv("PATH", stubDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PUZZLE_TEST_RAN", ranPath)

	var stdout, stderr bytes.Buffer
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), executable, false, emptyHomeEnvironment(t)); err != nil {
		t.Fatalf("runUpgrade: %v\nstderr: %s", err, stderr.String())
	}
	if fsFileExists(ranPath) {
		t.Fatalf("a package manager ran: %#v", readLines(t, ranPath))
	}
	out := stdout.String()
	if !strings.Contains(out, mono) || !strings.Contains(out, "-w <member>") {
		t.Fatalf("expected the workspace explanation naming %q, got:\n%s", mono, out)
	}
	if strings.Contains(out, "upgraded") {
		t.Fatalf("nothing was upgraded, so nothing may claim it was:\n%s", out)
	}
	if _, err := update.ReadCache(); err == nil {
		t.Fatal("a refusal must not write the update cache")
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

	project := realTempDir(t)
	mustWrite(t, filepath.Join(project, "package.json"), `{"dependencies":{"@magic-spells/puzzle":"0.1.0"}}`)
	mustWrite(t, filepath.Join(project, "package-lock.json"), "")
	// The running CLI is the project's own — the shape the refresh candidates
	// (platform package, then node_modules/.bin) are written for.
	executable := filepath.Join(project, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle")

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
	if err := runUpgrade(&stdout, &stderr, plainPrinter(), executable, false, env); err != nil {
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
