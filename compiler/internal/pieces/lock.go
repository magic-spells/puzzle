package pieces

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
)

// LockFileName is the per-app manifest recording exactly which pieces were
// copied in and the sha256 of each copied file. It exists so a future
// diff/update command can distinguish upstream drift from local edits — the
// reason we copy verbatim instead of stamping.
const LockFileName = "pieces.lock"

// Lock is the pieces.lock document. Field order here is the emitted key order
// (version, registry, pieces); map keys marshal sorted, giving a stable,
// diff-friendly file.
type Lock struct {
	Version  int                  `json:"version"`
	Registry string               `json:"registry"`
	Pieces   map[string]LockEntry `json:"pieces"`
}

// LockEntry records a piece's (or lib's) copied files: app-root-relative slash
// path → "sha256:<hex>".
type LockEntry struct {
	Files map[string]string `json:"files"`
}

// hashBytes returns the "sha256:<hex>" digest recorded for a copied file.
func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// readLock loads an existing pieces.lock, or returns a fresh empty one when none
// exists. A file that is present but not valid JSON is a hard error — silently
// clobbering it would destroy the provenance a diff/update relies on.
func readLock(path string) (*Lock, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Lock{Version: 1, Pieces: map[string]LockEntry{}}, nil
		}
		return nil, err
	}
	var lock Lock
	if err := json.Unmarshal(data, &lock); err != nil {
		return nil, fmt.Errorf("malformed %s (%s): %w — refusing to overwrite it", LockFileName, path, err)
	}
	if lock.Pieces == nil {
		lock.Pieces = map[string]LockEntry{}
	}
	return &lock, nil
}

// updateLock merges the just-copied units into pieces.lock, preserving entries
// for pieces added in earlier runs. Re-adding a piece REPLACES its entry (the
// files/hashes are now current); other keys are untouched.
func updateLock(path, source string, units []Unit) error {
	lock, err := readLock(path)
	if err != nil {
		return err
	}
	lock.Version = 1
	lock.Registry = source
	for _, u := range units {
		files := make(map[string]string, len(u.Files))
		for _, f := range u.Files {
			files[f.Rel] = f.Hash
		}
		lock.Pieces[u.Name] = LockEntry{Files: files}
	}
	return writeLock(path, lock)
}

// writeLock emits pieces.lock as 2-space-indented JSON with a trailing newline.
func writeLock(path string, lock *Lock) error {
	data, err := json.MarshalIndent(lock, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}
