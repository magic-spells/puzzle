package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/magic-spells/puzzle/compiler/internal/update"
	"github.com/magic-spells/puzzle/compiler/internal/version"
	"github.com/spf13/cobra"
)

const puzzlePackage = "@magic-spells/puzzle"

var fetchLatest = update.FetchLatest

var upgradeCmd = &cobra.Command{
	Use:   "upgrade",
	Short: "Upgrade the Puzzle CLI to the latest release",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		check, _ := cmd.Flags().GetBool("check")
		executable, _ := os.Executable()
		return runUpgrade(os.Stdout, os.Stderr, ui.New(os.Stdout), executable, check, upgradeEnvironment{
			homeDir:     os.UserHomeDir,
			input:       os.Stdin,
			interactive: ui.IsTerminal(os.Stdin),
		})
	},
}

// upgradeSkillsCmd refreshes the agent skill from THIS binary — the mirror image
// of the post-upgrade offer below. There, a newer binary exists on disk and the
// running process holds a stale payload, so the install must be re-exec'd; here
// nothing was upgraded, so the running CLI is the correct source and re-execing
// anything would be theatre. That is why it is its own path, not a shortcut into
// runUpgrade (D99).
var upgradeSkillsCmd = &cobra.Command{
	Use:   "skills",
	Short: "Reinstall this CLI's agent skill wherever one is already installed",
	Long: `Refresh the Puzzle agent skill from this binary's embedded copy.

Nothing is downloaded and no version is checked: the skill ships inside the CLI, so
the running binary already holds the payload that matches it.

Only config dirs that already carry a skill are refreshed — first installs belong to
` + "`puzzle add skills`" + `. A symlinked installation is a dev checkout link: it is
reported and left alone. On a non-TTY the refresh runs without prompting, because the
command names the intent; ` + "`puzzle add skills`" + ` still requires --overwrite there,
where clobbering would be a side effect rather than the request.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		return runUpgradeSkills(os.Stdout, ui.New(os.Stdout), upgradeEnvironment{
			homeDir:     os.UserHomeDir,
			input:       os.Stdin,
			interactive: ui.IsTerminal(os.Stdin),
		})
	},
}

func init() {
	upgradeCmd.Flags().Bool("check", false, "Report the current and latest versions without upgrading")
	upgradeCmd.AddCommand(upgradeSkillsCmd)
	rootCmd.AddCommand(upgradeCmd)
}

func runUpgradeSkills(w io.Writer, out *ui.Printer, env upgradeEnvironment) error {
	home, err := env.homeDir()
	if err != nil {
		return fmt.Errorf("finding home directory: %w", err)
	}
	targets, linked, err := installedSkillTargets(home)
	if err != nil {
		return err
	}
	for _, dest := range linked {
		fmt.Fprintf(w, "%s %s is a symlink — skill left as is.\n", out.Yellow("!"), dest)
	}
	if len(targets) == 0 {
		// Symlinks were already reported; only a genuinely empty result needs saying.
		if len(linked) == 0 {
			fmt.Fprintf(w, "%s No installed Puzzle skill found — run %s to install one.\n",
				out.Yellow("!"), out.Bold("puzzle add skills"))
		}
		return nil
	}

	stale := make([]skillTarget, 0, len(targets))
	for _, target := range targets {
		if installed, ok := installedSkillVersion(target.destination()); ok && installed == version.Version {
			fmt.Fprintf(w, "%s %s already has skill %s — up to date.\n",
				out.Green("✓"), target.destination(), version.Version)
			continue
		}
		stale = append(stale, target)
	}
	if len(stale) == 0 {
		fmt.Fprintf(w, "Run %s to reinstall anyway.\n", out.Bold("puzzle add skills --overwrite"))
		return nil
	}

	if env.interactive {
		confirmed, err := confirmSkillUpdate(env.input, w, stale, version.Version)
		if err != nil || !confirmed {
			return err
		}
	}
	return installSkills(w, out, stale)
}

type installKind int

const (
	installManual installKind = iota
	installProject
	installGlobal
	// installWorkspace is a refusal, not an install: the binary is hoisted into
	// a workspace root that does not itself declare the CLI, so the dependency
	// lives in a member package this command has no safe way to pick.
	installWorkspace
)

type installContext struct {
	kind        installKind
	dir         string
	manager     string
	dev         bool
	executable  string
	packageJSON string
}

// upgradeEnvironment carries what the post-upgrade skill refresh needs: where
// agent config dirs live, and whether we may prompt.
type upgradeEnvironment struct {
	homeDir     func() (string, error)
	input       io.Reader
	interactive bool
}

func runUpgrade(stdout, stderr io.Writer, out *ui.Printer, executable string, check bool, env upgradeEnvironment) error {
	latest, err := fetchLatest(5 * time.Second)
	if err != nil {
		return fmt.Errorf("checking for updates: %w", err)
	}
	cmp, err := update.Compare(version.Version, latest)
	if err != nil {
		return err
	}
	if cmp >= 0 {
		fmt.Fprintf(stdout, "%s puzzle %s is up to date\n", out.Green("✓"), version.Version)
		if !check {
			_ = update.WriteCache(latest, time.Now())
		}
		return nil
	}
	if check {
		fmt.Fprintf(stdout, "%s puzzle %s available (current %s)\n", out.Cyan("✨"), latest, version.Version)
		return nil
	}

	ctx, err := detectInstallContext(executable)
	if err != nil {
		return err
	}
	switch ctx.kind {
	case installManual:
		fmt.Fprintln(stdout, "Install the latest release with:")
		fmt.Fprintln(stdout, "  go install github.com/magic-spells/puzzle/compiler/cmd/puzzle@latest")
		return nil
	case installWorkspace:
		// Guessing a member would install into a package the user never named,
		// so the command stops and hands the decision back.
		fmt.Fprintf(stdout, "This CLI is installed by the workspace at %s, which does not declare %s itself.\n",
			ctx.dir, puzzlePackage)
		fmt.Fprintf(stdout, "Upgrade it in the member package that does, for example:\n")
		fmt.Fprintf(stdout, "  npm install %s@%s -w <member>\n", puzzlePackage, latest)
		fmt.Fprintf(stdout, "  (pnpm/yarn/bun: the same add, run from that member's directory)\n")
		return nil
	}

	name, args := upgradeCommand(ctx, latest)
	command := exec.Command(name, args...)
	command.Dir = ctx.dir
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", strings.Join(append([]string{name}, args...), " "), err)
	}

	packageJSON := ctx.packageJSON
	if ctx.kind == installGlobal && !fsFileExists(packageJSON) {
		// Unusual global layouts (a store the owner directory does not link
		// into) still resolve by walking up from the binary itself.
		packageJSON = findGlobalPackageJSON(ctx.executable)
	}
	installed, err := installedVersion(packageJSON)
	if err != nil {
		return fmt.Errorf("confirming installed version: %w", err)
	}
	if installed != latest {
		return fmt.Errorf("upgrade installed puzzle %s, expected %s", installed, latest)
	}

	// Name the scope that moved. The CLI the user invoked and a project they
	// happen to be standing in are different installs, and a success line that
	// says only "upgraded X → Y" reads as either one.
	if ctx.kind == installGlobal {
		fmt.Fprintf(stdout, "%s upgraded the global CLI %s → %s\n", out.Green("✓"), version.Version, latest)
	} else {
		fmt.Fprintf(stdout, "%s upgraded %s %s → %s in %s\n",
			out.Green("✓"), puzzlePackage, version.Version, latest, ctx.dir)
	}
	_ = update.WriteCache(latest, time.Now())
	refreshSkills(stdout, stderr, out, ctx, latest, env)
	return nil
}

// refreshSkills offers to reinstall the agent skill wherever one is already
// installed, and only after a version actually changed (D97). The skill payload
// is go:embed-ed into the binary, so THIS process only holds the OLD skill — the
// new bytes exist solely in the binary npm just installed. The refresh therefore
// re-execs that binary, after confirming its --version really is the new one; a
// binary we cannot find or cannot verify degrades to printing the command rather
// than silently reinstalling the stale skill we are carrying.
//
// Nothing here can fail the upgrade: the package is already installed, and a
// skill copy is a courtesy on top of it. Problems print and return.
func refreshSkills(stdout, stderr io.Writer, out *ui.Printer, ctx installContext, latest string, env upgradeEnvironment) {
	if env.homeDir == nil {
		return
	}
	home, err := env.homeDir()
	if err != nil {
		return
	}
	targets, linked, err := installedSkillTargets(home)
	if err != nil {
		return
	}
	for _, dest := range linked {
		fmt.Fprintf(stdout, "%s %s is a symlink — skill left as is.\n", out.Yellow("!"), dest)
	}
	if len(targets) == 0 {
		return
	}

	if !env.interactive {
		fmt.Fprintf(stdout, "%s Puzzle skill installed at %s — run %s to update it.\n",
			out.Yellow("!"), skillDestinations(targets), out.Bold("puzzle upgrade skills"))
		return
	}
	confirmed, err := confirmSkillUpdate(env.input, stdout, targets, latest)
	if err != nil || !confirmed {
		return
	}

	binary, err := upgradedBinary(ctx, latest)
	if err != nil {
		fmt.Fprintf(stdout, "%s Could not locate the upgraded CLI (%v) — run %s yourself.\n",
			out.Yellow("!"), err, out.Bold("puzzle upgrade skills"))
		return
	}
	args := []string{"add", "skills", "--overwrite"}
	for _, target := range targets {
		args = append(args, "--skill-root", target.Root)
	}
	command := exec.Command(binary, args...)
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		fmt.Fprintf(stdout, "%s Skill update failed (%v) — run %s yourself.\n",
			out.Yellow("!"), err, out.Bold("puzzle upgrade skills"))
	}
}

// upgradedBinary finds the puzzle binary npm just installed and proves it is the
// new one before we run it. Candidates differ by install shape; each is checked
// with --version, so a stale or mismatched path is skipped rather than trusted.
func upgradedBinary(ctx installContext, latest string) (string, error) {
	for _, candidate := range upgradedBinaryCandidates(ctx) {
		if candidate == "" {
			continue
		}
		if binaryReportsVersion(candidate, latest) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("no binary on disk reports version %s", latest)
}

func upgradedBinaryCandidates(ctx installContext) []string {
	if ctx.kind == installProject {
		return []string{
			// Hoisted layouts (npm/yarn/bun) expose the platform binary directly;
			// pnpm keeps it in the store, so fall back to the package-manager shim.
			filepath.Join(ctx.dir, "node_modules", "@magic-spells", platformPackageName(), "bin", "puzzle"),
			filepath.Join(ctx.dir, "node_modules", ".bin", "puzzle"),
		}
	}
	var candidates []string
	// A global install replaces the package behind the same PATH shim; pnpm's
	// versioned store means the currently running path may still be the old one,
	// which is exactly why every candidate is version-checked.
	if path, err := exec.LookPath("puzzle"); err == nil {
		candidates = append(candidates, path)
	}
	return append(candidates, ctx.executable)
}

// platformPackageName mirrors bin/puzzle.js: Node spells amd64 "x64".
func platformPackageName() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	return "puzzle-" + runtime.GOOS + "-" + arch
}

// binaryReportsVersion runs `<path> --version` and compares the trailing field
// (cobra prints "puzzle version <v>"). Exact equality, not a prefix or substring
// match: "0.2.1" must not accept a binary reporting 0.2.10.
func binaryReportsVersion(path, want string) bool {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return false
	}
	fields := strings.Fields(string(output))
	return len(fields) > 0 && fields[len(fields)-1] == want
}

// detectInstallContext derives the install context from the running executable
// alone (D76, §41). The current directory plays no part: `puzzle upgrade`
// upgrades the CLI that was invoked, so a project the user happens to be
// standing in is never touched — and the install whose version is compared
// against the registry, the install the package manager writes, and the install
// the success line names are the same one by construction.
func detectInstallContext(executable string) (installContext, error) {
	resolved := executable
	if real, err := filepath.EvalSymlinks(executable); err == nil {
		resolved = real
	}

	owner, ok := nodeModulesOwner(resolved)
	if !ok {
		// No node_modules above the binary: `go install`, or a binary built
		// straight out of the repo. npm owns neither.
		return installContext{kind: installManual, executable: resolved}, nil
	}

	// pnpm's global root is a real package directory — package.json plus a
	// lockfile, listing every global install as a dependency — so it has to be
	// recognised before the project test, or a pnpm global would upgrade itself
	// as though it were an app. Only the global-root shape counts: matching any
	// `pnpm` path segment would misclassify a project that merely lives under a
	// directory named pnpm (`~/pnpm/app`) and run `pnpm add -g` against it.
	if isPnpmGlobalRoot(owner) {
		return globalContext(owner, resolved, "pnpm"), nil
	}

	manifest, err := readOwnerManifest(filepath.Join(owner, "package.json"))
	if err != nil {
		return installContext{}, err
	}
	if manifest.declared {
		return installContext{
			kind:        installProject,
			dir:         owner,
			manager:     detectPackageManager(owner),
			dev:         manifest.dev,
			executable:  resolved,
			packageJSON: filepath.Join(owner, "node_modules", "@magic-spells", "puzzle", "package.json"),
		}, nil
	}
	// A workspace root hoists its members' dependencies, so the binary can sit
	// under a root that declares nothing itself. That is not a global install —
	// treating it as one would run `npm install -g` as a side effect and then
	// fail confirmation against the workspace's own hoisted copy. Which member
	// owns the dependency is the user's call, so the command explains and stops.
	if manifest.workspaces || fsFileExists(filepath.Join(owner, "pnpm-workspace.yaml")) {
		return installContext{kind: installWorkspace, dir: owner, executable: resolved}, nil
	}
	return globalContext(owner, resolved, "npm"), nil
}

// globalContext describes an install nobody's package.json declares — a global
// prefix (`/usr/local/lib`, `/opt/homebrew/lib`, pnpm's global root). dir stays
// empty so the package manager inherits this process's directory: `-g` does not
// care where it runs, and picking a directory would smuggle the cwd back in.
func globalContext(owner, executable, manager string) installContext {
	return installContext{
		kind:        installGlobal,
		manager:     manager,
		executable:  executable,
		packageJSON: filepath.Join(owner, "node_modules", "@magic-spells", "puzzle", "package.json"),
	}
}

// nodeModulesOwner returns the directory owning the outermost node_modules on
// path. Outermost, not nearest: the binary sits several levels in under every
// layout — `<root>/node_modules/@magic-spells/puzzle-<platform>/bin/puzzle`
// hoisted, `<root>/node_modules/.pnpm/<pkg>@<v>/node_modules/…` under pnpm — and
// only the outermost segment's parent is the root that declares the dependency.
func nodeModulesOwner(path string) (string, bool) {
	owner := ""
	dir := path
	for {
		if strings.EqualFold(filepath.Base(dir), "node_modules") {
			owner = filepath.Dir(dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return owner, owner != ""
		}
		dir = parent
	}
}

// ownerManifest is what the owning directory's package.json says about this
// CLI: whether it declares it, whether only as a devDependency, and whether the
// directory is a workspace root (which declares its members' dependencies on
// their behalf without listing them itself).
type ownerManifest struct {
	declared   bool
	dev        bool
	workspaces bool
}

// readOwnerManifest reads packageJSON. A missing file is not an error — most
// directories have none, and a global prefix never does.
func readOwnerManifest(packageJSON string) (ownerManifest, error) {
	data, readErr := os.ReadFile(packageJSON)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			return ownerManifest{}, nil
		}
		return ownerManifest{}, readErr
	}
	var pkg struct {
		Dependencies    map[string]json.RawMessage `json:"dependencies"`
		DevDependencies map[string]json.RawMessage `json:"devDependencies"`
		// Present in either shape npm/yarn/bun accept — an array of globs, or an
		// object with a `packages` key. Only presence matters here.
		Workspaces json.RawMessage `json:"workspaces"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ownerManifest{}, fmt.Errorf("reading %s: %w", packageJSON, err)
	}
	_, dependency := pkg.Dependencies[puzzlePackage]
	_, devDependency := pkg.DevDependencies[puzzlePackage]
	return ownerManifest{
		declared:   dependency || devDependency,
		dev:        !dependency && devDependency,
		workspaces: len(pkg.Workspaces) > 0,
	}, nil
}

