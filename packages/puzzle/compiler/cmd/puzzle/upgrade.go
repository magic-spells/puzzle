package main

import (
	"context"
	"encoding/json"
	"errors"
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

// confirmUpgrade asks whether to upgrade one scope, indirected so tests can
// answer it without driving a huh form.
var confirmUpgrade = func(input io.Reader, output io.Writer, title string) (bool, error) {
	return confirm(input, output, title, "")
}

var upgradeCmd = &cobra.Command{
	Use:   "upgrade",
	Short: "Upgrade the global CLI and this project to the latest Puzzle",
	Long: `Upgrade the global CLI, if one is installed, and this project: the nearest
package.json at or above the current folder, no higher than the home folder,
when it declares ` + puzzlePackage + `.

Both are listed with their installed and latest versions and the project's
folder first, then a terminal asks about each one that is behind. --check only
lists; --yes upgrades them all without asking. Without a terminal only the
install this command runs from is upgraded, and the other is printed as the
command to run. Afterwards it offers to refresh the agent skill (see
` + "`puzzle upgrade skills`" + `).`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		check, _ := cmd.Flags().GetBool("check")
		yes, _ := cmd.Flags().GetBool("yes")
		executable, _ := os.Executable()
		return runUpgrade(os.Stdout, os.Stderr, ui.New(os.Stdout), executable, check, upgradeEnvironment{
			homeDir:     os.UserHomeDir,
			input:       os.Stdin,
			interactive: ui.IsTerminal(os.Stdin) && !yes,
			yes:         yes,
		})
	},
}

