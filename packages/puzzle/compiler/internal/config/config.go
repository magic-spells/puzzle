// Package config loads puzzle.config.js — the app's optional configuration file
// (D12). The Go side must never parse JavaScript (D3), so the
// config is read by executing node: it imports the ES module and prints its
// default export as JSON, which Go then unmarshals. No config file present means
// zero-config defaults and no node invocation at all.
//
// v1 surface (SPEC §3, §11): styles.use accepts the single string entry
// "tailwindcss". The object form (`{ name: 'sass', ... }`) and any other string
// are parsed and rejected with a clear "not in v1" error — the grammar is
// recognized so the message can name what was deferred, not a generic failure.
package config

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ConfigFileName is the app-root config file. Its absence is not an error.
const ConfigFileName = "puzzle.config.js"

// configLoadTimeout bounds how long we wait for node to evaluate the config. A
// hanging puzzle.config.js (a stuck top-level await) would otherwise silently
// wedge every command; past the deadline we kill node and report a clear error.
const configLoadTimeout = 10 * time.Second

// Config is the resolved, validated configuration. The zero value is the
// valid "no config file" state: no style pipelines declared, default build,
// SPA output.
type Config struct {
	Styles Styles
	Build  Build
	Dev    Dev
	// Output is the resolved `output` key: "" (absent — the default SPA build),
	// "static" (the true static-pages mode: per-route HTML, per-page module
	// bundles, no router), or "hybrid" (per-route prerendered HTML that the full
	// SPA runtime takes over on load — the mode formerly spelled 'static'). Any
	// other value is rejected by validate with a message naming both.
	Output string
	// I18n is the `i18n` block (D175): nil when absent, which is the zero-cost
	// state — no locale files are emitted, __PUZZLE_HAS_I18N__ is false, and the
	// bundles stay byte-identical to an app that never heard of translations.
	I18n *I18n
	// Site is the top-level `site` key (D177): the app's public origin
	// ('https://example.com'), normalized without a trailing slash, or "" when
	// absent. Only the origin — routerBase carries any path. The prerender uses
	// it to make hreflang alternates absolute.
	Site string
}

// RoutingPrefix is the one accepted i18n.routing value (D177): every non-default
// locale lives under its own URL prefix (/es/…).
const RoutingPrefix = "prefix"

// I18n mirrors the `i18n` block of puzzle.config.js (D175). The compiler owns the
// locale files end to end (app/locales/<tag>.json → dist/locales/<tag>.<hash>.json),
// which is why the locale list lives here rather than in the PuzzleApp config.
type I18n struct {
	// Locales are the configured BCP 47 tags, in config order. Order matters at
	// runtime: a viewer whose language matches only by base (`pt`) gets the FIRST
	// configured tag with that base (`pt-BR`).
	Locales []string
	// DefaultLocale is one of Locales. Its table fills every other locale's missing
	// keys at build time, and the prerender renders in it.
	DefaultLocale string
	// Routing is i18n.routing (D177): "" (absent — D175's one URL per page,
	// client-side switch) or RoutingPrefix.
	Routing string
	// Detect is the tri-state i18n.detect: nil when absent (default on), else the
	// explicit value. It controls the first-visit language redirect, so it means
	// something only with prefix routing.
	Detect *bool
}

// PrefixRouting reports whether locale URL prefixes are on (D177). Safe on a
// nil receiver, so callers holding cfg.I18n need no separate nil check.
func (i *I18n) PrefixRouting() bool {
	return i != nil && i.Routing == RoutingPrefix
}

// Styles mirrors the `styles` block of puzzle.config.js.
type Styles struct {
	// Use lists the enabled style pipelines. In v1 the only accepted entry is
	// "tailwindcss"; the slice is therefore either empty or ["tailwindcss"].
	Use []string
}

// Build mirrors the `build` block of puzzle.config.js.
type Build struct {
	// DropConsole is the tri-state build.dropConsole setting: nil means the key
	// was absent (default behavior), a non-nil pointer is the explicit user
	// value. The pointer lets "unset" be distinguished from an explicit false.
	DropConsole *bool

	// SourceMap is the build.sourceMap setting. It defaults to false, so
	// production builds emit no linked source map unless explicitly enabled.
	SourceMap bool

	// Splitting is the tri-state build.splitting setting: nil means the key was
	// absent (default off this release), a non-nil pointer is the explicit user
	// value. Pointer storage so a later release can flip the default in the
	// accessor without changing stored semantics.
	Splitting *bool
}

