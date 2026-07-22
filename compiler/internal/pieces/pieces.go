package pieces

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// themeMarker is the header comment carried in the registry's theme/pieces.css.
// Its presence in the app's styles.css is how we know the design tokens the
// pieces style themselves with have already been merged in.
const themeMarker = "puzzle-pieces design tokens"

// Options configures one `add piece` run. AppRoot is already resolved (the cmd
// layer walks up for package.json/puzzle.config.js) and Fetcher is already bound
// to a source, so this package does no path walking or source selection.
type Options struct {
	AppRoot   string
	Names     []string
	Fetcher   Fetcher
	Overwrite bool
}

// FileWrite is one copied file in the Result: its app-root-relative slash path,
// absolute path, and recorded hash.
type FileWrite struct {
	Rel  string
	Abs  string
	Hash string
}

// Unit groups the files copied for one piece or one lib dep. Name is the piece
// name ("button") or the lib registry path ("lib/date-math.js") — the same key
// used in pieces.lock.
type Unit struct {
	Name  string
	IsLib bool
	Files []FileWrite
}

// Result reports what Add copied and what the user still has to do by hand.
type Result struct {
	AppRoot  string
	Source   string
	Units    []Unit
	NpmDeps  []string // deduped + sorted; never installed (D3)
	Theme    string   // non-empty ⇒ the `@import './pieces.css';` next-step advisory
	LockPath string
}

// plannedFile is a fetched-but-not-yet-written file: the bytes are held so the
// pre-flight overwrite check can run against every destination BEFORE the first
// write, keeping `add piece` all-or-nothing.
type plannedFile struct {
	rel  string
	abs  string
	data []byte
}

type plannedUnit struct {
	name  string
	isLib bool
	files []plannedFile
}

// Add resolves the requested pieces (with transitive deps), copies every file
// verbatim into AppRoot, records hashes in pieces.lock, and returns the next
// steps (npm install line, theme import advisory) for the caller to print. It is
// all-or-nothing on conflicts: if any destination exists and Overwrite is false,
// nothing is written.
func Add(opts Options) (*Result, error) {
	regData, err := opts.Fetcher.Fetch("registry.json")
	if err != nil {
		// A dead default source is almost always "the registry isn't published
		// yet / no override set" — name the two overrides, or the user is stuck
		// staring at a bare 404 on a URL they never chose.
		if opts.Fetcher.Source() == defaultRegistry {
			return nil, fmt.Errorf(
				"%w\n  (the default public registry isn't reachable — point at a registry with --registry <path|url> or the PUZZLE_PIECES_REGISTRY env var)", err)
		}
		return nil, err
	}
	var reg Registry
	if err := json.Unmarshal(regData, &reg); err != nil {
		return nil, fmt.Errorf("parsing registry.json: %w", err)
	}
	// The registry's theme path is untrusted manifest input like files/targetDir/
	// registryDependencies, so validate it the same way and BEFORE any write —
	// a `"theme": "../../.env"` would otherwise be read outside the registry and
	// copied into app/styles/pieces.css (applyTheme, state b). An empty theme uses
	// the built-in "theme/pieces.css" default and needs no check.
	if reg.Theme != "" {
		if err := validateManifestPath("registry", "theme", reg.Theme); err != nil {
			return nil, err
		}
	}

	resolvedPieces, libs, err := resolveAll(&reg, opts.Names)
	if err != nil {
		return nil, err
	}

	// Fetch everything up front so the pre-flight check sees every destination.
	units, err := planWrites(&opts, resolvedPieces, libs)
	if err != nil {
		return nil, err
	}

	// Pre-flight: refuse to clobber. List EVERY conflict (not just the first) so
	// the user can resolve them in one pass, and write nothing until this passes.
	if !opts.Overwrite {
		if err := checkConflicts(units); err != nil {
			return nil, err
		}
	}

	result := &Result{AppRoot: opts.AppRoot, Source: opts.Fetcher.Source()}
	for _, u := range units {
		ru := Unit{Name: u.name, IsLib: u.isLib}
		for _, f := range u.files {
			if err := os.MkdirAll(filepath.Dir(f.abs), 0o755); err != nil {
				return nil, err
			}
			if err := os.WriteFile(f.abs, f.data, 0o644); err != nil {
				return nil, fmt.Errorf("writing %s: %w", f.rel, err)
			}
			ru.Files = append(ru.Files, FileWrite{Rel: f.rel, Abs: f.abs, Hash: hashBytes(f.data)})
		}
		result.Units = append(result.Units, ru)
	}

	// Accumulate npm deps across every resolved piece (deduped, sorted). Printed
	// as a next step, never executed (D3 — no network installs at build time).
	result.NpmDeps = collectNpmDeps(resolvedPieces)

	// Theme is registry content too: pieces style themselves through its @theme
	// tokens, so we COPY it into app/styles/pieces.css and lock it exactly like a
	// piece — that's what lets a future update/diff track the theme instead of it
	// being an untracked manual paste. The one thing we can't do is wire the
	// import: styles.css is user-owned (D3), so the `@import './pieces.css';` line
	// stays a printed next step. Runs BEFORE the lock write so a freshly-copied
	// theme lands in the same lock pass as the pieces.
	themeUnit, advisory, err := applyTheme(&opts, &reg)
	if err != nil {
		return nil, err
	}
	if themeUnit != nil {
		result.Units = append(result.Units, *themeUnit)
	}
	result.Theme = advisory

	// pieces.lock: merge in the units just copied (pieces, libs, and the theme),
	// preserving prior entries.
	result.LockPath = filepath.Join(opts.AppRoot, LockFileName)
	if err := updateLock(result.LockPath, result.Source, result.Units); err != nil {
		return nil, err
	}

	return result, nil
}