// upgradeSkillsCmd refreshes the agent skill from THIS binary — the mirror image
// of the post-upgrade offer below. There, a newer binary exists on disk and the
// running process holds a stale payload, so the install must be re-exec'd; here
// nothing was upgraded, so the running CLI is the correct source and re-execing
// anything would be theatre. That is why it is its own path, not a shortcut into
// runUpgrade (D78).
var upgradeSkillsCmd = &cobra.Command{
	Use:   "skills",
	Short: "Reinstall this CLI's agent skill wherever one is already installed",
	Long: `Refresh the Puzzle agent skill from this binary's embedded copy.

Nothing is downloaded and no version is checked: the skill ships inside the CLI, so
the running binary already holds the payload that matches it.

Only config dirs that already carry a skill are refreshed — first installs belong to
` + "`puzzle add skills`" + `. A symlinked installation is a dev checkout link: it is
reported and left alone. On a non-TTY the refresh runs without prompting, because the
command names the intent; ` + "`puzzle add skills`" + ` still requires --force there,
where clobbering would be a side effect rather than the request.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		yes, _ := cmd.Flags().GetBool("yes")
		return runUpgradeSkills(os.Stdout, ui.New(os.Stdout), upgradeEnvironment{
			homeDir:     os.UserHomeDir,
			input:       os.Stdin,
			interactive: ui.IsTerminal(os.Stdin) && !yes,
			yes:         yes,
		})
	},
}

func init() {
	upgradeCmd.Flags().Bool("check", false, "Report the current and latest versions without upgrading")
	// Persistent so `puzzle upgrade skills -y` takes it too.
	upgradeCmd.PersistentFlags().BoolP("yes", "y", false, "Answer yes to every prompt instead of asking")
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
		fmt.Fprintf(w, "Run %s to reinstall anyway.\n", out.Bold("puzzle add skills --force"))
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
	// tool could safely run, so it explains instead (the scopes are still
	// offered after the explanation). Silence is the defect this
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

// installContext is one copy of the CLI: the one the running binary belongs to,
// or a scope `puzzle upgrade` found on disk. A scope — the global CLI or this
// project — is a context of kind installGlobal or installProject, and every
// scope is reported, asked about and upgraded by the same code.
type installContext struct {
	kind       installKind
	dir        string
	manager    string
	dev        bool
	executable string
	// packageJSON is a global's copy; a project's is looked up (installed).
	packageJSON string
	// current is the installed copy's version, "" when nothing is installed;
	// wanted is the range a project's package.json declares, shown in its place.
	current, wanted string
	// inspected is what detection actually looked at, so a refusal can name it.
	// A diagnostic that says only "could not tell" leaves the user with nothing
	// to check.
	inspected []string
}

// name is how the summary, the prompts and the result lines refer to a scope.
func (s installContext) name() string {
	if s.kind == installGlobal {
		return "the global CLI"
	}
	return "this project"
}

// from is the version a scope moves from: what is installed, else the range
// its package.json declares.
func (s installContext) from() string {
	if s.current != "" {
		return s.current
	}
	return s.wanted
}

// installed is the package.json of the copy s reports. A project's is looked up
// each time, as the first node_modules/@magic-spells/puzzle at or above it (in a
// workspace, the root's), so the read-back finds it wherever the install put it.
func (s installContext) installed() string {
	if s.kind == installProject {
		return upward(s.dir, inside(filepath.Join("node_modules", "@magic-spells", "puzzle", "package.json")))
	}
	return s.packageJSON
}

// older reports whether v is behind latest; a missing version (nothing installed) is.
func older(v, latest string) bool {
	cmp, err := update.Compare(v, latest)
	return err != nil || cmp < 0
}

// upgradeEnvironment carries what the post-upgrade skill refresh needs: where
// agent config dirs live, and whether we may prompt.
type upgradeEnvironment struct {
	homeDir     func() (string, error)
	input       io.Reader
	interactive bool
	// yes (--yes) answers the skill-refresh prompt with its default, Yes,
	// without showing it. The caller also clears interactive.
	yes bool
}

// runUpgrade reports the global CLI and this project, then upgrades the ones
// that are behind and that the person (or --yes, or a non-TTY run's own
// install) chose. Nothing changes before both have been reported.
func runUpgrade(stdout, stderr io.Writer, out *ui.Printer, executable string, check bool, env upgradeEnvironment) error {
	latest, err := fetchLatest(5 * time.Second)
	if err != nil {
		return fmt.Errorf("checking for updates: %w", err)
	}
	roots := newGlobalRoots()
	running, err := detectInstallContext(executable, roots)
	if err != nil {
		return err
	}
	scopes := upgradeScopes(running, roots)
	// A running binary that is neither scope has no row: it gets the ✨ line, and
	// how to upgrade it, when it is behind.
	runningBehind := running.kind != installGlobal && running.kind != installProject && older(version.Version, latest)
	var names []string
	var stale []installContext
	for i := range scopes {
		scopes[i].current, _ = update.PackageVersion(scopes[i].installed())
		names = append(names, scopes[i].name())
		if older(scopes[i].current, latest) {
			stale = append(stale, scopes[i])
		}
	}
	if len(stale) == 0 && !runningBehind {
		// With scopes the line speaks for them, and they are on latest; alone, it
		// speaks for the running binary, which may be a build ahead of npm.
		current, suffix := version.Version, ""
		if len(names) > 0 {
			current, suffix = latest, " ("+strings.Join(names, " and ")+")"
		}
		fmt.Fprintf(stdout, "%s puzzle %s is up to date%s\n", out.Green("✓"), current, suffix)
		if !check {
			_ = update.WriteCache(latest, time.Now())
		}
		return nil
	}
	if runningBehind {
		fmt.Fprintf(stdout, "%s puzzle %s available (current %s)\n", out.Cyan("✨"), latest, version.Version)
		if !check {
			printRefusal(stdout, out, running, latest)
		}
	}
	for _, s := range scopes {
		printScope(stdout, out, s, latest)
	}
	if check {
		return nil
	}

	// Every question comes before any install, so the answers are given once.
	var chosen []installContext
	for _, s := range stale {
		switch {
		case env.yes:
		case env.interactive:
			ok, err := confirmUpgrade(env.input, stdout, s.question(latest))
			if err != nil {
				return err
			}
			if !ok {
				continue
			}
		case s.kind != running.kind:
			// Without a terminal the command names the install it was run from,
			// and only that one moves; the other is left for the person to run.
			name, args := upgradeCommand(s, latest)
			in := ""
			if s.dir != "" {
				in = " in " + s.dir
			}
			fmt.Fprintf(stdout, "%s To upgrade %s, run %s%s\n",
				out.Yellow("!"), s.name(), out.Bold(strings.Join(append([]string{name}, args...), " ")), in)
			continue
		}
		chosen = append(chosen, s)
	}
	// One failed scope does not cancel the other the person also said yes to.
	var upgraded []installContext
	var errs []error
	for _, s := range chosen {
		if err := upgradeScope(stdout, stderr, out, s, latest); err != nil {
			errs = append(errs, fmt.Errorf("upgrading %s: %w", s.name(), err))
			continue
		}
		upgraded = append(upgraded, s)
	}
	if len(upgraded) > 0 {
		_ = update.WriteCache(latest, time.Now())
		refreshSkills(stdout, stderr, out, upgraded, latest, env)
	}
	return errors.Join(errs...)
}

// printScope is one summary row: the scope, what it moves from and to, and where.
func printScope(w io.Writer, out *ui.Printer, s installContext, latest string) {
	state := s.current + " → " + latest
	switch {
	case s.current == "":
		state = s.wanted + " (not installed) → " + latest
	case !older(s.current, latest):
		state = s.current + ", up to date"
	}
	fmt.Fprintf(w, "  %-15s %s  %s\n", s.name(), state, out.Dim(strings.TrimSpace(s.dir+" ("+s.manager+")")))
}

// question is the prompt for one scope. A project's names the folder the
// package manager will run in, and says when the upgrade may break the app,
// since that is the answer the person most needs before saying yes.
func (s installContext) question(latest string) string {
	if s.kind != installProject {
		return "Upgrade " + s.name() + "?"
	}
	q := "Upgrade " + s.name() + " in " + s.dir + "?"
	if update.Breaking(s.from(), latest) {
		q += " " + s.from() + " → " + latest + " may have breaking changes"
	}
	return q
}

// upgradeScope runs the package manager for s, then confirms the result by
// reading the installed copy back from disk.
func upgradeScope(stdout, stderr io.Writer, out *ui.Printer, s installContext, latest string) error {
	name, args := upgradeCommand(s, latest)
	command := exec.Command(name, args...)
	command.Dir = s.dir
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", strings.Join(append([]string{name}, args...), " "), err)
	}

	packageJSON := s.installed()
	if s.kind == installGlobal && !fsFileExists(packageJSON) {
		// Unusual global layouts (a store the owner directory does not link
		// into) still resolve by walking up from the binary itself.
		packageJSON = findGlobalPackageJSON(s.executable)
	}
	installed, err := update.PackageVersion(packageJSON)
	if err != nil {
		return fmt.Errorf("confirming installed version: %w", err)
	}
	if installed != latest {
		return fmt.Errorf("upgrade installed puzzle %s, expected %s", installed, latest)
	}
	fmt.Fprintf(stdout, "%s upgraded %s %s → %s\n", out.Green("✓"), s.name(), s.from(), installed)
	if s.kind == installProject && update.Breaking(s.from(), latest) {
		fmt.Fprintf(stdout, "%s %s may have breaking changes: read \"Upgrading across versions\" in %s and run %s in the project\n",
			out.Yellow("!"), latest, filepath.Join(filepath.Dir(packageJSON), "CHANGELOG.md"), out.Bold("npx puzzle check --fix"))
	}
	return nil
}

// printRefusal explains how to upgrade a running binary that is neither scope.
// Each kind is a copy no command this tool could safely run would reach, so it
// is explained rather than written to; the scopes are still offered after it.
func printRefusal(stdout io.Writer, out *ui.Printer, ctx installContext, latest string) {
	switch ctx.kind {
	case installManual:
		// A checkout build, never `go install …@latest`: the module lives in
		// packages/puzzle, and its go.mod `replace` for puzzle-lang makes
		// `go install pkg@version` refuse it outright.
		fmt.Fprintln(stdout, "Build the latest release from source with Go:")
		fmt.Fprintln(stdout, "  git clone https://github.com/magic-spells/puzzle")
		fmt.Fprintln(stdout, "  cd puzzle/packages/puzzle/compiler && go build -o puzzle ./cmd/puzzle")
		fmt.Fprintln(stdout, "  (on Windows use -o puzzle.exe)")
	case installWorkspace:
		// Guessing a member would install into a package the user never named,
		// so the command hands the decision back.
		fmt.Fprintf(stdout, "This CLI is installed by the workspace at %s, which does not declare %s itself.\n",
			ctx.dir, puzzlePackage)
		fmt.Fprintf(stdout, "Upgrade it in the member package that does, for example:\n")
		fmt.Fprintf(stdout, "  npm install %s@%s -w <member>\n", puzzlePackage, latest)
		fmt.Fprintf(stdout, "  (pnpm/yarn/bun: the same add, run from that member's directory)\n")
	case installNested:
		// The parent package pins the version; installing anything here would
		// upgrade a different copy and then report success over this one.
		fmt.Fprintf(stdout, "This CLI is a nested dependency inside %s — another package's copy, not one you installed.\n", ctx.dir)
		fmt.Fprintf(stdout, "Its version is pinned by whatever depends on it, so upgrading %s would leave this binary untouched.\n", puzzlePackage)
		fmt.Fprintf(stdout, "Upgrade that package instead, or install %s@%s where you want to run it.\n", puzzlePackage, latest)
	case installEphemeral:
		fmt.Fprintf(stdout, "This CLI is running from a %s cache (%s), which is thrown away rather than upgraded.\n", ctx.manager, ctx.dir)
		fmt.Fprintf(stdout, "Ask the runner for the version you want instead:\n")
		fmt.Fprintf(stdout, "  npx %s@%s <command>\n", puzzlePackage, latest)
		fmt.Fprintf(stdout, "Or install it for real — %s, or add it to a project — so there is something to upgrade.\n",
			out.Bold("npm install -g "+puzzlePackage+"@"+latest))
	case installUnresolved:
		// Refusing is the whole point: every silent alternative here upgrades
		// something other than the binary that is running.
		fmt.Fprintf(stdout, "%s Could not tell how %s is installed: %s declares no %s, is not a workspace root, and is not a global root npm or pnpm reports — "+
			"upgrade it the way you installed it rather than have this command install over something else.\n",
			out.Yellow("!"), ctx.executable, strings.Join(ctx.inspected, ", "), puzzlePackage)
	}
}

// refreshSkills offers to reinstall the agent skill wherever one is already
// installed, and only after a version actually changed (D78). The skill payload
// is go:embed-ed into the binary, so THIS process only holds the OLD skill — the
// new bytes exist solely in the binary npm just installed. The refresh therefore
// re-execs that binary, after confirming its --version really is the new one; a
// binary we cannot find or cannot verify degrades to printing the command rather
// than silently reinstalling the stale skill we are carrying. Any upgraded scope
// can supply it: each now holds the latest skill, so when only the project moved
// its binary is the source, matching the version the agent writes code for.
//
// Nothing here can fail the upgrade: the package is already installed, and a
// skill copy is a courtesy on top of it. Problems print and return.
func refreshSkills(stdout, stderr io.Writer, out *ui.Printer, upgraded []installContext, latest string, env upgradeEnvironment) {
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

	switch {
	case env.yes:
		// --yes: the prompt's default answer is Yes, so refresh without asking.
	case !env.interactive:
		fmt.Fprintf(stdout, "%s Puzzle skill installed at %s — run %s to update it.\n",
			out.Yellow("!"), skillDestinations(targets), out.Bold("puzzle upgrade skills"))
		return
	default:
		confirmed, err := confirmSkillUpdate(env.input, stdout, targets, latest)
		if err != nil || !confirmed {
			return
		}
	}

	binary, err := upgradedBinary(upgraded, latest)
	if err != nil {
		fmt.Fprintf(stdout, "%s Could not locate the upgraded CLI (%v) — run %s yourself.\n",
			out.Yellow("!"), err, out.Bold("puzzle upgrade skills"))
		return
	}
	// --force, the current spelling: the upgraded binary is newer than this one,
	// so it has it. (--overwrite remains a hidden alias for older callers.)
	args := []string{"add", "skills", "--force"}
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

// upgradedBinary finds a puzzle binary npm just installed and proves it is the
// new one before we run it. Candidates differ by install shape; each is checked
// with --version, so a stale or mismatched path is skipped rather than trusted.
func upgradedBinary(upgraded []installContext, latest string) (string, error) {
	for _, ctx := range upgraded {
		for _, candidate := range upgradedBinaryCandidates(ctx) {
			if candidate != "" && binaryReportsVersion(candidate, latest) {
				return candidate, nil
			}
		}
	}
	return "", fmt.Errorf("no binary on disk reports version %s", latest)
}

// upgradedBinaryCandidates starts from the copy the read-back confirmed. Its
// platform package sits beside it, hoisted there by a local install or linked
// there in pnpm's store (where the copy's symlink leads); npm -g nests it in
// the copy's own node_modules instead.
func upgradedBinaryCandidates(ctx installContext) []string {
	pkg := filepath.Dir(ctx.installed())
	if real, err := filepath.EvalSymlinks(pkg); err == nil {
		pkg = real
	}
	bin := filepath.Join(platformPackageName(), "bin", platformBinaryName())
	candidates := []string{
		filepath.Join(filepath.Dir(pkg), bin),
		filepath.Join(pkg, "node_modules", "@magic-spells", bin),
	}
	if ctx.kind == installProject {
		return append(candidates, filepath.Join(ctx.dir, "node_modules", ".bin", "puzzle"))
	}
	// A global install replaces the package behind the same PATH shim, though
	// PATH may reach a project's shim first (npx), and the running path may
	// still be the old one — which is why every candidate is version-checked.
	if path, err := exec.LookPath("puzzle"); err == nil {
		candidates = append(candidates, path)
	}
	return append(candidates, ctx.executable)
}

// platformPackageName mirrors bin/puzzle.js, which keys the platform packages by
// process.platform/process.arch: Node spells amd64 "x64" and windows "win32".
func platformPackageName() string {
	return platformPackageNameFor(runtime.GOOS, runtime.GOARCH)
}

// platformBinaryName is the file inside a platform package's bin/ — Windows
// needs the .exe suffix to execute it at all.
func platformBinaryName() string {
	return platformBinaryNameFor(runtime.GOOS)
}

// platformPackageNameFor is the pure translation the two wrappers above exist to
// expose: it takes the GOOS/GOARCH pair rather than reading the running host, so
// every shipped target can be asserted from one test on one machine. Reading
// runtime.GOOS directly is what let the Windows name sit wrong until Windows
// binaries shipped — a mac and a Linux runner both agreed with the bug.
func platformPackageNameFor(goos, goarch string) string {
	if goos == "windows" {
		goos = "win32"
		// Windows-on-ARM has no package of its own: it installs the x64 one and
		// runs it under the OS's x64 emulation (bin/puzzle.js folds the same key
		// the same way, and the x64 manifest's "cpu" lists arm64 so npm puts it
		// there). Without this fold `puzzle upgrade` would name a package that has
		// never been published and report nothing to upgrade.
		goarch = "amd64"
	}
	if goarch == "amd64" {
		goarch = "x64"
	}
	return "puzzle-" + goos + "-" + goarch
}

// platformBinaryNameFor is the same split for the file inside bin/.
func platformBinaryNameFor(goos string) string {
	if goos == "windows" {
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

// detectInstallContext derives the running binary's install context from the
// executable alone (D76, §41). The current directory plays no part here: the
// project a person stands in is its own scope (projectAt), so the copy this
// binary belongs to is never confused with it — and for each one, the install
// compared against the registry, the install the package manager writes, and
// the install the result line names are the same one by construction.
//
// Resolution starts from what is INSTALLED, not from what a manifest claims. The
// nearest ancestor node_modules that actually holds @magic-spells/puzzle is the
// copy this binary belongs to; a dependency stanza is a claim about a copy, and
// a directory on disk is the copy itself. Every branch below either identifies
// that copy's owner or refuses — nothing falls through to a global install.
func detectInstallContext(executable string, roots *globalRoots) (installContext, error) {
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
			kind:       installProject,
			dir:        owner,
			manager:    detectPackageManager(owner),
			dev:        manifest.dev,
			executable: resolved,
			inspected:  []string{owner},
		}, nil
	}
	// A workspace or monorepo root hoists its members' dependencies, so the
	// binary can sit under a root that declares nothing itself. That is not a
	// global install — treating it as one would run `npm install -g` as a side
	// effect and then fail confirmation against the root's own hoisted copy.
	// Which member owns the dependency is the user's call, so the command
	// explains rather than installs.
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
	for _, manager := range globalManagers {
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
			kind:       installProject,
			dir:        owner,
			manager:    detectPackageManager(owner),
			executable: resolved,
			inspected:  []string{owner},
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

// upgradeScopes lists the scopes `puzzle upgrade` reports on, the global CLI
// first. The running binary fills the scope it belongs to, and a workspace or
// nested copy holds the project's place: its note already names where that
// tree's dependency lives, and a second answer for the same tree would
// contradict it. Every other scope is found on disk.
func upgradeScopes(running installContext, roots *globalRoots) []installContext {
	var scopes []installContext
	if running.kind == installGlobal {
		scopes = append(scopes, running)
	} else if global, ok := installedGlobal(roots); ok {
		scopes = append(scopes, global)
	}
	switch running.kind {
	case installProject:
		return append(scopes, running)
	case installWorkspace, installNested:
		return scopes
	}
	cwd, _ := os.Getwd()
	if project, ok := projectAt(cwd); ok {
		scopes = append(scopes, project)
	}
	return scopes
}

// installedGlobal finds a global CLI the running binary is not: a puzzle
// package in the global node_modules npm or pnpm reports. None installed is no
// scope — this command never puts a global CLI where there was none.
func installedGlobal(roots *globalRoots) (installContext, bool) {
	for _, manager := range globalManagers {
		if root := roots.root(manager); root != "" {
			packageJSON := filepath.Join(root, "@magic-spells", "puzzle", "package.json")
			if fsFileExists(packageJSON) {
				return globalContext("", manager, packageJSON), true
			}
		}
	}
	return installContext{}, false
}

// projectAt finds the nearest package.json at or above dir; npm stops at the
// same file, so the upgrade never runs where `npm install` typed in dir would
// not. It is the project when it reads and its dependencies or devDependencies
// name the CLI. A workspace member stays the project: its package.json declares
// the dependency, so the package manager runs there.
func projectAt(dir string) (installContext, bool) {
	packageJSON := upward(dir, inside("package.json"))
	manifest, _ := readOwnerManifest(packageJSON)
	if manifest.wanted == "" {
		return installContext{}, false
	}
	dir = filepath.Dir(packageJSON)
	return installContext{
		kind:    installProject,
		dir:     dir,
		manager: detectPackageManager(dir),
		dev:     manifest.dev,
		wanted:  manifest.wanted,
	}, true
}

// upward returns find's first non-empty answer for dir or a folder above it,
// looking no higher than the home folder.
func upward(dir string, find func(dir string) string) string {
	home, _ := os.UserHomeDir()
	for {
		if found := find(dir); found != "" {
			return found
		}
		parent := filepath.Dir(dir)
		if parent == dir || dir == filepath.Clean(home) {
			return ""
		}
		dir = parent
	}
}

// inside is a find for upward: the path of rel in a folder, when it exists.
func inside(rel string) func(string) string {
	return func(dir string) string {
		if path := filepath.Join(dir, rel); fsFileExists(path) {
			return path
		}
		return ""
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

// globalManagers are the package managers asked for a global root, in order.
var globalManagers = []string{"npm", "pnpm"}

// globalRoots memoizes the global-root answers for one `puzzle upgrade`, so
// detection and the global lookup never spawn the same query twice.
type globalRoots struct{ seen map[string]string }

func newGlobalRoots() *globalRoots { return &globalRoots{seen: map[string]string{}} }

// root is manager's global node_modules, or "" when it cannot be asked.
func (g *globalRoots) root(manager string) string {
	root, cached := g.seen[manager]
	if !cached {
		root, _ = packageManagerGlobalRoot(manager)
		g.seen[manager] = root
	}
	return root
}

// is reports whether nodeModules is the global node_modules of manager. An
// unanswerable query (manager not installed, command failed) is a "no", which
// leaves the caller to refuse rather than to assume.
func (g *globalRoots) is(manager, nodeModules string) bool {
	root := g.root(manager)
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
	// wanted is the range dependencies or devDependencies gives the CLI: the
	// declaration a project upgrade rewrites. "" when neither names it.
	wanted string
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
		Dependencies         map[string]string `json:"dependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
		PeerDependencies     map[string]string `json:"peerDependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
		// Present in either shape npm/yarn/bun accept — an array of globs, or an
		// object with a `packages` key. Only presence matters here.
		Workspaces json.RawMessage `json:"workspaces"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return ownerManifest{}, fmt.Errorf("reading %s: %w", packageJSON, err)
	}
	wanted, dependency := pkg.Dependencies[puzzlePackage]
	devWanted, devDependency := pkg.DevDependencies[puzzlePackage]
	_, peerDependency := pkg.PeerDependencies[puzzlePackage]
	_, optionalDependency := pkg.OptionalDependencies[puzzlePackage]
	if wanted == "" {
		wanted = devWanted
	}
	return ownerManifest{
		exists:   true,
		declared: dependency || devDependency || peerDependency || optionalDependency,
		// -D is only right when devDependencies is the ONLY stanza naming it;
		// a peer or optional declaration takes the plain install.
		dev:        devDependency && !dependency && !peerDependency && !optionalDependency,
		workspaces: len(pkg.Workspaces) > 0,
		wanted:     wanted,
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

// detectPackageManager names the manager of the first lockfile at or above dir:
// a workspace member has none of its own, and the root's decides.
func detectPackageManager(dir string) string {
	if manager := upward(dir, detectLockfile); manager != "" {
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
