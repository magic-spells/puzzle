package build

// i18n.go — the build's half of D175 translations: load the locale files once
// per build (or per locale edit in dev), hand the manifest to every esbuild
// pass's plugin, write the hashed files into the output tree, and print the
// translation warnings.

import (
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/locales"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// loadLocales loads the app's translations when puzzle.config.js configures
// them. It returns nil (and no error) for an app without i18n — the zero-cost
// path, where nothing is read, emitted, or defined on.
func loadLocales(absRoot string, cfg config.Config) (*locales.Result, error) {
	if !cfg.I18nEnabled() {
		return nil, nil
	}
	return locales.Load(absRoot, cfg.I18n)
}

// applyI18n points a plugin at the build's locale state: the defines turn on
// with the config (i18n nil = off), and the manifest module serves res's hashed
// paths.
func applyI18n(pl *plugin.Plugin, i18n *config.I18n, res *locales.Result) {
	manifest := ""
	if res != nil {
		manifest = res.Manifest.JS()
	}
	pl.SetI18n(i18n != nil, manifest)
	pl.SetLocaleRouting(i18n.PrefixRouting())
}

// i18nWarnings collects every translation warning for one build: the locale
// loader's own (filled keys, stray keys, unlisted files), a literal `t` key the
// default locale does not define, and the two "translations are half set up"
// cases — `t` used, or app/locales/ present, with no i18n in the config. Under
// prefix routing (D177) it adds each literal root-relative href, and i18n.detect
// set without routing warns that it does nothing.
func i18nWarnings(absRoot string, cfg config.Config, usage plugin.Usage, res *locales.Result) []string {
	if !cfg.I18nEnabled() {
		var out []string
		// The compiler never reads app.js, so it cannot see an app-registered `t`
		// formatter; the warning says so rather than guessing.
		if usage.UsesT() {
			out = append(out, "templates use the t formatter, but "+config.ConfigFileName+
				" configures no i18n, so every key prints as written unless the app registers its own t formatter — to use translations, add i18n: { locales: ['en'], defaultLocale: 'en' } and app/locales/en.json")
		}
		if locales.HasSourceDir(absRoot) {
			out = append(out, locales.DirName+"/ exists, but "+config.ConfigFileName+
				" configures no i18n, so no locale file is emitted — add i18n: { locales: [...], defaultLocale: '...' }")
		}
		return out
	}
	if res == nil {
		return nil
	}
	out := append([]string(nil), res.Warnings...)
	if cfg.I18n.Detect != nil && !cfg.I18n.PrefixRouting() {
		out = append(out, "i18n.detect has no effect without i18n.routing: 'prefix' — it only switches off the first-visit redirect to a locale-prefixed URL")
	}
	if cfg.I18n.PrefixRouting() {
		out = append(out, rootHrefWarnings(usage.RootHrefs)...)
	}
	keys := make([]string, 0, len(usage.TKeys))
	for key := range usage.TKeys {
		if !res.DefaultKeys[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var defaults []string // sorted once, only when some key is missing
	if len(keys) > 0 {
		defaults = make([]string, 0, len(res.DefaultKeys))
		for k := range res.DefaultKeys {
			defaults = append(defaults, k)
		}
		sort.Strings(defaults)
	}
	for _, key := range keys {
		files := append([]string(nil), usage.TKeys[key]...)
		sort.Strings(files)
		hint := ""
		if near := nearestKey(defaults, key); near != "" {
			hint = fmt.Sprintf(" (did you mean %q?)", near)
		}
		out = append(out, fmt.Sprintf("%s: t key %q is not in %s/%s.json%s — it will print as written",
			strings.Join(files, ", "), key, locales.DirName, res.Manifest.DefaultLocale, hint))
	}
	return out
}

// rootHrefWarnings turns the scan's literal root-relative links into positioned
// warnings (D177): under prefix routing such a link skips the locale prefix, so
// a viewer reading /es/… is sent to the default language. Sorted by position so
// the dev builders' print-on-change comparison is stable.
func rootHrefWarnings(hrefs []plugin.RootHref) []string {
	sorted := append([]plugin.RootHref(nil), hrefs...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.File != b.File {
			return a.File < b.File
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Col < b.Col
	})
	out := make([]string, 0, len(sorted))
	for _, h := range sorted {
		fix := fmt.Sprintf("write href={ link(%s) }, or link(%s, { locale: false }) for a file that exists once", jsQuote(h.Href), jsQuote(h.Href))
		shown := h.Href
		if h.Mixed {
			shown += "…"
			fix = "build it with link() — link(path), or link(path, { locale: false }) for a file that exists once"
		}
		out = append(out, fmt.Sprintf("%s:%d:%d: href=%q skips the locale prefix, so it always opens the default-language page under i18n.routing: 'prefix' — %s",
			h.File, h.Line, h.Col, shown, fix))
	}
	return out
}

// jsQuote renders s as a single-quoted JavaScript string for a suggested fix.
func jsQuote(s string) string {
	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(s) + "'"
}

// printI18nWarnings writes each warning on its own line, in the plain
// `warning:` shape the other build advisories use.
func printI18nWarnings(w io.Writer, warnings []string) {
	for _, line := range warnings {
		fmt.Fprintf(w, "warning: translations: %s\n", line)
	}
}

// nearestKey returns the default-locale key (sorted holds them in order) within
// edit distance 2 of key, or "" when nothing is that close. Ties go to the
// alphabetically first key so the hint is stable.
func nearestKey(sorted []string, key string) string {
	best, bestDist := "", 3
	for _, k := range sorted {
		if d := editDistance(key, k); d < bestDist {
			best, bestDist = k, d
		}
	}
	return best
}

// editDistance is Levenshtein over runes. It is not textutil.EditDistance, which
// counts bytes: a translation key may be non-ASCII ("menú.título"), and one
// accented letter must cost one edit, not two.
func editDistance(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	curr := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		curr[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			curr[j] = min(prev[j]+1, curr[j-1]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}
	return prev[len(rb)]
}

// localesChanged reports whether a watcher batch touched the locale source dir.
func localesChanged(absRoot string, changed []string) bool {
	return pathsTouchDir(changed, locales.SourceDir(absRoot)) ||
		pathsTouchDir(changed, resolvePath(filepath.Join(absRoot, filepath.FromSlash(locales.DirName))))
}
