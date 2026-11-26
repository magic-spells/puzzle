package build

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/compiler/internal/update"
	"github.com/magic-spells/puzzle/compiler/internal/version"
)

// PreflightRuntime verifies that the runtime resolver used by configureRuntime
// has at least one source available before a command constructs an esbuild
// bundle, and that it pairs with this CLI (PairRuntime). The CLI is often
// installed globally, so a missing project install must be reported here
// instead of being left to esbuild's resolver walk.
//
// root is the raw command-line directory, so it is checked first: a mistyped
// `puzzle build typo-dir` must say the directory is missing, not send the user
// to npm install.
func PreflightRuntime(root string) error {
	if info, err := os.Stat(root); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("puzzle: directory not found: %s", root)
		}
		return fmt.Errorf("puzzle: %w", err)
	} else if !info.IsDir() {
		return fmt.Errorf("puzzle: %s is not a directory", root)
	}
	if found, err := PairRuntime(root); found || err != nil {
		return err
	}

	if command := packageManagerInstallCommand(root); command != "" {
		return fmt.Errorf(
			"puzzle: @magic-spells/puzzle is not installed in this project.\nRun `%s` and try again.",
			command,
		)
	}
	return fmt.Errorf(
		"puzzle: @magic-spells/puzzle is not installed in this project.\nRun `npm install` (or your package manager's install) and try again.",
	)
}

// PairRuntime reports whether a runtime source resolves for root, and fails
// when the one that wins is an installed package on the other side of a
// breaking release from this CLI (PairInstalled). The two development sources
// are not compared: PUZZLE_RUNTIME names a checkout on purpose, and an app
// inside this repo builds against the working tree, whose version only moves at
// release time. Commands that write or check source without bundling call it on
// its own, so they still run before `npm install`.
func PairRuntime(root string) (bool, error) {
	if envRuntime() != "" || FindRuntime(root) != "" {
		return true, nil
	}
	runtime := FindInstalledRuntime(root)
	if runtime == "" {
		return false, nil
	}
	_, err := PairInstalled(runtime)
	return true, err
}

// PairInstalled returns the version of the installed runtime FindInstalledRuntime
// found, and an error when it and this CLI are on different sides of a breaking
// release (update.Breaking). The compiler emits code for its own runtime, so such
// a pair builds without an error and ships a blank page. It happens when a global
// CLI is run inside a project; the project's own CLI always matches its install.
func PairInstalled(runtime string) (string, error) {
	installed, _ := update.PackageVersion(filepath.Join(filepath.Dir(filepath.Dir(runtime)), "package.json"))
	if !update.Breaking(installed, version.Version) {
		return installed, nil
	}
	upgrade := "Or upgrade the project:     puzzle upgrade"
	if cmp, _ := update.Compare(version.Version, installed); cmp < 0 {
		upgrade = "Or upgrade this CLI:        puzzle upgrade"
	}
	return installed, fmt.Errorf("This project has Puzzle %s installed, and this CLI is %s.\n"+
		"  Use the project's own CLI:  npm run dev, npm run build, or npx puzzle <command>\n  %s",
		installed, version.Version, upgrade)
}

// packageManagerInstallCommand names the install command for the lockfile
// nearest to root, walking up so a monorepo app whose lockfile lives at the
// workspace root still gets `pnpm install` rather than the generic line.
func packageManagerInstallCommand(root string) string {
	dir, err := filepath.Abs(root)
	if err != nil {
		dir = root
	}
	for {
		if command := lockfileInstallCommand(dir); command != "" {
			return command
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func lockfileInstallCommand(dir string) string {
	for _, candidate := range []struct {
		lockfile string
		command  string
	}{
		{lockfile: "pnpm-lock.yaml", command: "pnpm install"},
		{lockfile: "yarn.lock", command: "yarn install"},
		{lockfile: "bun.lockb", command: "bun install"},
		{lockfile: "bun.lock", command: "bun install"},
		{lockfile: "package-lock.json", command: "npm install"},
	} {
		if fsutil.FileExists(filepath.Join(dir, candidate.lockfile)) {
			return candidate.command
		}
	}
	return ""
}
