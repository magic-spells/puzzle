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

// applyI18n points a plugin at the build's locale state: the define turns on
// with the config, and the manifest module serves res's hashed paths.
func applyI18n(pl *plugin.Plugin, enabled bool, res *locales.Result) {
	manifest := ""
	if res != nil {
		manifest = res.Manifest.JS()
	}
	pl.SetI18n(enabled, manifest)
}

// i18nWarnings collects every translation warning for one build: the locale
// loader's own (filled keys, stray keys, unlisted files), a literal `t` key the
// default locale does not define, and the two "translations are half set up"
// cases — `t` used, or app/locales/ present, with no i18n in the config.
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
	keys := make([]string, 0, len(usage.TKeys))
	for key := range usage.TKeys {
		if !res.DefaultKeys[key] {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	for _, key := range keys {
		files := append([]string(nil), usage.TKeys[key]...)
		sort.Strings(files)
		hint := ""
		if near := nearestKey(res.DefaultKeys, key); near != "" {
			hint = fmt.Sprintf(" (did you mean %q?)", near)
		}
		out = append(out, fmt.Sprintf("%s: t key %q is not in %s/%s.json%s — it will print as written",
			strings.Join(files, ", "), key, locales.DirName, res.Manifest.DefaultLocale, hint))
	}
	return out
}

// printI18nWarnings writes each warning on its own line, in the plain
// `warning:` shape the other build advisories use.
func printI18nWarnings(w io.Writer, warnings []string) {
	for _, line := range warnings {
		fmt.Fprintf(w, "warning: translations: %s\n", line)
	}
}

// nearestKey returns the default-locale key within edit distance 2 of key, or
// "" when nothing is that close. Ties go to the alphabetically first key so the
// hint is stable.
func nearestKey(keys map[string]bool, key string) string {
	best, bestDist := "", 3
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)
	for _, k := range sorted {
		if d := editDistance(key, k); d < bestDist {
			best, bestDist = k, d
		}
	}
	return best
}

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
