package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
)

var infoCmd = &cobra.Command{
	Use:   "info [dir]",
	Short: "Print environment and project information",
	Long: `Print the CLI version, platform, Node.js version, and the project's paths and
style pipeline as an aligned table.

With --json, print the same facts as one JSON object on stdout instead. The keys
are stable: puzzle, platform, node (null when node is not on PATH), projectRoot
(absolute), sourceDir, outputDir, styles.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		if asJSON, _ := cmd.Flags().GetBool("json"); asJSON {
			return runInfoJSON(os.Stdout, dir)
		}
		out := ui.New(os.Stdout)
		return runInfo(os.Stdout, out, dir)
	},
}

// infoFacts is the --json shape of `puzzle info`. The json tags are a public
// contract for scripts: add keys, never rename or drop one.
type infoFacts struct {
	Puzzle      string  `json:"puzzle"`
	Platform    string  `json:"platform"`
	Node        *string `json:"node"`
	ProjectRoot string  `json:"projectRoot"`
	SourceDir   string  `json:"sourceDir"`
	OutputDir   string  `json:"outputDir"`
	Styles      string  `json:"styles"`
}

// infoJSONKeys names the --json keys in output order, for the flag's help text.
var infoJSONKeys = []string{"puzzle", "platform", "node", "projectRoot", "sourceDir", "outputDir", "styles"}

// collectInfo gathers the facts both renderings print, so the table and the
// JSON object can never disagree.
func collectInfo(dir string) infoFacts {
	absRoot, err := filepath.Abs(dir)
	if err != nil {
		absRoot = dir
	}
	facts := infoFacts{
		Puzzle:      version.Version,
		Platform:    runtime.GOOS + "/" + runtime.GOARCH,
		ProjectRoot: absRoot,
		SourceDir:   "app/",
		OutputDir:   "dist/",
		Styles:      stylesSummary(dir),
	}
	if v, ok := nodeVersion(); ok {
		facts.Node = &v
	}
	return facts
}

// runInfoJSON prints collectInfo as indented JSON, followed by a newline.
func runInfoJSON(w io.Writer, dir string) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(collectInfo(dir))
}

func init() {
	infoCmd.Flags().Bool("json", false, "Print the facts as one JSON object (keys: "+strings.Join(infoJSONKeys, ", ")+"; node is null when not found)")
	rootCmd.AddCommand(infoCmd)
}

// runInfo prints a compact, aligned table of version, platform, toolchain, and
// project paths.
func runInfo(w io.Writer, out *ui.Printer, dir string) error {
	facts := collectInfo(dir)
	nodeVer := "not found"
	if facts.Node != nil {
		nodeVer = *facts.Node
	}

	rows := [][2]string{
		{"puzzle", facts.Puzzle},
		{"platform", facts.Platform},
		{"node", nodeVer},
		{"project root", facts.ProjectRoot},
		{"source dir", facts.SourceDir},
		{"output dir", facts.OutputDir},
		{"styles", facts.Styles},
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
