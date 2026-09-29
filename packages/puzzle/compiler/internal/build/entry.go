package build

import (
	"fmt"
	"path/filepath"
)

// The app's build entry, as app-root-relative slash paths (D54). A TypeScript
// app starts from app/app.ts, a JavaScript app from app/app.js; the output is
// dist/app.js either way. puzzle.config.js is NOT an entry and stays
// JavaScript — node reads it before any bundling happens.
const (
	EntryTS = "app/app.ts"
	EntryJS = "app/app.js"
)

// ResolveEntry returns the absolute path of the build entry for the app rooted
// at root: app/app.ts when it exists, otherwise app/app.js. Every consumer of
// the entry — the one-shot build, both dev watchers, both prerender passes, the
// --fixtures wrapper and `puzzle doctor` — asks this function, so the rule lives
// in one place.
//
// Both files present is an error naming both: the build never guesses which one
// the developer meant. Neither present is the long-standing "entry point not
// found" error.
func ResolveEntry(root string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolving app root: %w", err)
	}
	ts := filepath.Join(absRoot, filepath.FromSlash(EntryTS))
	js := filepath.Join(absRoot, filepath.FromSlash(EntryJS))
	hasTS, hasJS := FileExists(ts), FileExists(js)
	switch {
	case hasTS && hasJS:
		return "", fmt.Errorf(
			"%s: conflicting build entries — %s also exists. An app has exactly one entry: app/app.ts for a TypeScript app, app/app.js otherwise; delete the one you are not using",
			ts, js,
		)
	case hasTS:
		return ts, nil
	case hasJS:
		return js, nil
	}
	return "", fmt.Errorf("entry point not found in %s (expected app.ts or app.js)", filepath.Dir(js)+string(filepath.Separator))
}

// entryUnchanged re-resolves the entry during a dev session and reports an
// error when it no longer matches the one the session's esbuild context was
// built over — a second entry file appeared, or the entry was renamed between
// app.js and app.ts. The context's entry point is frozen at construction, so
// rebuilding on would silently compile the wrong file.
func entryUnchanged(absRoot, entry string) error {
	now, err := ResolveEntry(absRoot)
	if err != nil {
		return err
	}
	if now != entry {
		return fmt.Errorf("the build entry changed from %s to %s — restart puzzle dev", entryRel(absRoot, entry), entryRel(absRoot, now))
	}
	return nil
}

func entryRel(absRoot, p string) string {
	if rel, err := filepath.Rel(absRoot, p); err == nil {
		return filepath.ToSlash(rel)
	}
	return p
}
