package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/dev"
	"github.com/magic-spells/puzzle/compiler/internal/preview"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/update"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "puzzle",
	Short: "Puzzle Framework - A client-side template framework",
	Long:  `Puzzle compiles .pzl components and packages your application for client-side rendering.`,
	// A build failure is not a usage error: don't dump usage, and let main()
	// print the error once (SilenceErrors avoids cobra's duplicate print).
	SilenceUsage:  true,
	SilenceErrors: true,
	// --no-color is the same switch as NO_COLOR (https://no-color.org): setting
	// the variable here, before any command prints, means every ui.Printer the
	// command creates sees it, and so do the node / Tailwind child processes it
	// spawns. No subcommand defines its own PersistentPreRunE, so this always
	// runs.
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		if noColor, _ := cmd.Flags().GetBool("no-color"); noColor {
			return os.Setenv("NO_COLOR", "1")
		}
		return nil
	},
}

var buildCmd = &cobra.Command{
	Use:   "build [dir]",
	Short: "Compile the app and produce a bundle in dist/",
	Long: `Compile .pzl components and package the app into dist/: the app bundle,
the stylesheet, and the copied public/ assets.

Production builds content-hash their names (app-<hash>.js, styles-<hash>.css,
and app-<hash>.css for JavaScript-imported CSS) and rewrite the shell's
references to match. Set build.hashNames: false to keep the fixed app.js and
styles.css. With build.hashNames unset, a file public/index.html does not
reference (both, when the shell is missing), or that another public/ HTML page
names, keeps its fixed name with a warning. An explicit hashNames: true fails
when the shell does not load app.js, rewrites the other public/ HTML pages,
and hashes the stylesheet even when nothing links it. With build.splitting enabled, lazy chunks land under
dist/chunks/ and the shell gets modulepreload links for its static-import
chunks. Development builds keep fixed names and add no preloads; public/
assets are never renamed.

With --static, additionally emit true static pages: each static route becomes
its own dist/<path>/index.html plus a small per-page module bundle under
dist/_puzzle/ — no router, no SPA takeover. Production pages preload their
shared chunks, and page modules are <slug>-<hash>.js unless build.hashNames is
false.
With --hybrid, prerender each static route to dist/<path>/index.html that the
full SPA runtime takes over on load (the mode formerly spelled --static).
Either flag has a puzzle.config.js
equivalent (output: 'static' | 'hybrid'); passing a flag that disagrees with
the config output value is an error. Dynamic (:id / *) routes are skipped with
a warning.

With --fixtures, wire app/fixtures.js (or .ts) through the fixtures/mock runtime
module so the built app seeds and mocks itself. Without the flag nothing from
that module reaches the bundle. It cannot be combined with --static/--hybrid.

With --profile-build, print a per-phase timing table to stderr after the build.
Setting PUZZLE_PROFILE_BUILD=1 does the same, and reaches the builds 'puzzle
dev' runs for an output: 'static' project.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}

		mode, _ := cmd.Flags().GetString("mode")
		quiet, _ := cmd.Flags().GetBool("quiet")
		switch mode {
		case "production", "development":
		default:
			return fmt.Errorf("invalid --mode %q (expected \"production\" or \"development\")", mode)
		}
		static, _ := cmd.Flags().GetBool("static")
		hybrid, _ := cmd.Flags().GetBool("hybrid")
		fixtures, _ := cmd.Flags().GetBool("fixtures")
		profile, _ := cmd.Flags().GetBool("profile-build")

		output, err := outputFlag(static, hybrid)
		if err != nil {
			return err
		}
		if err := build.PreflightRuntime(dir); err != nil {
			return err
		}

		start := time.Now()
		// The metafile drives the summary's bundle-composition breakdown: which
		// dependency accounts for how much of the emitted bytes. Asking for it
		// costs esbuild only the JSON it already has the data to produce.
		var metafile string
		if err := build.Build(dir, build.Options{
			Development: mode == "development",
			Output:      output,
			Fixtures:    fixtures,
			Profile:     profile,
			Metafile:    &metafile,
		}); err != nil {
			return err
		}
		if quiet {
			// --quiet drops the summary and the update notice; errors still
			// return above and print from main().
			return nil
		}
		out := ui.New(os.Stdout)
		outdir := filepath.Join(dir, "dist")
		printBuildSummary(out, outdir, mode, metafile, time.Since(start))
		printUpdateNotice(os.Stdout, out)
		return nil
	},
}

var devCmd = &cobra.Command{
	Use:   "dev [dir]",
	Short: "Start the dev server with live reload",
	Long: `Run a development build, serve dist/ with history-API fallback, and
rebuild + live-reload the browser on any change under app/. Builds are always
development mode (no minification).

When puzzle.config.js declares output: 'static', dev serves what that mode
actually ships instead: every rebuild runs the real prerender pass and the pages
are served with static semantics — clean URLs, plain full-page navigation, a real
404, and the per-page mount modules. Default and 'hybrid' projects are unaffected.

With --fixtures, wire app/fixtures.js (or .ts) through the fixtures/mock runtime
module so the served app seeds and mocks itself.

With --profile-build, print per-phase startup and rebuild timing tables to
stderr. PUZZLE_PROFILE_BUILD=1 enables the same profiling.`,
	Args: serverArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		host := serverHost(cmd)
		dir := serverDir(args)
		port, _ := cmd.Flags().GetInt("port")
		strictPort, _ := cmd.Flags().GetBool("strict-port")
		open, _ := cmd.Flags().GetBool("open")
		fixtures, _ := cmd.Flags().GetBool("fixtures")
		profile, _ := cmd.Flags().GetBool("profile-build")
		return dev.Serve(dir, dev.Options{
			Port:       port,
			StrictPort: strictPort,
			Host:       host,
			Open:       open,
			Fixtures:   fixtures,
			Profile:    profile,
			// OnReady runs after the ready banner, with the listener already
			// accepting in its own goroutine. The notice reads the cache and
			// returns, so it delays nothing either way.
			OnReady: func() {
				printUpdateNotice(os.Stdout, ui.New(os.Stdout))
			},
		})
	},
}

var previewCmd = &cobra.Command{
	Use:   "preview [dir]",
	Short: "Serve the existing dist/ the way a production host would",
	Long: `Serve an already-built dist/ locally, with the URL semantics of the output
mode declared in puzzle.config.js. There is no watcher, no rebuild, and no
live-reload — run 'puzzle build' first, then preview the artifact.

Default output: any path that is not a file falls back to index.html.
output: 'hybrid': the route's prerendered page when one exists, index.html
otherwise. output: 'static': clean URLs (/about → /about/index.html) and a real
404 — dist/404.html when the app's catch-all route wrote one — because that is
what a static host does.`,
	Args: serverArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		host := serverHost(cmd)
		dir := serverDir(args)
		port, _ := cmd.Flags().GetInt("port")
		strictPort, _ := cmd.Flags().GetBool("strict-port")
		return preview.Serve(dir, preview.Options{
			Port:       port,
			StrictPort: strictPort,
			Host:       host,
		})
	},
}

// outputFlag reconciles the mutually exclusive --static / --hybrid build flags
// into the build.Options.Output mode string. Both set is a usage error; neither
// set leaves the mode to puzzle.config.js `output` (empty here).
func outputFlag(static, hybrid bool) (string, error) {
	switch {
	case static && hybrid:
		return "", fmt.Errorf("--static and --hybrid are mutually exclusive — pass at most one")
	case static:
		return "static", nil
	case hybrid:
		return "hybrid", nil
	default:
		return "", nil
	}
}

func init() {
	rootCmd.PersistentFlags().Bool("no-color", false, "Disable colored output (same as setting NO_COLOR=1 or TERM=dumb)")
	buildCmd.Flags().StringP("mode", "m", "production", "Build mode (production|development): minified, or readable")
	buildCmd.Flags().BoolP("quiet", "q", false, "Skip the build summary and the update notice (errors, warnings and the --static/--hybrid page report still print)")
	buildCmd.Flags().Bool("static", false, "Emit true static pages: per-route HTML + a per-page module bundle, no SPA takeover")
	buildCmd.Flags().Bool("hybrid", false, "Prerender each static route to dist/<path>/index.html that the SPA runtime takes over")
	buildCmd.Flags().Bool("fixtures", false, "Install app/fixtures.js (or .ts) via the fixtures/mock runtime module; not valid with --static/--hybrid")
	buildCmd.Flags().Bool("profile-build", false, "Print a per-phase build timing table to stderr (also enabled by PUZZLE_PROFILE_BUILD=1, which reaches 'puzzle dev' rebuilds)")
	devCmd.Flags().IntP("port", "p", 3000, "Port for the dev server (scans upward if busy)")
	devCmd.Flags().Bool("strict-port", false, "Fail if --port is busy instead of scanning for a free one")
	addHostFlag(devCmd)
	devCmd.Flags().BoolP("open", "o", false, "Open the app in the default browser once the server is ready")
	devCmd.Flags().Bool("fixtures", false, "Install app/fixtures.js (or .ts) via the fixtures/mock runtime module")
	devCmd.Flags().Bool("profile-build", false, "Print per-phase startup and rebuild timing tables to stderr (also enabled by PUZZLE_PROFILE_BUILD=1)")
	// Preview defaults to a different port than dev on purpose: previewing a
	// build while a dev server runs is the common case, and the scan silently
	// moving off 3000 would hide which server answered.
	previewCmd.Flags().IntP("port", "p", 4000, "Port for the preview server (scans upward if busy)")
	previewCmd.Flags().Bool("strict-port", false, "Fail if --port is busy instead of scanning for a free one")
	addHostFlag(previewCmd)

	rootCmd.AddCommand(buildCmd)
	rootCmd.AddCommand(devCmd)
	rootCmd.AddCommand(previewCmd)
}

func main() {
	args := os.Args[1:]
	// Before parsing, so even a usage error (`puzzle dev --no-color --bogus`)
	// prints uncoloured; the persistent pre-run only sees successful parses.
	if hasNoColorFlag(args) {
		_ = os.Setenv("NO_COLOR", "1")
	}
	rootCmd.SetArgs(normalizeHostArgs(args))
	if err := rootCmd.Execute(); err != nil {
		errOut := ui.New(os.Stderr)
		if errOut.Enabled() {
			fmt.Fprintf(os.Stderr, "%s%v\n", errOut.Bold(errOut.Red("✘ ")), err)
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}

// hasNoColorFlag reports whether --no-color appears among the CLI arguments
// before any "--" terminator (a later one is a positional, not the flag).
func hasNoColorFlag(args []string) bool {
	for _, a := range args {
		if a == "--" {
			return false
		}
		if a == "--no-color" || a == "--no-color=true" {
			return true
		}
	}
	return false
}

func formatMillis(d time.Duration) string {
	return fmt.Sprintf("%dms", d.Round(time.Millisecond).Milliseconds())
}

func printUpdateNotice(stdout *os.File, out *ui.Printer) {
	// The gates come first, so a CI, piped, or opted-out invocation never
	// reaches the registry — CheckPassive is the only thing that starts the
	// background refresh on the passive path.
	if os.Getenv("CI") != "" || os.Getenv("PUZZLE_NO_UPDATE_CHECK") != "" || !ui.IsTerminal(stdout) {
		return
	}
	if latest, ok := update.CheckPassive(version.Version); ok {
		fmt.Fprintln(stdout, out.Dim(fmt.Sprintf(
			"  ✨ puzzle %s available (current %s) — run puzzle upgrade",
			latest,
			version.Version,
		)))
	}
}
