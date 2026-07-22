package main

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/huh"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	embeddedskills "github.com/magic-spells/puzzle/skills"
)

const embeddedPuzzleSkillRoot = "puzzle"

type addEnvironment struct {
	homeDir     func() (string, error)
	input       io.Reader
	interactive bool
}

type skillTarget struct {
	Name string
	Root string
}

func (t skillTarget) destination() string {
	return filepath.Join(t.Root, "skills", "puzzle")
}

var supportedSkillTargets = []struct {
	name   string
	config string
}{
	{name: "Claude Code", config: ".claude"},
	{name: "Codex", config: ".codex"},
	{name: "Cursor", config: ".cursor"},
}

func addSkills(w io.Writer, out *ui.Printer, overwrite bool, env addEnvironment) error {
	home, err := env.homeDir()
	if err != nil {
		return fmt.Errorf("finding home directory: %w", err)
	}

	targets, err := detectSkillTargets(home)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		fmt.Fprintf(w, "%s No Claude Code, Codex, or Cursor config directories found under %s — nothing to install.\n",
			out.Yellow("!"), home)
		return nil
	}

	selected := targets
	if env.interactive {
		selected, err = promptSkillTargets(env.input, w, targets)
		if err != nil {
			return err
		}
		if len(selected) == 0 {
			fmt.Fprintln(w, "No targets selected — nothing installed.")
			return nil
		}
	}

	if !overwrite {
		conflicts, err := existingSkillDestinations(selected)
		if err != nil {
			return err
		}
		if len(conflicts) > 0 {
			return fmt.Errorf("refusing to overwrite existing skill installation(s) (use --overwrite to replace):\n  %s",
				strings.Join(conflicts, "\n  "))
		}
	}

	for _, target := range selected {
		dest := target.destination()
		if err := copySkillTree(embeddedskills.FS, embeddedPuzzleSkillRoot, dest); err != nil {
			return fmt.Errorf("installing Puzzle skill for %s: %w", target.Name, err)
		}
		fmt.Fprintf(w, "%s Installed Puzzle skill for %s: %s\n",
			out.Green("✓"), target.Name, dest)
	}
	return nil
}

func detectSkillTargets(home string) ([]skillTarget, error) {
	var targets []skillTarget
	for _, supported := range supportedSkillTargets {
		root := filepath.Join(home, supported.config)
		info, err := os.Stat(root)
		switch {
		case os.IsNotExist(err):
			continue
		case err != nil:
			return nil, fmt.Errorf("checking %s: %w", root, err)
		case info.IsDir():
			targets = append(targets, skillTarget{Name: supported.name, Root: root})
		}
	}
	return targets, nil
}

func promptSkillTargets(input io.Reader, output io.Writer, targets []skillTarget) ([]skillTarget, error) {
	selected := append([]skillTarget(nil), targets...)
	options := make([]huh.Option[skillTarget], 0, len(targets))
	for _, target := range targets {
		options = append(options,
			huh.NewOption(fmt.Sprintf("%s (%s)", target.Name, target.Root), target).Selected(true))
	}

	field := huh.NewMultiSelect[skillTarget]().
		Title("Install the Puzzle skill for:").
		Description("Space to toggle, enter to confirm.").
		Options(options...).
		Filterable(false).
		Value(&selected)
	form := huh.NewForm(huh.NewGroup(field)).
		WithInput(input).
		WithOutput(output)
	if err := form.Run(); err != nil {
		return nil, fmt.Errorf("selecting skill targets: %w", err)
	}
	return selected, nil
}

func existingSkillDestinations(targets []skillTarget) ([]string, error) {
	var conflicts []string
	for _, target := range targets {
		dest := target.destination()
		_, err := os.Lstat(dest)
		switch {
		case err == nil:
			conflicts = append(conflicts, dest)
		case os.IsNotExist(err):
			continue
		default:
			return nil, fmt.Errorf("checking %s: %w", dest, err)
		}
	}
	return conflicts, nil
}

func copySkillTree(source fs.FS, sourceRoot, destination string) error {
	sub, err := fs.Sub(source, sourceRoot)
	if err != nil {
		return fmt.Errorf("loading embedded skill: %w", err)
	}
	return fs.WalkDir(sub, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == "." {
			return nil
		}

		dest := filepath.Join(destination, filepath.FromSlash(path))
		if entry.IsDir() {
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return fmt.Errorf("creating %s: %w", dest, err)
			}
			return nil
		}

		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return fmt.Errorf("reading embedded %s: %w", path, err)
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return fmt.Errorf("creating %s: %w", filepath.Dir(dest), err)
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", dest, err)
		}
		return nil
	})
}
