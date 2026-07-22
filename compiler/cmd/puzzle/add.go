package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/generate"
	"github.com/magic-spells/puzzle/compiler/internal/pieces"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

// npmInstallLine is the dependency install the user still runs by hand — the CLI
// only wires configuration, never node_modules (no network at build time).
const npmInstallLine = "npm install -D tailwindcss @tailwindcss/cli"

// canonicalTailwindConfig mirrors examples/todos/puzzle.config.js: an ES module
// default-exporting the styles.use block. Tabs match the reference file so a
// freshly written config reads like the hand-authored one.
const canonicalTailwindConfig = `// Puzzle app configuration (constellation/doc/DOC-DECISIONS.md D12/D26). Read by the
// compiler via node — the Go side never parses JS (D3). Declaring the Tailwind
// pipeline makes ` + "`puzzle build`" + ` / ` + "`puzzle dev`" + ` run the Tailwind CLI and fold
// its output into dist/styles.css ahead of the collected <styles> blocks.
export default {
	styles: {
		use: ['tailwindcss'],
	},
};
`

// tailwindConfigSnippet is what we print for a user to paste when a config
// already exists — we never rewrite their JavaScript (D3).
const tailwindConfigSnippet = `export default {
	styles: {
		use: ['tailwindcss'],
	},
};`

// tailwindStylesCSS is the Tailwind v4 entry stylesheet, matching the todos
// example's @import + @source detection block.
const tailwindStylesCSS = `@import "tailwindcss";

/*
 * Tailwind v4 content detection: scan the app's .pzl components/views/layouts
 * and JS so the utility classes they use are generated. Paths are relative to
 * this stylesheet (app/styles/), so "../" is the app root.
 */
@source "../**/*.pzl";
@source "../**/*.js";
@source "../public/**/*.html";
`

var addCmd = &cobra.Command{
	Use:   "add <integration|piece> [name…]",
	Short: "Add an integration (tailwind) or UI pieces from the registry",
	Long: `Wire an official integration into the current app, or copy UI pieces in.

Integrations (v1: tailwind):
  puzzle add tailwind          declares the Tailwind pipeline in puzzle.config.js
                               and adds an entry stylesheet. It never installs npm
                               dependencies and never rewrites an existing config —
                               it prints the manual steps.

Pieces (copy-in components):
  puzzle add piece <name…>     copies each named piece (and its transitive piece +
                               lib dependencies) from a registry into the app,
                               verbatim, and records hashes in pieces.lock. It never
                               runs npm and never edits styles.css — required npm
                               packages and the theme merge are printed as next
                               steps (D3). Refuses to overwrite existing files
                               unless --overwrite is given.

The registry source is --registry, else $PUZZLE_PIECES_REGISTRY, else the public
puzzle-pieces registry; it may be a local directory or an http(s) URL.`,
	// MinimumNArgs(1), not ExactArgs(1): `add piece` takes one or more piece names
	// after the "piece" selector.
	Args: cobra.MinimumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		registry, _ := cmd.Flags().GetString("registry")
		overwrite, _ := cmd.Flags().GetBool("overwrite")
		dir, _ := cmd.Flags().GetString("dir")
		if dir == "" {
			dir = "."
		}
		out := ui.New(os.Stdout)
		return runAdd(os.Stdout, out, dir, args, registry, overwrite)
	},
}

func init() {
	addCmd.Flags().String("registry", "", "Piece registry source: a local directory or http(s) URL (default: $PUZZLE_PIECES_REGISTRY or the public registry)")
	addCmd.Flags().Bool("overwrite", false, "Overwrite existing destination files when adding pieces")
	addCmd.Flags().String("dir", "", "App root to add pieces into (default: walk up from the current directory for package.json/puzzle.config.js)")
	rootCmd.AddCommand(addCmd)
}

// runAdd dispatches on the requested integration/selector. args[0] selects:
// "tailwind"/"tailwindcss" wire the Tailwind pipeline (unchanged); "piece"
// copies the remaining args as piece names from the registry.
func runAdd(w io.Writer, out *ui.Printer, dir string, args []string, registry string, overwrite bool) error {
	switch strings.ToLower(strings.TrimSpace(args[0])) {
	case "tailwind", "tailwindcss":
		return addTailwind(w, out, dir)
	case "piece":
		return addPieces(w, out, dir, registry, overwrite, args[1:])
	default:
		return fmt.Errorf("unknown integration %q (supported: tailwind, piece)", args[0])
	}
}

// addPieces resolves the app root (walk-up, honoring --dir) and hands off to the
// pieces package. The cmd layer stays thin: source selection, root walk-up, and
// presentation live here; all copy/lock/resolve logic is in internal/pieces.
func addPieces(w io.Writer, out *ui.Printer, dir, registry string, overwrite bool, names []string) error {
	if len(names) == 0 {
		return fmt.Errorf("usage: puzzle add piece <name…>")
	}
	start, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	// Reuse generate's project-root convention: walk up for package.json /
	// puzzle.config.js so `add piece` works from anywhere inside the app.
	root, err := generate.FindProjectRoot(start)
	if err != nil {
		return err
	}

	source := pieces.ResolveSource(registry)
	res, err := pieces.Add(pieces.Options{
		AppRoot:   root,
		Names:     names,
		Fetcher:   pieces.NewFetcher(source),
		Overwrite: overwrite,
	})
	if err != nil {
		return err
	}
	pieces.RenderSummary(w, out, res)
	return nil
}

