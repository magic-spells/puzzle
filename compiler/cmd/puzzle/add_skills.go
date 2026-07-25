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
	"github.com/magic-spells/puzzle/compiler/internal/version"
	embeddedskills "github.com/magic-spells/puzzle/skills"
)

const embeddedPuzzleSkillRoot = "puzzle"

// skillVersionFile records which CLI wrote an installed skill. The payload is
// go:embed-ed, so "which CLI wrote it" IS the skill's version — without the stamp
// the CLI can only ask whether a directory exists, never whether it is current
// (D99). Dotfile so it does not read as skill content to the agent loading it.
const skillVersionFile = ".puzzle-skill-version"

// confirmSkillUpdate is the skill-refresh prompt, indirected so tests can answer
// it without driving a huh form. Shared by `add skills`, `upgrade skills`, and the
// post-upgrade offer — one prompt, one seam.
var confirmSkillUpdate = confirmSkillRefresh

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

// addSkills installs the embedded skill into the resolved targets. Re-running the
// command after a CLI upgrade is the normal way to refresh an install, so an
// existing destination asks rather than refusing (D99): the refusal only survives
// on a non-TTY, where a script must name the clobber with --overwrite.
func addSkills(w io.Writer, out *ui.Printer, overwrite bool, env addEnvironment) error {
	selected, err := resolveSkillTargets(w, out, env)
	if err != nil {
		return err
	}
	// No targets is a friendly no-op — resolveSkillTargets already said why.
	if len(selected) == 0 {
		return nil
	}

	// --overwrite is explicit intent: write every selected target, symlinked
	// destinations included (the D97 upgrade path relies on exactly this).
	if overwrite {
		return installSkills(w, out, selected)
	}

	plan, err := classifySkillTargets(selected)
	if err != nil {
		return err
	}
	for _, dest := range plan.linked {
		fmt.Fprintf(w, "%s %s is a symlink — skill left as is.\n", out.Yellow("!"), dest)
	}
	for _, target := range plan.current {
		fmt.Fprintf(w, "%s %s already has skill %s — up to date.\n",
			out.Green("✓"), target.destination(), version.Version)
	}

	install := append([]skillTarget(nil), plan.fresh...)
	if len(plan.stale) > 0 {
		if !env.interactive {
			return fmt.Errorf("refusing to overwrite existing skill installation(s) (use --overwrite to replace):\n  %s",
				strings.Join(skillDestinationPaths(plan.stale), "\n  "))
		}
		confirmed, err := confirmSkillUpdate(env.input, w, plan.stale, version.Version)
		if err != nil {
			return err
		}
		if confirmed {
			install = append(install, plan.stale...)
		} else {
			fmt.Fprintf(w, "%s Left as is: %s\n", out.Yellow("!"), skillDestinations(plan.stale))
		}
	}

	if len(install) == 0 {
		// Everything selected was already current: say how to force a reinstall,
		// which is also how you re-copy an edited payload without bumping the version.
		if len(plan.current) > 0 && len(plan.stale) == 0 {
			fmt.Fprintf(w, "Run %s to reinstall anyway.\n", out.Bold("puzzle add skills --overwrite"))
		}
		return nil
	}
	return installSkills(w, out, install)
}

