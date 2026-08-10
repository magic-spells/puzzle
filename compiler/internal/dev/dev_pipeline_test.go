package dev

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/serve"
)

// TestRecompose asserts the pipeline writes dist/styles.css = Tailwind layer
// (from the private output file) + collected <style>, Tailwind first.
func TestRecompose(t *testing.T) {
	dist := t.TempDir()
	twFile := filepath.Join(t.TempDir(), "tw.css")
	if err := os.WriteFile(twFile, []byte(".tw{display:flex}"), 0o644); err != nil {
		t.Fatal(err)
	}
	pl := &pipeline{
		dist:         dist,
		twOutputPath: twFile,
		collectedCSS: func() string { return ".block{color:red}" },
	}
	pl.commitBuild(true)
	if err := pl.recompose(); err != nil {
		t.Fatalf("recompose: %v", err)
	}
	got := readFile(t, filepath.Join(dist, "styles.css"))
	iTw := strings.Index(got, ".tw{display:flex}")
	iBlock := strings.Index(got, ".block{color:red}")
	if iTw < 0 || iBlock < 0 {
		t.Fatalf("styles.css missing a layer:\n%s", got)
	}
	if iTw > iBlock {
		t.Errorf("Tailwind layer must precede collected <style>; got:\n%s", got)
	}
}

// TestRecomposeMissingTailwindFile: before the watcher first writes, the private
// file may not exist — composition treats the Tailwind layer as empty rather
// than failing.
func TestRecomposeMissingTailwindFile(t *testing.T) {
	dist := t.TempDir()
	pl := &pipeline{
		dist:         dist,
		twOutputPath: filepath.Join(t.TempDir(), "does-not-exist.css"),
		collectedCSS: func() string { return ".only{color:green}" },
	}
	pl.commitBuild(true)
	if err := pl.recompose(); err != nil {
		t.Fatalf("recompose should tolerate a missing Tailwind file: %v", err)
	}
	got := readFile(t, filepath.Join(dist, "styles.css"))
	if strings.TrimSpace(got) != ".only{color:green}" {
		t.Errorf("expected only collected CSS, got: %q", got)
	}
}

// TestRecomposeOnTailwindWrite exercises the full case (a): the warm watcher
// rewrites its private output, pollFile detects it, the pipeline recomposes, and
// a coalesced reload is broadcast to a connected SSE client.
func TestRecomposeOnTailwindWrite(t *testing.T) {
	dist := t.TempDir()
	twFile := filepath.Join(t.TempDir(), "tw.css")
	// Seed empty (as the dev loop does: the temp file exists before the child
	// first writes real utilities).
	if err := os.WriteFile(twFile, []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	srv := newServer(dist, serve.ModeSPA, ctx, nil)
	ts := httptest.NewServer(srv.handler())
	defer ts.Close()

	pl := &pipeline{
		dist:         dist,
		twOutputPath: twFile,
		collectedCSS: func() string { return ".block{color:red}" },
	}
	pl.commitBuild(true)
	coalescer := newReloadCoalescer(20*time.Millisecond, srv.hub.broadcast)

	// Subscribe an SSE client and wait for it to register.
	reqCtx, reqCancel := context.WithCancel(context.Background())
	defer reqCancel()
	req, _ := http.NewRequestWithContext(reqCtx, http.MethodGet, ts.URL+reloadPath, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	waitFor(t, 2*time.Second, func() bool { return srv.hub.clientCount() == 1 })

	events := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if line := sc.Text(); strings.HasPrefix(line, "event:") {
				events <- strings.TrimSpace(strings.TrimPrefix(line, "event:"))
				return
			}
		}
	}()

	// Start the output poll that the dev loop runs for case (a).
	go pollFile(ctx, twFile, 30*time.Millisecond, func() {
		pl.invalidateStyles()
		if err := pl.recompose(); err != nil {
			t.Errorf("recompose: %v", err)
			return
		}
		coalescer.request()
	})

	// Let pollFile seed from the empty file before the write (in the real dev
	// loop the watcher writes asynchronously, well after the poll is established).
	time.Sleep(100 * time.Millisecond)

	// Simulate the warm child writing real utilities.
	if err := os.WriteFile(twFile, []byte(".tw-flex{display:flex}"), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case ev := <-events:
		if ev != "reload" {
			t.Fatalf("SSE event = %q, want reload", ev)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("no reload broadcast after Tailwind wrote its output")
	}

	got := readFile(t, filepath.Join(dist, "styles.css"))
	if !strings.Contains(got, ".tw-flex{display:flex}") || !strings.Contains(got, ".block{color:red}") {
		t.Errorf("styles.css not recomposed with both layers:\n%s", got)
	}
}

func TestPipelineDoesNotPublishBeforeSuccessfulBundle(t *testing.T) {
	dist := t.TempDir()
	target := filepath.Join(dist, "styles.css")
	if err := os.WriteFile(target, []byte("last-good"), 0o644); err != nil {
		t.Fatal(err)
	}
	pl := &pipeline{dist: dist, collectedCSS: func() string { return ".candidate{color:red}" }}

	pl.invalidateStyles()
	if err := pl.recompose(); err != nil {
		t.Fatalf("recompose before first bundle: %v", err)
	}
	if got := readFile(t, target); got != "last-good" {
		t.Fatalf("styles changed before a successful bundle: %q", got)
	}

	pl.commitBuild(false)
	if err := pl.recompose(); err != nil {
		t.Fatalf("recompose after bundle commit: %v", err)
	}
	if got := readFile(t, target); !strings.Contains(got, ".candidate{color:red}") {
		t.Fatalf("pending styles were not published after bundle commit: %q", got)
	}
}

func TestPipelineRetriesDirtyCompositionAfterWriteFailure(t *testing.T) {
	parent := t.TempDir()
	dist := filepath.Join(parent, "missing", "dist")
	pl := &pipeline{dist: dist, collectedCSS: func() string { return ".retry{color:blue}" }}
	pl.commitBuild(true)

	if err := pl.recompose(); err == nil {
		t.Fatal("expected composition into a missing dist directory to fail")
	}
	if err := os.MkdirAll(dist, 0o755); err != nil {
		t.Fatal(err)
	}
	// A later successful source build may have no CSS delta. The failed write's
	// dirty bit must still force this retry.
	pl.commitBuild(false)
	if err := pl.recompose(); err != nil {
		t.Fatalf("dirty retry: %v", err)
	}
	if got := readFile(t, filepath.Join(dist, "styles.css")); !strings.Contains(got, ".retry{color:blue}") {
		t.Fatalf("retry did not publish styles: %q", got)
	}
}

func TestWaitForInitialTailwindOnlyBlocksStaticMode(t *testing.T) {
	tests := []struct {
		name     string
		required bool
		want     int
	}{
		{name: "spa", required: false, want: 0},
		{name: "static", required: true, want: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			waitForInitialTailwind(tt.required, func() { calls++ })
			if calls != tt.want {
				t.Fatalf("wait calls = %d, want %d", calls, tt.want)
			}
		})
	}
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
