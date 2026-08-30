package plugin

// scanmemo.go — the per-file memo that makes the usage scan incremental.
//
// ScanUsage is a serial walk that READS AND FULLY PARSES every .pzl in the
// project (SplitSections + ParseTemplate, plus ParseSkeleton when present) to
// answer the formatter union plus the D85 flip, D144 Portal, and D150 raw-block
// feature facts, and additionally READS (never parses) every .js/.ts-family
// module for the D163 lazy() bit. All are properties of the source
// tree, and a one-shot build runs the walk once — fine.
//
// A dev session runs it on EVERY rebuild, over a tree in which exactly one file
// changed. On the reference site that is 262 full template parses to discover
// that 261 of them still say what they said 400ms ago. The parse result per
// file is a pure function of its bytes, so the scanner keeps a memo keyed by
// path + mtime + size and re-parses only the files whose stamp moved.
//
// mtime+size rather than a content hash: the point is to avoid READING the
// file, and hashing requires reading it. The failure mode of a stamp collision
// (a same-size edit written back inside the filesystem's mtime resolution) is
// bounded and self-correcting in the direction that matters: a stale entry can
// only lose NEWLY-added usage for one rebuild, and the next
// edit to that file — or any edit that moves its size — restores it. The
// compile path is unaffected: it is keyed by content hash (cache.go), so the
// generated module is never stale.
//
// A scanner is safe for use from one goroutine at a time, which is what the
// build/dev callers do (the walk itself is serial).

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// fileUsage is one file's contribution to the project-wide Usage.
type fileUsage struct {
	formatters         []string
	hasFlip            bool
	hasPortal          bool
	hasRawAt           bool
	hasLazy            bool
	hasScopedTemplates bool
}

// scanStamp identifies a file version cheaply enough to check without reading.
type scanStamp struct {
	modUnixNano int64
	size        int64
}

type scanEntry struct {
	stamp scanStamp
	usage fileUsage
}

// UsageScanner is a reusable, incremental ScanUsage. Construct one per
// long-lived builder; a one-shot build has nothing to reuse and calls ScanUsage
// instead.
type UsageScanner struct {
	entries map[string]scanEntry
}

// NewUsageScanner returns an empty scanner. Its first Scan is a full walk.
func NewUsageScanner() *UsageScanner {
	return &UsageScanner{entries: map[string]scanEntry{}}
}

// Scan walks scanRoot and returns the project-wide Usage, re-reading only the
// files whose mtime or size changed since the previous Scan. It follows
// ScanUsage's contract exactly — same walk, same pruned directories, same
// fail-soft handling of unreadable or unparseable files — so the two are
// interchangeable and a builder can be tested against either.
func (s *UsageScanner) Scan(scanRoot string) (Usage, error) {
	allow, err := builtinAllowlist()
	if err != nil {
		return Usage{}, err
	}

	usage := Usage{Formatters: map[string]bool{}}
	root := filepath.Clean(scanRoot)
	// Files seen this pass, so entries for deleted files are dropped rather than
	// contributing their usage forever.
	seen := make(map[string]bool, len(s.entries))

	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if path != root && skipScanDir(d.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		if !IsScanInput(path) {
			return nil
		}
		seen[path] = true

		stamp := scanStamp{}
		if info, err := d.Info(); err == nil {
			stamp = scanStamp{modUnixNano: info.ModTime().UnixNano(), size: info.Size()}
		}
		if prev, ok := s.entries[path]; ok && prev.stamp == stamp && stamp != (scanStamp{}) {
			mergeFileUsage(&usage, prev.usage)
			return nil
		}

		fu := scanFileUsage(root, path, allow)
		s.entries[path] = scanEntry{stamp: stamp, usage: fu}
		mergeFileUsage(&usage, fu)
		return nil
	})
	if err != nil {
		return Usage{}, err
	}
	for path := range s.entries {
		if !seen[path] {
			delete(s.entries, path)
		}
	}
	return usage, nil
}

// mergeFileUsage folds one file's contribution into the project-wide result.
func mergeFileUsage(usage *Usage, fu fileUsage) {
	for _, name := range fu.formatters {
		usage.Formatters[name] = true
	}
	if fu.hasFlip {
		usage.HasFlip = true
	}
	if fu.hasPortal {
		usage.HasPortal = true
	}
	if fu.hasRawAt {
		usage.HasRawAt = true
	}
	if fu.hasLazy {
		usage.HasLazy = true
	}
	if fu.hasScopedTemplates {
		usage.HasScopedTemplates = true
	}
}

// scanFileUsage reads and parses one .pzl and returns its contribution. It is
// the body of the ScanUsage walk, extracted so the memo and the one-shot walk
// cannot drift: unreadable, empty, or unparseable files contribute nothing and
// never fail the scan (see ScanUsage for why over-inclusion is the safe
// direction and a scan failure is not).
func scanFileUsage(root, path string, allow map[string]bool) fileUsage {
	src, err := os.ReadFile(path)
	if err != nil {
		return fileUsage{}
	}
	raw := string(src)
	if strings.TrimSpace(raw) == "" {
		return fileUsage{}
	}

	// Script-level facts come from the RAW bytes and apply to both kinds of file:
	// a plain .js/.ts module, and a .pzl whose <script> section calls lazy(). This
	// runs before the template parse so a .pzl the parser rejects still
	// contributes its script usage — the fail-soft path must not lose a bit whose
	// false negative breaks the app.
	one := fileUsage{}
	scanScriptUsage(raw, &one)

	if filepath.Ext(path) != ".pzl" {
		return one
	}

	name := filepath.ToSlash(path)
	if rel, err := filepath.Rel(root, path); err == nil && !strings.HasPrefix(rel, "..") {
		name = filepath.ToSlash(rel)
	}

	sec, err := parser.SplitSections(raw, name)
	if err != nil {
		return one
	}
	tree, err := parser.ParseTemplate(sec, name)
	if err != nil {
		return one
	}

	tpl := Usage{Formatters: map[string]bool{}}
	collectUsage(tree, &tpl, allow)
	// Codegen also emits formatter calls inside renderSkeleton(), so a builtin
	// used ONLY in a skeleton must be seeded too.
	if sec.HasSkeleton {
		if skel, serr := parser.ParseSkeleton(sec, name); serr == nil && skel != nil {
			collectUsage(skel, &tpl, allow)
		}
	}

	one.hasFlip = tpl.HasFlip
	one.hasPortal = tpl.HasPortal
	one.hasRawAt = tpl.HasRawAt
	one.hasScopedTemplates = tpl.HasScopedTemplates
	for formatter := range tpl.Formatters {
		one.formatters = append(one.formatters, formatter)
	}
	return one
}
