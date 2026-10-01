package fsutil

import (
	"os"
	"path/filepath"
	"strings"
)

// CanonicalCase returns the absolute path with every component spelled the way
// the filesystem stores it. On a case-insensitive volume (macOS APFS and NTFS by
// default) `cd ~/code/app` succeeds against a directory named Code, and every
// path derived from that spelling carries the wrong case. Tools that compare
// paths as strings then disagree: the `tailwindcss --watch` child is handed
// .../code/... while its file events arrive as .../Code/..., so edits to an
// @imported stylesheet never match a dependency and never rebuild.
//
// Each component is looked up in its parent directory, preferring an exact
// match and otherwise taking the case-insensitive one, so the walk is a no-op
// on a case-sensitive filesystem. filepath.EvalSymlinks cannot do this job: on
// macOS it keeps the caller's spelling, and symlinks are deliberately left
// unresolved here. A component with no listed match keeps its spelling (a
// Windows 8.3 short name still resolves); a relative path, or a directory that
// cannot be listed (including one below a missing component), returns the
// input unchanged. The volume name (a Windows drive letter or UNC
// \\server\share prefix) is kept as given.
func CanonicalCase(path string) string {
	if !filepath.IsAbs(path) {
		return path
	}
	path = filepath.Clean(path)
	vol := filepath.VolumeName(path)
	sep := string(filepath.Separator)
	rest := strings.TrimPrefix(path[len(vol):], sep)
	if rest == "" {
		return path
	}
	out := vol + sep
	for _, part := range strings.Split(rest, sep) {
		name, err := entryName(out, part)
		if err != nil {
			return path
		}
		out = filepath.Join(out, name)
	}
	return out
}

// entryName returns the name dir stores for part: part itself when an entry
// matches exactly or none matches, else the first entry equal to it under case
// folding. The error is dir's, when it cannot be listed.
func entryName(dir, part string) (string, error) {
	f, err := os.Open(dir)
	if err != nil {
		return "", err
	}
	names, err := f.Readdirnames(-1)
	f.Close()
	if err != nil {
		return "", err
	}
	folded := part
	for _, name := range names {
		if name == part {
			return part, nil
		}
		if folded == part && strings.EqualFold(name, part) {
			folded = name
		}
	}
	return folded, nil
}
