package main

import (
	"bytes"
	"encoding/json"
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
