package build

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

// TestSPADevBuildTiming is an opt-in measurement for the wide SPA graph that
// benefits from change-aware rebuild work. It deliberately has no wall-clock
// assertion: host load is noisy, while the metadata and artifact assertions
// below prove each sample performed the intended work rather than timing a
// no-op. Run with PUZZLE_BENCH_SPA_DEV=1.
func TestSPADevBuildTiming(t *testing.T) {
	if os.Getenv("PUZZLE_BENCH_SPA_DEV") == "" {
		t.Skip("set PUZZLE_BENCH_SPA_DEV=1 to run the SPA dev build timing")
	}

	const (
		routes     = 148
		components = 100
		samples    = 7
	)
	root := writeSSGFixture(t, largeStaticFixture(routes, components))
	t.Logf("fixture: %d routes, %d .pzl files", routes, routes+components+1)

	var cold []time.Duration
	for i := 0; i < samples; i++ {
		start := time.Now()
		builder, err := NewWatchBuilder(root, WatchOptions{})
		if err != nil {
			t.Fatalf("cold builder %d: %v", i, err)
		}
		result, rebuildErr := builder.Rebuild(nil)
		builder.Dispose()
		if rebuildErr != nil {
			t.Fatalf("cold rebuild %d: %v", i, rebuildErr)
		}
		if !result.PublicSynced || !result.CSSChanged || !result.BundleBuilt {
			t.Fatalf("cold rebuild %d metadata = %+v", i, result)
		}
		cold = append(cold, time.Since(start))
	}

	builder, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer builder.Dispose()
	if _, err := builder.Rebuild(nil); err != nil {
		t.Fatalf("warm-up rebuild: %v", err)
	}

	leaf := filepath.Join(root, "app", "views", "V007.pzl")
	leafBase, err := os.ReadFile(leaf)
	if err != nil {
		t.Fatal(err)
	}
	var pzl []time.Duration
	for i := 0; i < samples; i++ {
		marker := fmt.Sprintf("SPA_PZL_REV_%d", i)
		body := strings.Replace(string(leafBase), "Page 7", marker, 1) +
			fmt.Sprintf("\n<style>.spa-bench-%d { --rev: %d; }</style>\n", i, i)
		write(t, leaf, body)
		start := time.Now()
		result, err := builder.Rebuild([]string{leaf})
		pzl = append(pzl, time.Since(start))
		if err != nil {
			t.Fatalf("warm .pzl rebuild %d: %v", i, err)
		}
		if !result.UsageScanned || result.PublicSynced || !result.CSSChanged || !result.BundleBuilt {
			t.Fatalf("warm .pzl rebuild %d metadata = %+v", i, result)
		}
		if css := builder.CSS(); !strings.Contains(css, fmt.Sprintf(".spa-bench-%d", i)) {
			t.Fatalf("warm .pzl rebuild %d did not publish its CSS", i)
		}
		if bundle := readDistBundle(t, root); !strings.Contains(bundle, marker) {
			t.Fatalf("warm .pzl rebuild %d did not publish its template marker", i)
		}
	}

	routesFile := filepath.Join(root, "app", "routes.js")
	routesBase, err := os.ReadFile(routesFile)
	if err != nil {
		t.Fatal(err)
	}
	var js []time.Duration
	for i := 0; i < samples; i++ {
		marker := fmt.Sprintf("SPA_JS_REV_%d", i)
		body := string(routesBase) + fmt.Sprintf("\nglobalThis.__PUZZLE_BENCH_ROUTES__ = %q;\n", marker)
		write(t, routesFile, body)
		start := time.Now()
		result, err := builder.Rebuild([]string{routesFile})
		js = append(js, time.Since(start))
		if err != nil {
			t.Fatalf("warm JS rebuild %d: %v", i, err)
		}
		if result.UsageScanned || result.PublicSynced || result.CSSChanged || !result.BundleBuilt {
			t.Fatalf("warm JS rebuild %d metadata = %+v", i, result)
		}
		if bundle := readDistBundle(t, root); !strings.Contains(bundle, marker) {
			t.Fatalf("warm JS rebuild %d did not publish its marker", i)
		}
	}

	publicFile := filepath.Join(root, "app", "public", "spa-bench.txt")
	var public []time.Duration
	for i := 0; i < samples; i++ {
		marker := fmt.Sprintf("SPA_PUBLIC_REV_%d", i)
		write(t, publicFile, marker)
		start := time.Now()
		result, err := builder.Rebuild([]string{publicFile})
		public = append(public, time.Since(start))
		if err != nil {
			t.Fatalf("warm public rebuild %d: %v", i, err)
		}
		if result.UsageScanned || !result.PublicSynced || result.CSSChanged || result.BundleBuilt {
			t.Fatalf("warm public rebuild %d metadata = %+v", i, result)
		}
		got, err := os.ReadFile(filepath.Join(root, "dist", "spa-bench.txt"))
		if err != nil || string(got) != marker {
			t.Fatalf("warm public rebuild %d output = %q, %v", i, got, err)
		}
	}

	median := func(ds []time.Duration) time.Duration {
		ordered := append([]time.Duration(nil), ds...)
		sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
		return ordered[len(ordered)/2]
	}
	t.Logf("cold builder + initial rebuild: median %v (all: %v)", median(cold), cold)
	t.Logf("warm .pzl + component CSS:    median %v (all: %v)", median(pzl), pzl)
	t.Logf("warm JS/routes edit:          median %v (all: %v)", median(js), js)
	t.Logf("warm public asset edit:       median %v (all: %v)", median(public), public)
}
