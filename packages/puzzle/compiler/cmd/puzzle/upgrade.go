package main

import (
	"context"
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
	// The kinds below are REFUSALS, not installs. Each one is a shape where the
	// copy the user's `puzzle` resolves to cannot be upgraded by any command this
	// tool could safely run, so it explains and stops. Silence is the defect this
	// set exists to prevent: guessing here is how a local install ends up being
	// written to the machine globally, or a "success" line ends up naming a copy
	// nobody runs.
	//
	// installWorkspace: the binary is hoisted into a workspace or monorepo root
	// that does not itself declare the CLI, so the dependency lives in a member
	// package this command has no safe way to pick.
	installWorkspace
	// installNested: the binary belongs to a copy nested inside another package's
	// node_modules — a transitive dependency whose version its parent pins. No
	// direct install reaches it.
	installNested
	// installEphemeral: the binary is running out of a package-runner cache
	// (`npx`, `pnpm dlx`, `bunx`). The cache is discarded, not upgraded, and the
	// next run resolves whatever the user asks for.
	installEphemeral
	// installUnresolved: the install shape is genuinely unrecognised. This is the
	// backstop that keeps an unknown from being escalated to `npm install -g`.
	installUnresolved
)

type installContext struct {
	kind        installKind
	dir         string
	manager     string
	dev         bool
	executable  string
	packageJSON string
	// inspected is what detection actually looked at, so a refusal can name it.
	// A diagnostic that says only "could not tell" leaves the user with nothing
	// to check.
	inspected []string
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
	case installNested:
		// The parent package pins the version; installing anything here would
		// upgrade a different copy and then report success over this one.
		fmt.Fprintf(stdout, "This CLI is a nested dependency inside %s — another package's copy, not one you installed.\n", ctx.dir)
		fmt.Fprintf(stdout, "Its version is pinned by whatever depends on it, so upgrading %s would leave this binary untouched.\n", puzzlePackage)
		fmt.Fprintf(stdout, "Upgrade that package instead, or install %s@%s where you want to run it.\n", puzzlePackage, latest)
		return nil
	case installEphemeral:
		fmt.Fprintf(stdout, "This CLI is running from a %s cache (%s), which is thrown away rather than upgraded.\n", ctx.manager, ctx.dir)
		fmt.Fprintf(stdout, "Ask the runner for the version you want instead:\n")
		fmt.Fprintf(stdout, "  npx %s@%s <command>\n", puzzlePackage, latest)
		fmt.Fprintf(stdout, "Or install it for real — %s, or add it to a project — so there is something to upgrade.\n",
			out.Bold("npm install -g "+puzzlePackage+"@"+latest))
		return nil
	case installUnresolved:
		// Refusing is the whole point: every silent alternative here upgrades
		// something other than the binary that is running.
		return fmt.Errorf(
			"could not tell how %s is installed: %s declares no %s, is not a workspace root, and is not a global root npm or pnpm reports — "+
				"upgrade it the way you installed it rather than have this command install over something else",
			ctx.executable, strings.Join(ctx.inspected, ", "), puzzlePackage)
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
			filepath.Join(ctx.dir, "node_modules", "@magic-spells", platformPackageName(), "bin", platformBinaryName()),
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

// platformPackageName mirrors bin/puzzle.js, which keys the platform packages by
// process.platform/process.arch: Node spells amd64 "x64" and windows "win32".
func platformPackageName() string {
	goos := runtime.GOOS
	if goos == "windows" {
		goos = "win32"
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	return "puzzle-" + goos + "-" + arch
}

// platformBinaryName is the file inside a platform package's bin/ — Windows
// needs the .exe suffix to execute it at all.
func platformBinaryName() string {
	if runtime.GOOS == "windows" {
		return "puzzle.exe"
	}
	return "puzzle"
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
//
// Resolution starts from what is INSTALLED, not from what a manifest claims. The
// nearest ancestor node_modules that actually holds @magic-spells/puzzle is the
// copy this binary belongs to; a dependency stanza is a claim about a copy, and
// a directory on disk is the copy itself. Every branch below either identifies
// that copy's owner or refuses — nothing falls through to a global install.
func detectInstallContext(executable string) (installContext, error) {
	resolved := executable
	if real, err := filepath.EvalSymlinks(executable); err == nil {
		resolved = real
	}

	nodeModules, pkgDir, searched, found := installedPuzzlePackage(resolved)
	if !found {
		if len(searched) == 0 {
			// No node_modules above the binary: `go install`, or a binary built
			// straight out of the repo. npm owns neither.
			return installContext{kind: installManual, executable: resolved}, nil
		}
		// A platform binary with no @magic-spells/puzzle above it is a broken or
		// hand-assembled tree. There is no copy to confirm against, so there is
		// nothing this command can safely write.
		return installContext{kind: installUnresolved, executable: resolved, inspected: searched}, nil
	}
	owner := filepath.Dir(nodeModules)
	packageJSON := filepath.Join(pkgDir, "package.json")

	if runner, ok := ephemeralRunnerCache(resolved); ok {
		return installContext{kind: installEphemeral, dir: owner, manager: runner,
			executable: resolved, packageJSON: packageJSON, inspected: []string{owner}}, nil
	}
	if nestedInNodeModules(owner) {
		return installContext{kind: installNested, dir: owner,
			executable: resolved, packageJSON: packageJSON, inspected: []string{owner}}, nil
	}

	roots := newGlobalRoots()

	// pnpm's global root is a real package directory — package.json plus a
	// lockfile, listing every global install as a dependency — so it has to be
	// recognised before the project test, or a pnpm global would upgrade itself
	// as though it were an app. Only the global-root shape counts: matching any
	// `pnpm` path segment would misclassify a project that merely lives under a
	// directory named pnpm (`~/pnpm/app`) and run `pnpm add -g` against it. The
	// shape misses a configured `global-dir`, so a pnpm-managed directory that
	// does not match it asks pnpm itself before anything else classifies it.
	if isPnpmGlobalRoot(owner) ||
		(fsFileExists(filepath.Join(owner, "pnpm-lock.yaml")) && roots.is("pnpm", nodeModules)) {
		return globalContext(resolved, "pnpm", packageJSON), nil
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
			packageJSON: packageJSON,
			inspected:   []string{owner},
		}, nil
	}
	// A workspace or monorepo root hoists its members' dependencies, so the
	// binary can sit under a root that declares nothing itself. That is not a
	// global install — treating it as one would run `npm install -g` as a side
	// effect and then fail confirmation against the root's own hoisted copy.
	// Which member owns the dependency is the user's call, so the command
	// explains and stops.
	if manifest.workspaces || monorepoRoot(owner) {
		return installContext{kind: installWorkspace, dir: owner, executable: resolved,
			packageJSON: packageJSON, inspected: []string{owner}}, nil
	}
	// A global install is ASSERTED, never assumed: the node_modules holding this
	// copy must be the one the package manager itself calls global. The old
	// fallthrough — "no manifest mentions it, so it must be global" — is how a
	// perfectly ordinary local install got `npm install -g` run against the
	// user's machine and then hard-failed confirmation against the still-stale
	// local copy.
	for _, manager := range []string{"npm", "pnpm"} {
		if roots.is(manager, nodeModules) {
			return globalContext(resolved, manager, packageJSON), nil
		}
	}
	// A local install the owner's manifest does not record: `npm install
	// --no-save`, or a manifest edited after the fact. The copy is still local
	// and still this binary's, so the ordinary project install upgrades exactly
	// what the confirmation then reads back.
	if manifest.exists && detectLockfile(owner) != "" {
		return installContext{
			kind:        installProject,
			dir:         owner,
			manager:     detectPackageManager(owner),
			executable:  resolved,
			packageJSON: packageJSON,
			inspected:   []string{owner},
		}, nil
	}
	return installContext{kind: installUnresolved, dir: owner, executable: resolved,
		packageJSON: packageJSON, inspected: []string{owner}}, nil
}

// globalContext describes a confirmed global install — a global prefix
// (`/usr/local/lib`, `/opt/homebrew/lib`) or pnpm's global root, each one either
// matched by shape or named by the package manager itself. dir stays empty so
// the package manager inherits this process's directory: `-g` does not care
// where it runs, and picking a directory would smuggle the cwd back in.
// packageJSON is the copy found on disk beneath the running binary, so the
// confirmation reads back the install that was just written.
func globalContext(executable, manager, packageJSON string) installContext {
	return installContext{
		kind:        installGlobal,
		manager:     manager,
		executable:  executable,
		packageJSON: packageJSON,
	}
}

// installedPuzzlePackage walks up from the running binary and returns the first
// ancestor node_modules that actually CONTAINS @magic-spells/puzzle, that
// package's directory, and every node_modules it looked in (so a refusal can say
// where it looked).
//
// Nearest-that-contains-it, not outermost: the binary sits several levels in
// under every layout — `<root>/node_modules/@magic-spells/puzzle-<platform>/bin/puzzle`
// hoisted, `<root>/node_modules/.pnpm/<pkg>@<v>/node_modules/…` under pnpm, where
// the store directory holds only the platform package and the walk continues to
// the root that links the real one. Picking the outermost segment instead points
// at whichever copy npm happened to hoist, which is exactly how a nested install
// reported success over a copy the user never runs.
func installedPuzzlePackage(path string) (nodeModules, pkgDir string, searched []string, ok bool) {
	dir := path
	for {
		if strings.EqualFold(filepath.Base(dir), "node_modules") {
			searched = append(searched, dir)
			candidate := filepath.Join(dir, "@magic-spells", "puzzle")
			if fsFileExists(filepath.Join(candidate, "package.json")) {
				return dir, candidate, searched, true
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", "", searched, false
		}
		dir = parent
	}
}

// nestedInNodeModules reports whether owner is itself inside a node_modules
// tree, i.e. the copy belongs to some other package rather than to a project or
// a global prefix.
func nestedInNodeModules(owner string) bool {
	dir := owner
	for {
		if strings.EqualFold(filepath.Base(dir), "node_modules") {
			return true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return false
		}
		dir = parent
	}
}

// ephemeralRunnerCache reports the package runner whose throwaway cache path
// holds, so `puzzle upgrade` never claims to have upgraded one. npm's is
// `~/.npm/_npx/<hash>`; pnpm and yarn use a `dlx` directory under their own
// cache root; bun uses a `bunx-<uid>-<pkg>` temp directory.
func ephemeralRunnerCache(path string) (string, bool) {
	underManagerCache := false
	for _, segment := range strings.Split(filepath.ToSlash(path), "/") {
		lower := strings.ToLower(segment)
		switch {
		case lower == "_npx":
			return "npx", true
		case strings.HasPrefix(lower, "bunx-"):
			return "bunx", true
		case lower == "dlx" && underManagerCache:
			return "dlx", true
		case lower == "pnpm" || lower == "yarn" || lower == ".yarn" || lower == "berry":
			underManagerCache = true
		}
	}
	return "", false
}

// monorepoRootMarkers are the files that make a directory a multi-package root
// whose node_modules hoists its members' dependencies. `workspaces` in
// package.json covers npm/yarn/bun; these cover the tools that keep their member
// list somewhere else, which is precisely why such a root used to look like a
// global prefix — a package.json that never mentions the CLI.
var monorepoRootMarkers = []string{"pnpm-workspace.yaml", "lerna.json", "nx.json", "rush.json"}

func monorepoRoot(dir string) bool {
	for _, marker := range monorepoRootMarkers {
		if fsFileExists(filepath.Join(dir, marker)) {
			return true
		}
	}
	return false
}

// packageManagerGlobalRoot asks a package manager where its own global
// node_modules is (`npm root -g`, `pnpm root -g` — both print an absolute path
// and ignore the working directory). It is a var so tests can answer without a
// package manager on PATH.
var packageManagerGlobalRoot = func(manager string) (string, bool) {
	bin, err := exec.LookPath(manager)
	if err != nil {
		return "", false
	}
	// A package manager that hangs must not hang `puzzle upgrade` with it; an
	// unanswered query is a "no", which refuses rather than guesses.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, bin, "root", "-g").Output()
	if err != nil {
		return "", false
	}
	dir := strings.TrimSpace(string(output))
	if dir == "" {
		return "", false
	}
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		dir = resolved
	}
	return filepath.Clean(dir), true
}

// globalRoots memoizes the global-root answers for one detection pass, so a
// single `puzzle upgrade` never spawns the same query twice.
type globalRoots struct{ seen map[string]string }

func newGlobalRoots() *globalRoots { return &globalRoots{seen: map[string]string{}} }

// is reports whether nodeModules is the global node_modules of manager. An
// unanswerable query (manager not installed, command failed) is a "no", which
// leaves the caller to refuse rather than to assume.
func (g *globalRoots) is(manager, nodeModules string) bool {
	root, cached := g.seen[manager]
	if !cached {
		root, _ = packageManagerGlobalRoot(manager)
		g.seen[manager] = root
	}
	if root == "" {
		return false
	}
	target := filepath.Clean(nodeModules)
	if resolved, err := filepath.EvalSymlinks(target); err == nil {
		target = resolved
	}
	return root == target
}

// ownerManifest is what the owning directory's package.json says about this
// CLI: whether it declares it, whether only as a devDependency, and whether the
// directory is a workspace root (which declares its members' dependencies on
// their behalf without listing them itself).
type ownerManifest struct {
	exists     bool
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
		// EVERY dependency stanza counts. A peer or optional declaration is still
		// the owner declaring this CLI, and reading only two of the four is how a
		// declared local dependency was classified as a global install.
		Dependencies         map[string]json.RawMessage `json:"dependencies"`
		DevDependencies      map[string]json.RawMessage `json:"devDependencies"`
		PeerDependencies     map[string]json.RawMessage `json:"peerDependencies"`
		OptionalDependencies map[string]json.RawMessage `json:"optionalDependencies"`
		// Present in either shape npm/yarn/bun accept — an array of globs, or an
		// object with a `packages` key. Only presence matters here.
		Workspaces json.RawMessage `json:"workspaces"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ownerManifest{}, fmt.Errorf("reading %s: %w", packageJSON, err)
	}
	_, dependency := pkg.Dependencies[puzzlePackage]
	_, devDependency := pkg.DevDependencies[puzzlePackage]
	_, peerDependency := pkg.PeerDependencies[puzzlePackage]
	_, optionalDependency := pkg.OptionalDependencies[puzzlePackage]
	return ownerManifest{
		exists:   true,
		declared: dependency || devDependency || peerDependency || optionalDependency,
		// -D is only right when devDependencies is the ONLY stanza naming it;
		// a peer or optional declaration takes the plain install.
		dev:        devDependency && !dependency && !peerDependency && !optionalDependency,
		workspaces: len(pkg.Workspaces) > 0,
	}, nil
}

// detectLockfile returns the manager owning dir's lockfile, or "" when dir has
// none. The empty answer is load-bearing: a directory with a package.json and no
// lockfile is not a project anybody installed into, which is what tells an
// unrecorded local install apart from a global prefix that happens to carry a
// package.json.
func detectLockfile(dir string) string {
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
	return ""
}

func detectPackageManager(dir string) string {
	if manager := detectLockfile(dir); manager != "" {
		return manager
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