func detectPackageManager(dir string) string {
	locks := []struct {
		name    string
		manager string
	}{
		{"pnpm-lock.yaml", "pnpm"},
		{"yarn.lock", "yarn"},
		{"bun.lock", "bun"},
		{"bun.lockb", "bun"},
		{"package-lock.json", "npm"},
	}
	for _, lock := range locks {
		if fsFileExists(filepath.Join(dir, lock.name)) {
			return lock.manager
		}
	}
	return "npm"
}

func upgradeCommand(ctx installContext, latest string) (string, []string) {
	pkg := puzzlePackage + "@" + latest
	if ctx.kind == installGlobal {
		if ctx.manager == "pnpm" {
			return "pnpm", []string{"add", "-g", pkg}
		}
		return "npm", []string{"install", "-g", pkg}
	}

	switch ctx.manager {
	case "pnpm":
		args := []string{"add"}
		if ctx.dev {
			args = append(args, "-D")
		}
		return "pnpm", append(args, pkg)
	case "yarn":
		args := []string{"add"}
		if ctx.dev {
			args = append(args, "-D")
		}
		return "yarn", append(args, pkg)
	case "bun":
		args := []string{"add"}
		if ctx.dev {
			args = append(args, "-d")
		}
		return "bun", append(args, pkg)
	default:
		args := []string{"install"}
		if ctx.dev {
			args = append(args, "--save-dev")
		}
		return "npm", append(args, pkg)
	}
}

