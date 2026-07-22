package main

import (
	"fmt"
	"os"

	"github.com/magic-spells/puzzle/compiler/internal/generate"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

var generateCmd = &cobra.Command{
	Use:     "generate <type> <Name>",
	Aliases: []string{"g"},
	Short:   "Scaffold a component, view, layout, or model",
	Long: `Scaffold a new source file from a stub template.

Types:
  component   app/components/<Name>.pzl   (PascalCase name)
  view        app/views/<Name>.pzl        (PascalCase name)
  layout      app/layouts/<Name>.pzl      (PascalCase name)
  model       app/models/<name>.js        (lower-case singular name)

The output directory can be overridden with --path (relative to the project
root). Existing files are never overwritten unless --force is given.`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		kind, err := generate.ParseKind(args[0])
		if err != nil {
			return err
		}
		name := args[1]

		path, _ := cmd.Flags().GetString("path")
		force, _ := cmd.Flags().GetBool("force")

		cwd, err := os.Getwd()
		if err != nil {
			return err
		}
		root, err := generate.FindProjectRoot(cwd)
		if err != nil {
			return err
		}

		res, err := generate.Generate(generate.Options{
			Root:  root,
			Kind:  kind,
			Name:  name,
			Dir:   path,
			Force: force,
		})
		if err != nil {
			return err
		}

		out := ui.New(os.Stdout)
		fmt.Fprintf(os.Stdout, "%s created %s\n", out.Green("✓"), out.Bold(res.Rel))
		if res.Hint != "" {
			fmt.Fprintf(os.Stdout, "\n%s %s\n", out.Yellow("→"), out.Dim(res.Hint))
		}
		return nil
	},
}

func init() {
	generateCmd.Flags().String("path", "", "Output directory, relative to the project root (overrides the default)")
	generateCmd.Flags().Bool("force", false, "Overwrite an existing file")
	rootCmd.AddCommand(generateCmd)
}
