// True static-pages output for `puzzle build --static` (or `output: 'static'`
// in puzzle.config.js), decision D79. Unlike the hybrid mode (prerender.go),
// which prerenders per-route HTML that the full SPA runtime takes over, the
// static mode ships content-complete HTML pages plus a SMALL per-page ES-module
// bundle: no router, no SPA takeover, no history API. Navigation is plain <a>
// page loads; the per-page script upgrades each page to an interactive document.
//
// The Go pipeline runs the shared node prerender pass in mode 'static' (the JS
// side captures each page's store payload and returns an extended summary), then
// generates one `mountStatic` entry file per written page and runs a SECOND,
// browser-platform esbuild pass with Splitting over those entries into
// staging/_puzzle. staging/app.js is deleted (nothing references it in static
// mode). Like hybrid, it slots in before the staging→dist swap, so any failure
// discards staging and leaves the last good dist/ untouched.
package build

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// staticPagesDir is the per-page bundle output directory under the app root (and
// the URL prefix the JS shell surgery injects: /_puzzle/<slug>.js). It ships in
// dist/ alongside the prerendered pages.
const staticPagesDir = "_puzzle"

// staticSummary mirrors the JSON the SSG runtime's prerenderToDir prints after
// the sentinel in `mode: 'static'`. It extends the hybrid summary (prerender.go
// ssgSummary) with the per-page module/entry/route facts and the top-level
// mode/target/apiURL/hasFormatters the per-page entry generation needs.
type staticSummary struct {
	Written []staticPage `json:"written"`
	Skipped []struct {
		Path   string `json:"path"`
		Reason string `json:"reason"`
	} `json:"skipped"`
	Warnings []string `json:"warnings"`

	// Mode echoes the requested mode ("static") — a cheap contract check that the
	// JS side ran the intended path.
	Mode string `json:"mode"`
	// Target is the mount element id (e.g. "app"); the per-page entry mounts into
	// `#<target>`.
	Target string `json:"target"`
	// APIURL is the app's configured apiURL, embedded verbatim into each entry's
	// mountStatic call. Kept raw (string or null) so it round-trips exactly.
	APIURL json.RawMessage `json:"apiURL"`
	// HasFormatters is true when the app config registered custom formatters; the
	// build warns when they exist but app/formatters.js does not (they would be
	// missing client-side in static mode).
	HasFormatters bool `json:"hasFormatters"`
}

// staticPage is one written page in the static summary.
type staticPage struct {
	Path string `json:"path"`
	// false for a `prerender: false` route — an empty, unmarked target is written
	// and the per-page script populates it client-side.
	Prerender bool `json:"prerender"`
	// Entry is the per-page bundle URL path, "_puzzle/<slug>.js"; the slug is the
	// esbuild entry name and the on-disk staging entry basename.
	Entry   string        `json:"entry"`
	Modules staticModules `json:"modules"`
	// Route is the serialized route snapshot (plain JSON, no classes) embedded
	// verbatim into the mountStatic call. Kept raw so the Go side never models the
	// chain shape.
	Route json.RawMessage `json:"route"`
}

// staticModules names the app-relative source paths (the codegen __pzlModule
// stamps) of a page's chain view classes and its layout, so the entry generator
// can import them by their real module path.
type staticModules struct {
	Views  []string `json:"views"`
	Layout *string  `json:"layout"`
}

