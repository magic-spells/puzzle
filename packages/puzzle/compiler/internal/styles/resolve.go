package styles

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
)

// ResolvedCLI is one runnable Tailwind CLI invocation: an executable plus the
// fixed leading arguments that precede -i/-o/--watch/--minify. Direct
// resolutions (`node <bin script>`, or the v3 `.bin/tailwindcss` shim) run with
// no npx overhead; the npx entries are the portable fallback (D27).
type ResolvedCLI struct {
	// Name identifies the invocation in logs and error messages.
	Name string
	// Exec is the program to run: "node", an absolute path to a .bin shim, or
	// "npx".
	Exec string
	// Args are the leading arguments before the caller appends -i/-o/etc.
	Args []string
}

// ResolveCLI returns the first Tailwind CLI candidate for appRoot. It is used
// for user-facing status text in paths that run Tailwind one-shot per rebuild.
func ResolveCLI(appRoot string) (ResolvedCLI, bool) {
	clis := resolveCLIs(appRoot)
	if len(clis) == 0 {
		return ResolvedCLI{}, false
	}
	return clis[0], true
}

// resolveCLIs returns the Tailwind CLIs to try for appRoot, best-first:
//
//  1. Tailwind v4, resolved directly: node_modules/@tailwindcss/cli's "bin"
//     script executed as `node <script>` (no npx, no PATH resolution).
//  2. Tailwind v3, resolved directly: the node_modules/.bin/tailwindcss shim.
//  3. Tailwind v4 via npx (@tailwindcss/cli) — portable fallback.
//  4. Tailwind v3 via npx (tailwindcss) — portable fallback.
//
// The direct entries are omitted when their files are not found walking up from
// appRoot; the npx entries are always present so a machine with a global/npx
// Tailwind still works. This helps BOTH `puzzle build` (one-shot) and
// `puzzle dev` (warm --watch), since npx resolution + Node cold start is the
// dominant cost the direct path skips (D27).
func resolveCLIs(appRoot string) []ResolvedCLI {
	var clis []ResolvedCLI

	if script := findV4CLI(appRoot); script != "" {
		clis = append(clis, ResolvedCLI{
			Name: "@tailwindcss/cli (Tailwind v4, direct)",
			Exec: "node",
			Args: []string{script},
		})
	}
	if bin := findV3Bin(appRoot); bin != "" {
		clis = append(clis, ResolvedCLI{
			Name: "tailwindcss (Tailwind v3, node_modules/.bin)",
			Exec: bin,
			Args: nil,
		})
	}

	clis = append(clis,
		ResolvedCLI{Name: "@tailwindcss/cli (Tailwind v4, npx)", Exec: "npx", Args: []string{"@tailwindcss/cli"}},
		ResolvedCLI{Name: "tailwindcss (Tailwind v3, npx)", Exec: "npx", Args: []string{"tailwindcss"}},
	)
	return clis
}

// findV4CLI walks up from appRoot for node_modules/@tailwindcss/cli and returns
// the absolute path to its "bin" script (the file `node` should execute), or ""
// if the package is not installed anywhere up the tree.
func findV4CLI(appRoot string) string {
	pkgDir := findUp(appRoot, filepath.Join("node_modules", "@tailwindcss", "cli"))
	if pkgDir == "" {
		return ""
	}
	binRel := binScript(filepath.Join(pkgDir, "package.json"), "tailwindcss")
	if binRel == "" {
		return ""
	}
	script := filepath.Join(pkgDir, filepath.FromSlash(binRel))
	if !fsutil.FileExists(script) {
		return ""
	}
	return script
}

// findV3Bin walks up from appRoot for the node_modules/.bin/tailwindcss shim
// (Tailwind v3's CLI entry) and returns its absolute path, or "".
func findV3Bin(appRoot string) string {
	bin := findUp(appRoot, filepath.Join("node_modules", ".bin", "tailwindcss"))
	if bin == "" || !fsutil.FileExists(bin) {
		return ""
	}
	return bin
}

// binScript reads package.json and returns its "bin" entry for the given
// package name. The "bin" field is either a string (single binary) or an object
// mapping names to script paths; we prefer the named key, then any single entry.
func binScript(pkgPath, name string) string {
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return ""
	}
	var pkg struct {
		Bin json.RawMessage `json:"bin"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil || len(pkg.Bin) == 0 {
		return ""
	}
	// bin as a bare string.
	var s string
	if json.Unmarshal(pkg.Bin, &s) == nil && s != "" {
		return s
	}
	// bin as an object.
	var m map[string]string
	if json.Unmarshal(pkg.Bin, &m) == nil {
		if v, ok := m[name]; ok && v != "" {
			return v
		}
		for _, v := range m {
			if v != "" {
				return v
			}
		}
	}
	return ""
}

// findUp returns the first existing <ancestor>/rel walking up from start
// (start included), or "" if none exists up to the filesystem root. This mirrors
// Node's node_modules resolution: a dependency may live in a parent's
// node_modules (e.g. the in-repo examples/todos resolves to the repo-root install).
func findUp(start, rel string) string {
	dir := start
	for {
		candidate := filepath.Join(dir, rel)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