// Dev mirrors the `dev` block of puzzle.config.js.
type Dev struct {
	// Proxy maps same-origin path prefixes to backend origins for puzzle dev.
	Proxy map[string]string `json:"proxy"`
}

// TailwindEnabled reports whether the Tailwind pipeline is declared.
func (c Config) TailwindEnabled() bool {
	for _, u := range c.Styles.Use {
		if u == "tailwindcss" {
			return true
		}
	}
	return false
}

// DropConsole reports whether production builds should strip console.* calls.
// Unset (no config file, or build.dropConsole absent) defaults to true — the
// v1 behavior; build.dropConsole: false opts out.
func (c Config) DropConsole() bool {
	if c.Build.DropConsole == nil {
		return true
	}
	return *c.Build.DropConsole
}

// I18nEnabled reports whether the app configured translations (D175).
func (c Config) I18nEnabled() bool {
	return c.I18n != nil
}

// Splitting reports whether the SPA browser bundle should be built with esbuild
// code splitting, so a dynamic import() emits a lazy chunk under dist/chunks/
// instead of being inlined into app.js. Default is off; enable with
// build: { splitting: true }.
func (c Config) Splitting() bool {
	return c.Build.Splitting != nil && *c.Build.Splitting
}

// rawConfig is the permissive shape used to decode the JSON that node prints.
// styles.use entries are kept as raw messages so object entries (deferred) can
// be distinguished from strings and reported precisely; build booleans are raw
// so invalid values can be named precisely in rejection messages.
type rawConfig struct {
	Styles struct {
		Use []json.RawMessage `json:"use"`
	} `json:"styles"`
	Build struct {
		DropConsole json.RawMessage `json:"dropConsole"`
		SourceMap   json.RawMessage `json:"sourceMap"`
		Splitting   json.RawMessage `json:"splitting"`
	} `json:"build"`
	Dev Dev `json:"dev"`
	// Output is kept raw so a non-string or unsupported value can be named
	// precisely in the rejection message (parallel to build.dropConsole).
	Output json.RawMessage `json:"output"`
	// I18n is kept raw for the same reason: every shape error names its key.
	I18n json.RawMessage `json:"i18n"`
	Site json.RawMessage `json:"site"`
}

// LoadConfig loads and validates puzzle.config.js from appRoot.
//
//   - No config file: returns the zero Config and no error (no node needed).
//   - Config present but node missing / unrunnable: a clear error.
//   - Config present but malformed JS: node's syntax error, surfaced.
//   - A deferred entry (object form, or a non-"tailwindcss" string): a
//     "not in v1" error naming the entry.
func LoadConfig(appRoot string) (Config, error) {
	abs, err := filepath.Abs(appRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolving app root: %w", err)
	}
	configPath := filepath.Join(abs, ConfigFileName)
	if _, err := os.Stat(configPath); err != nil {
		if os.IsNotExist(err) {
			return Config{}, nil // zero-config defaults; no node invocation.
		}
		return Config{}, fmt.Errorf("checking for %s: %w", ConfigFileName, err)
	}

	data, err := readConfigViaNode(configPath)
	if err != nil {
		return Config{}, err
	}

	var raw rawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return Config{}, fmt.Errorf("%s produced JSON the compiler could not read: %w", ConfigFileName, err)
	}

	cfg, err := validate(raw)
	if err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// configSentinel prefixes the JSON payload node writes to stdout. Because the
// config module (or anything it imports) may console.log at will, the payload
// cannot be the whole of stdout — stray logging would corrupt the JSON. node
// writes the sentinel + JSON as the LAST thing on stdout, and Go reads only the
// text after the sentinel's LAST occurrence; everything before it is user noise.
const configSentinel = "__PUZZLE_CONFIG_JSON__"

