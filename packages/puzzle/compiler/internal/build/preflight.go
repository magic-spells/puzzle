package build

import (
	"fmt"
	"os"
	"path/filepath"
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

func packageManagerInstallCommand(root string) string {
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
		if fileExists(filepath.Join(root, candidate.lockfile)) {
			return candidate.command
		}
	}
	return ""
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
