package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
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
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("getting current directory: %w", err)
		}
		executable, _ := os.Executable()
		return runUpgrade(os.Stdout, os.Stderr, ui.New(os.Stdout), cwd, executable, check)
	},
}

func init() {
	upgradeCmd.Flags().Bool("check", false, "Report the current and latest versions without upgrading")
	rootCmd.AddCommand(upgradeCmd)
}

type installKind int

const (
	installManual installKind = iota
	installProject
	installGlobal
)

type installContext struct {
	kind        installKind
	dir         string
	manager     string
	dev         bool
	executable  string
	packageJSON string
}

func runUpgrade(stdout, stderr io.Writer, out *ui.Printer, cwd, executable string, check bool) error {
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

	ctx, err := detectInstallContext(cwd, executable)
	if err != nil {
		return err
	}
	if ctx.kind == installManual {
		fmt.Fprintln(stdout, "Install the latest release with:")
		fmt.Fprintln(stdout, "  go install github.com/magic-spells/puzzle/compiler/cmd/puzzle@latest")
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
	if ctx.kind == installGlobal {
		packageJSON = findGlobalPackageJSON(ctx.executable)
	}
	installed, err := installedVersion(packageJSON)
	if err != nil {
		return fmt.Errorf("confirming installed version: %w", err)
	}
	if installed != latest {
		return fmt.Errorf("upgrade installed puzzle %s, expected %s", installed, latest)
	}

	fmt.Fprintf(stdout, "%s upgraded %s → %s\n", out.Green("✓"), version.Version, latest)
	_ = update.WriteCache(latest, time.Now())
	return nil
}

func detectInstallContext(cwd, executable string) (installContext, error) {
	project, found, err := findProjectInstall(cwd)
	if err != nil || found {
		return project, err
	}

	resolved := executable
	if real, err := filepath.EvalSymlinks(executable); err == nil {
		resolved = real
	}
	if !hasPathSegment(resolved, "node_modules") {
		return installContext{kind: installManual}, nil
	}
	manager := "npm"
	if hasPnpmSegment(resolved) {
		manager = "pnpm"
	}
	return installContext{
		kind:       installGlobal,
		dir:        cwd,
		manager:    manager,
		executable: resolved,
	}, nil
}

func findProjectInstall(start string) (installContext, bool, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return installContext{}, false, err
	}
	for {
		packageJSON := filepath.Join(dir, "package.json")
		data, readErr := os.ReadFile(packageJSON)
		if readErr == nil {
			var pkg struct {
				Dependencies    map[string]json.RawMessage `json:"dependencies"`
				DevDependencies map[string]json.RawMessage `json:"devDependencies"`
			}
			if err := json.Unmarshal(data, &pkg); err != nil {
				return installContext{}, false, fmt.Errorf("reading %s: %w", packageJSON, err)
			}
			_, dependency := pkg.Dependencies[puzzlePackage]
			_, devDependency := pkg.DevDependencies[puzzlePackage]
			if dependency || devDependency {
				return installContext{
					kind:        installProject,
					dir:         dir,
					manager:     detectPackageManager(dir),
					dev:         !dependency && devDependency,
					packageJSON: filepath.Join(dir, "node_modules", "@magic-spells", "puzzle", "package.json"),
				}, true, nil
			}
		} else if !os.IsNotExist(readErr) {
			return installContext{}, false, readErr
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return installContext{}, false, nil
		}
		dir = parent
	}
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

func hasPathSegment(path, want string) bool {
	for {
		base := filepath.Base(path)
		if strings.EqualFold(base, want) {
			return true
		}
		parent := filepath.Dir(path)
		if parent == path {
			return false
		}
		path = parent
	}
}

func hasPnpmSegment(path string) bool {
	for {
		base := strings.ToLower(filepath.Base(path))
		if base == "pnpm" || base == ".pnpm" || strings.HasPrefix(base, "pnpm@") {
			return true
		}
		parent := filepath.Dir(path)
		if parent == path {
			return false
		}
		path = parent
	}
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
