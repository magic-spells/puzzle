package main

import (
	"bytes"
	"encoding/json"
	"io"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

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
	if help := helpText(t, cmd); strings.Contains(help, "--"+name+" ") {
		t.Errorf("%s --help lists hidden flag --%s:\n%s", cmd.Name(), name, help)
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
	if addCmd.Flags().Lookup("overwrite").Deprecated == "" {
		t.Error("--overwrite should be marked deprecated in favour of --force")
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
