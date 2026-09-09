package dev

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestChangeFilterDropsMetadataOnlyEcho is the unit statement of the
// double-rebuild fix: the same bytes seen twice is one change, different bytes
// is two. settled(true) after each accepted burst mirrors the dev loop, which
// tells the filter how the rebuild it scheduled ended.
func TestChangeFilterDropsMetadataOnlyEcho(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "Home.pzl")
	if err := os.WriteFile(f, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	filter := newChangeFilter()
	accept := func(want int, why string) {
		t.Helper()
		got := filter.pending([]string{f})
		if len(got) != want {
			t.Fatalf("%s: want %d paths, got %v", why, want, got)
		}
		if len(got) > 0 {
			filter.settled(true)
		}
	}

	accept(1, "first sighting should pass")
	// A bare touch: mtime moves, content does not.
	now := time.Now().Add(time.Second)
	if err := os.Chtimes(f, now, now); err != nil {
		t.Fatal(err)
	}
	accept(0, "metadata-only echo should be dropped")
	// A real edit passes, and so does a second real edit right behind it.
	os.WriteFile(f, []byte("two"), 0o644)
	accept(1, "content change should pass")
	os.WriteFile(f, []byte("three"), 0o644)
	accept(1, "a rapid successive save must not be swallowed")
	// A rewrite with identical bytes is a no-op.
	os.WriteFile(f, []byte("three"), 0o644)
	accept(0, "identical rewrite should be dropped")
	// Deletion is a change, and re-creation after it is a first sighting again.
	os.Remove(f)
	accept(1, "deletion should pass")
	os.WriteFile(f, []byte("three"), 0o644)
	accept(1, "re-creation should pass")
}

// TestChangeFilterRetriesAfterFailedRebuild: the fix for a broken build is
// usually somewhere else, and the save that follows it is often byte-identical.
// A failed rebuild must leave that save able to retry.
func TestChangeFilterRetriesAfterFailedRebuild(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "Home.pzl")
	if err := os.WriteFile(f, []byte("broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	filter := newChangeFilter()
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("first sighting should pass, got %v", got)
	}
	filter.settled(false) // the rebuild it scheduled failed

	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("a re-save after a failed rebuild must retry, got %v", got)
	}
}

// TestChangeFilterTouchOutsideEchoWindow: `touch`ing a .pzl is how you pick up
// an edited module the watcher does not cover. It changes no bytes, so it is
// only ever dropped as an echo of the rebuild that just ran — once that window
// has closed it must schedule a rebuild like anything else.
func TestChangeFilterTouchOutsideEchoWindow(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "Home.pzl")
	if err := os.WriteFile(f, []byte("stable"), 0o644); err != nil {
		t.Fatal(err)
	}
	filter := newChangeFilter()
	filter.window = 20 * time.Millisecond

	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("first sighting should pass, got %v", got)
	}
	filter.settled(true)
	if got := filter.pending([]string{f}); len(got) != 0 {
		t.Fatalf("the echo inside the window should be dropped, got %v", got)
	}
	time.Sleep(40 * time.Millisecond)
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("a touch after the echo window must rebuild, got %v", got)
	}
}

// TestOneSaveOneRebuildAcrossSlowRebuild drives the real watcher: a save whose
// trailing metadata event lands AFTER a slow rebuild has finished (the shape
// that produced two rebuilds per save on the reference site) must schedule
// exactly one rebuild once the burst goes through the filter.
func TestOneSaveOneRebuildAcrossSlowRebuild(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "app", "views")
	if err := os.MkdirAll(app, 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(app, "Home.pzl")
	os.WriteFile(f, []byte("x"), 0o644)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	filter := newChangeFilter()
	var mu sync.Mutex
	rebuilds := 0
	go runWatcher(ctx, []string{filepath.Join(root, "app")}, "", debounceInterval, func(changed []string) {
		changed = filter.pending(changed)
		if len(changed) == 0 {
			return
		}
		mu.Lock()
		rebuilds++
		mu.Unlock()
		// Stand in for a slow static rebuild: while this runs no fsnotify event
		// is drained, so the save's trailing event lands in a fresh window.
		time.Sleep(900 * time.Millisecond)
		filter.settled(true)
	})

	time.Sleep(300 * time.Millisecond)
	os.WriteFile(f, []byte("edited"), 0o644)
	time.Sleep(400 * time.Millisecond)
	now := time.Now()
	os.Chtimes(f, now, now)
	time.Sleep(2500 * time.Millisecond)

	mu.Lock()
	got := rebuilds
	mu.Unlock()
	if got != 1 {
		t.Fatalf("one save should schedule one rebuild, got %d", got)
	}
}
