package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// These tests pin the CLI's flag conventions (shorthands, aliases, hidden
// flags, machine-readable output) against what npm, gh, vite and cargo users
// type from muscle memory. Each one reads the real registered commands, so a
// renamed or dropped flag fails here rather than in someone's script.

// resetFlags returns every flag on cmd (local and inherited) to its default and
// clears Changed, so a test that parsed flags on the shared package-level
// commands leaves nothing behind for the next one.
func resetFlags(t *testing.T, cmd *cobra.Command) {
	t.Helper()
	reset := func(f *pflag.Flag) {
		if sv, ok := f.Value.(pflag.SliceValue); ok {
			_ = sv.Replace(nil)
		} else {
			_ = f.Value.Set(f.DefValue)
		}
		f.Changed = false
	}
	cmd.Flags().VisitAll(reset)
	cmd.PersistentFlags().VisitAll(reset)
	cmd.InheritedFlags().VisitAll(reset)
}

// parse runs cmd's flag parser over args and registers a cleanup that resets
// the command, returning the positional args left over.
func parse(t *testing.T, cmd *cobra.Command, args ...string) []string {
	t.Helper()
	t.Cleanup(func() { resetFlags(t, cmd) })
	if err := cmd.ParseFlags(args); err != nil {
		t.Fatalf("%s: parsing %v: %v", cmd.Name(), args, err)
	}
	return cmd.Flags().Args()
}

// helpText renders cmd's --help output.
func helpText(t *testing.T, cmd *cobra.Command) string {
	t.Helper()
	var buf bytes.Buffer
	cmd.SetOut(&buf)
	t.Cleanup(func() { cmd.SetOut(nil) })
	if err := cmd.Help(); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

// execRoot runs the root command with args, capturing what cobra writes to its
// output stream, and resets the root and every subcommand afterwards.
func execRoot(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	rootCmd.SetOut(&out)
	rootCmd.SetErr(&out)
	rootCmd.SetArgs(args)
	t.Cleanup(func() {
		rootCmd.SetOut(nil)
		rootCmd.SetErr(nil)
		rootCmd.SetArgs(nil)
		resetFlags(t, rootCmd)
		for _, c := range rootCmd.Commands() {
			resetFlags(t, c)
		}
	})
	err := rootCmd.Execute()
	return out.String(), err
}

func requireShorthand(t *testing.T, cmd *cobra.Command, name, short string) {
	t.Helper()
	f := cmd.Flags().Lookup(name)
	if f == nil {
		t.Fatalf("%s has no --%s flag", cmd.Name(), name)
	}
	if f.Shorthand != short {
		t.Errorf("%s --%s shorthand = %q, want %q", cmd.Name(), name, f.Shorthand, short)
	}
}

func requireHidden(t *testing.T, cmd *cobra.Command, name string) {
	t.Helper()
	f := cmd.Flags().Lookup(name)
	if f == nil {
		t.Fatalf("%s has no --%s flag (a hidden alias must still parse)", cmd.Name(), name)
	}
	if !f.Hidden {
		t.Errorf("%s --%s should be hidden", cmd.Name(), name)
	}
	// Only the Flags: listing counts — the long description may still mention a
	// deprecated spelling to explain it.
	help := helpText(t, cmd)
	_, flags, _ := strings.Cut(help, "\nFlags:\n") // no section: nothing listed
	if strings.Contains(flags, "--"+name+" ") {
		t.Errorf("%s --help lists hidden flag --%s:\n%s", cmd.Name(), name, flags)
	}
}

func TestVersionSubcommandMatchesVersionFlag(t *testing.T) {
	want := "puzzle version " + version.Version + "\n"
	for _, args := range [][]string{{"--version"}, {"-v"}, {"version"}} {
		got, err := execRoot(t, args...)
		if err != nil {
			t.Fatalf("puzzle %v: %v", args, err)
		}
		if got != want {
			t.Errorf("puzzle %v printed %q, want %q", args, got, want)
		}
		// upgrade.go's binaryReportsVersion reads the last field.
		if fields := strings.Fields(got); fields[len(fields)-1] != version.Version {
			t.Errorf("puzzle %v: last field %q is not the version", args, fields[len(fields)-1])
		}
	}
}

func TestVersionSubcommandTakesNoArgs(t *testing.T) {
	if _, err := execRoot(t, "version", "extra"); err == nil {
		t.Fatal("puzzle version extra should be a usage error")
	}
}

func TestInfoJSONParsesWithStableKeys(t *testing.T) {
	requireShorthand(t, infoCmd, "json", "")
	dir := healthyProject(t)
	var buf bytes.Buffer
	if err := runInfoJSON(&buf, dir); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("info --json is not JSON: %v\n%s", err, buf.String())
	}
	for _, key := range infoJSONKeys {
		if _, ok := got[key]; !ok {
			t.Errorf("info --json missing key %q: %s", key, buf.String())
		}
	}
	if len(got) != len(infoJSONKeys) {
		t.Errorf("info --json has %d keys, want %d (%v): %s", len(got), len(infoJSONKeys), infoJSONKeys, buf.String())
	}
	if got["puzzle"] != version.Version || got["sourceDir"] != "app/" || got["outputDir"] != "dist/" {
		t.Errorf("info --json values wrong: %s", buf.String())
	}
}

