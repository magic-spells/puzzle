package config

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// writeConfig writes a puzzle.config.js into a fresh temp app root.
func writeConfig(t *testing.T, body string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ConfigFileName), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// writeConfigIn writes a puzzle.config.js into a named subdirectory of a fresh
// temp root, so the project path can contain characters (like '#' or '%') that a
// bare t.TempDir() never produces.
func writeConfigIn(t *testing.T, dirName, body string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), dirName)
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ConfigFileName), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// requireNode skips a test when node is not on PATH — reading a config needs it.
func requireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
}

func TestLoadConfigNoFile(t *testing.T) {
	// No puzzle.config.js: zero-config defaults, no node invocation, no error.
	cfg, err := LoadConfig(t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.TailwindEnabled() {
		t.Error("expected Tailwind disabled with no config file")
	}
	if len(cfg.Styles.Use) != 0 {
		t.Errorf("expected empty Styles.Use, got %v", cfg.Styles.Use)
	}
	if cfg.Build.SourceMap {
		t.Error("expected build.sourceMap disabled with no config file")
	}
}

func TestLoadConfigValidTailwind(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { styles: { use: ['tailwindcss'] } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.TailwindEnabled() {
		t.Fatalf("expected Tailwind enabled, got Styles.Use=%v", cfg.Styles.Use)
	}
}

func TestLoadConfigEmptyDefault(t *testing.T) {
	requireNode(t)
	// A config that exports nothing relevant is valid and enables nothing.
	root := writeConfig(t, "export default {};\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.TailwindEnabled() {
		t.Error("expected Tailwind disabled for empty config")
	}
}

func TestLoadConfigMalformed(t *testing.T) {
	requireNode(t)
	// A JS syntax error must surface as a clear load error, not a silent default.
	root := writeConfig(t, "export default { styles: { use: [ };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for malformed puzzle.config.js")
	}
	if !strings.Contains(err.Error(), ConfigFileName) {
		t.Errorf("error should name the config file, got: %v", err)
	}
}

func TestLoadConfigObjectEntryNotInV1(t *testing.T) {
	requireNode(t)
	// The object form (the deferred Sass pipeline shape) is parsed and rejected.
	root := writeConfig(t, "export default { styles: { use: [{ name: 'sass', input: './main.scss' }] } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected a not-in-v1 error for an object styles.use entry")
	}
	if !strings.Contains(err.Error(), "not supported in v1") {
		t.Errorf("expected a 'not supported in v1' message, got: %v", err)
	}
	if !strings.Contains(err.Error(), "sass") {
		t.Errorf("expected the error to name the deferred entry, got: %v", err)
	}
}

func TestLoadConfigNonTailwindStringNotInV1(t *testing.T) {
	requireNode(t)
	// A recognized-but-deferred string entry names itself in the error.
	root := writeConfig(t, "export default { styles: { use: ['postcss'] } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected a not-in-v1 error for a non-tailwind string entry")
	}
	if !strings.Contains(err.Error(), "postcss") || !strings.Contains(err.Error(), "not supported in v1") {
		t.Errorf("expected a message naming 'postcss' as unsupported, got: %v", err)
	}
}

func TestLoadConfigDropConsole(t *testing.T) {
	requireNode(t)
	// Explicit boolean values parse and are readable via DropConsole().
	tests := []struct {
		name string
		body string
		want bool
	}{
		{
			name: "false opts out",
			body: "export default { build: { dropConsole: false } };\n",
			want: false,
		},
		{
			name: "true opts in",
			body: "export default { build: { dropConsole: true } };\n",
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := writeConfig(t, tt.body)
			cfg, err := LoadConfig(root)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := cfg.DropConsole(); got != tt.want {
				t.Errorf("DropConsole() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestLoadConfigDropConsoleDefaultsTrue(t *testing.T) {
	requireNode(t)
	// build.dropConsole absent (build block omitted entirely) defaults to true —
	// the v1 behavior of stripping console.* from production bundles.
	root := writeConfig(t, "export default { styles: { use: ['tailwindcss'] } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.DropConsole() {
		t.Error("expected DropConsole() true when build.dropConsole is absent")
	}
}

func TestLoadConfigNoFileDropConsoleDefaultsTrue(t *testing.T) {
	// No config file at all: the zero Config must still report the default.
	cfg, err := LoadConfig(t.TempDir())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.DropConsole() {
		t.Error("expected DropConsole() true with no config file")
	}
}

func TestLoadConfigPathWithHash(t *testing.T) {
	requireNode(t)
	// A '#' in the project path used to truncate the file: URL (ERR_MODULE_NOT_FOUND);
	// node's pathToFileURL now percent-encodes it, so the config still loads.
	root := writeConfigIn(t, "proj#1", "export default { styles: { use: ['tailwindcss'] } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error loading config under a '#' path: %v", err)
	}
	if !cfg.TailwindEnabled() {
		t.Fatalf("expected Tailwind enabled, got Styles.Use=%v", cfg.Styles.Use)
	}
}

func TestLoadConfigPathWithPercent(t *testing.T) {
	requireNode(t)
	// A '%' in the project path used to throw URIError in fileURLToPath; pathToFileURL
	// percent-encodes it, so the config still loads.
	root := writeConfigIn(t, "proj%20x", "export default { styles: { use: ['tailwindcss'] } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error loading config under a '%%' path: %v", err)
	}
	if !cfg.TailwindEnabled() {
		t.Fatalf("expected Tailwind enabled, got Styles.Use=%v", cfg.Styles.Use)
	}
}

func TestLoadConfigIgnoresStrayStdout(t *testing.T) {
	requireNode(t)
	// A config (or a module it imports) that logs to stdout must not corrupt the
	// JSON payload: the sentinel transport reads only the config JSON.
	body := "console.log('noise from the config');\n" +
		"console.log(JSON.stringify({ looks: 'like config but is not' }));\n" +
		"export default { styles: { use: ['tailwindcss'] } };\n"
	root := writeConfig(t, body)
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error with stray stdout logging: %v", err)
	}
	if !cfg.TailwindEnabled() {
		t.Fatalf("expected Tailwind enabled despite stray logging, got Styles.Use=%v", cfg.Styles.Use)
	}
}

func TestLoadConfigDropConsoleNonBooleanRejected(t *testing.T) {
	requireNode(t)
	// A non-boolean build.dropConsole is rejected with a message naming the key.
	root := writeConfig(t, "export default { build: { dropConsole: 'no' } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for a non-boolean build.dropConsole")
	}
	if !strings.Contains(err.Error(), "build.dropConsole") {
		t.Errorf("error should name build.dropConsole, got: %v", err)
	}
	if !strings.Contains(err.Error(), "must be a boolean") {
		t.Errorf("expected a 'must be a boolean' message, got: %v", err)
	}
}

