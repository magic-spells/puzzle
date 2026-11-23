package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/generate"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	deploytemplates "github.com/magic-spells/puzzle/deploy"
)

// deployWrite is one template resolved against an app: the bytes to write and
// the absolute and app-relative paths they go to.
type deployWrite struct {
	data []byte
	// abs is the absolute destination path.
	abs string
	// rel is the slash-separated, app-root-relative path, for messages.
	rel string
	// current is true when the destination already holds exactly these bytes.
	current bool
}

// addDeploy is `puzzle add deploy [host]` (D198). with no host it lists the
// hosts; with one it copies that host's config template into the app, picking
// the spa or static template from --static / --hybrid, else from the
// config's output key. like `add piece` it refuses to overwrite an existing
// file unless --force, and it never edits a file in place (D3): a template is
// written whole or not at all.
func addDeploy(w io.Writer, out *ui.Printer, dir, flagOutput string, overwrite bool, names []string) error {
	if len(names) == 0 {
		renderDeployHosts(w, out)
		return nil
	}
	if len(names) > 1 {
		return fmt.Errorf("usage: puzzle add deploy <host> — one host at a time (%s)", strings.Join(deploytemplates.Names(), ", "))
	}
	host, ok := deploytemplates.Lookup(names[0])
	if !ok {
		return fmt.Errorf("unknown deploy host %q (supported: %s)", names[0], strings.Join(deploytemplates.Names(), ", "))
	}

	// the app root is the walk-up root, so the command works from anywhere
	// inside the app, like add piece.
	root, err := generate.FindProjectRoot(dir)
	if err != nil {
		return err
	}

	// the config tells us the output mode (when no flag does) and whether
	// locale prefixes are on (for the per-locale 404 hint). a broken config is
	// reported, not guessed around: picking the wrong template ships a site
	// that 404s on refresh or serves the shell for missing pages.
	cfg, err := config.LoadConfig(root)
	if err != nil {
		return err
	}
	output := flagOutput
	if output == "" {
		output = cfg.Output
	}
	static := output == "static"

	files := host.SPA
	if static {
		files = host.Static
	}

	// resolve every destination first, so a refusal leaves the app untouched
	// (all or nothing, the add piece pre-flight).
	writes := make([]deployWrite, 0, len(files))
	var clashes []string
	for _, file := range files {
		data, err := deploytemplates.FS.ReadFile(file.Template)
		if err != nil {
			return fmt.Errorf("reading embedded deploy template %s: %w", file.Template, err)
		}
		rel := deployDestination(root, file)
		abs := filepath.Join(root, filepath.FromSlash(rel))
		write := deployWrite{data: data, abs: abs, rel: rel}
		existing, readErr := os.ReadFile(abs)
		switch {
		case readErr == nil && bytes.Equal(existing, data):
			write.current = true
		case readErr == nil:
			clashes = append(clashes, rel)
		case os.IsNotExist(readErr):
			// nothing there yet: a plain write.
		default:
			return fmt.Errorf("checking %s: %w", rel, readErr)
		}
		writes = append(writes, write)
	}
	if len(clashes) > 0 && !overwrite {
		return fmt.Errorf("refusing to overwrite %s (use --force to replace it with the %s template)",
			strings.Join(clashes, ", "), host.Label)
	}

	for _, write := range writes {
		if write.current {
			fmt.Fprintf(w, "%s %s already matches the %s template — nothing to do.\n",
				out.Green("✓"), write.rel, host.Label)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(write.abs), 0o755); err != nil {
			return fmt.Errorf("creating %s: %w", filepath.Dir(write.rel), err)
		}
		if err := os.WriteFile(write.abs, write.data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", write.rel, err)
		}
		fmt.Fprintf(w, "%s Wrote %s (%s, %s).\n", out.Green("✓"), write.rel, host.Label, deployShape(output))
	}

	renderDeployNextSteps(w, out, host, root, cfg, output)
	return nil
}

// deployDestination is the app-relative slash path a template is written to.
// a Public file follows the build's own public folder rule: app/public/ when
// it exists, else public/ when that exists, else app/public/ (created), the
// layout puzzle init scaffolds.
func deployDestination(root string, file deploytemplates.File) string {
	if file.Place != deploytemplates.Public {
		return file.Name
	}
	if !dirExists(filepath.Join(root, "app", "public")) && dirExists(filepath.Join(root, "public")) {
		return "public/" + file.Name
	}
	return "app/public/" + file.Name
}