// prerenderStaticPages runs the true static-pages build against the app rooted
// at absRoot, writing content-complete HTML pages (via the node prerender pass)
// plus one per-page ES-module bundle under staging/_puzzle. cfg + dev select the
// same minify/define/dropConsole policy as the main app.js pass.
func prerenderStaticPages(absRoot, staging string, cfg config.Config, dev bool) error {
	// A public/ asset that already produced a staging/_puzzle would be clobbered
	// by the per-page bundles — reject it up front (extends the reserved-output
	// collision guard to the static tree). copyPublic has already run, so the
	// collision is observable here, before the splitting pass writes anything.
	if pagesOut := filepath.Join(staging, staticPagesDir); dirExists(pagesOut) || fileExists(pagesOut) {
		return fmt.Errorf(
			"public asset would overwrite compiler output dist/%s (a reserved output name in static mode); rename or remove it",
			staticPagesDir,
		)
	}

	// 1. Node prerender pass in mode 'static': the JS side renders each static
	//    route, captures its store payload into the page's data island, strips the
	//    app.js tag, and returns the extended summary behind the sentinel.
	entry, err := json.Marshal(appEntryPath(absRoot))
	if err != nil {
		return fmt.Errorf("encoding prerender entry path: %w", err)
	}
	stdin := fmt.Sprintf(
		"import app from %s;\n"+
			"import { prerenderToDir } from '@magic-spells/puzzle/ssg';\n"+
			"const summary = await prerenderToDir(app?.config ?? app, { outDir: process.argv[2], shellPath: process.argv[3], mode: 'static' });\n"+
			"process.stdout.write('\\n%s' + JSON.stringify(summary));\n",
		string(entry), prerenderSentinel,
	)

	outfile := filepath.Join(staging, prerenderDir, "prerender.mjs")
	if err := bundlePrerenderEntry(absRoot, stdin, outfile, "--static"); err != nil {
		return err
	}

	payload, err := runPrerender(outfile, staging, "--static")
	if err != nil {
		return err
	}
	var summary staticSummary
	if err := json.Unmarshal([]byte(payload), &summary); err != nil {
		return fmt.Errorf("puzzle build --static: prerender summary was not readable JSON: %w", err)
	}

	// 2. Generate one mountStatic entry file per written page. Whether the app
	//    ships a models registry / a formatters module is a build-wide fact, so
	//    resolve it once.
	hasModels := fileExists(filepath.Join(absRoot, "app", "models", "index.js"))
	hasFormatters := fileExists(filepath.Join(absRoot, "app", "formatters.js"))

	entriesDir := filepath.Join(staging, prerenderDir, "entries")
	if err := os.MkdirAll(entriesDir, 0o755); err != nil {
		return fmt.Errorf("puzzle build --static: creating entry dir: %w", err)
	}
	var entryFiles []string
	for _, page := range summary.Written {
		slug, err := slugFromEntry(page.Entry)
		if err != nil {
			return err
		}
		src, err := staticEntrySource(absRoot, page, summary.Target, summary.APIURL, hasModels, hasFormatters)
		if err != nil {
			return err
		}
		file := filepath.Join(entriesDir, slug+".js")
		if err := os.WriteFile(file, []byte(src), 0o644); err != nil {
			return fmt.Errorf("puzzle build --static: writing entry %s: %w", slug, err)
		}
		entryFiles = append(entryFiles, file)
	}

	// 3. Warn when the app registered custom formatters (in app.js) but has no
	//    app/formatters.js — those formatters do not exist in the per-page graph.
	if summary.HasFormatters && !hasFormatters {
		out := ui.New(os.Stdout)
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"),
			"custom formatters registered in app.js will not exist client-side in static mode — export them from app/formatters.js")
	}

	// 4. Splitting esbuild pass over all entries → staging/_puzzle. Shared chunks
	//    land in _puzzle/chunks/ automatically. Skipped when there is nothing to
	//    render (no static routes).
	if len(entryFiles) > 0 {
		if err := bundleStaticPages(absRoot, entryFiles, filepath.Join(staging, staticPagesDir), cfg, dev); err != nil {
			return err
		}
	}

	// 5. Nothing references staging/app.js in static mode — drop it (and its map)
	//    plus the prerender scaffolding before the swap so neither ships in dist/.
	for _, name := range []string{"app.js", "app.js.map"} {
		if err := os.Remove(filepath.Join(staging, name)); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("puzzle build --static: removing staging/%s: %w", name, err)
		}
	}
	if err := os.RemoveAll(filepath.Join(staging, prerenderDir)); err != nil {
		return fmt.Errorf("puzzle build --static: cleaning %s: %w", prerenderDir, err)
	}

	printStaticSummary(summary, len(entryFiles))
	return nil
}

// slugFromEntry extracts the page slug from an "_puzzle/<slug>.js" entry path
// (the on-disk staging entry basename and the esbuild EntryNames token). It is
// tolerant of a leading slash. A shape that does not match is a contract
// violation between the Go and JS sides, surfaced as a build error.
func slugFromEntry(entry string) (string, error) {
	e := strings.TrimPrefix(filepath.ToSlash(entry), "/")
	e = strings.TrimPrefix(e, staticPagesDir+"/")
	e = strings.TrimSuffix(e, ".js")
	if e == "" || strings.Contains(e, "/") {
		return "", fmt.Errorf("puzzle build --static: prerender returned a malformed entry path %q", entry)
	}
	return e, nil
}

// staticEntrySource builds the mountStatic entry module for one page. Import
// specifiers and embedded values are JSON-encoded (space/quote safe, forward
// slashes). The models/formatters imports (and their shorthand call properties)
// are emitted only when the source files exist — an absent binding must never be
// referenced. route + apiURL are embedded verbatim from the summary.
func staticEntrySource(absRoot string, page staticPage, target string, apiURL json.RawMessage, hasModels, hasFormatters bool) (string, error) {
	var b strings.Builder
	b.WriteString("import { mountStatic } from '@magic-spells/puzzle/static';\n")

	viewIdents := make([]string, len(page.Modules.Views))
	for i, mod := range page.Modules.Views {
		ident := fmt.Sprintf("V%d", i)
		viewIdents[i] = ident
		spec, err := json.Marshal(absModuleImport(absRoot, mod))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import %s from %s;\n", ident, spec)
	}

	layoutExpr := "null"
	if page.Modules.Layout != nil {
		spec, err := json.Marshal(absModuleImport(absRoot, *page.Modules.Layout))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import L0 from %s;\n", spec)
		layoutExpr = "L0"
	}

	if hasModels {
		spec, err := json.Marshal(absModuleImport(absRoot, "app/models/index.js"))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import models from %s;\n", spec)
	}
	if hasFormatters {
		spec, err := json.Marshal(absModuleImport(absRoot, "app/formatters.js"))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "import formatters from %s;\n", spec)
	}

	targetJSON, err := json.Marshal("#" + target)
	if err != nil {
		return "", err
	}
	routeJSON := "null"
	if len(page.Route) > 0 {
		routeJSON = string(page.Route)
	}
	apiURLJSON := "null"
	if len(apiURL) > 0 {
		apiURLJSON = string(apiURL)
	}

	b.WriteString("mountStatic({\n")
	fmt.Fprintf(&b, "  target: %s,\n", targetJSON)
	fmt.Fprintf(&b, "  views: [%s],\n", strings.Join(viewIdents, ", "))
	fmt.Fprintf(&b, "  layout: %s,\n", layoutExpr)
	fmt.Fprintf(&b, "  route: %s,\n", routeJSON)
	if hasModels {
		b.WriteString("  models,\n")
	}
	if hasFormatters {
		b.WriteString("  formatters,\n")
	}
	fmt.Fprintf(&b, "  apiURL: %s,\n", apiURLJSON)
	b.WriteString("});\n")
	return b.String(), nil
}