func TestDoctorJSONParsesAndCountsFailures(t *testing.T) {
	var buf bytes.Buffer
	fails, err := runDoctorJSON(&buf, t.TempDir()) // empty: entry + index.html fail
	if err != nil {
		t.Fatal(err)
	}
	var got doctorReport
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("doctor --json is not JSON: %v\n%s", err, buf.String())
	}
	if got.OK || got.Failures != fails || fails < 2 {
		t.Errorf("doctor --json ok=%v failures=%d (returned %d), want not ok with >=2: %s", got.OK, got.Failures, fails, buf.String())
	}
	var raw map[string]any
	_ = json.Unmarshal(buf.Bytes(), &raw)
	for _, key := range []string{"dir", "ok", "failures", "checks"} {
		if _, ok := raw[key]; !ok {
			t.Errorf("doctor --json missing key %q", key)
		}
	}
	for _, c := range got.Checks {
		switch c.Status {
		case doctorPass, doctorFail, doctorWarn:
		default:
			t.Errorf("check %q has status %q", c.Name, c.Status)
		}
	}
	if rest := parse(t, doctorCmd, "--json"); len(rest) != 0 {
		t.Errorf("unexpected positional args %v", rest)
	}
}

func TestAddForceShorthandAndDeprecatedOverwriteAlias(t *testing.T) {
	requireShorthand(t, addCmd, "force", "f")
	requireShorthand(t, addCmd, "yes", "y")
	requireHidden(t, addCmd, "overwrite")
	// Hidden, not deprecated, through 0.10.x: a 0.9 upgrade re-execs the new
	// binary with --overwrite, and a deprecation notice would land in its output.
	if d := addCmd.Flags().Lookup("overwrite").Deprecated; d != "" {
		t.Errorf("--overwrite should be a silent hidden alias in 0.10.x, got deprecation %q", d)
	}
	for _, args := range [][]string{{"-f"}, {"--force"}, {"--overwrite"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			parse(t, addCmd, args...)
			if got, _ := addCmd.Flags().GetBool("force"); !got {
				t.Errorf("%v should set force", args)
			}
		})
	}
	if got, _ := addCmd.Flags().GetBool("force"); got {
		t.Error("force should reset to false between parses")
	}
}

// TestAddSkillsYesReplacesStaleWithoutPrompting: --yes takes the refresh
// prompt's default (Yes) on a stale install instead of refusing like a bare
// non-TTY run, and never shows a form.
func TestAddSkillsYesReplacesStaleWithoutPrompting(t *testing.T) {
	home := t.TempDir()
	dest := filepath.Join(home, ".claude", "skills", "puzzle")
	mustWrite(t, filepath.Join(dest, "SKILL.md"), "old skill\n") // no stamp: stale
	prev := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		t.Fatal("--yes must not prompt")
		return false, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = prev })

	var buf bytes.Buffer
	env := addEnvironment{homeDir: func() (string, error) { return home, nil }, yes: true}
	if err := runAddWithEnvironment(&buf, plainPrinter(), t.TempDir(), []string{"skills"}, "", "", false, env); err != nil {
		t.Fatalf("add skills --yes: %v", err)
	}
	if got, ok := installedSkillVersion(dest); !ok || got != version.Version {
		t.Errorf("stale install not replaced: stamp %q (%v)\n%s", got, ok, buf.String())
	}
}

