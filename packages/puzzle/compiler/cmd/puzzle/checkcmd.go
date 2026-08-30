package main

import (
	"fmt"
	"os"

	"github.com/magic-spells/puzzle/compiler/internal/check"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

var checkCmd = &cobra.Command{
	Use:   "check [dir]",
	Short: "Type-check .pzl scripts and template expressions",
	Long: `Type-check the app's .pzl files with the TypeScript compiler the app itself
has installed (node_modules/.bin/tsc — puzzle never installs one for you).

Each .pzl becomes a virtual file under .puzzle/check/: a lang="ts" script is
checked as written, and every template expression is re-emitted as typed
statements so a typo in { user.nmae } is a type error. Diagnostics are reported
at their real .pzl line and column.

A plain-JavaScript component gets its template expressions checked but its
script body left alone — inference noise on untyped JavaScript is opt-in.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		js, _ := cmd.Flags().GetBool("js")
		if js {
			return fmt.Errorf("--js is not yet implemented")
		}
		files, err := check.Run(dir)
		if err != nil {
			return err
		}
		out := ui.New(os.Stdout)
		fmt.Fprintf(os.Stdout, "%s no type errors in %s\n", out.Green("✓"), pluralFiles(files))
		return nil
	},
}

func pluralFiles(n int) string {
	if n == 1 {
		return "1 .pzl file"
	}
	return fmt.Sprintf("%d .pzl files", n)
}

func init() {
	checkCmd.Flags().Bool("js", false, "Also check JavaScript script bodies (not yet implemented)")
	rootCmd.AddCommand(checkCmd)
}
