package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/compiler/internal/generate"
	"github.com/magic-spells/puzzle/compiler/internal/standalone"
	"github.com/spf13/cobra"
)

// compileCmd prints one .pzl file's compiled module to stdout. It is the seam
// between the Go compiler and the @magic-spells/puzzle/vitest plugin (D194):
// Vitest runs on Vite, which cannot read .pzl, so the plugin hands each .pzl
// import to this command and serves what it prints. It is hidden because the
// plugin is its only intended caller; its output is not a stable format to
// build on (puzzle build is the real compile).
var compileCmd = &cobra.Command{
	Use:    "compile <file.pzl>",
	Short:  "Print one .pzl file's compiled JavaScript module (used by the Vitest plugin)",
	Hidden: true,
	Long: `Compile one .pzl file into a standalone ES module and print it to stdout.

The emission mode follows the build's directory rule: files under app/views/
and app/layouts/ compile as views, everything else as a component. {#svg}
assets resolve from the nearest app/assets/ directory and are inlined. A
lang="ts" script has its types stripped, and an inline source map takes the
module back to its .pzl lines. <style> blocks are not part of the module.
Errors print as file:line:col: message on stderr and exit 1; warnings print
to stderr and the module is still printed.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		js, err := compileOne(args[0], os.Stderr)
		if err != nil {
			return err
		}
		_, err = fmt.Fprint(os.Stdout, js)
		return err
	},
}

// compileOne reads and compiles path, printing any codegen warnings to warn.
// split out from the command so tests can call it without capturing stdout.
func compileOne(path string, warn *os.File) (string, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	// compile under the build's name for the file, its path from the project
	// root: that name picks the d20 view or component mode and keys the
	// <style scoped> id (d59), so both match the build on every machine.
	abs, _ := filepath.Abs(path)
	root, err := generate.FindProjectRoot(filepath.Dir(abs))
	if err != nil {
		return "", err
	}
	rel, _ := filepath.Rel(root, abs)
	name := filepath.ToSlash(rel)
	res, err := standalone.Compile(name, src, codegen.ModeForPath(name), standalone.AssetsDirFor(path))
	if err != nil {
		return "", err
	}
	for _, w := range res.Warnings {
		fmt.Fprintf(warn, "%s:%d:%d: warning: %s\n", w.File, w.Line, w.Col, w.Message)
	}
	return res.JS, nil
}

func init() {
	rootCmd.AddCommand(compileCmd)
}