func TestUpgradeYesFlagIsPersistent(t *testing.T) {
	f := upgradeCmd.PersistentFlags().Lookup("yes")
	if f == nil || f.Shorthand != "y" {
		t.Fatalf("upgrade needs a persistent --yes/-y, got %+v", f)
	}
	parse(t, upgradeSkillsCmd, "-y")
	if got, _ := upgradeSkillsCmd.Flags().GetBool("yes"); !got {
		t.Error("upgrade skills -y should set yes")
	}
}

// TestUpgradeYesRefreshesSkillsWithoutPrompting: after an upgrade, --yes runs
// the skill refresh the prompt would have offered, without asking.
func TestUpgradeYesRefreshesSkillsWithoutPrompting(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell-script package-manager stub")
	}
	home := skillHome(t, ".claude")
	skillArgs := filepath.Join(t.TempDir(), "skill-args")
	t.Setenv("PUZZLE_TEST_SKILL_ARGS", skillArgs)
	prev := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		t.Fatal("--yes must not prompt")
		return false, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = prev })

	runUpgradeWithStubsEnv(t, home, upgradeEnvironment{yes: true}, nil)

	want := []string{"add", "skills", "--force", "--skill-root", filepath.Join(home, ".claude")}
	if got := readLines(t, skillArgs); !reflect.DeepEqual(got, want) {
		t.Fatalf("skill refresh argv = %#v, want %#v", got, want)
	}
}

// TestUpgradeSkillsYesSkipsPrompt: `upgrade skills --yes` on what would be a
// TTY refreshes without the confirm form.
func TestUpgradeSkillsYesSkipsPrompt(t *testing.T) {
	home := t.TempDir()
	dest := filepath.Join(home, ".claude", "skills", "puzzle")
	mustWrite(t, filepath.Join(dest, "SKILL.md"), "old skill\n")
	prev := confirmSkillUpdate
	confirmSkillUpdate = func(io.Reader, io.Writer, []skillTarget, string) (bool, error) {
		t.Fatal("--yes must not prompt")
		return false, nil
	}
	t.Cleanup(func() { confirmSkillUpdate = prev })
	var buf bytes.Buffer
	env := upgradeEnvironment{homeDir: func() (string, error) { return home, nil }, yes: true}
	if err := runUpgradeSkills(&buf, plainPrinter(), env); err != nil {
		t.Fatal(err)
	}
	if got, ok := installedSkillVersion(dest); !ok || got != version.Version {
		t.Errorf("skill not refreshed: %q (%v)\n%s", got, ok, buf.String())
	}
}

func TestGenerateForceShorthand(t *testing.T) {
	requireShorthand(t, generateCmd, "force", "f")
	root := stubProject(t)
	if err := runGenerate(t, root, "view", "Home"); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := runGenerate(t, root, "view", "Home", "-f"); err != nil {
		t.Errorf("expected -f to overwrite: %v", err)
	}
}

// TestGenerateDirFlagFindsRootFromElsewhere: --dir names the app root (walking
// up from it), so generate works from outside the project like `add --dir`.
func TestGenerateDirFlagFindsRootFromElsewhere(t *testing.T) {
	root := stubProject(t)
	nested := filepath.Join(root, "app", "views")
	mustWrite(t, filepath.Join(nested, ".keep"), "")
	if err := runGenerate(t, t.TempDir(), "component", "Badge", "--dir", nested); err != nil {
		t.Fatalf("generate --dir: %v", err)
	}
	if !fsFileExists(filepath.Join(root, "app", "components", "Badge.pzl")) {
		t.Error("--dir should resolve the project root by walking up from it")
	}
}

