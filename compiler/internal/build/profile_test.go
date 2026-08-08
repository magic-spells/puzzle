package build

import (
	"bytes"
	"strings"
	"testing"
)

// A disabled profiler must be safe to use everywhere Build threads it, and must
// print nothing — that is the whole zero-cost claim.
func TestNilProfileIsInert(t *testing.T) {
	var prof *buildProfile
	end := prof.phase("bundle")
	end()

	var buf bytes.Buffer
	prof.report(&buf)
	if buf.Len() != 0 {
		t.Fatalf("disabled profiler wrote %q", buf.String())
	}
}

func TestProfileReportListsPhasesInOrder(t *testing.T) {
	prof := newBuildProfile(true)
	if prof == nil {
		t.Fatal("newBuildProfile(true) returned nil")
	}
	prof.phase("config load")()
	prof.phase("browser bundle")()

	var buf bytes.Buffer
	prof.report(&buf)
	out := buf.String()

	for _, want := range []string{"puzzle build · profile", "config load", "browser bundle", "total"} {
		if !strings.Contains(out, want) {
			t.Fatalf("report missing %q:\n%s", want, out)
		}
	}
	if i, j := strings.Index(out, "config load"), strings.Index(out, "browser bundle"); i > j {
		t.Fatalf("phases out of completion order:\n%s", out)
	}
}

func TestProfileEnabledReadsEnv(t *testing.T) {
	cases := []struct {
		env  string
		want bool
	}{
		{env: "", want: false},
		{env: "0", want: false},
		{env: "false", want: false},
		{env: " NO ", want: false},
		{env: "1", want: true},
		{env: "yes", want: true},
	}
	for _, c := range cases {
		t.Setenv(ProfileEnvVar, c.env)
		if got := profileEnabled(false); got != c.want {
			t.Fatalf("profileEnabled(false) with %s=%q = %v, want %v", ProfileEnvVar, c.env, got, c.want)
		}
	}

	// The explicit option wins regardless of the environment.
	t.Setenv(ProfileEnvVar, "0")
	if !profileEnabled(true) {
		t.Fatal("Options.Profile must enable profiling even when the env var says off")
	}
}
