package build

import (
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

func TestEnvDefines(t *testing.T) {
	env := map[string]json.RawMessage{"API_URL": json.RawMessage(`"https://api.example"`), "BETA": json.RawMessage(`false`), "LIMIT": json.RawMessage(`3`)}
	for _, values := range []map[string]json.RawMessage{nil, env} {
		defines := bundleDefines(plugin.New(t.TempDir()), bundleFlags{Env: values})
		var object map[string]json.RawMessage
		if err := json.Unmarshal([]byte(defines["import.meta.env"]), &object); err != nil || len(object) != len(values) {
			t.Fatalf("bare env = %s, error %v", defines["import.meta.env"], err)
		}
		for key, value := range values {
			if got := defines["import.meta.env."+key]; got != string(value) || string(object[key]) != string(value) {
				t.Errorf("env.%s = %s; object %s; want %s", key, got, object[key], value)
			}
		}
		result := api.Transform(`globalThis.url = import.meta.env.API_URL;`, api.TransformOptions{Define: defines, MinifyWhitespace: true})
		if len(result.Errors) != 0 {
			t.Fatal(result.Errors)
		}
		if values != nil && string(result.Code) != "globalThis.url=\"https://api.example\";\n" {
			t.Fatalf("direct read must emit only its literal, got %s", result.Code)
		}
	}
}

func TestBuildEnv(t *testing.T) {
	requireNodeBin(t)
	for _, configured := range []bool{false, true} {
		for _, dev := range []bool{false, true} {
			name := "absent"
			if configured {
				name = "configured"
			}
			if dev {
				name += "-dev"
			}
			t.Run(name, func(t *testing.T) {
				files := ssgFixtureFiles{"app/app.ts": `
const { API_URL } = import.meta.env;
const key = 'API_URL';
globalThis.envResult = [import.meta.env.API_URL, API_URL, import.meta.env[key], import.meta.env.MISSING === undefined, typeof import.meta.env, import.meta.env.BETA, import.meta.env.LIMIT];
`}
				want := `[null,null,null,true,"object",null,null]`
				if configured {
					files[config.ConfigFileName] = `export default { env: { API_URL: 'https://api.example', BETA: false, LIMIT: 3 } };`
					want = `["https://api.example","https://api.example","https://api.example",true,"object",false,3]`
				} else {
					files[config.ConfigFileName] = `export default {};`
				}
				root := writeSSGFixture(t, files)
				if dev {
					cfg, err := config.LoadConfig(root)
					if err != nil {
						t.Fatal(err)
					}
					b, err := NewWatchBuilder(root, WatchOptions{Env: cfg.Env})
					if err != nil {
						t.Fatal(err)
					}
					defer b.Dispose()
					if _, err := b.Rebuild(nil); err != nil {
						t.Fatal(err)
					}
				} else if err := Build(root, Options{Quiet: true}); err != nil {
					t.Fatal(err)
				}
				bundle := appBundle(t, filepath.Join(root, "dist"))
				cmd := exec.Command("node", "--input-type=module", "-e", `import { pathToFileURL } from 'node:url'; await import(pathToFileURL(process.argv[1])); process.stdout.write(JSON.stringify(globalThis.envResult));`, bundle)
				out, err := cmd.CombinedOutput()
				if err != nil || string(out) != want {
					t.Fatalf("bundle result = %s, error %v; want %s", out, err, want)
				}
			})
		}
	}
}

func TestPrerenderEnv(t *testing.T) {
	requireStaticRuntime(t)
	for _, mode := range []string{"hybrid", "static", "static-dev"} {
		t.Run(mode, func(t *testing.T) {
			files := baseSSGFixture()
			output := strings.TrimSuffix(mode, "-dev")
			files[config.ConfigFileName] = `export default { output: '` + output + `', env: { API_URL: 'https://api.example', BETA: false } };`
			files["app/views/Home.pzl"] = `<puzzle-view><p>{ value }</p></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
 data() {
  const { API_URL } = import.meta.env;
  return { value: [import.meta.env.API_URL, API_URL, typeof import.meta.env.MISSING, typeof import.meta.env, import.meta.env.BETA].join('|') };
 }
}
</script>`
			root := writeSSGFixture(t, files)
			if mode == "static-dev" {
				cfg, err := config.LoadConfig(root)
				if err != nil {
					t.Fatal(err)
				}
				b, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: cfg})
				if err != nil {
					t.Fatal(err)
				}
				defer b.Dispose()
				if err := b.Rebuild(nil); err != nil {
					t.Fatal(err)
				}
			} else if err := Build(root, Options{Quiet: true}); err != nil {
				t.Fatal(err)
			}
			html := readFile(t, filepath.Join(root, "dist", "index.html"))
			if !strings.Contains(html, "https://api.example|https://api.example|undefined|object|false") {
				t.Fatalf("env did not reach prerender: %s", html)
			}
			pattern := filepath.Join(root, "dist", "_puzzle", "*.js")
			if output == "hybrid" {
				pattern = filepath.Join(root, "dist", "app-*.js")
			}
			bundles, err := filepath.Glob(pattern)
			if err != nil || len(bundles) == 0 {
				t.Fatalf("browser bundles: %v, %v", bundles, err)
			}
			found := false
			for _, bundle := range bundles {
				if strings.Contains(readFile(t, bundle), "https://api.example") {
					found = true
				}
			}
			if !found {
				t.Fatal("env literal missing from browser bundles")
			}
		})
	}
}