// readConfigViaNode executes node to import the ES module config and print its
// default export as JSON (D3: the compiler never parses JS itself). It uses
// `node --input-type=module -e` with a top-level `await import(...)` so the real
// ES module resolution (imports, computed values) is honored. The absolute path
// is passed as an argv value (not concatenated into a URL) and turned into a
// proper file: URL by node's own pathToFileURL, so paths containing '#', '%', or
// a Windows drive letter resolve correctly. The JSON rides a unique sentinel so
// stray console output from the config cannot corrupt the payload.
func readConfigViaNode(configPath string) ([]byte, error) {
	script := fmt.Sprintf(
		"const { pathToFileURL } = await import('node:url');"+
			"const m = await import(pathToFileURL(process.argv[1]).href);"+
			"process.stdout.write('\\n%s' + JSON.stringify(m.default ?? {}));",
		configSentinel,
	)
	ctx, cancel := context.WithTimeout(context.Background(), configLoadTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", script, configPath)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return nil, fmt.Errorf(
				"%s is present but `node` was not found on PATH — reading a puzzle.config.js requires Node.js",
				ConfigFileName,
			)
		}
		// The context deadline firing kills node mid-run; surface that as a
		// timeout, not node's opaque signal error.
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf(
				"loading %s timed out after %s — check for a hanging top-level await in the config",
				ConfigFileName, configLoadTimeout,
			)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("failed to load %s:\n%s", ConfigFileName, msg)
	}

	// Take only the JSON after the LAST sentinel; anything earlier is user
	// logging from the config or a module it imported.
	out := stdout.String()
	idx := strings.LastIndex(out, configSentinel)
	if idx < 0 {
		return nil, fmt.Errorf(
			"%s did not produce a readable configuration (no config payload on stdout)",
			ConfigFileName,
		)
	}
	return []byte(strings.TrimSpace(out[idx+len(configSentinel):])), nil
}

// unset reports whether a raw JSON value was omitted entirely or written as
// null. Both mean "the key was not set": json.Unmarshal of `null` into a scalar
// is a documented no-op that returns no error and leaves the destination at its
// zero value, so a bare `len(raw) > 0` presence check would read
// `dropConsole: null` as an explicit false (silently shipping console calls) and
// `output: null` as the unsupported value "".
func unset(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed == "" || trimmed == "null"
}