func TestCheckJSHiddenButAccepted(t *testing.T) {
	requireHidden(t, checkCmd, "js")
	parse(t, checkCmd, "--js")
	if err := checkCmd.RunE(checkCmd, nil); err == nil || !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("check --js error = %v, want not yet implemented", err)
	}
}

func TestInitUsageAndFlags(t *testing.T) {
	if initCmd.Use != "init [app-name]" {
		t.Errorf("init Use = %q, want %q", initCmd.Use, "init [app-name]")
	}
	requireShorthand(t, initCmd, "template", "t")
	requireShorthand(t, initCmd, "yes", "y")
	requireHidden(t, initCmd, "dir")
	parse(t, initCmd, "-t", "todos", "-y")
	if got, _ := initCmd.Flags().GetString("template"); got != "todos" {
		t.Errorf("-t todos parsed as %q", got)
	}
	if got, _ := initCmd.Flags().GetBool("yes"); !got {
		t.Error("-y should set yes")
	}
}

func TestInitTarget(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "abs-app")
	tests := []struct {
		arg, dir             string
		wantParent, wantName string
		wantErr              bool
	}{
		{"my-app", "", ".", "my-app", false},
		{"my-app/", "", ".", "my-app", false},
		{filepath.Join("..", "apps", "foo"), "", filepath.Join("..", "apps"), "foo", false},
		{"foo", "apps", "apps", "foo", false}, // the pre-path --dir spelling
		{filepath.Join("nested", "foo"), "apps", filepath.Join("apps", "nested"), "foo", false},
		{abs, "", filepath.Dir(abs), "abs-app", false},
		{abs, "apps", "", "", true}, // absolute path and --dir: ambiguous
		{"  ", "", "", "", true},
	}
	for _, tt := range tests {
		parent, name, err := initTarget(tt.arg, tt.dir)
		if tt.wantErr {
			if err == nil {
				t.Errorf("initTarget(%q, %q) should error", tt.arg, tt.dir)
			}
			continue
		}
		if err != nil || parent != tt.wantParent || name != tt.wantName {
			t.Errorf("initTarget(%q, %q) = (%q, %q, %v), want (%q, %q)", tt.arg, tt.dir, parent, name, err, tt.wantParent, tt.wantName)
		}
	}
}

// TestInitPositionalPathCreatesInParent: `puzzle init <parent>/<name>` creates
// the app inside parent (made if missing), named by the last segment.
func TestInitPositionalPathCreatesInParent(t *testing.T) {
	r, w, err := os.Pipe() // non-TTY stdin: nothing is prompted
	if err != nil {
		t.Fatal(err)
	}
	w.Close()
	orig := os.Stdin
	os.Stdin = r
	t.Cleanup(func() { os.Stdin = orig; r.Close() })

	base := t.TempDir()
	target := filepath.Join(base, "apps", "path-app")
	parse(t, initCmd)
	if err := initCmd.RunE(initCmd, []string{target}); err != nil {
		t.Fatalf("init %s: %v", target, err)
	}
	pkg, err := os.ReadFile(filepath.Join(target, "package.json"))
	if err != nil {
		t.Fatalf("app not created at %s: %v", target, err)
	}
	if !strings.Contains(string(pkg), `"name": "path-app"`) {
		t.Errorf("package name should be the last path segment:\n%s", pkg)
	}
}

// captureStdout runs fn with os.Stdout redirected to a pipe and returns what it
// wrote (the build summary prints to os.Stdout, not cobra's output stream).
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stdout
	os.Stdout = w
	done := make(chan []byte)
	go func() { b, _ := io.ReadAll(r); done <- b }()
	fn()
	os.Stdout = orig
	w.Close()
	return string(<-done)
}

func TestBuildModeAndQuietShorthands(t *testing.T) {
	requireShorthand(t, buildCmd, "mode", "m")
	requireShorthand(t, buildCmd, "quiet", "q")
	if usage := buildCmd.Flags().Lookup("mode").Usage; !strings.Contains(usage, "production") || !strings.Contains(usage, "development") {
		t.Errorf("--mode help should name both modes, got %q", usage)
	}
	parse(t, buildCmd, "-m", "development", "-q")
	if got, _ := buildCmd.Flags().GetString("mode"); got != "development" {
		t.Errorf("-m development parsed as %q", got)
	}
	if got, _ := buildCmd.Flags().GetBool("quiet"); !got {
		t.Error("-q should set quiet")
	}
}

