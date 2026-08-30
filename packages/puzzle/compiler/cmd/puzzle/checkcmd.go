package main

import (
	"fmt"

	"github.com/magic-spells/puzzle/compiler/internal/check"
	"github.com/spf13/cobra"
)

var checkCmd = &cobra.Command{
	Use:   "check [dir]",
	Short: "Type-check .pzl scripts and template expressions",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		js, _ := cmd.Flags().GetBool("js")
		if js {
			return fmt.Errorf("--js is not yet implemented")
		}
		return check.Run(dir)
	},
}

func init() {
	checkCmd.Flags().Bool("js", false, "Also check JavaScript script bodies (not yet implemented)")
	rootCmd.AddCommand(checkCmd)
}
