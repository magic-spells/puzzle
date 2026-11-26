package main

import (
	"text/template"

	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
)

// versionTemplate is the one definition of what `puzzle --version`, `puzzle -v`
// and `puzzle version` print: "puzzle version <v>". The format is load-bearing —
// upgrade.go's binaryReportsVersion reads the LAST whitespace field of a freshly
// installed binary's --version output, so the version must stay the final token.
const versionTemplate = "{{.Name}} version {{.Version}}\n"

// versionCmd is the subcommand spelling of --version (npm, gh, cargo and wrangler
// all answer both). It renders the same template against the root command, so
// the two can never drift.
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the Puzzle CLI version (same as --version)",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return template.Must(template.New("version").Parse(versionTemplate)).
			Execute(cmd.OutOrStdout(), cmd.Root())
	},
}

func init() {
	// rootCmd.Version enables cobra's --version / -v flag off the stamped build
	// value; the template pins its output to the shared format above.
	rootCmd.Version = version.Version
	rootCmd.SetVersionTemplate(versionTemplate)
	rootCmd.AddCommand(versionCmd)
}
