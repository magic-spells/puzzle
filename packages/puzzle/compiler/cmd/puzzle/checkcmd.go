package main

import (
	"fmt"
	"os"

	"github.com/magic-spells/puzzle/compiler/internal/check"
	"github.com/magic-spells/puzzle/compiler/internal/codemod"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

var checkCmd = &cobra.Command{
	Use:   "check [dir]",
	Short: "Type-check .pzl scripts and template expressions",
	Long: `Type-check the app's .pzl files with the TypeScript compiler the app itself
has installed (node_modules/typescript, run under node — puzzle never installs
one for you).

Each .pzl becomes a virtual file under .puzzle/check/: a lang="ts" script is
checked as written, and every template expression is re-emitted as typed
statements. A value read from data() is untyped, so the template check catches
an event handler missing from events, and a handler (in a lang="ts" component)
or standard function called with the wrong number of arguments or an argument
of a known type that does not fit — not a misspelled data field. Diagnostics
are reported at their real .pzl line and column.

A plain-JavaScript component gets its template expressions checked but its
script body left alone — inference noise on untyped JavaScript is opt-in.

Before type-checking, check looks for code written for an older Puzzle that
0.10 renamed (D199): the router <Slot/> (now <Outlet/>, or <Children/> in a
component), this.setData( (now setState), positional data(params, props)
(now data({ params, props })), and the formatters config key and
app/formatters.js (now functions). It lists each site and stops; --fix
rewrites them in place, then type-checks. Sites it cannot rewrite safely are
listed for you to finish by hand.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		fix, _ := cmd.Flags().GetBool("fix")
		out := ui.New(os.Stdout)
		// the upgrade pass (D199) runs first: code written for an older release
		// would otherwise surface as type errors that do not say what changed.
		ran, err := runCodemod(dir, fix, out)
		if err != nil {
			return err
		}
		if fix && ran && !check.HasTypeScript(dir) {
			// a fix has done its job even where the app has no TypeScript to
			// type-check with, so that case is a note, not a failure.
			fmt.Fprintf(os.Stdout, "%s skipped the type check: npm install -D typescript to run it\n", out.Dim("·"))
			return nil
		}
		files, err := check.Run(dir)
		if err != nil {
			return err
		}
		fmt.Fprintf(os.Stdout, "%s no type errors in %s\n", out.Green("✓"), pluralFiles(files))
		return nil
	},
}

// runCodemod runs the 0.10 codemod over the app. a dry run with sites to
// rewrite prints them and returns an error, so check exits non-zero before it
// type-checks; with fix it rewrites them and reports what changed. ran is true
// when the pass found the app at all (no app/ directory is left for check.Run
// to report).
func runCodemod(dir string, fix bool, out *ui.Printer) (ran bool, err error) {
	res, err := codemod.Run(dir, fix)
	if err != nil {
		// no app/ here: check.Run gives the project-root error itself.
		return false, nil
	}
	if notes := codemod.FormatNotes(res); notes != "" {
		fmt.Fprintf(os.Stdout, "%s left for you to finish (D199):\n%s", out.Yellow("!"), notes)
	}
	if len(res.Changes) == 0 {
		if fix {
			fmt.Fprintf(os.Stdout, "%s nothing to upgrade\n", out.Green("✓"))
		}
		return true, nil
	}
	if fix {
		fmt.Fprintf(os.Stdout, "%s upgraded %s in %s for 0.10:\n%s", out.Green("✓"), pluralSites(len(res.Changes)), pluralFiles2(res.Files), codemod.Format(res))
		return true, nil
	}
	fmt.Fprint(os.Stdout, codemod.Format(res))
	return true, fmt.Errorf("%s written for an older Puzzle (D199) — run puzzle check --fix to rewrite %s", pluralSites(len(res.Changes)), them(len(res.Changes)))
}

// pluralSites spells a count of rewrite sites.
func pluralSites(n int) string {
	if n == 1 {
		return "1 site"
	}
	return fmt.Sprintf("%d sites", n)
}

// pluralFiles2 spells a count of files of any kind.
func pluralFiles2(n int) string {
	if n == 1 {
		return "1 file"
	}
	return fmt.Sprintf("%d files", n)
}

// them is the pronoun for a count.
func them(n int) string {
	if n == 1 {
		return "it"
	}
	return "them"
}

func pluralFiles(n int) string {
	if n == 1 {
		return "1 .pzl file"
	}
	return fmt.Sprintf("%d .pzl files", n)
}

func init() {
	checkCmd.Flags().Bool("fix", false, "rewrite code written for an older Puzzle (the 0.10 renames), then type-check")
	rootCmd.AddCommand(checkCmd)
}