// validate turns the permissive raw config into a validated Config, rejecting
// every v1-deferred style entry with a message that names it.
func validate(raw rawConfig) (Config, error) {
	var cfg Config
	for _, entry := range raw.Styles.Use {
		var name string
		if err := json.Unmarshal(entry, &name); err == nil {
			// String entry: only "tailwindcss" is accepted in v1.
			if name == "tailwindcss" {
				cfg.Styles.Use = append(cfg.Styles.Use, name)
				continue
			}
			return Config{}, fmt.Errorf(
				"%s: styles.use entry %q is not supported in v1 (only 'tailwindcss')",
				ConfigFileName, name,
			)
		}
		// Non-string entry: the object form (e.g. the Sass pipeline) is deferred.
		return Config{}, fmt.Errorf(
			"%s: styles.use object entries are not supported in v1 (only the string 'tailwindcss'); got %s",
			ConfigFileName, strings.TrimSpace(string(entry)),
		)
	}

	// build.dropConsole: an explicit boolean opts the production console-strip in
	// (true) or out (false). Absent leaves the pointer nil (default: strip).
	// Anything non-boolean is rejected with a message naming the key. Other keys
	// inside `build` are ignored, matching the loader's permissive posture toward
	// unknown top-level keys.
	if !unset(raw.Build.DropConsole) {
		var drop bool
		if err := json.Unmarshal(raw.Build.DropConsole, &drop); err != nil {
			return Config{}, fmt.Errorf(
				"%s: build.dropConsole must be a boolean; got %s",
				ConfigFileName, strings.TrimSpace(string(raw.Build.DropConsole)),
			)
		}
		cfg.Build.DropConsole = &drop
	}

	// build.sourceMap: production builds omit linked source maps by default; an
	// explicit true enables them. Anything non-boolean is rejected.
	if !unset(raw.Build.SourceMap) {
		if err := json.Unmarshal(raw.Build.SourceMap, &cfg.Build.SourceMap); err != nil {
			return Config{}, fmt.Errorf(
				"%s: build.sourceMap must be a boolean; got %s",
				ConfigFileName, strings.TrimSpace(string(raw.Build.SourceMap)),
			)
		}
	}

	// build.splitting: opt-in code splitting for the SPA browser bundle. Anything
	// non-boolean is rejected; null means unset (off).
	if !unset(raw.Build.Splitting) {
		var split bool
		if err := json.Unmarshal(raw.Build.Splitting, &split); err != nil {
			return Config{}, fmt.Errorf(
				"%s: build.splitting must be a boolean; got %s",
				ConfigFileName, strings.TrimSpace(string(raw.Build.Splitting)),
			)
		}
		cfg.Build.Splitting = &split
	}

	// dev.proxy is consumed only by puzzle dev. Prefixes stay intact when
	// forwarded, so each key must be an absolute request path prefix and each
	// target must name an http(s) backend origin.
	//
	// Two further rules exist because dev registers each prefix with a
	// http.ServeMux, and ServeMux PANICS on a bad or repeated pattern — a panic on
	// the Serve path nothing recovers, so `puzzle dev` would die with a Go stack
	// trace instead of a config error. A trailing slash is not significant
	// ('/api' and '/api/' name the same subtree), so prefixes are compared after
	// trimming it; and a prefix that trims to nothing is the root proxy, rejected
	// below. Keys are checked in sorted order so a rejection message is stable
	// across runs.
	prefixes := make([]string, 0, len(raw.Dev.Proxy))
	for prefix := range raw.Dev.Proxy {
		prefixes = append(prefixes, prefix)
	}
	sort.Strings(prefixes)
	routes := make(map[string]string, len(prefixes))
	for _, prefix := range prefixes {
		target := raw.Dev.Proxy[prefix]
		if !strings.HasPrefix(prefix, "/") {
			return Config{}, fmt.Errorf(
				"%s: dev.proxy prefix %q must start with '/'",
				ConfigFileName, prefix,
			)
		}
		route := strings.TrimRight(prefix, "/")
		if route == "" {
			// A root proxy swallows everything — the app shell, app.js, styles.css,
			// the live-reload stream — leaving dev with nothing of its own to serve.
			// That is a config mistake every time, so name it instead of silently
			// handing the whole origin to the backend.
			return Config{}, fmt.Errorf(
				"%s: dev.proxy prefix %q would proxy every request, including the app shell and dev assets; proxy a specific prefix such as '/api' instead",
				ConfigFileName, prefix,
			)
		}
		if first, dup := routes[route]; dup {
			return Config{}, fmt.Errorf(
				"%s: dev.proxy prefixes %q and %q are the same route (a trailing slash is not significant); keep only one",
				ConfigFileName, first, prefix,
			)
		}
		routes[route] = prefix
		parsed, err := url.Parse(target)
		if err != nil || !parsed.IsAbs() || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return Config{}, fmt.Errorf(
				"%s: dev.proxy target for %q must be an absolute http or https URL; got %q",
				ConfigFileName, prefix, target,
			)
		}
	}
	cfg.Dev.Proxy = raw.Dev.Proxy

	// output: the prerender opt-in. Absent leaves it "" (the default SPA build);
	// the accepted values are 'static' (true static pages) and 'hybrid'
	// (prerender + SPA takeover, the old 'static'). A non-string, or any other
	// string, is rejected with a message naming both allowed values — the grammar
	// is recognized so the door stays open for future modes.
	if !unset(raw.Output) {
		var out string
		if err := json.Unmarshal(raw.Output, &out); err != nil {
			return Config{}, fmt.Errorf(
				"%s: output must be a string ('static' or 'hybrid'); got %s",
				ConfigFileName, strings.TrimSpace(string(raw.Output)),
			)
		}
		if out != "static" && out != "hybrid" {
			return Config{}, fmt.Errorf(
				"%s: output %q is not supported (allowed values are 'static' and 'hybrid'; omit the key for the default SPA build)",
				ConfigFileName, out,
			)
		}
		cfg.Output = out
	}

	if !unset(raw.I18n) {
		i18n, err := validateI18n(raw.I18n)
		if err != nil {
			return Config{}, err
		}
		cfg.I18n = i18n
	}

	// TEMPORARY GATE (D177): prefix routing is built for static output only so
	// far. Hybrid and SPA need the router half (path base + locale prefix), which
	// has not landed; delete this block when it does. It reads the config's
	// output, not the --static flag, because `puzzle dev` picks its mode from the
	// config alone.
	if cfg.I18n.PrefixRouting() && cfg.Output != "static" {
		return Config{}, fmt.Errorf(
			"%s: i18n.routing: 'prefix' currently requires output: 'static' — prefix routing for hybrid output and the SPA is not built yet",
			ConfigFileName,
		)
	}

	if !unset(raw.Site) {
		site, err := validateSite(raw.Site)
		if err != nil {
			return Config{}, err
		}
		cfg.Site = site
	}

	return cfg, nil
}

