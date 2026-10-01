package main

import (
	"github.com/magic-spells/puzzle/compiler/internal/update"
	"github.com/spf13/cobra"
)

// updateCheckCmd is the detached helper the passive notice spawns when its
// cached answer has gone stale (D76). It is not a user-facing command — it
// prints nothing, exits 0 whatever happens, and exists only because a
// `puzzle build` process is gone long before a registry request finishes, so
// the refresh cannot run inside it.
var updateCheckCmd = &cobra.Command{
	Use:    update.RefreshCommand,
	Short:  "Refresh the cached update notice in the background (internal)",
	Hidden: true,
	Args:   cobra.NoArgs,
	Run: func(cmd *cobra.Command, args []string) {
		update.Refresh()
	},
}

func init() {
	rootCmd.AddCommand(updateCheckCmd)
}