func installSkills(w io.Writer, out *ui.Printer, targets []skillTarget) error {
	for _, target := range targets {
		dest := target.destination()
		if err := installSkillTree(dest); err != nil {
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
	form := newSkillPromptForm(input, output, huh.NewGroup(field))
	if err := form.Run(); err != nil {
		return nil, fmt.Errorf("selecting skill targets: %w", err)
	}
	return selected, nil
}

// newSkillPromptForm preserves huh's environment-selected accessible mode for
// real terminal input. In accessible mode huh reads os.Stdin directly, ignoring
// WithInput, so an injected reader must pin the regular renderer to stay
// deterministic regardless of TERM.
func newSkillPromptForm(input io.Reader, output io.Writer, group *huh.Group) *huh.Form {
	form := huh.NewForm(group).
		WithInput(input).
		WithOutput(output)
	if inputFile, ok := input.(*os.File); !ok || inputFile != os.Stdin {
		form.WithAccessible(false)
	}
	return form
}

// skillPlan splits selected targets by what is already sitting at their
// destination. Only `stale` needs the user's consent: a missing destination is a
// plain install, a matching stamp has nothing to replace, and a symlink is a dev
// checkout link we refuse to write through without --overwrite (D97's rule,
// applied to `add` in D99).
type skillPlan struct {
	fresh   []skillTarget
	current []skillTarget
	stale   []skillTarget
	linked  []string
}

func classifySkillTargets(targets []skillTarget) (skillPlan, error) {
	var plan skillPlan
	for _, target := range targets {
		dest := target.destination()
		info, err := os.Lstat(dest)
		switch {
		case os.IsNotExist(err):
			plan.fresh = append(plan.fresh, target)
		case err != nil:
			return skillPlan{}, fmt.Errorf("checking %s: %w", dest, err)
		case info.Mode()&os.ModeSymlink != 0:
			plan.linked = append(plan.linked, dest)
		default:
			// A non-directory here is junk in the destination slot, not an install:
			// it has no stamp, so it lands in `stale` and gets replaced on consent.
			if installed, ok := installedSkillVersion(dest); ok && installed == version.Version {
				plan.current = append(plan.current, target)
				continue
			}
			plan.stale = append(plan.stale, target)
		}
	}
	return plan, nil
}

// installedSkillVersion reads the CLI version stamped into an installed skill. A
// missing or unreadable stamp is "unknown", never an error: the stamp only phrases
// a prompt, and every install written before D99 legitimately has none — those read
// as stale, which is the right default.
func installedSkillVersion(dest string) (string, bool) {
	data, err := os.ReadFile(filepath.Join(dest, skillVersionFile))
	if err != nil {
		return "", false
	}
	stamped := strings.TrimSpace(string(data))
	if stamped == "" {
		return "", false
	}
	return stamped, true
}

// installSkillTree replaces the skill at dest with this binary's embedded copy and
// stamps the CLI version beside it.
//
// A real destination is REMOVED first: copySkillTree merges, so a file the new
// payload dropped would linger and keep telling an agent something the current
// release contradicts — the staleness D97 exists to prevent, one level down.
//
// A symlinked destination is written THROUGH, never removed: os.RemoveAll on a
// symlink deletes the link itself, quietly converting a dev checkout link into a
// real directory. Only --overwrite reaches here with a symlink.
func installSkillTree(dest string) error {
	info, err := os.Lstat(dest)
	switch {
	case err == nil && info.Mode()&os.ModeSymlink == 0:
		if err := os.RemoveAll(dest); err != nil {
			return fmt.Errorf("removing %s: %w", dest, err)
		}
	case err != nil && !os.IsNotExist(err):
		return fmt.Errorf("checking %s: %w", dest, err)
	}

	if err := copySkillTree(embeddedskills.FS, embeddedPuzzleSkillRoot, dest); err != nil {
		return err
	}
	stamp := filepath.Join(dest, skillVersionFile)
	if err := os.WriteFile(stamp, []byte(version.Version+"\n"), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", stamp, err)
	}
	return nil
}

func confirmSkillRefresh(input io.Reader, output io.Writer, targets []skillTarget, latest string) (bool, error) {
	confirmed := true
	field := huh.NewConfirm().
		Title(fmt.Sprintf("Update the installed Puzzle skill to %s?", latest)).
		Description(strings.Join(skillDestinationLines(targets), "\n")).
		Affirmative("Yes").
		Negative("No").
		Value(&confirmed)
	form := newSkillPromptForm(input, output, huh.NewGroup(field))
	if err := form.Run(); err != nil {
		return false, err
	}
	return confirmed, nil
}

// skillDestinationLines describes each destination for the confirm prompt, naming
// what is installed there so the user is answering about a version delta rather
// than about a path.
func skillDestinationLines(targets []skillTarget) []string {
	lines := make([]string, 0, len(targets))
	for _, target := range targets {
		dest := target.destination()
		if installed, ok := installedSkillVersion(dest); ok {
			lines = append(lines, fmt.Sprintf("%s (%s) — installed %s", dest, target.Name, installed))
			continue
		}
		lines = append(lines, fmt.Sprintf("%s (%s) — version unknown", dest, target.Name))
	}
	return lines
}

func skillDestinationPaths(targets []skillTarget) []string {
	paths := make([]string, 0, len(targets))
	for _, target := range targets {
		paths = append(paths, target.destination())
	}
	return paths
}

func skillDestinations(targets []skillTarget) string {
	return strings.Join(skillDestinationPaths(targets), ", ")
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
