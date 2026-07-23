// Package config loads puzzle.config.js — the app's optional configuration file
// (constellation/doc/DOC-DECISIONS.md D12). The Go side must never parse JavaScript (D3), so the
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

// StaticOutput reports whether the app declares the true static-pages output
// mode via `output: 'static'`. Absent (or no config file) reports false — the
// default SPA build. The `puzzle build --static` flag enables the same mode
// without touching the config.
func (c Config) StaticOutput() bool {
	return c.Output == "static"
}

// HybridOutput reports whether the app declares the hybrid (prerender +
// SPA-takeover) output mode via `output: 'hybrid'` — the behavior formerly
// spelled 'static'. The `puzzle build --hybrid` flag enables the same mode.
func (c Config) HybridOutput() bool {
	return c.Output == "hybrid"
}

// rawConfig is the permissive shape used to decode the JSON that node prints.
// styles.use entries are kept as raw messages so object entries (deferred) can
// be distinguished from strings and reported precisely; build.dropConsole is
// raw so a non-boolean value can be named precisely in the rejection message.
type rawConfig struct {
	Styles struct {
		Use []json.RawMessage `json:"use"`
	} `json:"styles"`
	Build struct {
		DropConsole json.RawMessage `json:"dropConsole"`
	} `json:"build"`
	Dev Dev `json:"dev"`
	// Output is kept raw so a non-string or unsupported value can be named
	// precisely in the rejection message (parallel to build.dropConsole).
	Output json.RawMessage `json:"output"`
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
	if len(raw.Build.DropConsole) > 0 {
		var drop bool
		if err := json.Unmarshal(raw.Build.DropConsole, &drop); err != nil {
			return Config{}, fmt.Errorf(
				"%s: build.dropConsole must be a boolean; got %s",
				ConfigFileName, strings.TrimSpace(string(raw.Build.DropConsole)),
			)
		}
		cfg.Build.DropConsole = &drop
	}

	// dev.proxy is consumed only by puzzle dev. Prefixes stay intact when
	// forwarded, so each key must be an absolute request path prefix and each
	// target must name an http(s) backend origin.
	for prefix, target := range raw.Dev.Proxy {
		if !strings.HasPrefix(prefix, "/") {
			return Config{}, fmt.Errorf(
				"%s: dev.proxy prefix %q must start with '/'",
				ConfigFileName, prefix,
			)
		}
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
	if len(raw.Output) > 0 {
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

	return cfg, nil
}
