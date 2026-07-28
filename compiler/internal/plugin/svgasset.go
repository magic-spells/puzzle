package plugin

// svgasset.go — the esbuild half of {#svg} asset DEDUP (v1.14 D46 amendment).
//
// In dedup mode codegen emits, per {#svg} use site, an import of a virtual module
// specifier `@magic-spells/puzzle/svg-asset/<app/assets-relative src>` plus a
// factory call. This file resolves those specifiers to the file on disk and
// serves a per-asset module that exports a factory returning the island-frozen
// `<svg>` vnode. esbuild caches modules by (resolved Path, Namespace), so every
// use site across the WHOLE bundle — any number of files — collapses onto ONE
// module: each unique icon's markup is stored once instead of inlined at every
// site.
//
// Error positioning is preserved by codegen: it still reads + scans each file at
// compile time, so a missing/malformed file fails the .pzl compile with a
// positioned message before this virtual module is ever loaded. This loader
// re-scans (same parser.ScanSVGFile) purely to build the shared module.

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/codegen"
)

const svgAssetNamespace = "puzzle-svg-asset"

// setupSVGAssets registers the OnResolve/OnLoad handlers for the {#svg} dedup
// virtual modules. Called from setup().
func (p *Plugin) setupSVGAssets(build api.PluginBuild) {
	// Resolve `@magic-spells/puzzle/svg-asset/<src>` → the absolute svg path so
	// esbuild dedups by file (Path + Namespace), collapsing every use of the same
	// asset — even across .pzl files — onto one module.
	build.OnResolve(api.OnResolveOptions{Filter: "^" + escapeRegexp(codegen.SVGAssetSpecifierPrefix)}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
		src := strings.TrimPrefix(args.Path, codegen.SVGAssetSpecifierPrefix)
		p.mu.Lock()
		assetsDir := p.assetsDir
		p.mu.Unlock()
		abs, err := resolveSVGAsset(assetsDir, src)
		if err != nil {
			return api.OnResolveResult{Errors: []api.Message{{Text: err.Error()}}}, nil
		}
		return api.OnResolveResult{
			Path:      abs,
			Namespace: svgAssetNamespace,
		}, nil
	})

	build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: svgAssetNamespace}, func(args api.OnLoadArgs) (api.OnLoadResult, error) {
		data, err := os.ReadFile(args.Path)
		if err != nil {
			return api.OnLoadResult{Errors: []api.Message{{Text: err.Error()}}}, nil
		}

		p.mu.Lock()
		runtimeDir := p.runtimeDir
		p.mu.Unlock()
		viewNodeImport := "@magic-spells/puzzle"
		if runtimeDir != "" {
			viewNodeImport = filepath.ToSlash(filepath.Join(runtimeDir, "index.js"))
		}

		// Position a malformed-file error inside the svg (matches the .pzl-compile
		// error the codegen path already reports for the same file).
		name := p.relName(args.Path)
		out, cerr := codegen.SVGAssetModule(data, name, viewNodeImport)
		if cerr != nil {
			return api.OnLoadResult{
				Errors:     toMessages(cerr, name),
				WatchFiles: []string{args.Path},
			}, nil
		}
		return api.OnLoadResult{
			Contents:   &out,
			Loader:     api.LoaderJS,
			ResolveDir: runtimeDir,
			// Editing the svg must regenerate this shared module: esbuild caches
			// virtual-module OnLoad results, so list the source as a WatchFile to
			// invalidate the cache on the next incremental rebuild (D46).
			WatchFiles: []string{args.Path},
		}, nil
	})
}

// resolveSVGAsset maps a {#svg} virtual-module specifier to the asset file on
// disk, CONTAINED to app/assets/. codegen only ever emits specifiers that
// already passed the compile-time shape check, but this handler resolves the
// specifier for ANY module in the bundle — a hand-written
// `import '@magic-spells/puzzle/svg-asset/../../../../etc/passwd'` in app JS or
// a dependency would otherwise be joined blind and read by OnLoad. The shape
// rule is codegen's own (ValidSVGPath: relative, no "./"/"../", a Clean that
// stays inside), plus a filepath.Rel containment check on the joined result so
// nothing but a descendant of assetsDir is ever handed to OnLoad.
func resolveSVGAsset(assetsDir, src string) (string, error) {
	bad := fmt.Errorf("refusing to resolve %q — {#svg} assets must be plain paths inside app/assets/", codegen.SVGAssetSpecifierPrefix+src)
	if !codegen.ValidSVGPath(src) {
		return "", bad
	}
	abs := filepath.Join(assetsDir, filepath.FromSlash(src))
	rel, err := filepath.Rel(assetsDir, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", bad
	}
	return abs, nil
}

// escapeRegexp escapes the regexp metacharacters that can occur in the fixed
// specifier prefix (only '.' in practice) so the OnResolve filter matches it
// literally.
func escapeRegexp(s string) string {
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune(`.+*?()|[]{}^$\`, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}
