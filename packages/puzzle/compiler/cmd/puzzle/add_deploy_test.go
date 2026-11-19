package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	deploytemplates "github.com/magic-spells/puzzle/deploy"
)

// newDeployApp makes a bare app root (a package.json is the project marker
// FindProjectRoot walks up to) and returns its path.
func newDeployApp(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"deploy-test","type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// runDeploy runs `puzzle add deploy <args…>` against root with the given
// --static / --hybrid choice and returns the output and error.
func runDeploy(t *testing.T, root, output string, overwrite bool, args ...string) (string, error) {
	t.Helper()
	var buf bytes.Buffer
	err := runAddWithEnvironment(&buf, plainPrinter(), root, append([]string{"deploy"}, args...), "", "", overwrite, addEnvironment{
		homeDir:      os.UserHomeDir,
		deployOutput: output,
	})
	return buf.String(), err
}

// embedded returns a template's bytes, failing the test when it is missing.
func embedded(t *testing.T, template string) []byte {
	t.Helper()
	data, err := deploytemplates.FS.ReadFile(template)
	if err != nil {
		t.Fatalf("reading embedded %s: %v", template, err)
	}
	return data
}

func TestAddDeployListsHostsWithoutWriting(t *testing.T) {
	root := newDeployApp(t)
	out, err := runDeploy(t, root, "", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, name := range []string{"vercel", "netlify", "cloudflare", "nginx", "apache"} {
		if !strings.Contains(out, name) {
			t.Errorf("host list should name %s, got:\n%s", name, out)
		}
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 1 {
		t.Errorf("listing hosts must write nothing, found %d entries", len(entries))
	}
}

func TestAddDeployUnknownHost(t *testing.T) {
	_, err := runDeploy(t, newDeployApp(t), "", false, "heroku")
	if err == nil || !strings.Contains(err.Error(), "supported: vercel, netlify, cloudflare, nginx, apache") {
		t.Fatalf("expected an unknown-host error listing the hosts, got %v", err)
	}
}

func TestAddDeployOneHostAtATime(t *testing.T) {
	_, err := runDeploy(t, newDeployApp(t), "", false, "vercel", "netlify")
	if err == nil || !strings.Contains(err.Error(), "one host at a time") {
		t.Fatalf("expected a one-host usage error, got %v", err)
	}
}

// every host writes exactly its embedded template, at its documented path,
// for each output mode. no puzzle.config.js means the spa template; the flag
// picks the others.
func TestAddDeployWritesEachHostTemplate(t *testing.T) {
	for _, host := range deploytemplates.Hosts {
		for _, mode := range []string{"", "hybrid", "static"} {
			t.Run(host.Name+"/"+mode, func(t *testing.T) {
				root := newDeployApp(t)
				// a host case-insensitive and space-tolerant, like the other selectors.
				if _, err := runDeploy(t, root, mode, false, "  "+strings.ToUpper(host.Name)+" "); err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				files := host.SPA
				if mode == "static" {
					files = host.Static
				}
				for _, file := range files {
					want := embedded(t, file.Template)
					dest := file.Name
					if file.Place == deploytemplates.Public {
						dest = filepath.Join("app", "public", file.Name)
					}
					got, err := os.ReadFile(filepath.Join(root, dest))
					if err != nil {
						t.Fatalf("expected %s written: %v", dest, err)
					}
					if !bytes.Equal(got, want) {
						t.Errorf("%s does not match the %s template", dest, file.Template)
					}
				}
			})
		}
	}
}

// an app that keeps its public folder at the root gets the public templates
// there, because that is the folder the build copies (publicDir's rule).
func TestAddDeployUsesRootPublicFolder(t *testing.T) {
	root := newDeployApp(t)
	if err := os.Mkdir(filepath.Join(root, "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := runDeploy(t, root, "", false, "cloudflare"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !fsFileExists(filepath.Join(root, "public", "_headers")) {
		t.Error("expected public/_headers")
	}
	if fsFileExists(filepath.Join(root, "app", "public", "_headers")) {
		t.Error("did not expect app/public/_headers beside a root public/ folder")
	}
}

func TestAddDeployRefusesThenForces(t *testing.T) {
	root := newDeployApp(t)
	dest := filepath.Join(root, "netlify.toml")
	mine := []byte("# my own netlify config\n")
	if err := os.WriteFile(dest, mine, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := runDeploy(t, root, "", false, "netlify")
	if err == nil || !strings.Contains(err.Error(), "refusing to overwrite netlify.toml") || !strings.Contains(err.Error(), "--force") {
		t.Fatalf("expected a refusal naming the file and --force, got %v", err)
	}
	if got, _ := os.ReadFile(dest); !bytes.Equal(got, mine) {
		t.Fatal("a refused add must leave the existing file untouched")
	}

	if _, err := runDeploy(t, root, "", true, "netlify"); err != nil {
		t.Fatalf("--force should replace the file: %v", err)
	}
	if got, _ := os.ReadFile(dest); !bytes.Equal(got, embedded(t, "netlify/spa/netlify.toml")) {
		t.Fatal("--force should write the template")
	}

	// the same template again is a no-op, not a refusal.
	out, err := runDeploy(t, root, "", false, "netlify")
	if err != nil {
		t.Fatalf("an identical file should not be refused: %v", err)
	}
	if !strings.Contains(out, "already matches") {
		t.Errorf("expected an up-to-date note, got:\n%s", out)
	}
}

// the config's output key picks the template when no flag does.
func TestAddDeployFollowsConfigOutput(t *testing.T) {
	addRequireNode(t)
	root := newDeployApp(t)
	cfg := "export default { output: 'static', i18n: { locales: ['en', 'es'], defaultLocale: 'en', routing: 'prefix' } };\n"
	if err := os.WriteFile(filepath.Join(root, "puzzle.config.js"), []byte(cfg), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "app", "locales"), 0o755); err != nil {
		t.Fatal(err)
	}
	out, err := runDeploy(t, root, "", false, "nginx")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(root, "nginx.conf"))
	if !bytes.Equal(got, embedded(t, "nginx/static/nginx.conf")) {
		t.Fatal("output: 'static' should pick the static nginx template")
	}
	// the non-default locale's 404 page is a manual step, named exactly.
	if !strings.Contains(out, "location /es/") || strings.Contains(out, "location /en/") {
		t.Errorf("expected a 404 step for es only, got:\n%s", out)
	}
}

// cloudflare pages leaves spa mode when a top-level 404.html ships, so an spa
// with one gets a warning.
func TestAddDeployCloudflareWarnsAboutPublic404(t *testing.T) {
	root := newDeployApp(t)
	if err := os.MkdirAll(filepath.Join(root, "app", "public"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "app", "public", "404.html"), []byte("<h1>gone</h1>"), 0o644); err != nil {
		t.Fatal(err)
	}
	out, err := runDeploy(t, root, "", false, "cloudflare")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(out, "app/public/404.html turns off Cloudflare Pages' spa fallback") {
		t.Errorf("expected the 404.html warning, got:\n%s", out)
	}
}

// the templates folder and the host table must agree: every listed template
// exists, and every file in the folder is listed (an unlisted template is one
// nobody can install).
func TestDeployTemplatesMatchHostTable(t *testing.T) {
	listed := map[string]bool{}
	for _, host := range deploytemplates.Hosts {
		if len(host.SPA) == 0 || len(host.Static) == 0 {
			t.Errorf("%s needs both an spa and a static template", host.Name)
		}
		for _, file := range append(append([]deploytemplates.File(nil), host.SPA...), host.Static...) {
			embedded(t, file.Template)
			listed[file.Template] = true
		}
	}
	err := fs.WalkDir(deploytemplates.FS, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && !listed[path] {
			t.Errorf("template %s is in the folder but no host lists it", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// the routing rules each template is for. spa templates send unknown paths to
// the shell; static templates never do, and serve a real 404 page instead.
// cloudflare has no routing rules at all (pages picks spa or static mode by
// whether a top-level 404.html exists), so its headers file must not try.
func TestDeployTemplateRouting(t *testing.T) {
	cases := []struct {
		template string
		want     []string
		never    []string
	}{
		{"vercel/spa/vercel.json", []string{`"destination": "/index.html"`}, nil},
		{"vercel/static/vercel.json", nil, []string{"rewrites", "index.html"}},
		{"netlify/spa/netlify.toml", []string{`to = "/index.html"`, "status = 200"}, nil},
		{"netlify/static/netlify.toml", nil, []string{"\n[[redirects]]", `to = "/index.html"`}},
		{"nginx/spa/nginx.conf", []string{"try_files $uri $uri/ /index.html;"}, []string{"error_page"}},
		{"nginx/static/nginx.conf", []string{"try_files $uri $uri/ =404;", "error_page 404 /404.html;"}, []string{"/index.html;"}},
		{"apache/spa/.htaccess", []string{"RewriteRule ^ index.html [L]"}, []string{"ErrorDocument"}},
		{"apache/static/.htaccess", []string{"ErrorDocument 404 /404.html"}, []string{"RewriteRule ^ index.html"}},
		{"cloudflare/_headers", nil, []string{"index.html 200"}},
	}
	for _, tc := range cases {
		body := string(embedded(t, tc.template))
		for _, want := range tc.want {
			if !strings.Contains(body, want) {
				t.Errorf("%s should contain %q", tc.template, want)
			}
		}
		for _, never := range tc.never {
			if strings.Contains(body, never) {
				t.Errorf("%s should not contain %q", tc.template, never)
			}
		}
	}
}

// every template marks content-hashed names immutable and nothing else: the
// hash pattern is the build's upper-case base32 (8 chars), and the year-long
// cache never reaches html.
func TestDeployTemplatesCacheHashedNames(t *testing.T) {
	for _, host := range deploytemplates.Hosts {
		for _, file := range append(append([]deploytemplates.File(nil), host.SPA...), host.Static...) {
			body := string(embedded(t, file.Template))
			if !strings.Contains(body, "max-age=31536000, immutable") {
				t.Errorf("%s should cache hashed assets for a year", file.Template)
			}
		}
	}
}

// vercel.json is json and nothing else (no comments), with the keys vercel reads.
func TestDeployVercelTemplatesAreJSON(t *testing.T) {
	for _, template := range []string{"vercel/spa/vercel.json", "vercel/static/vercel.json"} {
		var parsed struct {
			OutputDirectory string            `json:"outputDirectory"`
			BuildCommand    string            `json:"buildCommand"`
			Headers         []json.RawMessage `json:"headers"`
		}
		if err := json.Unmarshal(embedded(t, template), &parsed); err != nil {
			t.Fatalf("%s is not valid JSON: %v", template, err)
		}
		if parsed.OutputDirectory != "dist" || parsed.BuildCommand == "" || len(parsed.Headers) == 0 {
			t.Errorf("%s should set outputDirectory dist, a build command and headers: %+v", template, parsed)
		}
	}
}
