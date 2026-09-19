package build

import (
	"fmt"
	"path/filepath"

	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
)

// PreflightRuntime verifies that the runtime resolver used by configureRuntime
// has at least one source available before a command constructs an esbuild
// bundle. The CLI is often installed globally, so a missing project install
// must be reported here instead of being left to esbuild's resolver walk.
func PreflightRuntime(root string) error {
	if envRuntime() != "" || FindRuntime(root) != "" || FindInstalledRuntime(root) != "" {
		return nil
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
