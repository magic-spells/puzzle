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

With --static, additionally prerender each static route to its own
dist/<path>/index.html (SSG mode) — the same step enabled by output: 'static'
in puzzle.config.js. Dynamic (:id / *) routes are skipped with a warning.`,
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

		start := time.Now()
		if err := build.Build(dir, build.Options{Development: mode == "development", Static: static}); err != nil {
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
		return dev.Serve(dir, dev.Options{
			Port: port,
			OnReady: func() {
				printUpdateNotice(os.Stdout, ui.New(os.Stdout))
			},
		})
	},
}

func init() {
	buildCmd.Flags().String("mode", "production", "Build mode: production (minified) or development (readable)")
	buildCmd.Flags().Bool("static", false, "Prerender each static route to its own dist/<path>/index.html (SSG mode)")
	devCmd.Flags().Int("port", 3000, "Port for the dev server")

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
