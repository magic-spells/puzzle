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
	p.hasFlip = usage.HasFlip
	p.hasHeadTags = usage.HasHeadTags
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

// Features returns the usage bits captured by the most recent SetUsage call.
func (p *Plugin) Features() (hasFlip, hasHeadTags bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.hasFlip, p.hasHeadTags
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
	list := strings.Join(names, ", ")
	return "import { " + list + " } from " + strconv.Quote(builtinsPath) + ";\n" +
		"export default { " + list + " };\n", nil
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