// absModuleImport joins an app-relative POSIX module path (a __pzlModule stamp,
// or a conventional app/… path) onto absRoot and returns a forward-slashed
// absolute specifier for a generated import.
func absModuleImport(absRoot, rel string) string {
	return filepath.ToSlash(filepath.Join(absRoot, filepath.FromSlash(rel)))
}

// bundleStaticPages runs the browser-platform, Splitting esbuild pass over the
// generated per-page entries into outdir (staging/_puzzle). Target/minify/define
// and the dropConsole policy match the main app.js pass exactly; EntryNames is
// the bare slug so the emitted /_puzzle/<slug>.js matches the URLs the shell
// surgery injected, and shared code splits into _puzzle/chunks/. The CSS this
// fresh plugin collects is discarded — styles.css was composed by the main pass.
func bundleStaticPages(absRoot string, entryFiles []string, outdir string, cfg config.Config, dev bool) error {
	pl := plugin.New(absRoot)
	if err := scanFormatters(absRoot, pl); err != nil {
		return err
	}

	devLiteral := "false"
	if dev {
		devLiteral = "true"
	}

	buildOpts := api.BuildOptions{
		EntryPoints: entryFiles,
		Bundle:      true,
		Splitting:   true,
		Format:      api.FormatESModule,
		Platform:    api.PlatformBrowser,
		Target:      api.ES2022,
		Outdir:      outdir,
		Write:       true,
		Sourcemap:   api.SourceMapLinked,
		EntryNames:  "[name]",
		ChunkNames:  "chunks/[name]-[hash]",
		Define:      map[string]string{"__PUZZLE_DEV__": devLiteral},
		Plugins:     []api.Plugin{pl.ESBuild()},
		LogLevel:    api.LogLevelSilent,
	}
	// Production (dev=false) matches the main bundle: minify everything and strip
	// console.* unless build.dropConsole: false opts out.
	if !dev {
		buildOpts.MinifyWhitespace = true
		buildOpts.MinifyIdentifiers = true
		buildOpts.MinifySyntax = true
		if cfg.DropConsole() {
			buildOpts.Drop = api.DropConsole
		}
	}
	configureRuntime(absRoot, &buildOpts, pl)

	result := api.Build(buildOpts)
	if len(result.Errors) > 0 {
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return fmt.Errorf("puzzle build --static: per-page bundle failed:\n%s", strings.Join(lines, "\n"))
	}
	return nil
}

// printStaticSummary reports the static build result in the build-summary style:
// the header, the prerendered-page count (with any prerender:false pages noted
// as empty islands), the per-page bundle count, then advisory warnings and
// skipped routes.
func printStaticSummary(s staticSummary, bundleCount int) {
	prerendered := 0
	for _, w := range s.Written {
		if w.Prerender {
			prerendered++
		}
	}
	empties := len(s.Written) - prerendered

	out := ui.New(os.Stdout)
	detail := fmt.Sprintf("· %d page%s prerendered", prerendered, plural(prerendered))
	if empties > 0 {
		// `prerender: false` pages get an empty, unmarked target the per-page
		// script fills client-side.
		detail += fmt.Sprintf(" (+%d empty island%s)", empties, plural(empties))
	}
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s %s\n",
		out.Cyan(out.Bold("puzzle build · static")),
		out.Dim(detail),
	)
	fmt.Fprintf(os.Stdout, "  %s\n",
		out.Dim(fmt.Sprintf("· %d page bundle%s", bundleCount, plural(bundleCount))),
	)
	for _, w := range s.Warnings {
		fmt.Fprintf(os.Stdout, "  %s %s\n", out.Yellow("!"), w)
	}
	for _, sk := range s.Skipped {
		fmt.Fprintf(os.Stdout, "  %s %s %s\n",
			out.Yellow("!"),
			out.Dim("skipped"),
			fmt.Sprintf("%s (%s)", sk.Path, sk.Reason),
		)
	}
}
