package pieces

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/textutil"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// themesDir is where a NON-default palette lands. The default theme keeps its
// historical destination (app/styles/pieces.css) so `add theme default` and
// `add piece` stay idempotent with each other.
const themesDir = "app/styles/themes"

// packageThemePrefix is the subpath @magic-spells/puzzle-pieces exports its
// palettes under. An app that imports one straight from the package already has
// the theme — copying a second, drifting copy into app/styles/ is exactly the
// hand-copy problem this command exists to end.
const packageThemePrefix = "@magic-spells/puzzle-pieces/themes/"

// defaultThemeName is the registry name of the palette that IS Registry.Theme.
const defaultThemeName = "default"

// defaultModes is the mode set assumed when a registry omits `modes` — the three
// the pieces themes have always shipped.
var defaultModes = []string{"light", "medium", "dark"}

// ThemeState is what `add theme` found or did for one palette. The zero value is
// never used; every planned theme gets one explicitly.
type ThemeState string

const (
	// ThemeCopied — the file was written on this run.
	ThemeCopied ThemeState = "copied"
	// ThemeUpToDate — already present and not locally modified; skipped.
	ThemeUpToDate ThemeState = "up to date"
	// ThemeWired — the app's styles.css already carries these tokens.
	ThemeWired ThemeState = "wired"
	// ThemeWiredViaPackage — styles.css imports the palette from the npm package,
	// so a copy would only drift from it.
	ThemeWiredViaPackage ThemeState = "wired via package"
	// ThemeInstalled — listing-only: the destination file exists.
	ThemeInstalled ThemeState = "installed"
	// ThemeAbsent — listing-only: not installed and not wired.
	ThemeAbsent ThemeState = "—"
)

// ThemeOptions configures one `add theme` run. Like Options, AppRoot is already
// resolved and Fetcher already bound to a source.
type ThemeOptions struct {
	AppRoot   string
	Names     []string
	Fetcher   Fetcher
	Overwrite bool
}

// ThemeOutcome is one palette's line in the summary or the listing.
type ThemeOutcome struct {
	Name        string
	Label       string
	Description string
	State       ThemeState
	// Rel is the app-root-relative destination, set whenever one exists on disk
	// or was written (empty for a package-wired theme).
	Rel string
}

// ThemeResult reports what `add theme <name…>` did and what the user still has
// to wire by hand (styles.css is user-owned — D3, we print, never rewrite).
type ThemeResult struct {
	AppRoot   string
	Source    string
	Themes    []ThemeOutcome
	NextSteps []string
}

// ThemeListing is `puzzle add theme` with no name: the registry's palettes with
// this app's install state for each.
type ThemeListing struct {
	Source string
	Modes  []string
	Themes []ThemeOutcome
}

// plannedThemeCopy is a fetched-but-not-yet-written palette, held so every
// destination is checked before the first write (all-or-nothing, like `piece`).
type plannedThemeCopy struct {
	file plannedFile
	unit Unit
	// advisory is the manual import line printed for this palette.
	advisory string
	name     string
}