// validateSite checks the top-level `site` key (D177): a string naming an
// absolute http(s) origin. A trailing slash is dropped; any path, query or
// fragment is rejected rather than ignored, since routerBase is where a path
// belongs and a silently dropped one would put the wrong URL in every hreflang.
func validateSite(raw json.RawMessage) (string, error) {
	var site string
	if err := json.Unmarshal(raw, &site); err != nil {
		return "", fmt.Errorf("%s: site must be a string like 'https://example.com'; got %s", ConfigFileName, strings.TrimSpace(string(raw)))
	}
	u, err := url.Parse(site)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Opaque != "" {
		return "", fmt.Errorf("%s: site must be an absolute http or https origin like 'https://example.com'; got %q", ConfigFileName, site)
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.HasSuffix(site, "#") {
		return "", fmt.Errorf("%s: site must be the origin only (got %q) — write %q; a path prefix belongs in routerBase", ConfigFileName, site, u.Scheme+"://"+u.Host)
	}
	return u.Scheme + "://" + u.Host, nil
}

// ValidLocaleTag reports whether tag is a well-formed locale tag, and when it is
// not, a message naming the problem. Shared with the locale-file loader, which
// applies the same rule to file names (and the same '_' → '-' suggestion).
//
// The rule is the BCP 47 langtag structure the browser's Intl constructors
// accept, since the runtime hands the tag straight to them and a tag they throw
// on breaks rendering: a 2–3 letter language, an optional 4-letter script, an
// optional 2-letter or 3-digit region, then variants (5–8 alphanumerics, or a
// digit and 3 alphanumerics), none repeated. It is a subset of what Intl takes:
// the 5–8 letter language form is refused because no registered language uses
// it and "english" is far likelier a mistake, and extensions, private use and
// grandfathered tags are out — the tag also names a file
// (app/locales/<tag>.json) and a URL segment. It is deliberately a SHAPE check,
// not a registry lookup.
func ValidLocaleTag(tag string) (bool, string) {
	if strings.Contains(tag, "_") {
		fixed := strings.ReplaceAll(tag, "_", "-")
		if ok, _ := ValidLocaleTag(fixed); ok {
			return false, fmt.Sprintf("%q is not a BCP 47 locale tag — use %q (a hyphen, not an underscore)", tag, fixed)
		}
	}
	generic := fmt.Sprintf("%q is not a BCP 47 locale tag (expected a language code like 'en', 'es' or 'pt-BR')", tag)
	subtags := strings.Split(tag, "-")
	lang := subtags[0]
	if !isAlpha(lang) || len(lang) < 2 || len(lang) > 3 {
		if lang != "" && isAlnum(lang) {
			return false, fmt.Sprintf("%q is not a BCP 47 locale tag: the language %q must be 2–3 letters (like 'en')", tag, lang)
		}
		return false, generic
	}
	// stage: 0 = script next, 1 = region next, 2 = variants only.
	stage := 0
	seen := map[string]bool{}
	for i, sub := range subtags[1:] {
		if sub == "" || !isAlnum(sub) {
			return false, generic
		}
		key := strings.ToLower(sub)
		switch {
		case stage == 0 && len(sub) == 4 && isAlpha(sub):
			stage = 1
			continue
		case stage <= 1 && (len(sub) == 2 && isAlpha(sub) || len(sub) == 3 && isDigit(sub)):
			stage = 2
			continue
		case len(sub) >= 5 && len(sub) <= 8 || len(sub) == 4 && isDigit(sub[:1]):
			if !seen[key] {
				seen[key] = true
				stage = 2
				continue
			}
		}
		for _, prev := range subtags[:i+1] {
			if strings.EqualFold(prev, sub) {
				return false, fmt.Sprintf("%q is not a BCP 47 locale tag: %q appears twice", tag, sub)
			}
		}
		return false, fmt.Sprintf("%q is not a BCP 47 locale tag: %q is not a script (4 letters, like 'Hant'), region (2 letters or 3 digits, like 'BR' or '419') or variant (5–8 characters) in that position", tag, sub)
	}
	return true, ""
}

func isAlpha(s string) bool {
	for i := 0; i < len(s); i++ {
		if c := s[i] | 0x20; c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

func isDigit(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func isAlnum(s string) bool {
	for i := 0; i < len(s); i++ {
		if !isAlpha(s[i:i+1]) && !isDigit(s[i:i+1]) {
			return false
		}
	}
	return true
}

// validateI18n checks the `i18n` block: an object with a non-empty `locales`
// array of well-formed, distinct tags and a `defaultLocale` that is one of them.
func validateI18n(raw json.RawMessage) (*I18n, error) {
	var block map[string]json.RawMessage
	if err := json.Unmarshal(raw, &block); err != nil {
		return nil, fmt.Errorf(
			"%s: i18n must be an object like { locales: ['en', 'es'], defaultLocale: 'en' }; got %s",
			ConfigFileName, strings.TrimSpace(string(raw)),
		)
	}
	var locales []string
	rawLocales, ok := block["locales"]
	if !ok || unset(rawLocales) {
		return nil, fmt.Errorf("%s: i18n.locales is required — list every locale the app ships, e.g. locales: ['en', 'es']", ConfigFileName)
	}
	if err := json.Unmarshal(rawLocales, &locales); err != nil {
		return nil, fmt.Errorf("%s: i18n.locales must be an array of locale tags; got %s", ConfigFileName, strings.TrimSpace(string(rawLocales)))
	}
	if len(locales) == 0 {
		return nil, fmt.Errorf("%s: i18n.locales must list at least one locale", ConfigFileName)
	}
	seen := map[string]string{}
	for _, tag := range locales {
		if ok, msg := ValidLocaleTag(tag); !ok {
			return nil, fmt.Errorf("%s: i18n.locales: %s", ConfigFileName, msg)
		}
		// Tags compare case-insensitively (BCP 47), and on macOS/Windows the two
		// spellings would also name one file.
		fold := strings.ToLower(tag)
		if first, dup := seen[fold]; dup {
			return nil, fmt.Errorf("%s: i18n.locales lists %q and %q, which are the same locale", ConfigFileName, first, tag)
		}
		seen[fold] = tag
	}

	rawDefault, ok := block["defaultLocale"]
	if !ok || unset(rawDefault) {
		hint := ""
		if _, wrote := block["default"]; wrote {
			// `default` is a reserved word — `const { default } = config.i18n` is a
			// syntax error — which is why the key is spelled defaultLocale.
			hint = " (the key is defaultLocale, not default)"
		}
		return nil, fmt.Errorf("%s: i18n.defaultLocale is required%s — name the locale the others fall back to, e.g. defaultLocale: '%s'", ConfigFileName, hint, locales[0])
	}
	var def string
	if err := json.Unmarshal(rawDefault, &def); err != nil {
		return nil, fmt.Errorf("%s: i18n.defaultLocale must be a string; got %s", ConfigFileName, strings.TrimSpace(string(rawDefault)))
	}
	listed := false
	for _, tag := range locales {
		if tag == def {
			listed = true
			break
		}
	}
	if !listed {
		return nil, fmt.Errorf("%s: i18n.defaultLocale %q is not in i18n.locales (%s)", ConfigFileName, def, strings.Join(locales, ", "))
	}
	out := &I18n{Locales: locales, DefaultLocale: def}

	// routing (D177): only 'prefix' exists. Any other value — a typo such as
	// 'prefixed' included — is an error, never a silent fall-back to one URL.
	if rawRouting, ok := block["routing"]; ok && !unset(rawRouting) {
		var routing string
		if err := json.Unmarshal(rawRouting, &routing); err != nil || routing != RoutingPrefix {
			return nil, fmt.Errorf("%s: i18n.routing accepts only '%s'; got %s", ConfigFileName, RoutingPrefix, strings.TrimSpace(string(rawRouting)))
		}
		out.Routing = routing
	}
	if rawDetect, ok := block["detect"]; ok && !unset(rawDetect) {
		var detect bool
		if err := json.Unmarshal(rawDetect, &detect); err != nil {
			return nil, fmt.Errorf("%s: i18n.detect must be a boolean; got %s", ConfigFileName, strings.TrimSpace(string(rawDetect)))
		}
		out.Detect = &detect
	}
	return out, nil
}
