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
//
// The hash alone would be too strong a rule, though, because unchanged bytes are
// not always a no-op:
//
//   - After a FAILED rebuild the natural thing to do is fix the cause elsewhere
//     and hit save again. If that save is byte-identical the session would sit on
//     the error overlay forever.
//   - `touch`ing a .pzl is the documented way to pick up an edited module the
//     watcher does not cover (a sibling directory outside app/), and a touch by
//     definition changes no bytes.
//
// So the drop rule is scoped to what it was built for: the echo arrives in the
// very next burst after the rebuild it echoes — its events were already sitting
// in fsnotify's channel while that rebuild ran — so identical bytes are ignored
// only inside a short window that opens when a rebuild SUCCEEDS and closes
// echoWindow later (settled). Outside that window, and after any failure, every
// event rebuilds. Suppression therefore always expires on its own: no watcher
// event can be swallowed with no way to get it back.

import (
	"crypto/sha256"
	"os"
	"sync"
	"time"
)

// echoWindow is how long after a rebuild an identical-bytes burst still counts
// as that rebuild's trailing metadata event. The echo lands one debounce
// interval after the rebuild stops draining events; the rest is slack for a
// loaded machine. Overshooting costs at most one manual re-save that has to be
// repeated, undershooting costs the redundant rebuild the filter exists to kill.
const echoWindow = 2 * time.Second

// changeFilter remembers the content of every path a burst has already been
// acted on with. The zero value is not usable — construct with newChangeFilter.
type changeFilter struct {
	mu sync.Mutex
	// seen maps an absolute path to the sha256 of the bytes the loop last
	// accepted for it. A path absent from the map has never been seen, so its
	// first event always passes.
	seen map[string][32]byte
	// echoUntil is the instant the current echo window closes; a zero value means
	// no rebuild has succeeded since the last failure and nothing is suppressed.
	echoUntil time.Time
	// window is echoWindow, per-filter so a test can shrink or widen it.
	window time.Duration
}

func newChangeFilter() *changeFilter {
	return &changeFilter{seen: map[string][32]byte{}, window: echoWindow}
}

// pending returns the subset of paths that warrant a rebuild, recording the
// content it accepted as it goes. An empty result means the whole burst was a
// metadata-only echo of work already done and the caller must not rebuild.
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
	// Outside the echo window every event is taken at face value; the hashes are
	// still recorded, because the next rebuild's echo is compared against them.
	echo := !f.echoUntil.IsZero() && time.Now().Before(f.echoUntil)
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			delete(f.seen, p)
			out = append(out, p)
			continue
		}
		sum := sha256.Sum256(data)
		if prev, ok := f.seen[p]; echo && ok && prev == sum {
			continue
		}
		f.seen[p] = sum
		out = append(out, p)
	}
	return out
}

// settled reports how the rebuild that consumed the last accepted burst ended.
// A success opens the echo window over the bytes that rebuild was made from; a
// failure closes it AND forgets those bytes, so the very next event — including
// a re-save of the identical file the developer just tried — rebuilds.
func (f *changeFilter) settled(ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !ok {
		f.seen = map[string][32]byte{}
		f.echoUntil = time.Time{}
		return
	}
	f.echoUntil = time.Now().Add(f.window)
}
