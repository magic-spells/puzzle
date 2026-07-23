package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/scaffold"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

// initCmd scaffolds a new Puzzle application from an embedded template. It is
// registered here (not in main.go) so the three CLI commands can live in
// separate files; rootCmd is the package-level command in main.go.
var initCmd = &cobra.Command{
	Use:   "init <app-name>",
	Short: "Scaffold a new Puzzle application",
	Long: `Create a new Puzzle app in <parent>/<app-name>.

The target directory must not already exist and be non-empty. The app name
becomes an npm package name, so it must be lowercase letters, digits and
hyphens, starting with a letter.

With no argument, prompts for the app name when run interactively (a TTY); in
scripts and CI the argument is required. When interactive, --template and
--typescript are also prompted for unless the flag was passed explicitly; in
scripts and CI the flag defaults are used silently and nothing is prompted.`,
	// MaximumNArgs(1), not ExactArgs(1): the name may be omitted and prompted
	// for interactively (see RunE). Zero args on a non-TTY still errors (D32
	// scriptability — puzzle init must stay non-interactive under pipes/CI).
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Interactive means a real terminal on stdin. Every prompt below is gated
		// on this exact check so a non-TTY (pipe, CI, `< /dev/null`) stays fully
		// non-interactive: it never prompts, never hangs on stdin, and falls back
		// to args/flag defaults (D32: init is non-interactive by contract except
		// for these opt-in TTY prompts).
		interactive := ui.IsTerminal(os.Stdin)

		var appName string
		if len(args) == 1 {
			appName = args[0]
		} else if interactive {
			name, perr := promptAppName(os.Stdin, os.Stdout)
			if perr != nil {
				return perr
			}
			appName = name
		} else {
			// No app-name argument on a non-TTY: hard-error so scripts stay
			// predictable rather than blocking on a prompt they can't answer.
			return fmt.Errorf("app name required (usage: puzzle init <app-name>)")
		}

		template, _ := cmd.Flags().GetString("template")
		dir, _ := cmd.Flags().GetString("dir")
		typescript, _ := cmd.Flags().GetBool("typescript")

		// On a TTY, prompt for any question whose flag was not passed explicitly.
		// An explicit flag is authoritative and never second-guessed; a non-TTY
		// skips both prompts and keeps the flag defaults.
		if interactive && !cmd.Flags().Changed("template") {
			t, perr := promptTemplate(os.Stdin, os.Stdout)
			if perr != nil {
				return perr
			}
			template = t
		}
		if interactive && !cmd.Flags().Changed("typescript") {
			ts, perr := promptTypeScript(os.Stdin, os.Stdout)
			if perr != nil {
				return perr
			}
			typescript = ts
		}

		if !scaffold.ValidTemplate(template) {
			return fmt.Errorf("invalid --template %q (available: %s)", template, strings.Join(scaffold.Templates, ", "))
		}

		res, err := scaffold.Create(dir, appName, template)
		if err != nil {
			return err
		}

		// --typescript (v1.22, D54): add a strict/noEmit tsconfig.json alongside the
		// scaffold so editors type-check the app's .ts/.js files, with typed .pzl
		// imports (the puzzle-env.d.ts shim). The .pzl `<script>` bodies themselves
		// are transpile-only — the tsconfig include can't reach them and D54 never
		// type-checks them. The build stays transpile-only; the default is plain JS.
		// Either a tsconfig.json (--typescript) or a jsconfig.json — never both,
		// since editors ignore jsconfig.json next to a tsconfig.json. Both carry
		// the `paths` entry for the build's '@' app alias (SPEC §40, D75).
		configWriter := scaffold.WriteJSConfig
		if typescript {
			configWriter = scaffold.WriteTypeScriptConfig
		}
		added, terr := configWriter(res.Dir)
		if terr != nil {
			return terr
		}
		res.Files = append(res.Files, added...)

		printInitSummary(ui.New(os.Stdout), appName, template, res, typescript)
		return nil
	},
}

func init() {
	initCmd.Flags().String("template", scaffold.DefaultTemplate,
		fmt.Sprintf("Starter template (%s)", strings.Join(scaffold.Templates, "|")))
	initCmd.Flags().String("dir", "", "Parent directory to create the app in (default: current directory)")
	initCmd.Flags().Bool("typescript", false, "Add a strict tsconfig.json for editor type-checking of .ts/.js files (with typed .pzl imports; .pzl <script> bodies are transpile-only)")
	rootCmd.AddCommand(initCmd)
}

