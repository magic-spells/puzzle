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
// is two.
func TestChangeFilterDropsMetadataOnlyEcho(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "Home.pzl")
	if err := os.WriteFile(f, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}
	filter := newChangeFilter()

	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("first sighting should pass, got %v", got)
	}
	// A bare touch: mtime moves, content does not.
	now := time.Now().Add(time.Second)
	if err := os.Chtimes(f, now, now); err != nil {
		t.Fatal(err)
	}
	if got := filter.pending([]string{f}); len(got) != 0 {
		t.Fatalf("metadata-only echo should be dropped, got %v", got)
	}
	// A real edit passes, and so does a second real edit right behind it.
	os.WriteFile(f, []byte("two"), 0o644)
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("content change should pass, got %v", got)
	}
	os.WriteFile(f, []byte("three"), 0o644)
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("a rapid successive save must not be swallowed, got %v", got)
	}
	// A rewrite with identical bytes is a no-op.
	os.WriteFile(f, []byte("three"), 0o644)
	if got := filter.pending([]string{f}); len(got) != 0 {
		t.Fatalf("identical rewrite should be dropped, got %v", got)
	}
	// Deletion is a change, and re-creation after it is a first sighting again.
	os.Remove(f)
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("deletion should pass, got %v", got)
	}
	os.WriteFile(f, []byte("three"), 0o644)
	if got := filter.pending([]string{f}); len(got) != 1 {
		t.Fatalf("re-creation should pass, got %v", got)
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
