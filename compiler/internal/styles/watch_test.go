package styles

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// longRunningCLI returns a fake ResolvedCLI standing in for `tailwindcss
// --watch`: a shell loop that never exits on its own. StartWatch appends
// --watch/-i/-o after Args; with `sh -c <script> <arg0> ...` those land as
// positional params the script ignores, so it just loops until killed. (Unix
// only — the child-lifecycle behavior is identical enough that skipping Windows
// in this unit test is acceptable; the real CLI is exercised in the manual proof.)
func longRunningCLI() ResolvedCLI {
	return ResolvedCLI{
		Name: "fake-tailwind",
		Exec: "sh",
		Args: []string{"-c", "while true; do sleep 0.05; done", "fake-tailwind"},
	}
}

func TestWatcherKilledOnContextCancel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake shell watcher is unix-only")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cli := longRunningCLI()
	w, err := StartWatch(ctx, WatchOptions{
		AppRoot: t.TempDir(),
		Output:  filepath.Join(t.TempDir(), "out.css"),
		CLI:     &cli,
	})
	if err != nil {
		t.Fatalf("StartWatch: %v", err)
	}

	// It must still be running: Done stays open.
	select {
	case <-w.Done():
		t.Fatal("watcher exited immediately; expected a long-running child")
	case <-time.After(250 * time.Millisecond):
	}

	// Cancelling the context must kill it.
	cancel()
	select {
	case <-w.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("watcher not killed within 3s of context cancel")
	}
}

func TestWatcherKilledOnStop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake shell watcher is unix-only")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cli := longRunningCLI()
	w, err := StartWatch(ctx, WatchOptions{
		AppRoot: t.TempDir(),
		Output:  filepath.Join(t.TempDir(), "out.css"),
		CLI:     &cli,
	})
	if err != nil {
		t.Fatalf("StartWatch: %v", err)
	}
	w.Stop()
	select {
	case <-w.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("watcher not killed within 3s of Stop()")
	}
	// Stop is idempotent.
	w.Stop()
}

// selfExitingCLI stands in for a `tailwindcss --watch` child that exits on its
// own (crash / unexpected termination). The script exits immediately; StartWatch
// appends --watch/-o as ignored positional params.
func selfExitingCLI() ResolvedCLI {
	return ResolvedCLI{
		Name: "fake-tailwind-selfexit",
		Exec: "sh",
		Args: []string{"-c", "exit 0", "fake-tailwind"},
	}
}

// TestWatcherStdinReleasedOnSelfExit proves the self-exit path releases the
// held-open stdin write end (the ctx-watch goroutine must Stop() on <-w.done, not
// just return). Without the fix the fd leaks for the session.
func TestWatcherStdinReleasedOnSelfExit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake shell watcher is unix-only")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cli := selfExitingCLI()
	w, err := StartWatch(ctx, WatchOptions{
		AppRoot: t.TempDir(),
		Output:  filepath.Join(t.TempDir(), "out.css"),
		CLI:     &cli,
	})
	if err != nil {
		t.Fatalf("StartWatch: %v", err)
	}
	if w.stdin == nil {
		t.Skip("stdin pipe unavailable on this platform; nothing to assert")
	}

	// The child exits on its own — Done must close without any cancel or Stop.
	select {
	case <-w.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("self-exiting child never exited")
	}

	// Poll the write end: with the child gone but the pipe still open, a write
	// reports a broken pipe (EPIPE); once Stop() closes it, a write reports
	// os.ErrClosed. Waiting for ErrClosed proves the fd was released, not leaked.
	deadline := time.Now().Add(3 * time.Second)
	for {
		_, werr := w.stdin.Write([]byte{0})
		if errors.Is(werr, os.ErrClosed) {
			return // released — no fd leak.
		}
		if time.Now().After(deadline) {
			t.Fatalf("stdin write end not closed after self-exit (fd leak); last write err = %v", werr)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestWatcherStartError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cli := ResolvedCLI{Name: "bogus", Exec: "puzzle-nonexistent-binary-xyz", Args: nil}
	if _, err := StartWatch(ctx, WatchOptions{
		AppRoot: t.TempDir(),
		Output:  filepath.Join(t.TempDir(), "out.css"),
		CLI:     &cli,
	}); err == nil {
		t.Fatal("expected StartWatch to error when the CLI cannot be started")
	}
}