// dirExists reports whether path is an existing directory.
func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// deployShape names the routing the written template does, for the success line.
func deployShape(output string) string {
	switch output {
	case "static":
		return "static pages, real 404s"
	case "hybrid":
		return "hybrid: prerendered pages, then the shell"
	default:
		return "spa: every route falls back to the shell"
	}
}

// renderDeployHosts prints the host list for a bare `puzzle add deploy`.
func renderDeployHosts(w io.Writer, out *ui.Printer) {
	fmt.Fprintln(w, "Deploy hosts (puzzle add deploy <host>):")
	fmt.Fprintln(w)
	for _, host := range deploytemplates.Hosts {
		// the spa and static templates of a host always land in the same place,
		// so either list names the file.
		dests := make([]string, 0, len(host.SPA))
		for _, file := range host.SPA {
			if file.Place == deploytemplates.Public {
				dests = append(dests, "app/public/"+file.Name)
			} else {
				dests = append(dests, file.Name)
			}
		}
		fmt.Fprintf(w, "  %s %-17s writes %s\n", out.Bold(fmt.Sprintf("%-11s", host.Name)), host.Label, strings.Join(dests, ", "))
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "The template follows the config's output key; --static or --hybrid picks one instead.")
}

// renderDeployNextSteps prints what is left for the user after the write: the
// host-side setup, and the cases a template cannot cover by itself.
func renderDeployNextSteps(w io.Writer, out *ui.Printer, host deploytemplates.Host, root string, cfg config.Config, output string) {
	static := output == "static"
	var steps []string
	switch host.Name {
	case "vercel":
		steps = append(steps, "Commit vercel.json and import the repo in Vercel; it runs npm run build and publishes dist/.")
		if static && cfg.I18n.PrefixRouting() {
			steps = append(steps, "Vercel serves only the top-level dist/404.html, so a missing /<locale>/… path gets the default locale's 404 page.")
		}
	case "netlify":
		steps = append(steps, "Commit netlify.toml and link the repo in Netlify; it runs npm run build and publishes dist/.")
		if static {
			for _, locale := range otherLocales(cfg) {
				steps = append(steps, fmt.Sprintf("Add a 404 rule for %s to netlify.toml: from = \"/%s/*\", to = \"/%s/404.html\", status = 404 (the commented block shows the shape).", locale, locale, locale))
			}
		}
	case "cloudflare":
		steps = append(steps, fmt.Sprintf("Run puzzle build (dist/_headers comes from the public folder), then set the Pages build command to npm run build, the output directory to dist and NODE_VERSION to %d (Pages does not read engines).", minNodeMajor))
		if output == "" {
			// cloudflare pages leaves spa mode the moment a top-level 404.html
			// ships, and every client route then answers with that page.
			for _, name := range []string{"app/public/404.html", "public/404.html"} {
				if fsFileExists(filepath.Join(root, filepath.FromSlash(name))) {
					steps = append(steps, fmt.Sprintf("%s turns off Cloudflare Pages' spa fallback: every client route would get that page. Remove it and draw not-found in a catch-all route.", name))
				}
			}
		}
		if output == "hybrid" {
			steps = append(steps, "Hybrid with a catch-all route: a path with no prerendered page gets dist/404.html with a 404 status, and the router then draws the right route.")
		}
	case "nginx":
		steps = append(steps, "Copy the server block into your nginx config, set server_name and root (the folder you upload dist/ to), then run nginx -t and reload.")
		if static {
			for _, locale := range otherLocales(cfg) {
				steps = append(steps, fmt.Sprintf("Add a location /%s/ block with error_page 404 /%s/404.html (the commented block shows the shape).", locale, locale))
			}
		}
	case "apache":
		steps = append(steps, "Run puzzle build (dist/.htaccess comes from the public folder) and upload dist/; the server needs mod_rewrite and AllowOverride for that folder.")
		if static {
			for _, locale := range otherLocales(cfg) {
				steps = append(steps, fmt.Sprintf("Add an <If> block sending %s's missing paths to /%s/404.html (the commented block shows the shape).", locale, locale))
			}
		}
	}
	if len(steps) == 0 {
		return
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Next:")
	for _, step := range steps {
		fmt.Fprintf(w, "  %s %s\n", out.Dim("•"), step)
	}
}

// otherLocales lists the locales with their own url prefix (every locale but
// the default) when i18n.routing is 'prefix', else nothing. each one has its
// own dist/<locale>/404.html in a static build.
func otherLocales(cfg config.Config) []string {
	if !cfg.I18n.PrefixRouting() {
		return nil
	}
	var locales []string
	for _, locale := range cfg.I18n.Locales {
		if locale != cfg.I18n.DefaultLocale {
			locales = append(locales, locale)
		}
	}
	return locales
}
