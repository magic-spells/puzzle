package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
)

var infoCmd = &cobra.Command{
	Use:   "info [dir]",
	Short: "Print environment and project information",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		out := ui.New(os.Stdout)
		return runInfo(os.Stdout, out, dir)
	},
}

func init() {
	// Wire the `puzzle --version` flag off the stamped build value. (No `version`
	// subcommand — cobra's rootCmd.Version enables only the flag.)
	rootCmd.Version = version.Version
	rootCmd.AddCommand(infoCmd)
}

// runInfo prints a compact, aligned table of version, platform, toolchain, and
// project paths.
func runInfo(w io.Writer, out *ui.Printer, dir string) error {
	absRoot, err := filepath.Abs(dir)
	if err != nil {
		absRoot = dir
	}

	nodeVer := "not found"
	if v, ok := nodeVersion(); ok {
		nodeVer = v
	}

	rows := [][2]string{
		{"puzzle", version.Version},
		{"platform", runtime.GOOS + "/" + runtime.GOARCH},
		{"node", nodeVer},
		{"project root", absRoot},
		{"source dir", "app/"},
		{"output dir", "dist/"},
		{"styles", stylesSummary(dir)},
	}

	labelW := 0
	for _, r := range rows {
		if len(r[0]) > labelW {
			labelW = len(r[0])
		}
	}

	fmt.Fprintf(w, "\n  %s\n\n", out.Cyan(out.Bold("puzzle info")))
	for _, r := range rows {
		fmt.Fprintf(w, "  %s  %s\n", out.Dim(fmt.Sprintf("%-*s", labelW, r[0])), r[1])
	}
	fmt.Fprintln(w)
	return nil
}

// stylesSummary reports the declared style pipeline. Informational only: a
// config that fails to load is reported rather than surfaced as an error.
func stylesSummary(dir string) string {
	if !fsFileExists(filepath.Join(dir, config.ConfigFileName)) {
		return "none (defaults)"
	}
	cfg, err := config.LoadConfig(dir)
	if err != nil {
		return "unavailable (puzzle.config.js failed to load)"
	}
	if cfg.TailwindEnabled() {
		return "tailwindcss"
	}
	return "none (defaults)"
}
