package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/dev"
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
}

var buildCmd = &cobra.Command{
	Use:   "build [dir]",
	Short: "Compile the app and produce a bundle in dist/",
	Long: `Compile .pzl components and package the app into dist/ (app.js, styles.css,
and the copied public/ assets).

With --static, additionally emit true static pages: each static route becomes
its own dist/<path>/index.html plus a small per-page module bundle under
dist/_puzzle/ — no router, no SPA takeover. With --hybrid, prerender each
static route to dist/<path>/index.html that the full SPA runtime takes over on
load (the mode formerly spelled --static). Either flag has a puzzle.config.js
equivalent (output: 'static' | 'hybrid'); passing a flag that disagrees with
the config output value is an error. Dynamic (:id / *) routes are skipped with
a warning.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}

		mode, _ := cmd.Flags().GetString("mode")
		switch mode {
		case "production", "development":
		default:
			return fmt.Errorf("invalid --mode %q (expected \"production\" or \"development\")", mode)
		}
		static, _ := cmd.Flags().GetBool("static")
		hybrid, _ := cmd.Flags().GetBool("hybrid")

		output, err := outputFlag(static, hybrid)
		if err != nil {
			return err
		}

		start := time.Now()
		if err := build.Build(dir, build.Options{Development: mode == "development", Output: output}); err != nil {
			return err
		}
		out := ui.New(os.Stdout)
		outdir := filepath.Join(dir, "dist")
		printBuildSummary(out, outdir, mode, time.Since(start))
		printUpdateNotice(os.Stdout, out)
		return nil
	},
}

var devCmd = &cobra.Command{
	Use:   "dev [dir]",
	Short: "Start the dev server with live reload",
	Long: `Run a development build, serve dist/ with history-API fallback, and
rebuild + live-reload the browser on any change under app/. Builds are always
development mode (no minification).`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		port, _ := cmd.Flags().GetInt("port")
		strictPort, _ := cmd.Flags().GetBool("strict-port")
		return dev.Serve(dir, dev.Options{
			Port:       port,
			StrictPort: strictPort,
			OnReady: func() {
				printUpdateNotice(os.Stdout, ui.New(os.Stdout))
			},
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
	buildCmd.Flags().String("mode", "production", "Build mode: production (minified) or development (readable)")
	buildCmd.Flags().Bool("static", false, "Emit true static pages: per-route HTML + a per-page module bundle, no SPA takeover")
	buildCmd.Flags().Bool("hybrid", false, "Prerender each static route to dist/<path>/index.html that the SPA runtime takes over")
	devCmd.Flags().Int("port", 3000, "Port for the dev server (scans upward if busy)")
	devCmd.Flags().Bool("strict-port", false, "Fail if --port is busy instead of scanning for a free one")

	rootCmd.AddCommand(buildCmd)
	rootCmd.AddCommand(devCmd)
}

func main() {
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

func formatMillis(d time.Duration) string {
	return fmt.Sprintf("%dms", d.Round(time.Millisecond).Milliseconds())
}

func printUpdateNotice(stdout *os.File, out *ui.Printer) {
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
