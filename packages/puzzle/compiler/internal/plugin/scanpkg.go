package plugin

// scanpkg.go — the usage scan's second half: .pzl sources shipped inside
// installed packages (DECISION-D89).
//
// The project walk prunes node_modules at any depth, which is right for the
// thousands of packages that hold no Puzzle source. But a component package
// that ships .pzl files is compiled by this build's .pzl OnLoad like any
// first-party template, so its feature usage has to reach the same defines and
// the same formatter manifest — or `raw()` in a package component compiles to
// a vnode whose runtime half was stripped.
//
// Which packages count: one whose package.json lists "@magic-spells/puzzle" in
// peerDependencies or dependencies — except Puzzle itself, and except an app
// (the project or an ancestor of it, or any directory with a puzzle.config.js:
// a workspace sibling app linked into node_modules is not a dependency). One
// manifest read per package root is the whole cost of an ordinary package, and
// an uncounted package's files are never read. Inside a counted package the
// walk reads .pzl files ONLY, and drops their lazy() text match — a package's
// JavaScript is runtime-like code (a router helper, a bundled build) where the
// loose lazy() regex would trip on anything, and lazy() route tables live in
// the app, never in a component package. It skips example/, examples/, test/,
// tests/ and __tests__/ at the package root, which a linked checkout carries
// and a published package leaves out.
//
// Where: the node_modules directly under the scan root and under each of its
// ancestors — the directories node resolution itself would search from the
// project — plus the nested node_modules of EVERY package (a Puzzle package
// can be the dependency of one that is not), plus the node_modules that holds
// the real directory of a linked or counted package (a store layout that
// symlinks top-level entries into a shared virtual store keeps a package's own
// dependencies beside it there). Every directory is visited by its real path,
// so a symlinked package (npm link, a store layout) is read once however many
// names point at it; only link entries pay for resolving one.
//
// A package this rule misses — no declaration, a broken package.json, a linked
// folder outside every node_modules — is not silently mis-built: the plugin's
// per-file check (see Plugin.featureMismatches) fails the build naming the file
// and the feature.

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// puzzlePackage is the framework's own package name: the dependency a Puzzle
// component package declares, and the one package the walk never reads.
const puzzlePackage = "@magic-spells/puzzle"

// pkgEntry memoizes one package root's classification by its package.json
// stamp, so a long-lived scanner re-reads a manifest only when it changed.
type pkgEntry struct {
	stamp   scanStamp
	counted bool
}

// pkgWalk is one Scan's package pass. lists and pkgs hold real paths already
// visited this pass, so a symlinked or repeated directory is read once.
type pkgWalk struct {
	s     *UsageScanner
	root  string
	allow map[string]bool
	usage *Usage
	seen  map[string]bool
	lists map[string]bool
	pkgs  map[string]bool
}

// scanPackages folds the usage of every counted package's .pzl files into
// usage. Like the project walk it is fail-soft: an unreadable directory or
// manifest contributes nothing and never fails the scan.
func (s *UsageScanner) scanPackages(root string, allow map[string]bool, usage *Usage, seen map[string]bool) {
	w := &pkgWalk{s: s, root: root, allow: allow, usage: usage, seen: seen, lists: map[string]bool{}, pkgs: map[string]bool{}}
	for dir := root; ; {
		w.list(filepath.Join(dir, "node_modules"))
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	for dir := range s.pkgs {
		if !w.pkgs[dir] {
			delete(s.pkgs, dir)
		}
	}
}

// list visits every package in one node_modules directory, resolving the
// directory itself first.
func (w *pkgWalk) list(nodeModules string) {
	real, err := filepath.EvalSymlinks(nodeModules)
	if err != nil {
		return
	}
	w.listReal(real)
}

// listReal visits every package in a node_modules directory already known by
// its real path: unscoped entries directly, scoped ones one level down. Dot
// entries (.bin, a store directory, caches) are not packages. An entry that is
// not a symlink is already a real path, so only links pay for EvalSymlinks —
// on a large flat install that is most of the walk's cost.
func (w *pkgWalk) listReal(real string) {
	if w.lists[real] {
		return
	}
	w.lists[real] = true
	entries, err := os.ReadDir(real)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		dir := filepath.Join(real, name)
		link := e.Type()&fs.ModeSymlink != 0
		if !strings.HasPrefix(name, "@") {
			w.pkg(dir, link)
			continue
		}
		if link {
			if dir, err = filepath.EvalSymlinks(dir); err != nil {
				continue
			}
		}
		scoped, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, c := range scoped {
			if !strings.HasPrefix(c.Name(), ".") {
				w.pkg(filepath.Join(dir, c.Name()), c.Type()&fs.ModeSymlink != 0)
			}
		}
	}
}

