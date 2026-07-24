// Hybrid (SSG) output for `puzzle build --hybrid` (or `output: 'hybrid'` in
// puzzle.config.js) — the prerender + SPA-takeover mode formerly spelled
// 'static'. The Go compiler needs no new parser/codegen work — compiled .pzl
// output is already pure ViewNode-tree data — so this is entirely a downstream
// step: bundle a SECOND, node-platform esbuild pass whose entry imports the
// app's default export plus the SSG runtime, run it under node to emit one
// index.html per static route into the staging dir, then hand back a summary. It
// slots into Build() after copyPublic and before the staging→dist swap, so a
// prerender failure discards staging and leaves the last good dist/ exactly as
// it was (the same atomic-swap guarantee compile failures already get).
//
// The true static-pages mode (`--static` / `output: 'static'`, D81) lives in
// prerender_pages.go and reuses the shared bundle/exec helpers here.
package build

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
	"github.com/magic-spells/puzzle/compiler/internal/textutil"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
)

// prerenderSentinel prefixes the JSON summary the prerender entry writes to
// stdout as its LAST output. As with the config loader (config.go), user code
// (models, data()) may console.log freely, so the payload cannot be the whole of
// stdout — Go reads only the text after the sentinel's LAST occurrence.
const prerenderSentinel = "__PUZZLE_SSG_JSON__"

// prerenderTimeout bounds the node prerender run. It is generous relative to the
// config load: prerendering awaits each route's data(), which may hit the network
// or seed a store, so a hung route past this deadline is killed and reported.
const prerenderTimeout = 120 * time.Second

// prerenderDir is the staging subdirectory that holds the generated prerender
// bundle. It is deleted before the staging→dist swap so it never ships in dist/.
const prerenderDir = ".puzzle-prerender"

// ssgSummary mirrors the JSON the SSG runtime's prerenderToDir prints after the
// sentinel: the files written, the routes it skipped (dynamic routes in v1), and
// any advisory warnings. `written` entries also carry the output file path and a
// prerender flag — the Go side never reads them, so they are not modeled here.
type ssgSummary struct {
	Written []struct {
		Path string `json:"path"`
		// false for a `prerender: false` route — the plain SPA shell was written
		// at its path instead of rendered markup (an SPA island, SPEC §36).
		Prerender bool `json:"prerender"`
	} `json:"written"`
	Skipped []struct {
		Path   string `json:"path"`
		Reason string `json:"reason"`
	} `json:"skipped"`
	Warnings []string `json:"warnings"`
}

// prerenderHybrid bundles and runs the hybrid prerender step against the app
// rooted at absRoot, writing per-route index.html files into staging (the temp
// build dir before the atomic swap). staging/index.html is the SPA shell
// copyPublic just produced — it is the injection template. On any failure the
// returned error surfaces node's stderr/stdout and staging is discarded by
// Build's defer, so the previous dist/ is untouched.
func prerenderHybrid(absRoot, staging string) error {
	// The generated prerender entry (the SSG contract): import the app's default
	// export + prerenderToDir, run it against the outDir/shellPath passed on argv
	// in the 'hybrid' mode (passed explicitly so the JS side is unambiguous — it
	// is also the JS default), and print the JSON summary behind the sentinel.
	// The app entry path is JSON-encoded so a root with spaces/quotes stays a
	// valid JS string literal.
	entry, err := json.Marshal(appEntryPath(absRoot))
	if err != nil {
		return fmt.Errorf("encoding prerender entry path: %w", err)
	}
	stdin := fmt.Sprintf(
		"import app from %s;\n"+
			"import { prerenderToDir } from '@magic-spells/puzzle/ssg';\n"+
			"const summary = await prerenderToDir(app?.config ?? app, { outDir: process.argv[2], shellPath: process.argv[3], mode: 'hybrid' });\n"+
			"process.stdout.write('\\n%s' + JSON.stringify(summary));\n",
		string(entry), prerenderSentinel,
	)

	outfile := filepath.Join(staging, prerenderDir, "prerender.mjs")
	if err := bundlePrerenderEntry(absRoot, stdin, outfile, "--hybrid"); err != nil {
		return err
	}

	payload, err := runPrerender(outfile, staging, "--hybrid")
	if err != nil {
		return err
	}
	var summary ssgSummary
	if err := json.Unmarshal([]byte(payload), &summary); err != nil {
		return fmt.Errorf("puzzle build --hybrid: prerender summary was not readable JSON: %w", err)
	}

	printPrerenderSummary(summary)

	// Drop the prerender bundle before the swap so it never ships in dist/.
	if err := os.RemoveAll(filepath.Join(staging, prerenderDir)); err != nil {
		return fmt.Errorf("puzzle build --hybrid: cleaning %s: %w", prerenderDir, err)
	}
	return nil
}

// appEntryPath is the app's default-export entry (app/app.js under absRoot),
// forward-slashed for embedding in a generated JS import.
func appEntryPath(absRoot string) string {
	return filepath.ToSlash(filepath.Join(absRoot, "app", "app.js"))
}