func TestLoadConfigSourceMap(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { build: { sourceMap: true } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.Build.SourceMap {
		t.Error("expected build.sourceMap enabled")
	}
}

func TestLoadConfigSourceMapNonBooleanRejected(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { build: { sourceMap: 'yes' } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for a non-boolean build.sourceMap")
	}
	if !strings.Contains(err.Error(), "build.sourceMap") || !strings.Contains(err.Error(), "must be a boolean") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadConfigDevProxy(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { dev: { proxy: { '/api': 'http://localhost:3091' } } };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := cfg.Dev.Proxy["/api"]; got != "http://localhost:3091" {
		t.Fatalf("Dev.Proxy[/api] = %q, want http://localhost:3091", got)
	}
}

func TestLoadConfigDevProxyPrefixMustStartWithSlash(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { dev: { proxy: { api: 'http://localhost:3091' } } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for a dev.proxy prefix without a leading slash")
	}
	if !strings.Contains(err.Error(), `dev.proxy prefix "api" must start with '/'`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadConfigDevProxyTargetMustBeAbsoluteHTTPURL(t *testing.T) {
	requireNode(t)
	root := writeConfig(t, "export default { dev: { proxy: { '/api': 'localhost:3091' } } };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for a non-URL dev.proxy target")
	}
	if !strings.Contains(err.Error(), `dev.proxy target for "/api" must be an absolute http or https URL`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadConfigOutputStatic(t *testing.T) {
	requireNode(t)
	// output: 'static' is preserved for the build-mode resolver.
	root := writeConfig(t, "export default { output: 'static' };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Output != "static" {
		t.Fatalf("Output = %q, want %q", cfg.Output, "static")
	}
}

func TestLoadConfigOutputHybrid(t *testing.T) {
	requireNode(t)
	// output: 'hybrid' is preserved for the build-mode resolver.
	root := writeConfig(t, "export default { output: 'hybrid' };\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Output != "hybrid" {
		t.Fatalf("Output = %q, want %q", cfg.Output, "hybrid")
	}
}

func TestLoadConfigOutputInvalidNamesBothModes(t *testing.T) {
	requireNode(t)
	// The rejection message for an unsupported value must name BOTH allowed modes
	// so the door to the renamed 'hybrid' is discoverable.
	root := writeConfig(t, "export default { output: 'server' };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for an unsupported output value")
	}
	if !strings.Contains(err.Error(), "static") || !strings.Contains(err.Error(), "hybrid") {
		t.Errorf("error should name both 'static' and 'hybrid', got: %v", err)
	}
}

func TestLoadConfigOutputAbsentDefaultsSPA(t *testing.T) {
	requireNode(t)
	// No output key: the empty value selects the default SPA build.
	root := writeConfig(t, "export default {};\n")
	cfg, err := LoadConfig(root)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Output != "" {
		t.Fatalf("Output = %q, want empty default", cfg.Output)
	}
}

func TestLoadConfigOutputInvalidValueRejected(t *testing.T) {
	requireNode(t)
	// Any value other than 'static' is rejected with a message naming the
	// allowed value.
	root := writeConfig(t, "export default { output: 'server' };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for an unsupported output value")
	}
	if !strings.Contains(err.Error(), "output") {
		t.Errorf("error should name output, got: %v", err)
	}
	if !strings.Contains(err.Error(), "static") {
		t.Errorf("error should name the allowed value 'static', got: %v", err)
	}
}

func TestLoadConfigOutputNonStringRejected(t *testing.T) {
	requireNode(t)
	// A non-string output (e.g. true) is rejected, naming the key.
	root := writeConfig(t, "export default { output: true };\n")
	_, err := LoadConfig(root)
	if err == nil {
		t.Fatal("expected an error for a non-string output")
	}
	if !strings.Contains(err.Error(), "output") {
		t.Errorf("error should name output, got: %v", err)
	}
}