// fetchRegistry loads and parses registry.json, adding the "your source yielded
// nothing" hint when the failure is the zero-config default npm source.
func fetchRegistry(f Fetcher) (*Registry, error) {
	regData, err := f.Fetch("registry.json")
	if err != nil {
		// A dead default source is almost always "no pieces release matches this
		// CLI's major.minor yet / npm is unreachable" — name the three overrides,
		// or the user is stuck staring at a bare error about a source they never
		// chose.
		if f.Source() == defaultRegistry {
			return nil, fmt.Errorf(
				"%w\n  (the default npm registry didn't yield a matching pieces release — pin one with --pieces-version, or point at a registry with --registry <path|url|npm:pkg[@version]> or the PUZZLE_PIECES_REGISTRY env var)", err)
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
	return &reg, nil
}

// registryThemes returns the registry's palette entries, validated. A registry
// written before the `themes` array existed (or one that omits it) still has the
// single default palette, so it is synthesized from Registry.Theme — `add theme`
// must not become a hard error against an older pieces release.
func registryThemes(reg *Registry) ([]Theme, error) {
	if len(reg.Themes) == 0 {
		return []Theme{{
			Name:        defaultThemeName,
			File:        themePath(reg),
			Label:       "Default",
			Description: "The registry's design tokens.",
		}}, nil
	}
	seen := make(map[string]bool, len(reg.Themes))
	themes := make([]Theme, 0, len(reg.Themes))
	for _, t := range reg.Themes {
		if err := validateThemeName(t.Name); err != nil {
			return nil, err
		}
		if seen[t.Name] {
			return nil, fmt.Errorf("registry lists theme %q twice", t.Name)
		}
		seen[t.Name] = true
		// Same traversal defence Registry.Theme gets — a `"file": "../../.env"`
		// would otherwise be read outside the registry and copied into the app.
		if err := validateManifestPath("registry", "themes[].file", t.File); err != nil {
			return nil, err
		}
		themes = append(themes, t)
	}
	return themes, nil
}

// validateThemeName guards the ONE piece of registry data that becomes a path
// segment on its own (app/styles/themes/<name>.css). It runs the shared manifest
// check and then rejects any separator, so a name can never contribute a
// directory — the destination stays one file, exactly where the summary says.
func validateThemeName(name string) error {
	invalid := func(reason string) error {
		return fmt.Errorf("registry has invalid theme name %q: %s", name, reason)
	}
	if name == "" {
		return invalid("must not be empty")
	}
	if strings.ContainsAny(name, `/\`) {
		return invalid("path separators are not allowed in a theme name")
	}
	if err := validateManifestPath("registry", "themes[].name", name); err != nil {
		return invalid(strings.TrimSpace(err.Error()[strings.LastIndex(err.Error(), ":")+1:]))
	}
	return nil
}

// themePath is Registry.Theme with the built-in default applied.
func themePath(reg *Registry) string {
	if reg.Theme == "" {
		return "theme/pieces.css"
	}
	return reg.Theme
}

// isDefaultTheme reports whether a registry entry IS the default palette — the
// one `add piece` already copies to app/styles/pieces.css. Matching on the FILE
// (not the name) is what keeps the two commands idempotent no matter what a
// registry calls the entry.
func isDefaultTheme(reg *Registry, t Theme) bool { return t.File == themePath(reg) }

// themeDestRel is where a palette is copied: the historical app/styles/pieces.css
// for the default, app/styles/themes/<name>.css for every other.
func themeDestRel(reg *Registry, t Theme) string {
	if isDefaultTheme(reg, t) {
		return "app/styles/pieces.css"
	}
	return themesDir + "/" + t.Name + ".css"
}

// themeImportedFromPackage reports whether styles.css pulls this palette straight
// out of the npm package. Both quote styles count — `@import` accepts either, and
// an app formatted with single quotes is not a different situation. The match has
// to sit in a live `@import` STATEMENT: a commented-out import is a palette the
// app deliberately turned off, and reading it as wired would silently skip the
// copy the user just asked for.
func themeImportedFromPackage(styles, name string) bool {
	spec := packageThemePrefix + name + ".css"
	for _, stmt := range importStatements(stripCSSComments(styles)) {
		if strings.Contains(stmt, `"`+spec+`"`) || strings.Contains(stmt, `'`+spec+`'`) {
			return true
		}
	}
	return false
}

// stripCSSComments removes /* … */ blocks (CSS has no line comments). An
// unterminated comment swallows the rest of the file, exactly as a browser
// parses it.
func stripCSSComments(css string) string {
	var b strings.Builder
	for {
		open := strings.Index(css, "/*")
		if open < 0 {
			b.WriteString(css)
			return b.String()
		}
		b.WriteString(css[:open])
		rest := css[open+2:]
		close := strings.Index(rest, "*/")
		if close < 0 {
			return b.String()
		}
		css = rest[close+2:]
	}
}

// importStatements returns the body of each `@import` statement, up to its
// terminating `;` (or the end of the stylesheet for an unterminated one).
func importStatements(css string) []string {
	var stmts []string
	for {
		at := strings.Index(css, "@import")
		if at < 0 {
			return stmts
		}
		rest := css[at+len("@import"):]
		if end := strings.IndexByte(rest, ';'); end >= 0 {
			stmts = append(stmts, rest[:end])
			css = rest[end+1:]
			continue
		}
		return append(stmts, rest)
	}
}

// readAppStyles returns app/styles/styles.css, or "" when there is none (a
// missing stylesheet counts as "not wired", exactly as planTheme treats it).
func readAppStyles(appRoot string) (string, error) {
	p := filepath.Join(appRoot, "app", "styles", "styles.css")
	switch data, err := os.ReadFile(p); {
	case err == nil:
		return string(data), nil
	case os.IsNotExist(err):
		return "", nil
	default:
		return "", fmt.Errorf("reading %s: %w", p, err)
	}
}

// resolveThemes maps the requested names (case-sensitive, exact) onto registry
// entries. Unknown names are reported with the full available list — and the
// whole run is refused before anything is fetched or written, so a typo in the
// second of three names leaves the app untouched.
func resolveThemes(themes []Theme, names []string) ([]Theme, error) {
	index := make(map[string]Theme, len(themes))
	for _, t := range themes {
		index[t.Name] = t
	}
	seen := make(map[string]bool, len(names))
	selected := make([]Theme, 0, len(names))
	for _, n := range names {
		t, ok := index[n]
		if !ok {
			return nil, unknownThemeError(themes, n)
		}
		if seen[n] {
			continue
		}
		seen[n] = true
		selected = append(selected, t)
	}
	return selected, nil
}

// unknownThemeError names every available palette (the listing `add theme` with
// no name prints), plus a did-you-mean when one is within suggestMaxDistance —
// the same affordance an unknown piece gets.
func unknownThemeError(themes []Theme, name string) error {
	available := make([]string, 0, len(themes))
	best, bestDist := "", suggestMaxDistance+1
	for _, t := range themes {
		available = append(available, t.Name)
		if d := textutil.EditDistance(name, t.Name); d < bestDist {
			bestDist, best = d, t.Name
		}
	}
	if best != "" {
		return fmt.Errorf("unknown theme %q — did you mean %q? (available: %s)",
			name, best, strings.Join(available, ", "))
	}
	return fmt.Errorf("unknown theme %q (available: %s)", name, strings.Join(available, ", "))
}

// AddThemes copies the named palettes into the app and records them in
// pieces.lock. It is all-or-nothing like `add piece`: every name is resolved,
// every destination is fetched and checked, and only then is the first byte
// written — an unknown name or a modified destination leaves the app untouched.
//
// The default palette is not re-implemented here: it goes through planTheme, the
// same code `add piece` uses, so `puzzle add theme default` and `puzzle add
// piece` converge on one app/styles/pieces.css and one lock entry.
func AddThemes(opts ThemeOptions) (*ThemeResult, error) {
	reg, err := fetchRegistry(opts.Fetcher)
	if err != nil {
		return nil, err
	}
	themes, err := registryThemes(reg)
	if err != nil {
		return nil, err
	}
	selected, err := resolveThemes(themes, opts.Names)
	if err != nil {
		return nil, err
	}
	styles, err := readAppStyles(opts.AppRoot)
	if err != nil {
		return nil, err
	}

	resolvedRoot, err := filepath.Abs(opts.AppRoot)
	if err != nil {
		return nil, fmt.Errorf("resolving app root %s: %w", opts.AppRoot, err)
	}
	resolvedRoot, err = filepath.EvalSymlinks(resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolving app root %s: %w", opts.AppRoot, err)
	}

	lockPath := filepath.Join(opts.AppRoot, LockFileName)
	lock, err := readLock(lockPath)
	if err != nil {
		return nil, err
	}

	result := &ThemeResult{AppRoot: opts.AppRoot, Source: opts.Fetcher.Source()}
	var planned []plannedThemeCopy
	var refusals []string
	for _, t := range selected {
		outcome := ThemeOutcome{Name: t.Name, Label: t.Label, Description: t.Description}
		rel := themeDestRel(reg, t)
		advisory := themeImportLine(t.Name)
		// adviseWhenUpToDate is set only where the stylesheet is KNOWN not to
		// import the palette (planTheme's state (c)). For every other palette we
		// don't inspect styles.css for a local import, so repeating the line on an
		// already-wired app would just be noise.
		adviseWhenUpToDate := false

		if isDefaultTheme(reg, t) {
			// The default palette's "is it needed at all?" question belongs to
			// planTheme — the same code `add piece` runs — so the two commands agree
			// on when pieces.css is wanted. Only its state (c) (pieces.css present
			// but unwired) continues below, where it gets the SAME already-installed
			// rules every other palette gets: `add theme default` must behave like
			// `add theme dim`. `add piece` itself is unchanged and still never
			// rewrites pieces.css.
			plan, defaultAdvisory, perr := planTheme(&Options{AppRoot: opts.AppRoot, Fetcher: opts.Fetcher}, reg)
			if perr != nil {
				return nil, perr
			}
			if plan != nil { // (b) nothing there yet — copy it
				outcome.State, outcome.Rel = ThemeCopied, plan.file.rel
				planned = append(planned, plannedThemeCopy{
					file: plan.file, unit: plan.unit, advisory: defaultAdvisory, name: t.Name,
				})
				result.Themes = append(result.Themes, outcome)
				continue
			}
			if defaultAdvisory == "" { // (a) styles.css already carries the tokens
				if themeImportedFromPackage(styles, t.Name) {
					outcome.State = ThemeWiredViaPackage
				} else {
					outcome.State = ThemeWired
				}
				result.Themes = append(result.Themes, outcome)
				continue
			}
			advisory, adviseWhenUpToDate = defaultAdvisory, true
		} else if themeImportedFromPackage(styles, t.Name) {
			// Provided by the package already — a copy could only drift from it.
			outcome.State = ThemeWiredViaPackage
			result.Themes = append(result.Themes, outcome)
			continue
		}

		outcome.Rel = rel
		abs, err := containedWritePath(resolvedRoot, rel, "registry", "themes[].name", t.Name)
		if err != nil {
			return nil, err
		}
		data, err := opts.Fetcher.Fetch(t.File)
		if err != nil {
			return nil, err
		}

		// A symlinked destination is a deliberate link (a dev checkout, a shared
		// palette): report and skip it rather than silently replacing what it
		// points at. --overwrite is explicit intent and writes THROUGH the link
		// (abs is already the resolved target), never over it. The Lstat is on the
		// UNRESOLVED path — containedWritePath has followed the link by now, so
		// stat-ing abs would only ever see the target.
		info, lerr := os.Lstat(filepath.Join(resolvedRoot, filepath.FromSlash(rel)))
		switch {
		case lerr == nil && info.Mode()&os.ModeSymlink != 0:
			if !opts.Overwrite {
				refusals = append(refusals, rel+" (symlink)")
				continue
			}
		case lerr != nil && !os.IsNotExist(lerr):
			return nil, fmt.Errorf("checking %s: %w", rel, lerr)
		}

		// Already installed: identical bytes, or a copy still matching the hash
		// pieces.lock recorded, is up to date. Anything else is the user's own
		// edit, refused rather than discarded.
		if lerr == nil {
			existing, rerr := os.ReadFile(abs)
			if rerr != nil {
				return nil, fmt.Errorf("reading %s: %w", rel, rerr)
			}
			locked := lock.Pieces[t.File].Files[rel]
			if hashBytes(existing) == hashBytes(data) || (locked != "" && hashBytes(existing) == locked) {
				outcome.State = ThemeUpToDate
				if adviseWhenUpToDate {
					result.NextSteps = append(result.NextSteps, advisory)
				}
				result.Themes = append(result.Themes, outcome)
				continue
			}
			if !opts.Overwrite {
				refusals = append(refusals, rel)
				continue
			}
		}

		outcome.State = ThemeCopied
		planned = append(planned, plannedThemeCopy{
			file: plannedFile{rel: rel, abs: abs, data: data},
			// Keyed by its registry path ("theme/dim.css"), same lock shape as the
			// default theme and a lib.
			unit:     Unit{Name: t.File, Files: []FileWrite{{Rel: rel, Abs: abs, Hash: hashBytes(data)}}},
			advisory: advisory,
			name:     t.Name,
		})
		result.Themes = append(result.Themes, outcome)
	}

	// Pre-flight, listing EVERY refusal so the user resolves them in one pass.
	// Nothing has been written at this point.
	if len(refusals) > 0 {
		sort.Strings(refusals)
		return nil, fmt.Errorf("refusing to overwrite modified file(s) (use --overwrite to replace):\n  %s",
			strings.Join(refusals, "\n  "))
	}

	var units []Unit
	var copied []string
	for _, p := range planned {
		if err := writePlannedTheme(&plannedTheme{file: p.file}); err != nil {
			return nil, err
		}
		units = append(units, p.unit)
		result.NextSteps = append(result.NextSteps, p.advisory)
		copied = append(copied, p.name)
	}
	if len(copied) > 0 {
		result.NextSteps = append(result.NextSteps, schemeAdvisory(reg, copied))
	}
	if len(units) > 0 {
		if err := updateLock(lockPath, lock, result.Source, version.Version, units); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// themeImportLine is the one manual line per copied palette — styles.css is
// user-owned, so the import is printed, never written (D3).
func themeImportLine(name string) string {
	return fmt.Sprintf("add `@import './themes/%s.css';` to app/styles/styles.css (after `@import './pieces.css';`)", name)
}

// schemeAdvisory is the single "now switch to it" line, printed once however
// many palettes were copied. With exactly one it names that palette; with
// several it stays a placeholder rather than repeating itself per theme.
func schemeAdvisory(reg *Registry, copied []string) string {
	name := "<name>"
	if len(copied) == 1 {
		name = copied[0]
	}
	modes := reg.Modes
	if len(modes) == 0 {
		modes = defaultModes
	}
	return fmt.Sprintf("switch with data-scheme=%q on <html>; modes: data-theme=%q",
		name, strings.Join(modes, "|"))
}

// ListThemes is `puzzle add theme` with no name: every palette the registry
// ships, with this app's state for each. It reads, never writes.
func ListThemes(opts ThemeOptions) (*ThemeListing, error) {
	reg, err := fetchRegistry(opts.Fetcher)
	if err != nil {
		return nil, err
	}
	themes, err := registryThemes(reg)
	if err != nil {
		return nil, err
	}
	styles, err := readAppStyles(opts.AppRoot)
	if err != nil {
		return nil, err
	}
	listing := &ThemeListing{Source: opts.Fetcher.Source(), Modes: reg.Modes}
	if len(listing.Modes) == 0 {
		listing.Modes = defaultModes
	}
	for _, t := range themes {
		rel := themeDestRel(reg, t)
		outcome := ThemeOutcome{Name: t.Name, Label: t.Label, Description: t.Description, Rel: rel}
		switch {
		case themeImportedFromPackage(styles, t.Name):
			outcome.State, outcome.Rel = ThemeWiredViaPackage, ""
		case fileOnDisk(filepath.Join(opts.AppRoot, filepath.FromSlash(rel))):
			outcome.State = ThemeInstalled
		case isDefaultTheme(reg, t) && strings.Contains(styles, themeMarker):
			// The default's tokens can also be hand-merged into styles.css.
			outcome.State, outcome.Rel = ThemeWired, ""
		default:
			outcome.State, outcome.Rel = ThemeAbsent, ""
		}
		listing.Themes = append(listing.Themes, outcome)
	}
	return listing, nil
}

func fileOnDisk(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// RenderThemeSummary prints the `add theme` report in the add/init aesthetic: a
// header, one line per palette, then the manual steps.
func RenderThemeSummary(w io.Writer, out *ui.Printer, res *ThemeResult) {
	fmt.Fprintf(w, "%s %s\n", out.Cyan(out.Bold("puzzle add theme")), out.Dim("· "+res.Source))
	for _, t := range res.Themes {
		mark := out.Dim("·")
		if t.State == ThemeCopied {
			mark = out.Green("✓")
		}
		detail := string(t.State)
		if t.State == ThemeCopied {
			detail = t.Rel
		}
		fmt.Fprintf(w, "  %s %s %s\n", mark, out.Bold(t.Name), out.Dim("· "+detail))
	}
	if len(res.NextSteps) == 0 {
		return
	}
	fmt.Fprintf(w, "\n  %s\n", out.Bold("Next steps"))
	for _, step := range dedupe(res.NextSteps) {
		fmt.Fprintf(w, "    %s %s\n", out.Yellow("→"), step)
	}
}

// RenderThemeListing prints the palettes a registry ships and where this app
// stands with each.
func RenderThemeListing(w io.Writer, out *ui.Printer, listing *ThemeListing) {
	fmt.Fprintf(w, "%s %s\n", out.Cyan(out.Bold("puzzle add theme")), out.Dim("· "+listing.Source))
	width := 0
	for _, t := range listing.Themes {
		if len(t.Name) > width {
			width = len(t.Name)
		}
	}
	for _, t := range listing.Themes {
		pad := strings.Repeat(" ", width-len(t.Name))
		fmt.Fprintf(w, "  %s%s %s %s\n", out.Bold(t.Name), pad, t.Label, out.Dim("· "+string(t.State)))
		if t.Description != "" {
			fmt.Fprintf(w, "  %s %s\n", strings.Repeat(" ", width), out.Dim(t.Description))
		}
	}
	fmt.Fprintf(w, "\n  %s %s\n", out.Bold("Install"), out.Dim("· puzzle add theme <name…>"))
	fmt.Fprintf(w, "  %s %s\n", out.Bold("Modes"), out.Dim(`· data-theme="`+strings.Join(listing.Modes, "|")+`"`))
}

// dedupe keeps the first occurrence of each line, so two palettes copied in one
// run share the single switch advisory instead of repeating it.
func dedupe(lines []string) []string {
	seen := make(map[string]bool, len(lines))
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if l == "" || seen[l] {
			continue
		}
		seen[l] = true
		out = append(out, l)
	}
	return out
}