// promptAppName reads an app name from r, re-prompting until it passes
// scaffold.ValidateName (the same rule the argument form enforces, so an
// interactive answer can never scaffold a name the CLI would otherwise reject).
// Invalid input prints the reason and loops; EOF / a read error ends the loop
// with the same error the non-TTY path returns, so a closed stdin never hangs.
// Reader/Writer (not *os.File) so tests can drive it with plain buffers; that
// also means plain Fprintf here rather than ui.Printer, which needs a terminal
// file to decide on color.
func promptAppName(r io.Reader, w io.Writer) (string, error) {
	scanner := bufio.NewScanner(r)
	for {
		fmt.Fprint(w, "  App name › ")
		if !scanner.Scan() {
			return "", fmt.Errorf("app name required (usage: puzzle init <app-name>)")
		}
		name := strings.TrimSpace(scanner.Text())
		if err := scaffold.ValidateName(name); err != nil {
			fmt.Fprintf(w, "  %s\n", err)
			continue
		}
		return name, nil
	}
}

// promptTemplate reads a template choice from r, re-prompting until it names a
// known template (scaffold.Templates). Empty input selects scaffold.DefaultTemplate,
// so pressing Enter keeps the same default the --template flag carries. Invalid
// input prints the accepted set and loops; EOF / a read error ends the loop with
// an error so a closed stdin never hangs (mirroring promptAppName). Reader/Writer
// so tests can drive it with plain buffers.
func promptTemplate(r io.Reader, w io.Writer) (string, error) {
	scanner := bufio.NewScanner(r)
	for {
		fmt.Fprintf(w, "  Template (%s) [%s] › ", strings.Join(scaffold.Templates, "/"), scaffold.DefaultTemplate)
		if !scanner.Scan() {
			return "", fmt.Errorf("template required (usage: puzzle init --template <%s>)", strings.Join(scaffold.Templates, "|"))
		}
		choice := strings.TrimSpace(scanner.Text())
		if choice == "" {
			return scaffold.DefaultTemplate, nil
		}
		if !scaffold.ValidTemplate(choice) {
			fmt.Fprintf(w, "  invalid template %q (available: %s)\n", choice, strings.Join(scaffold.Templates, ", "))
			continue
		}
		return choice, nil
	}
}

// promptTypeScript reads a yes/no answer from r for whether to add a strict
// tsconfig.json. It defaults to No: empty input (a bare Enter) means no, matching
// the --typescript flag default. y/yes/n/no are accepted case-insensitively;
// anything else re-prompts. EOF / a read error ends the loop with an error so a
// closed stdin never hangs (mirroring promptAppName). Reader/Writer so tests can
// drive it with plain buffers.
func promptTypeScript(r io.Reader, w io.Writer) (bool, error) {
	scanner := bufio.NewScanner(r)
	for {
		fmt.Fprint(w, "  Add TypeScript config? [y/N] › ")
		if !scanner.Scan() {
			return false, fmt.Errorf("typescript answer required (usage: puzzle init --typescript)")
		}
		switch strings.ToLower(strings.TrimSpace(scanner.Text())) {
		case "", "n", "no":
			return false, nil
		case "y", "yes":
			return true, nil
		default:
			fmt.Fprintln(w, "  please answer y or n")
		}
	}
}

// printInitSummary prints a short colored report of what was scaffolded plus the
// next steps, degrading cleanly to plain text on a non-TTY (ui no-ops color).
func printInitSummary(out *ui.Printer, appName, template string, res *Result, typescript bool) {
	rel := res.Dir
	if wd, err := os.Getwd(); err == nil {
		if r, err := filepath.Rel(wd, res.Dir); err == nil && !strings.HasPrefix(r, "..") {
			rel = r
		}
	}

	tsNote := ""
	if typescript {
		tsNote = " · typescript"
	}
	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s %s\n\n",
		out.Cyan(out.Bold("puzzle init")),
		out.Dim("· "+template+" template"+tsNote),
	)
	fmt.Fprintf(os.Stdout, "  %s created %s %s\n",
		out.Green("✓"),
		out.Bold(appName),
		out.Dim(fmt.Sprintf("· %d files", len(res.Files))),
	)

	fmt.Fprintln(os.Stdout)
	fmt.Fprintf(os.Stdout, "  %s\n", out.Bold("Next steps"))
	fmt.Fprintf(os.Stdout, "    %s %s\n", out.Dim("$"), "cd "+rel)
	fmt.Fprintf(os.Stdout, "    %s %s\n", out.Dim("$"), "npm install")
	fmt.Fprintf(os.Stdout, "    %s %s\n", out.Dim("$"), "npm run dev")
	fmt.Fprintln(os.Stdout)
}

// Result aliases scaffold.Result so the summary signature reads locally; the CLI
// package owns its own presentation of the scaffold result.
type Result = scaffold.Result
