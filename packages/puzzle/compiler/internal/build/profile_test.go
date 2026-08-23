package build

import (
	"bytes"
	"strings"
	"sync"
	"testing"
)

// A disabled profiler must be safe to use everywhere Build threads it, and must
// print nothing — that is the whole zero-cost claim.
func TestNilProfileIsInert(t *testing.T) {
	var prof *PhaseProfile
	end := prof.Phase("bundle")
	end()

	var buf bytes.Buffer
	prof.Report(&buf)
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
		t.Fatalf("phases out of start order:\n%s", out)
	}
}

func TestPhaseProfileUsesLabel(t *testing.T) {
	prof := NewPhaseProfile(true, "puzzle dev · rebuild")
	prof.Phase("browser bundle")()

	var buf bytes.Buffer
	prof.Report(&buf)
	if out := buf.String(); !strings.Contains(out, "puzzle dev · rebuild · profile") {
		t.Fatalf("profile report missing its label:\n%s", out)
	}
}

func TestPhaseProfileConcurrentCompletionKeepsStartOrder(t *testing.T) {
	prof := NewPhaseProfile(true, "concurrent")
	ends := []func(){
		prof.Phase("first"),
		prof.Phase("second"),
		prof.Phase("third"),
	}

	triggers := []chan struct{}{make(chan struct{}), make(chan struct{}), make(chan struct{})}
	completed := make(chan int, len(ends))
	var wg sync.WaitGroup
	for i, end := range ends {
		wg.Add(1)
		go func(i int, end func()) {
			defer wg.Done()
			<-triggers[i]
			end()
			completed <- i
		}(i, end)
	}
	for _, i := range []int{2, 1, 0} {
		close(triggers[i])
		if got := <-completed; got != i {
			t.Fatalf("phase %d completed while releasing phase %d", got, i)
		}
	}
	wg.Wait()

	var buf bytes.Buffer
	prof.Report(&buf)
	out := buf.String()
	first := strings.Index(out, "first")
	second := strings.Index(out, "second")
	third := strings.Index(out, "third")
	if first < 0 || second < 0 || third < 0 || !(first < second && second < third) {
		t.Fatalf("concurrent phases not reported in start order:\n%s", out)
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
		if got := ProfileEnabled(false); got != c.want {
			t.Fatalf("ProfileEnabled(false) with %s=%q = %v, want %v", ProfileEnvVar, c.env, got, c.want)
		}
	}

	// The explicit option wins regardless of the environment.
	t.Setenv(ProfileEnvVar, "0")
	if !ProfileEnabled(true) {
		t.Fatal("Options.Profile must enable profiling even when the env var says off")
	}
}
