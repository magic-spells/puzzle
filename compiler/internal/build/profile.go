package build

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// ProfileEnvVar turns the build profiler on for any process that runs a build,
// including `puzzle dev`'s static rebuild path — which calls build.Build
// directly and therefore has no CLI flag of its own to carry the request.
const ProfileEnvVar = "PUZZLE_PROFILE_BUILD"

// buildProfile accumulates wall-clock timings for the phases of ONE Build.
//
// A nil *buildProfile is the disabled state, and every method is nil-safe, so an
// unprofiled build pays a single nil comparison per phase and allocates nothing:
// phase returns the shared no-op closure rather than a fresh one. That is why
// the profiler is threaded as a possibly-nil pointer instead of an interface or
// a bool + branch at each call site.
type buildProfile struct {
	start  time.Time
	phases []phaseTiming
}

type phaseTiming struct {
	name string
	dur  time.Duration
}

// noPhase is the shared closure returned by a disabled profiler. Package-level
// so `defer prof.phase(…)()` on a nil profiler is allocation-free.
var noPhase = func() {}

// newBuildProfile returns a live profiler when enabled, nil otherwise.
func newBuildProfile(enabled bool) *buildProfile {
	if !enabled {
		return nil
	}
	return &buildProfile{start: time.Now()}
}

// profileEnabled reports whether this build should be profiled: the explicit
// Options.Profile request, or PUZZLE_PROFILE_BUILD set to anything but the
// obvious off values.
func profileEnabled(opt bool) bool {
	if opt {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv(ProfileEnvVar))) {
	case "", "0", "false", "no":
		return false
	default:
		return true
	}
}

// phase starts timing a named phase and returns the function that ends it.
// Phases are recorded in completion order and may nest — the report prints them
// flat, so a nested phase is simply listed after the one that contains it.
func (p *buildProfile) phase(name string) func() {
	if p == nil {
		return noPhase
	}
	started := time.Now()
	return func() {
		p.phases = append(p.phases, phaseTiming{name: name, dur: time.Since(started)})
	}
}

// report prints the phase table. It goes to stderr, never stdout: stdout carries
// the build summary that scripts and the skipped-route gate parse, and profiling
// must not change it.
func (p *buildProfile) report(w io.Writer) {
	if p == nil {
		return
	}
	total := time.Since(p.start)
	nameW := len("total")
	for _, ph := range p.phases {
		if n := len(ph.name); n > nameW {
			nameW = n
		}
	}
	fmt.Fprintf(w, "\n  puzzle build · profile\n\n")
	for _, ph := range p.phases {
		fmt.Fprintf(w, "  %-*s  %8s\n", nameW, ph.name, formatPhase(ph.dur))
	}
	fmt.Fprintf(w, "  %s\n", strings.Repeat("─", nameW+10))
	fmt.Fprintf(w, "  %-*s  %8s\n", nameW, "total", formatPhase(total))
}

// formatPhase renders a duration in whole milliseconds — the resolution that
// matters for a build, and stable enough to eyeball across runs.
func formatPhase(d time.Duration) string {
	return fmt.Sprintf("%dms", d.Round(time.Millisecond).Milliseconds())
}