// addTailwind wires the Tailwind pipeline. When no puzzle.config.js exists it
// writes the canonical one (and an entry stylesheet if app/styles/ needs it).
// When a config already exists it never rewrites the user's JS (D3): a config
// that already declares Tailwind is a friendly no-op; otherwise the exact
// snippet to add is printed as a manual step.
func addTailwind(w io.Writer, out *ui.Printer, dir string) error {
	configPath := filepath.Join(dir, config.ConfigFileName)
	info, statErr := os.Stat(configPath)
	switch {
	case statErr == nil && !info.IsDir():
		return addTailwindExisting(w, out, dir)
	case statErr != nil && !os.IsNotExist(statErr):
		return fmt.Errorf("checking for %s: %w", config.ConfigFileName, statErr)
	}

	// No config file: write the canonical one.
	if err := os.WriteFile(configPath, []byte(canonicalTailwindConfig), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", config.ConfigFileName, err)
	}
	fmt.Fprintf(w, "%s Wrote %s (Tailwind pipeline declared).\n",
		out.Green("✓"), config.ConfigFileName)

	rel, wrote, err := ensureTailwindStyles(dir)
	if err != nil {
		return err
	}
	if wrote {
		fmt.Fprintf(w, "%s Created %s.\n", out.Green("✓"), rel)
	}

	fmt.Fprintf(w, "\nNext, install the Tailwind CLI:\n\n  %s\n", out.Bold(npmInstallLine))
	return nil
}

// addTailwindExisting handles the "config already present" case: load it (D3 —
// via node, never parsed in Go) and either no-op or print the manual snippet.
func addTailwindExisting(w io.Writer, out *ui.Printer, dir string) error {
	cfg, err := config.LoadConfig(dir)
	if err != nil {
		return err
	}
	if cfg.TailwindEnabled() {
		fmt.Fprintf(w, "%s %s already declares the Tailwind pipeline — nothing to do.\n",
			out.Green("✓"), config.ConfigFileName)
		return nil
	}

	fmt.Fprintf(w, "%s %s exists but does not declare Tailwind — manual step required.\n\n",
		out.Yellow("!"), config.ConfigFileName)
	fmt.Fprintf(w, "Add the Tailwind entry to styles.use in %s:\n\n%s\n\n",
		config.ConfigFileName, tailwindConfigSnippet)
	fmt.Fprintf(w, "Then install the Tailwind CLI:\n\n  %s\n", out.Bold(npmInstallLine))
	return nil
}

// ensureTailwindStyles creates app/styles/styles.css when app/styles/ exists but
// no .css there already pulls in Tailwind. It never overwrites an existing
// styles.css. Returns the slash-relative path written and whether it wrote.
//
// A genuine filesystem failure (an unreadable dir/stylesheet, a non-directory at
// app/styles, a failed write or stat) is returned as an error so the caller never
// reports success on a write that didn't happen. Only a missing app/styles/ is a
// legitimate no-op, not an error.
func ensureTailwindStyles(dir string) (string, bool, error) {
	stylesDir := filepath.Join(dir, "app", "styles")
	info, err := os.Stat(stylesDir)
	switch {
	case os.IsNotExist(err):
		return "", false, nil // no app/styles/ to seed — nothing to do
	case err != nil:
		return "", false, fmt.Errorf("checking %s: %w", stylesDir, err)
	case !info.IsDir():
		return "", false, fmt.Errorf("%s exists but is not a directory", stylesDir)
	}

	entries, err := os.ReadDir(stylesDir)
	if err != nil {
		return "", false, fmt.Errorf("reading %s: %w", stylesDir, err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".css") {
			continue
		}
		cssPath := filepath.Join(stylesDir, e.Name())
		data, err := os.ReadFile(cssPath)
		if err != nil {
			return "", false, fmt.Errorf("reading %s: %w", cssPath, err)
		}
		if cssImportsTailwind(string(data)) {
			return "", false, nil // an entry stylesheet already exists
		}
	}

	target := filepath.Join(stylesDir, "styles.css")
	switch _, err := os.Stat(target); {
	case err == nil:
		return "", false, nil // don't clobber an existing styles.css
	case !os.IsNotExist(err):
		return "", false, fmt.Errorf("checking %s: %w", target, err)
	}
	if err := os.WriteFile(target, []byte(tailwindStylesCSS), 0o644); err != nil {
		return "", false, fmt.Errorf("writing %s: %w", target, err)
	}
	return "app/styles/styles.css", true, nil
}

// cssImportsTailwind reports whether a stylesheet already pulls Tailwind in,
// via the v4 `@import "tailwindcss"` or a v3 `@tailwind` directive.
func cssImportsTailwind(css string) bool {
	if strings.Contains(css, "@tailwind") {
		return true
	}
	return strings.Contains(css, "@import") && strings.Contains(css, "tailwindcss")
}