// bundlePrerenderEntry runs the node-platform esbuild pass over the generated
// stdin entry, writing the runnable bundle to outfile. It mirrors the main
// bundle's .pzl plugin + runtime aliasing (the '@' app alias plus the in-repo
// @magic-spells/puzzle + /ssg + /static aliases) so views/layouts compile the
// same way. label names the mode in a bundle-failure error. The CSS the fresh
// plugin collects is discarded — styles.css was already composed by the main
// pass; this pass exists only to run the app under node.
func bundlePrerenderEntry(absRoot, stdin, outfile, label string) error {
	pl := plugin.New(absRoot)
	if err := scanFormatters(absRoot, pl); err != nil {
		return err
	}

	buildOpts := api.BuildOptions{
		Stdin: &api.StdinOptions{
			Contents:   stdin,
			ResolveDir: absRoot,
			Loader:     api.LoaderJS,
			Sourcefile: "puzzle-prerender-entry.js",
		},
		Bundle:   true,
		Outfile:  outfile,
		Write:    true,
		Platform: api.PlatformNode, // runs under node, not the browser
		Format:   api.FormatESModule,
		Target:   api.ES2022,
		// Inline sourcemap so `node --enable-source-maps` maps a data()/model
		// throw back to the user's .pzl/.js without a sidecar file in staging.
		Sourcemap: api.SourceMapInline,
		// Build-time render: the runtime's dev-only HMR machinery folds away.
		Define:   map[string]string{"__PUZZLE_DEV__": "false"},
		Plugins:  []api.Plugin{pl.ESBuild()},
		LogLevel: api.LogLevelSilent,
	}
	configureRuntime(absRoot, &buildOpts, pl)

	result := api.Build(buildOpts)
	if len(result.Errors) > 0 {
		lines := api.FormatMessages(result.Errors, api.FormatMessagesOptions{
			Kind:          api.ErrorMessage,
			Color:         ui.New(os.Stderr).Enabled(),
			TerminalWidth: 0,
		})
		return fmt.Errorf("puzzle build %s: prerender bundle failed:\n%s", label, strings.Join(lines, "\n"))
	}
	return nil
}

// runPrerender executes the bundled prerender entry under node, passing the
// staging dir (outDir) and the SPA shell (staging/index.html) on argv, and
// returns the raw JSON summary that rides the stdout sentinel (the caller
// unmarshals it into the mode's summary shape). A non-zero exit or a missing
// sentinel fails the build with node's stderr/stdout surfaced. label names the
// mode in error text. It follows the node-execution + sentinel-parsing pattern
// of config.readConfigViaNode.
func runPrerender(entryFile, staging, label string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), prerenderTimeout)
	defer cancel()

	shellPath := filepath.Join(staging, "index.html")
	cmd := exec.CommandContext(ctx, "node", "--enable-source-maps", entryFile, staging, shellPath)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", fmt.Errorf(
				"puzzle build %s requires Node.js but `node` was not found on PATH", label,
			)
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "", fmt.Errorf(
				"puzzle build %s: prerendering timed out after %s — check for a hanging data() in a route",
				label, prerenderTimeout,
			)
		}
		return "", fmt.Errorf(
			"puzzle build %s: prerender failed:\n%s",
			label, prerenderDetail(stderr.String(), stdout.String(), err),
		)
	}

	out := stdout.String()
	idx := strings.LastIndex(out, prerenderSentinel)
	if idx < 0 {
		return "", fmt.Errorf(
			"puzzle build %s: prerender produced no summary (missing %s sentinel)\n%s",
			label, prerenderSentinel, prerenderDetail(stderr.String(), out, nil),
		)
	}
	return strings.TrimSpace(out[idx+len(prerenderSentinel):]), nil
}

// prerenderDetail picks the most useful diagnostic to surface: node's stderr,
// else its stdout, else the raw exec error.
func prerenderDetail(stderr, stdout string, err error) string {
	if msg := strings.TrimSpace(stderr); msg != "" {
		return msg
	}
	if msg := strings.TrimSpace(stdout); msg != "" {
		return msg
	}
	if err != nil {
		return err.Error()
	}
	return "(no output)"
}

// printPrerenderSummary reports the prerender result to stdout in the style of
// the build summary: a header with the page count, then each skipped route and
// each advisory warning as a dimmed/yellow line. It degrades cleanly on a
// non-TTY (the ui.Printer no-ops color).
func printPrerenderSummary(s ssgSummary) {
	prerendered := 0
	for _, w := range s.Written {
		if w.Prerender {
			prerendered++
		}
	}
	shells := len(s.Written) - prerendered

	out := ui.New(os.Stdout)
	detail := fmt.Sprintf("· %d page%s prerendered", prerendered, textutil.Plural(prerendered))
	if shells > 0 {
		// `prerender: false` islands get the plain SPA shell — written, not rendered.
		detail += fmt.Sprintf(" (+%d SPA shell%s)", shells, textutil.Plural(shells))
	}
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s %s\n",
		out.Cyan(out.Bold("puzzle build · hybrid")),
		out.Dim(detail),
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