// planWrites fetches every piece and lib file and computes its destination.
func planWrites(opts *Options, resolvedPieces []Piece, libs []string) ([]plannedUnit, error) {
	resolvedRoot, err := filepath.Abs(opts.AppRoot)
	if err != nil {
		return nil, fmt.Errorf("resolving app root %s: %w", opts.AppRoot, err)
	}
	resolvedRoot, err = filepath.EvalSymlinks(resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolving app root %s: %w", opts.AppRoot, err)
	}

	var units []plannedUnit
	libOwners := make(map[string]string)
	for _, p := range resolvedPieces {
		targetDir := p.TargetDir
		if targetDir == "" {
			targetDir = defaultTargetDir
		}
		if err := validateManifestPath(p.Name, "targetDir", targetDir); err != nil {
			return nil, err
		}
		for _, dep := range p.RegistryDependencies {
			if strings.HasPrefix(dep, libPrefix) {
				if err := validateManifestPath(p.Name, "registryDependencies", dep); err != nil {
					return nil, err
				}
				if _, ok := libOwners[dep]; !ok {
					libOwners[dep] = p.Name
				}
			}
		}
		u := plannedUnit{name: p.Name}
		for _, file := range p.Files {
			if err := validateManifestPath(p.Name, "files", file); err != nil {
				return nil, err
			}
			// A piece's files live at ui/<name>/<file> in the registry regardless
			// of where they land in the app (targetDir).
			regPath := path.Join("ui", p.Name, file)
			rel := path.Join(filepath.ToSlash(targetDir), file)
			abs, err := containedWritePath(resolvedRoot, rel, p.Name, "files", file)
			if err != nil {
				return nil, err
			}
			data, err := opts.Fetcher.Fetch(regPath)
			if err != nil {
				return nil, err
			}
			u.files = append(u.files, plannedFile{
				rel:  rel,
				abs:  abs,
				data: data,
			})
		}
		units = append(units, u)
	}
	for _, lib := range libs {
		// A lib dep's registry path IS the dependency string; it lands in app/lib/
		// under its basename.
		data, err := opts.Fetcher.Fetch(lib)
		if err != nil {
			return nil, err
		}
		rel := path.Join("app", "lib", path.Base(lib))
		abs, err := containedWritePath(resolvedRoot, rel, libOwners[lib], "registryDependencies", lib)
		if err != nil {
			return nil, err
		}
		units = append(units, plannedUnit{
			name:  lib,
			isLib: true,
			files: []plannedFile{{
				rel:  rel,
				abs:  abs,
				data: data,
			}},
		})
	}
	return units, nil
}