// pkgSkipDirs are folders at a counted package's root that hold no shipped
// component source: a linked checkout carries its examples and tests, which a
// published package leaves out of `files`. dist/build/vendor are deliberately
// NOT pruned here, unlike the project walk: a package commonly publishes its
// .pzl sources under dist/, and a Puzzle build never writes .pzl into one, so
// pruning them would lose real usage and gain nothing.
var pkgSkipDirs = map[string]bool{
	"example":   true,
	"examples":  true,
	"test":      true,
	"tests":     true,
	"__tests__": true,
}

// pkg reads one package root's manifest and, when it declares Puzzle, every
// .pzl inside it. Whatever the verdict, the package's own nested node_modules
// is listed (a Puzzle package can be the dependency of one that is not), and
// so is the node_modules holding its real directory when the entry was a
// link (a store layout keeps a package's dependencies beside it). An
// uncounted package's files are never read.
func (w *pkgWalk) pkg(dir string, link bool) {
	real := dir
	if link {
		var err error
		if real, err = filepath.EvalSymlinks(dir); err != nil {
			return
		}
	}
	if w.pkgs[real] {
		return
	}
	w.pkgs[real] = true
	counted := w.s.declaresPuzzle(real)
	if counted && w.isApp(real) {
		return
	}
	if counted {
		w.readPZL(real)
	}
	nested := filepath.Join(real, "node_modules")
	if fi, err := os.Lstat(nested); err == nil {
		if fi.Mode()&fs.ModeSymlink != 0 {
			w.list(nested)
		} else if fi.IsDir() {
			w.listReal(nested)
		}
	}
	if link || counted {
		if nm := containingNodeModules(real); nm != "" {
			w.listReal(nm)
		}
	}
}

// isApp reports whether a declaring package is really an app — the project
// itself or one of its ancestors (a workspace root linked into node_modules),
// or any directory holding a puzzle.config.js (a sibling app in a workspace).
// An app's templates are its own build's business, not a dependency's.
func (w *pkgWalk) isApp(real string) bool {
	if real == w.root || strings.HasPrefix(w.root, real+string(filepath.Separator)) {
		return true
	}
	_, err := os.Stat(filepath.Join(real, "puzzle.config.js"))
	return err == nil
}

// readPZL folds every .pzl under a counted package into the usage.
func (w *pkgWalk) readPZL(real string) {
	_ = filepath.WalkDir(real, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() && path != real {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if path == real {
				return nil
			}
			switch name := d.Name(); {
			case name == "node_modules":
				// Nested dependencies are packages in their own right: only the
				// ones that declare Puzzle are read.
				w.list(path)
				return fs.SkipDir
			case strings.HasPrefix(name, "."):
				return fs.SkipDir
			case pkgSkipDirs[name] && filepath.Dir(path) == real:
				return fs.SkipDir
			}
			return nil
		}
		if filepath.Ext(path) == ".pzl" && d.Type().IsRegular() {
			w.s.visit(w.root, path, d, w.allow, w.usage, w.seen, true)
		}
		return nil
	})
}

// containingNodeModules returns the node_modules directory a package's real
// directory sits in (`…/node_modules/kit`, `…/node_modules/@x/kit`), or "" for
// a package that lives elsewhere (a linked checkout).
func containingNodeModules(pkgDir string) string {
	parent := filepath.Dir(pkgDir)
	if strings.HasPrefix(filepath.Base(parent), "@") {
		parent = filepath.Dir(parent)
	}
	if filepath.Base(parent) == "node_modules" {
		return parent
	}
	return ""
}

// declaresPuzzle reports whether the package at dir lists Puzzle in
// peerDependencies or dependencies, memoized by its package.json stamp. A
// missing or malformed manifest does not count.
func (s *UsageScanner) declaresPuzzle(dir string) bool {
	manifest := filepath.Join(dir, "package.json")
	info, err := os.Stat(manifest)
	if err != nil {
		delete(s.pkgs, dir)
		return false
	}
	stamp := scanStamp{modUnixNano: info.ModTime().UnixNano(), size: info.Size()}
	if prev, ok := s.pkgs[dir]; ok && prev.stamp == stamp {
		return prev.counted
	}
	counted := manifestDeclaresPuzzle(manifest)
	s.pkgs[dir] = pkgEntry{stamp: stamp, counted: counted}
	return counted
}

func manifestDeclaresPuzzle(manifest string) bool {
	data, err := os.ReadFile(manifest)
	if err != nil {
		return false
	}
	var pkg struct {
		Name             string                     `json:"name"`
		Dependencies     map[string]json.RawMessage `json:"dependencies"`
		PeerDependencies map[string]json.RawMessage `json:"peerDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil || pkg.Name == puzzlePackage {
		return false
	}
	_, peer := pkg.PeerDependencies[puzzlePackage]
	_, dep := pkg.Dependencies[puzzlePackage]
	return peer || dep
}
