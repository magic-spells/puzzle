package plugin

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

const ManifestSpecifier = "@magic-spells/puzzle/formatters/manifest"

const manifestNamespace = "puzzle-formatters-manifest"

// SetRuntimeDir points the virtual formatter manifest at client-runtime/.
func (p *Plugin) SetRuntimeDir(dir string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.runtimeDir = dir
}

// SetFormatters stores the app-wide built-in formatter union used by the
// virtual manifest. escape is always present as the safety default.
func (p *Plugin) SetFormatters(used map[string]bool) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.setFormattersLocked(used)
}

// SetUsage stores every build-wide usage bit discovered by ScanUsage. Formatter
// manifest behavior stays identical; the booleans feed esbuild's literal DCE
// defines.
func (p *Plugin) SetUsage(usage Usage) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.setFormattersLocked(usage.Formatters)
	p.features = usage.Features()
}

func (p *Plugin) setFormattersLocked(used map[string]bool) {
	next := map[string]bool{"escape": true}
	for name, ok := range used {
		if ok {
			next[name] = true
		}
	}
	p.formatters = next
}

// Features returns the DCE define bits captured by the most recent SetUsage
// call.
func (p *Plugin) Features() Features {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.features
}

func (p *Plugin) formatterManifest() (string, error) {
	names, err := p.orderedUsedFormatterNames()
	if err != nil {
		return "", err
	}

	p.mu.Lock()
	runtimeDir := p.runtimeDir
	p.mu.Unlock()
	if runtimeDir == "" {
		return "", fmt.Errorf("puzzle formatter manifest: runtime directory not configured")
	}

	builtinsPath := filepath.ToSlash(filepath.Join(runtimeDir, "formatters", "builtins.js"))
	imports := make([]string, len(names))
	props := make([]string, len(names))
	for i, name := range names {
		imports[i], props[i] = name, name
		// `default` is a reserved word: builtins.js exports that formatter as its
		// default export, so it needs a local binding name here (D174).
		if name == "default" {
			imports[i] = "default as __puzzle_default"
			props[i] = "default: __puzzle_default"
		}
	}
	return "import { " + strings.Join(imports, ", ") + " } from " + strconv.Quote(builtinsPath) + ";\n" +
		"export default { " + strings.Join(props, ", ") + " };\n", nil
}

// I18nManifestSpecifier is the virtual module the i18n runtime imports for the
// build's locale manifest (D175): `{ defaultLocale, locales: { tag: path } }`,
// or null when the app configures no translations. Served the same way the
// formatter manifest is, so it is not a new exclusion mechanism (D89's ceiling).
const I18nManifestSpecifier = "@magic-spells/puzzle/i18n/manifest"

const i18nManifestNamespace = "puzzle-i18n-manifest"

// nullI18nManifest is the module every build without i18n serves. The i18n
// runtime is only reachable behind __PUZZLE_HAS_I18N__, so it is resolved but
// never shipped.
const nullI18nManifest = "export default null;\n"

// SetI18n records whether translations are configured and, once the locale files
// have been loaded, the manifest module source (locales.Manifest.JS). enabled
// drives the __PUZZLE_HAS_I18N__ define; the manifest may be set later, and again
// on every locale edit — the virtual module is re-served on every rebuild.
func (p *Plugin) SetI18n(enabled bool, manifestJS string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.i18nEnabled = enabled
	p.i18nManifest = manifestJS
}

// I18nEnabled reports whether the app configured translations.
func (p *Plugin) I18nEnabled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.i18nEnabled
}

func (p *Plugin) i18nManifestSource() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.i18nEnabled || p.i18nManifest == "" {
		return nullI18nManifest
	}
	return p.i18nManifest
}

func (p *Plugin) orderedUsedFormatterNames() ([]string, error) {
	builtins, err := builtinFormatterNames()
	if err != nil {
		return nil, err
	}

	p.mu.Lock()
	used := make(map[string]bool, len(p.formatters)+1)
	for name, ok := range p.formatters {
		used[name] = ok
	}
	p.mu.Unlock()
	used["escape"] = true

	names := make([]string, 0, len(used))
	for _, name := range builtins {
		if used[name] {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("puzzle formatter manifest: builtin allowlist does not include escape")
	}
	return names, nil
}