// TestBuildQuietSuppressesSummary runs a real build of a minimal app twice: the
// default prints the summary, -q prints nothing on success.
func TestBuildQuietSuppressesSummary(t *testing.T) {
	dir := healthyProject(t)
	installRuntime(t, dir, repoRoot(t))

	var err error
	loud := captureStdout(t, func() { _, err = execRoot(t, "build", dir, "-m", "development") })
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	if !strings.Contains(loud, "puzzle build") {
		t.Fatalf("default build should print the summary, got:\n%s", loud)
	}
	quiet := captureStdout(t, func() { _, err = execRoot(t, "build", dir, "-m", "development", "-q") })
	if err != nil {
		t.Fatalf("build -q: %v", err)
	}
	if strings.TrimSpace(quiet) != "" {
		t.Errorf("build -q should print nothing on success, got:\n%s", quiet)
	}
	if !fsFileExists(filepath.Join(dir, "dist", "app.js")) {
		t.Error("build -q must still build")
	}
}

func TestServerPortShorthandAndHostFlag(t *testing.T) {
	for _, cmd := range []*cobra.Command{devCmd, previewCmd} {
		requireShorthand(t, cmd, "port", "p")
		f := cmd.Flags().Lookup("host")
		if f == nil || f.DefValue != "localhost" || f.NoOptDefVal != hostBareSentinel {
			t.Fatalf("%s --host = %+v, want default localhost and an optional value", cmd.Name(), f)
		}
		_, flags, _ := strings.Cut(helpText(t, cmd), "\nFlags:\n")
		if !strings.Contains(flags, "--host address ") || strings.Contains(flags, `[="`) {
			t.Errorf("%s --help should show --host address with no [=…] suffix:\n%s", cmd.Name(), flags)
		}
	}
	requireShorthand(t, devCmd, "open", "o")
}

// TestResolveHost pins the --host rule end to end: normalizeHostArgs over the
// raw argv (what main does), cobra's flag parse, then the Args validator.
func TestResolveHost(t *testing.T) {
	ipDir := filepath.Join(t.TempDir(), "10.0.0.1")
	mustWrite(t, filepath.Join(ipDir, ".keep"), "")
	chdir(t, filepath.Dir(ipDir)) // "10.0.0.1" now names an existing directory

	tests := []struct {
		name     string
		argv     []string // after "dev"
		wantHost string
		wantArgs []string
		wantErr  string
	}{
		{"omitted", []string{"app"}, "localhost", []string{"app"}, ""},
		{"bare", []string{"--host"}, "0.0.0.0", nil, ""},
		{"bare then dir", []string{"--host", "app"}, "0.0.0.0", []string{"app"}, ""},
		{"equals", []string{"--host=192.168.1.5", "app"}, "192.168.1.5", []string{"app"}, ""},
		{"space ip", []string{"--host", "0.0.0.0"}, "0.0.0.0", nil, ""},
		{"space ip then dir", []string{"--host", "10.0.0.7", "app"}, "10.0.0.7", []string{"app"}, ""},
		{"space ipv6 after dir", []string{"app", "--host", "::"}, "::", []string{"app"}, ""},
		{"space localhost", []string{"--host", "localhost"}, "localhost", nil, ""},
		{"ip-named dir right after --host is the address", []string{"--host", "10.0.0.1"}, "10.0.0.1", nil, ""},
		{"equals is never overridden by an ip positional", []string{"--host=0.0.0.0", "10.0.0.1"}, "0.0.0.0", []string{"10.0.0.1"}, ""},
		{"equals is never overridden by localhost", []string{"--host=0.0.0.0", "localhost"}, "0.0.0.0", []string{"localhost"}, ""},
		{"ip before the flag is not reclaimed", []string{"10.0.0.1", "--host"}, "0.0.0.0", []string{"10.0.0.1"}, ""},
		{"ip after another flag is not reclaimed", []string{"--host", "--strict-port", "10.0.0.1"}, "0.0.0.0", []string{"10.0.0.1"}, ""},
		{"hostname after bare --host is an error", []string{"--host", "my.lan", "app"}, "", nil, "--host takes a hostname only as --host=<name>"},
		{"two dirs without --host is the generic error", []string{"a", "b"}, "", nil, "accepts at most 1 arg"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			argv := normalizeHostArgs(append([]string{"dev"}, tt.argv...))[1:]
			args := parse(t, devCmd, argv...)
			err := serverArgs(devCmd, args)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("dev %v: error %v, want %q", tt.argv, err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("dev %v: %v", tt.argv, err)
			}
			if host := serverHost(devCmd); host != tt.wantHost || strings.Join(args, ",") != strings.Join(tt.wantArgs, ",") {
				t.Errorf("dev %v → host %q args %v, want %q %v", tt.argv, host, args, tt.wantHost, tt.wantArgs)
			}
		})
	}
}

