package build

import (
	"encoding/json"
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
// bundle. The CLI is often installed globally, so a missing project install
// must be reported here instead of being left to esbuild's resolver walk.
//
// root is the raw command-line directory, so it is checked first: a mistyped
// `puzzle build typo-dir` must say the directory is missing, not send the user
// to npm install.
//
// An installed runtime must also pair with this CLI (InstalledVersion). The two
// development sources are not compared: PUZZLE_RUNTIME names a checkout on
// purpose, and an app inside this repo builds against the working tree, whose
// version only moves at release time.
func PreflightRuntime(root string) error {
	if info, err := os.Stat(root); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("puzzle: directory not found: %s", root)
		}
		return fmt.Errorf("puzzle: %w", err)
	} else if !info.IsDir() {
		return fmt.Errorf("puzzle: %s is not a directory", root)
	}
	if envRuntime() != "" || FindRuntime(root) != "" {
		return nil
	}
	if runtime := FindInstalledRuntime(root); runtime != "" {
		_, err := InstalledVersion(runtime)
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

// InstalledVersion reads the version of the installed runtime FindInstalledRuntime
// found, and fails when it and this CLI are on different sides of a breaking
// release (update.Breaking). The compiler emits code for its own runtime, so such
// a pair builds without an error and ships a blank page. It happens when a global
// CLI is run inside a project; the project's own CLI always matches its install.
func InstalledVersion(runtime string) (string, error) {
	var pkg struct {
		Version string `json:"version"`
	}
	data, _ := os.ReadFile(filepath.Join(filepath.Dir(filepath.Dir(runtime)), "package.json"))
	_ = json.Unmarshal(data, &pkg)
	if !update.Breaking(pkg.Version, version.Version) {
		return pkg.Version, nil
	}
	upgrade := "Or upgrade the project:     puzzle upgrade"
	if cmp, _ := update.Compare(version.Version, pkg.Version); cmp < 0 {
		upgrade = "Or upgrade this CLI:        puzzle upgrade"
	}
	return pkg.Version, fmt.Errorf("This project has Puzzle %s installed, and this CLI is %s.\n"+
		"  Use the project's own CLI:  npm run dev, npm run build, or npx puzzle <command>\n  %s",
		pkg.Version, version.Version, upgrade)
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