// validateManifestPath rejects registry-controlled paths that are absolute or
// contain a parent-directory segment. Backslashes are normalized for the check
// so a manifest cannot be safe on POSIX but escape when the CLI runs on Windows.
func validateManifestPath(piece, field, value string) error {
	normalized := strings.ReplaceAll(value, `\`, "/")
	isDriveAbs := len(normalized) >= 3 && normalized[1] == ':' && normalized[2] == '/'
	if path.IsAbs(normalized) || filepath.IsAbs(value) || isDriveAbs {
		return fmt.Errorf("piece %q has invalid %s %q: absolute paths are not allowed", piece, field, value)
	}
	for _, segment := range strings.Split(normalized, "/") {
		if segment == ".." {
			return fmt.Errorf("piece %q has invalid %s %q: parent-directory '..' segments are not allowed", piece, field, value)
		}
	}
	return nil
}

// containedWritePath resolves the destination as far as the filesystem exists
// and verifies the result remains under the symlink-resolved app root. Resolving
// the nearest existing ancestor catches an in-project directory symlink that
// points outside even when the final file does not exist yet.
func containedWritePath(resolvedRoot, rel, piece, field, value string) (string, error) {
	joined := filepath.Join(resolvedRoot, filepath.FromSlash(rel))
	abs, err := evalSymlinksAllowMissing(joined)
	if err != nil {
		return "", fmt.Errorf("piece %q has invalid %s %q: resolving destination: %w", piece, field, value, err)
	}
	fromRoot, err := filepath.Rel(resolvedRoot, abs)
	if err != nil || fromRoot == ".." || strings.HasPrefix(fromRoot, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("piece %q has invalid %s %q: destination resolves outside the project root", piece, field, value)
	}
	return abs, nil
}

// evalSymlinksAllowMissing mirrors filepath.EvalSymlinks for a destination that
// may not exist yet: resolve the nearest existing ancestor, then append the
// missing suffix. A dangling symlink fails closed instead of being mistaken for
// a missing ordinary path segment.
func evalSymlinksAllowMissing(name string) (string, error) {
	current := name
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(current)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		if _, lerr := os.Lstat(current); lerr == nil {
			return "", err
		} else if !os.IsNotExist(lerr) {
			return "", lerr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}

// checkConflicts returns an error listing every existing destination path.
func checkConflicts(units []plannedUnit) error {
	var conflicts []string
	for _, u := range units {
		for _, f := range u.files {
			switch _, err := os.Stat(f.abs); {
			case err == nil:
				conflicts = append(conflicts, f.rel)
			case !os.IsNotExist(err):
				return fmt.Errorf("checking %s: %w", f.rel, err)
			}
		}
	}
	if len(conflicts) == 0 {
		return nil
	}
	sort.Strings(conflicts)
	return fmt.Errorf("refusing to overwrite existing file(s) (use --overwrite to replace):\n  %s",
		strings.Join(conflicts, "\n  "))
}

// collectNpmDeps unions the npm dependencies of every resolved piece.
func collectNpmDeps(resolvedPieces []Piece) []string {
	set := map[string]bool{}
	for _, p := range resolvedPieces {
		for _, d := range p.Dependencies {
			set[d] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	deps := make([]string, 0, len(set))
	for d := range set {
		deps = append(deps, d)
	}
	sort.Strings(deps)
	return deps
}

// themeImportAdvisory is the single manual line the user must add — styles.css is
// user-owned, so we never edit it (D3), we only tell them the one import to wire.
const themeImportAdvisory = "add `@import './pieces.css';` to app/styles/styles.css (after `@import \"tailwindcss\";`)"

// applyTheme reconciles the registry's design-token theme with the app, in three
// states keyed off app/styles/styles.css and app/styles/pieces.css:
//
//	(a) styles.css already carries the tokens — the manual-merge marker, or an
//	    import that references pieces.css — nothing to do, no advisory.
//	(b) not wired AND app/styles/pieces.css is absent — copy the registry theme
//	    verbatim to app/styles/pieces.css, return it as a Unit (so it's locked +
//	    shown), and advise the import.
//	(c) not wired BUT pieces.css already exists — leave the file alone (never
//	    rewrite it — same reason we won't touch styles.css) and advise the import.
//
// A missing styles.css counts as "not wired". The copy is additive and skipped
// when pieces.css exists, so it deliberately sits OUTSIDE the piece/lib overwrite
// pre-flight — an existing pieces.css is state (c), not a conflict.
func applyTheme(opts *Options, reg *Registry) (unit *Unit, advisory string, err error) {
	theme := reg.Theme
	if theme == "" {
		theme = "theme/pieces.css"
	}

	stylesPath := filepath.Join(opts.AppRoot, "app", "styles", "styles.css")
	styles := ""
	switch data, readErr := os.ReadFile(stylesPath); {
	case readErr == nil:
		styles = string(data)
	case !os.IsNotExist(readErr):
		return nil, "", fmt.Errorf("reading %s: %w", stylesPath, readErr)
	}

	// (a) Already wired — a hand-merged token block, or an import pulling pieces.css in.
	if strings.Contains(styles, themeMarker) || strings.Contains(styles, "pieces.css") {
		return nil, "", nil
	}

	piecesPath := filepath.Join(opts.AppRoot, "app", "styles", "pieces.css")
	switch _, statErr := os.Stat(piecesPath); {
	case statErr == nil:
		// (c) pieces.css present but unwired — advise only, don't rewrite the user's file.
		return nil, themeImportAdvisory, nil
	case !os.IsNotExist(statErr):
		return nil, "", fmt.Errorf("checking %s: %w", piecesPath, statErr)
	}

	// (b) Copy the registry theme verbatim, then lock it like any other unit.
	data, err := opts.Fetcher.Fetch(theme)
	if err != nil {
		return nil, "", err
	}
	if err := os.MkdirAll(filepath.Dir(piecesPath), 0o755); err != nil {
		return nil, "", err
	}
	if err := os.WriteFile(piecesPath, data, 0o644); err != nil {
		return nil, "", fmt.Errorf("writing app/styles/pieces.css: %w", err)
	}
	// Keyed by its registry path ("theme/pieces.css"), same lock shape as a lib.
	return &Unit{
		Name: theme,
		Files: []FileWrite{{
			Rel:  "app/styles/pieces.css",
			Abs:  piecesPath,
			Hash: hashBytes(data),
		}},
	}, themeImportAdvisory, nil
}

// RenderSummary prints the copy report and next steps through the CLI's Printer,
// matching the init/add aesthetic (a header, one ✓ line per unit, a Next steps
// block). Lib deps get their own ✓ line so a shared util is shown once.
func RenderSummary(w io.Writer, out *ui.Printer, res *Result) {
	fmt.Fprintf(w, "%s %s\n", out.Cyan(out.Bold("puzzle add piece")), out.Dim("· "+res.Source))
	for _, u := range res.Units {
		n := len(u.Files)
		fmt.Fprintf(w, "  %s %s %s\n",
			out.Green("✓"), out.Bold(u.Name), out.Dim(fmt.Sprintf("· %d file%s", n, plural(n))))
	}

	if len(res.NpmDeps) == 0 && res.Theme == "" {
		return
	}
	fmt.Fprintf(w, "\n  %s\n", out.Bold("Next steps"))
	if len(res.NpmDeps) > 0 {
		fmt.Fprintf(w, "    %s %s\n", out.Dim("$"), "npm install "+strings.Join(res.NpmDeps, " "))
	}
	if res.Theme != "" {
		fmt.Fprintf(w, "    %s %s\n", out.Yellow("→"), res.Theme)
	}
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
