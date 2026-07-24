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
	// skillRoots pins the config dirs to install into (--skill-root). When set,
	// home detection and the target prompt are both skipped: explicit roots are
	// explicit intent. `puzzle upgrade` uses this to hand the freshly installed
	// binary the exact set the user already confirmed (D97).
	skillRoots []string
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
	selected, err := resolveSkillTargets(w, out, env)
	if err != nil {
		return err
	}
	// No targets is a friendly no-op — resolveSkillTargets already said why.
	if len(selected) == 0 {
		return nil
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

// resolveSkillTargets picks the config dirs to install into: the explicit
// --skill-root list when given, otherwise the detected ones (all of them on a
// non-TTY, the checked ones from the prompt on a TTY). An empty result is a
// legitimate no-op and is explained on w before returning.
func resolveSkillTargets(w io.Writer, out *ui.Printer, env addEnvironment) ([]skillTarget, error) {
	if len(env.skillRoots) > 0 {
		return skillTargetsFromRoots(env.skillRoots)
	}

	home, err := env.homeDir()
	if err != nil {
		return nil, fmt.Errorf("finding home directory: %w", err)
	}
	targets, err := detectSkillTargets(home)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		fmt.Fprintf(w, "%s No Claude Code, Codex, or Cursor config directories found under %s — nothing to install.\n",
			out.Yellow("!"), home)
		return nil, nil
	}
	if !env.interactive {
		return targets, nil
	}

	selected, err := promptSkillTargets(env.input, w, targets)
	if err != nil {
		return nil, err
	}
	if len(selected) == 0 {
		fmt.Fprintln(w, "No targets selected — nothing installed.")
		return nil, nil
	}
	return selected, nil
}

// skillTargetsFromRoots turns explicit --skill-root values into targets. The
// root must already exist: we create `<root>/skills/puzzle` inside a config dir
// the user already has, we never conjure the config dir itself (a typo'd path
// would otherwise install a skill nothing reads).
func skillTargetsFromRoots(roots []string) ([]skillTarget, error) {
	targets := make([]skillTarget, 0, len(roots))
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, fmt.Errorf("resolving --skill-root %s: %w", root, err)
		}
		info, err := os.Stat(abs)
		switch {
		case os.IsNotExist(err):
			return nil, fmt.Errorf("--skill-root %s does not exist", root)
		case err != nil:
			return nil, fmt.Errorf("checking %s: %w", abs, err)
		case !info.IsDir():
			return nil, fmt.Errorf("--skill-root %s is not a directory", root)
		}
		targets = append(targets, skillTarget{Name: skillTargetName(abs), Root: abs})
	}
	return targets, nil
}

// skillTargetName labels an explicit root with its tool name when the directory
// is a known config dir, else with its own basename.
func skillTargetName(root string) string {
	base := filepath.Base(root)
	for _, supported := range supportedSkillTargets {
		if strings.EqualFold(base, supported.config) {
			return supported.name
		}
	}
	return base
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

// installedSkillTargets splits the detected config dirs into the ones that
// already carry a real Puzzle skill directory (refreshable) and the ones whose
// install is a symlink. A symlink is a dev checkout link — copying through it
// would rewrite files in the linked repository, so `puzzle upgrade` reports it
// and leaves it alone rather than clobbering a working tree (D97).
func installedSkillTargets(home string) (refresh []skillTarget, linked []string, err error) {
	targets, err := detectSkillTargets(home)
	if err != nil {
		return nil, nil, err
	}
	for _, target := range targets {
		dest := target.destination()
		info, statErr := os.Lstat(dest)
		switch {
		case os.IsNotExist(statErr):
			continue // never installed here — `puzzle add skills` owns first installs
		case statErr != nil:
			return nil, nil, fmt.Errorf("checking %s: %w", dest, statErr)
		case info.Mode()&os.ModeSymlink != 0:
			linked = append(linked, dest)
		case info.IsDir():
			refresh = append(refresh, target)
		}
	}
	return refresh, linked, nil
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
