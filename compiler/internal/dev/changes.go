package dev

// changes.go — the content filter that stands between a debounced watcher burst
// and a rebuild.
//
// The debounce (runWatcher) coalesces events that arrive within 150ms of each
// other, which is enough for the events ONE save produces back-to-back. It is
// not enough for the events one save produces AROUND a rebuild: onChange runs
// synchronously in the watcher loop, so for the whole duration of a rebuild
// nothing drains fsnotify. A trailing metadata-only event — the CHTIMES half of
// an editor save, a formatter-on-save touch, a `touch` that follows a write —
// is therefore delivered only after the rebuild returns, lands in a fresh
// debounce window, and schedules a SECOND rebuild over bytes the first one
// already compiled. Measured on the reference site (2.3s static rebuilds), that
// is the "one save, two rebuilds" behavior; it reproduces in internal/dev tests
// whenever a rebuild outlasts the gap between a save's events.
//
// Widening the debounce does not fix it (the gap is a function of rebuild time,
// not of editor behavior) and would make genuine successive saves feel laggy.
// So the filter asks the only question that matters: did the BYTES change since
// the last burst this loop acted on? A burst whose every path still hashes to
// what we already built from is dropped entirely and no rebuild is scheduled;
// anything new, changed, or deleted rebuilds exactly as before. Two real saves
// 50ms apart still produce two bursts with two distinct hashes, so rapid
// successive editing is untouched.
//
// Deliberately a content hash rather than mtime+size: an editor that rewrites a
// file byte-for-byte (undo, reformat-to-identical, save-with-no-edit) is the
// same no-op, and size alone misses a same-length edit.

import (
	"crypto/sha256"
	"os"
	"sync"
)

// changeFilter remembers the content of every path a burst has already been
// acted on with. The zero value is not usable — construct with newChangeFilter.
type changeFilter struct {
	mu sync.Mutex
	// seen maps an absolute path to the sha256 of the bytes the loop last
	// accepted for it. A path absent from the map has never been seen, so its
	// first event always passes.
	seen map[string][32]byte
}

func newChangeFilter() *changeFilter {
	return &changeFilter{seen: map[string][32]byte{}}
}

// pending returns the subset of paths whose content differs from what the filter
// last accepted, recording the new content as it goes. An empty result means the
// whole burst was a metadata-only echo of work already done and the caller must
// not rebuild.
//
// Failure modes all fall through to "changed", because the cost of a redundant
// rebuild is a second of dev time while the cost of a missed one is a stale
// page: an unreadable file (deleted, renamed away, mid-write) is reported as
// changed and its record dropped, so the next event for that path is a first
// sighting again.
func (f *changeFilter) pending(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}
	var out []string
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			delete(f.seen, p)
			out = append(out, p)
			continue
		}
		sum := sha256.Sum256(data)
		if prev, ok := f.seen[p]; ok && prev == sum {
			continue
		}
		f.seen[p] = sum
		out = append(out, p)
	}
	return out
}