func TestNormalizeHostArgsScope(t *testing.T) {
	for _, tc := range []struct{ in, want []string }{
		{[]string{"preview", "--host", "::1"}, []string{"preview", "--host=::1"}},
		{[]string{"--no-color", "dev", "--host", "127.0.0.1"}, []string{"--no-color", "dev", "--host=127.0.0.1"}},
		{[]string{"build", "--host", "10.0.0.1"}, []string{"build", "--host", "10.0.0.1"}},
		{[]string{"dev", "--", "--host", "10.0.0.1"}, []string{"dev", "--", "--host", "10.0.0.1"}},
	} {
		if got := normalizeHostArgs(tc.in); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("normalizeHostArgs(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// TestNoColorReachesPrintersInRunE: --no-color turns color off for every
// Printer a command creates, not just the environment variable.
func TestNoColorReachesPrintersInRunE(t *testing.T) {
	t.Setenv("NO_COLOR", "")
	t.Setenv("TERM", "xterm-256color")
	if f := rootCmd.PersistentFlags().Lookup("no-color"); f == nil {
		t.Fatal("root needs a persistent --no-color flag")
	}
	var allowed, enabled bool
	probe := &cobra.Command{Use: "color-probe", RunE: func(cmd *cobra.Command, args []string) error {
		allowed = ui.ColorAllowed()
		enabled = ui.New(os.Stdout).Enabled()
		return nil
	}}
	rootCmd.AddCommand(probe)
	t.Cleanup(func() { rootCmd.RemoveCommand(probe) })

	if _, err := execRoot(t, "color-probe"); err != nil {
		t.Fatal(err)
	}
	if !allowed {
		t.Fatal("without --no-color the environment should allow color")
	}
	if _, err := execRoot(t, "color-probe", "--no-color"); err != nil {
		t.Fatal(err)
	}
	if allowed || enabled {
		t.Errorf("under --no-color a Printer made in RunE must be uncoloured (allowed=%v enabled=%v)", allowed, enabled)
	}
}

// TestHasNoColorFlag: main() checks argv before parsing, so a usage error is
// uncoloured too.
func TestHasNoColorFlag(t *testing.T) {
	for args, want := range map[string]bool{
		"dev --no-color --bogus": true,
		"--no-color":             true,
		"build --no-color=true":  true,
		"build":                  false,
		"dev -- --no-color":      false,
	} {
		if got := hasNoColorFlag(strings.Fields(args)); got != want {
			t.Errorf("hasNoColorFlag(%q) = %v, want %v", args, got, want)
		}
	}
}

// TestDoctorJSONMissingDir: a directory that does not exist still yields valid
// JSON, and the command exits non-zero.
func TestDoctorJSONMissingDir(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	var err error
	out := captureStdout(t, func() { _, err = execRoot(t, "doctor", missing, "--json") })
	if err == nil {
		t.Error("doctor --json on a missing dir should exit non-zero")
	}
	var got doctorReport
	if jerr := json.Unmarshal([]byte(out), &got); jerr != nil {
		t.Fatalf("doctor --json on a missing dir is not JSON: %v\n%s", jerr, out)
	}
	if got.OK || got.Failures == 0 || got.Dir != missing {
		t.Errorf("want a failing report for %s, got %+v", missing, got)
	}
}