// isPnpmGlobalRoot reports whether owner is pnpm's global package directory:
// `<pnpm home>/global/<n>`, where the pnpm home is a directory named `pnpm`
// (`~/Library/pnpm`, `~/.local/share/pnpm`), a corepack `pnpm@<v>` cache, or
// wherever $PNPM_HOME points. The full shape is required — a mere `pnpm` path
// segment is not pnpm's, so a project living under one stays a project.
func isPnpmGlobalRoot(owner string) bool {
	global := filepath.Dir(owner)
	if !strings.EqualFold(filepath.Base(global), "global") {
		return false
	}
	root := filepath.Dir(global)
	base := strings.ToLower(filepath.Base(root))
	if base == "pnpm" || strings.HasPrefix(base, "pnpm@") {
		return true
	}
	home := os.Getenv("PNPM_HOME")
	if home == "" {
		return false
	}
	if resolved, err := filepath.EvalSymlinks(home); err == nil {
		home = resolved
	}
	return filepath.Clean(home) == root
}

func findGlobalPackageJSON(executable string) string {
	dir := filepath.Dir(executable)
	for {
		if strings.EqualFold(filepath.Base(dir), "node_modules") {
			candidate := filepath.Join(dir, "@magic-spells", "puzzle", "package.json")
			if fsFileExists(candidate) {
				return candidate
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func installedVersion(packageJSON string) (string, error) {
	if packageJSON == "" {
		return "", fmt.Errorf("could not locate %s/package.json", puzzlePackage)
	}
	data, err := os.ReadFile(packageJSON)
	if err != nil {
		return "", err
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return "", err
	}
	if pkg.Version == "" {
		return "", fmt.Errorf("%s has no version", packageJSON)
	}
	return pkg.Version, nil
}
