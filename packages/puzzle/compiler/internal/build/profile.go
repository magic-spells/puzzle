package build

import (
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// ProfileEnvVar turns the build profiler on for any process that runs a build,
// including `puzzle dev`'s static rebuild path — which calls build.Build
// directly and therefore has no CLI flag of its own to carry the request.
const ProfileEnvVar = "PUZZLE_PROFILE_BUILD"

// PhaseProfile accumulates wall-clock timings for one build or rebuild.
//
// A nil *PhaseProfile is the disabled state, and every method is nil-safe, so an
// unprofiled build pays a single nil comparison per phase and allocates nothing:
// Phase returns the shared no-op closure rather than a fresh one. The mutex and
// start-order ordinal let independent build phases finish concurrently without
// racing or making the report order depend on scheduler timing.
type PhaseProfile struct {
	mu     sync.Mutex
	start  time.Time
	label  string
	next   uint64
	phases []phaseTiming
}

type phaseTiming struct {
	order uint64
	name  string
	dur   time.Duration
}

// buildProfile keeps the existing build-package call sites compact while the
// exported name lets the dev package use the same profiler.
type buildProfile = PhaseProfile

// noPhase is the shared closure returned by a disabled profiler. Package-level
// so `defer prof.phase(…)()` on a nil profiler is allocation-free.
var noPhase = func() {}

// newBuildProfile returns a live profiler when enabled, nil otherwise.
func newBuildProfile(enabled bool) *buildProfile {
	return NewPhaseProfile(enabled, "puzzle build")
}

// NewPhaseProfile returns a labeled live profiler when enabled, nil otherwise.
// Callers that accept both a flag and ProfileEnvVar should pass
// ProfileEnabled(flag) as enabled.
func NewPhaseProfile(enabled bool, label string) *PhaseProfile {
	if !enabled {
		return nil
	}
	return &PhaseProfile{start: time.Now(), label: label}
}

// profileEnabled reports whether this build should be profiled: the explicit
// Options.Profile request, or PUZZLE_PROFILE_BUILD set to anything but the
// obvious off values.
func profileEnabled(opt bool) bool {
	return ProfileEnabled(opt)
}

// ProfileEnabled reports whether profiling was explicitly requested or enabled
// through PUZZLE_PROFILE_BUILD. Obvious false spellings keep it disabled.
func ProfileEnabled(opt bool) bool {
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

// Phase starts timing a named phase and returns the function that ends it.
// The phase's report position is fixed here, before concurrent work starts;
// completion order therefore cannot reorder the table.
func (p *PhaseProfile) Phase(name string) func() {
	if p == nil {
		return noPhase
	}
	p.mu.Lock()
	order := p.next
	p.next++
	p.mu.Unlock()
	started := time.Now()
	return func() {
		p.mu.Lock()
		p.phases = append(p.phases, phaseTiming{order: order, name: name, dur: time.Since(started)})
		p.mu.Unlock()
	}
}

// phase is the build-package spelling retained for existing call sites.
func (p *PhaseProfile) phase(name string) func() { return p.Phase(name) }

// Report prints the phase table. It goes to stderr, never stdout: stdout carries
// the build summary that scripts and the skipped-route gate parse, and profiling
// must not change it.
func (p *PhaseProfile) Report(w io.Writer) {
	if p == nil {
		return
	}
	p.mu.Lock()
	start := p.start
	label := p.label
	phases := append([]phaseTiming(nil), p.phases...)
	p.mu.Unlock()
	sort.SliceStable(phases, func(i, j int) bool { return phases[i].order < phases[j].order })
	total := time.Since(start)
	nameW := len("total")
	for _, ph := range phases {
		if n := len(ph.name); n > nameW {
			nameW = n
		}
	}
	fmt.Fprintf(w, "\n  %s · profile\n\n", label)
	for _, ph := range phases {
		fmt.Fprintf(w, "  %-*s  %8s\n", nameW, ph.name, formatPhase(ph.dur))
	}
	fmt.Fprintf(w, "  %s\n", strings.Repeat("─", nameW+10))
	fmt.Fprintf(w, "  %-*s  %8s\n", nameW, "total", formatPhase(total))
}

// report is the build-package spelling retained for existing call sites.
func (p *PhaseProfile) report(w io.Writer) { p.Report(w) }

// formatPhase renders a duration in whole milliseconds — the resolution that
// matters for a build, and stable enough to eyeball across runs.
func formatPhase(d time.Duration) string {
	return fmt.Sprintf("%dms", d.Round(time.Millisecond).Milliseconds())
}
