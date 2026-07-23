package codegen

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

func TestExtractClassName(t *testing.T) {
	pos := parser.Position{Line: 3, Col: 1}
	cases := []struct {
		name    string
		scripts string
		want    string
		wantErr bool
		errText string
	}{
		{
			name:    "normal",
			scripts: "\nimport { PuzzleView } from '@magic-spells/puzzle';\n\nexport default class TodoHome extends PuzzleView {\n}\n",
			want:    "TodoHome",
		},
		{
			name:    "indented declaration",
			scripts: "  export default class Foo extends PuzzleView {}",
			want:    "Foo",
		},
		{
			name:    "first match wins",
			scripts: "export default class First extends PuzzleView {}\nexport default class Second extends PuzzleView {}",
			want:    "First",
		},
		{
			name:    "alternate base class is accepted",
			scripts: "export default class Derived extends SomeBase {}",
			want:    "Derived",
		},
		{
			name:    "named class without extends is an error",
			scripts: "export default class Demo {}",
			wantErr: true,
			errText: "default export must extend PuzzleView",
		},
		{
			name:    "anonymous extends is an error",
			scripts: "export default class extends PuzzleView {}",
			wantErr: true,
		},
		{
			name:    "anonymous braces is an error",
			scripts: "export default class {}",
			wantErr: true,
		},
		{
			name:    "no default class is an error",
			scripts: "export class NotDefault extends PuzzleView {}",
			wantErr: true,
		},
		{
			name:    "decoy inside a string is ignored",
			scripts: "const s = 'export default class Decoy extends X';\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			name:    "decoy inside a line comment is ignored",
			scripts: "// export default class Decoy extends X\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			// The regression the LexSkip scan fixes: a commented-out declaration at
			// COLUMN 0 (line-anchored regex would have picked Fake).
			name:    "decoy inside a block comment at column 0 is ignored",
			scripts: "/*\nexport default class Fake extends X {}\n*/\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			name:    "extends-less declaration in comment does not shadow the real class",
			scripts: "// export default class Fake {}\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			name:    "decoy at column 0 in a line comment is ignored",
			scripts: "//export default class Fake extends X\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			name:    "decoy inside a template literal is ignored",
			scripts: "const tpl = `\nexport default class Fake extends X\n`;\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
		{
			name:    "keyword as a property name is not the declaration",
			scripts: "obj.export;\nexport default class Real extends PuzzleView {}",
			want:    "Real",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := extractClassName(tc.scripts, "T.pzl", pos)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("extractClassName() = %q, want error", got)
				}
				if pe, ok := err.(*parser.ParseError); !ok || pe.File != "T.pzl" {
					t.Errorf("error is not a positioned *parser.ParseError: %v", err)
				}
				if tc.errText != "" && !strings.Contains(err.Error(), tc.errText) {
					t.Errorf("error %q does not contain %q", err, tc.errText)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Errorf("extractClassName() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestClassNameFromFilename covers the scriptless-.pzl class-name sanitizer:
// extension stripped, non-identifier chars → '_', leading digit guarded.
func TestClassNameFromFilename(t *testing.T) {
	cases := map[string]string{
		"Box.pzl":             "Box",
		"components/Card.pzl": "Card",
		"my-widget.pzl":       "my_widget",
		"weird name!.pzl":     "weird_name_",
		"my.thing.pzl":        "my_thing",
		"2cool.pzl":           "_2cool",
	}
	for in, want := range cases {
		if got := classNameFromFilename(in); got != want {
			t.Errorf("classNameFromFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestCompileScriptless proves <script> is optional: a template-only .pzl
// compiles to a synthesized PuzzleView subclass named from the filename, in both
// view and component modes, and the emitted module is valid JS (node --check).
func TestCompileScriptless(t *testing.T) {
	cases := []struct {
		name string
		file string
		src  string
		mode EmissionMode
	}{
		{
			name: "view",
			file: "Banner.pzl",
			src:  `<puzzle-view class="banner"><h1>Hello</h1></puzzle-view>`,
			mode: ModeView,
		},
		{
			name: "component",
			file: "Chip.pzl",
			src:  `<puzzle-view><span class="chip">x</span></puzzle-view>`,
			mode: ModeComponent,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sec, err := parser.SplitSections(tc.src, tc.file)
			if err != nil {
				t.Fatalf("split: %v", err)
			}
			if sec.Scripts != "" {
				t.Fatalf("precondition: expected empty Scripts, got %q", sec.Scripts)
			}
			res, err := Compile(sec, Options{Filename: tc.file, Mode: tc.mode})
			if err != nil {
				t.Fatalf("compile: %v", err)
			}
			out := res.JS
			name := strings.TrimSuffix(tc.file, ".pzl")
			if !strings.Contains(out, "import { PuzzleView } from '@magic-spells/puzzle';") {
				t.Errorf("missing synthesized PuzzleView import:\n%s", out)
			}
			if !strings.Contains(out, "export default class "+name+" extends PuzzleView {}") {
				t.Errorf("missing synthesized class declaration:\n%s", out)
			}
			if !strings.Contains(out, name+".prototype.render = function () {") {
				t.Errorf("render tail not bound to %s:\n%s", name, out)
			}
			nodeCheck(t, out)
		})
	}
}

// nodeCheck syntax-checks src with `node --check`, no-op when node is absent so a
// node-less environment still passes the string assertions above.
func nodeCheck(t *testing.T, src string) {
	t.Helper()
	nodeBin, err := exec.LookPath("node")
	if err != nil {
		t.Log("node not available; skipping syntax check")
		return
	}
	f := filepath.Join(t.TempDir(), "out.mjs")
	if err := os.WriteFile(f, []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(nodeBin, "--check", f).CombinedOutput(); err != nil {
		t.Fatalf("node --check failed: %v\n%s\n--- source ---\n%s", err, out, src)
	}
}

// TestCompileErrors exercises the codegen build errors (D20 component-mode
// rules and the malformed event handler).
func TestCompileErrors(t *testing.T) {
	cases := []struct {
		name string
		src  string
		mode EmissionMode
		want string
	}{
		{
			name: "component with attrs on puzzle-view",
			src:  "<puzzle-view class=\"x\"><span>hi</span></puzzle-view>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeComponent,
			want: "components render inline",
		},
		{
			name: "component with two roots",
			src:  "<puzzle-view><span>a</span><span>b</span></puzzle-view>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeComponent,
			want: "single root element",
		},
		{
			name: "bad event handler",
			src:  "<puzzle-view class=\"x\"><button @click={ a + b }>x</button></puzzle-view>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeView,
			want: "single call expression",
		},
		{
			name: "event modifiers on component callback prop",
			src:  "<puzzle-view class=\"x\"><Child @select:once={ onSelect } /></puzzle-view>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeView,
			want: "event modifiers are not allowed on component callback props",
		},
		{
			name: "component skeleton with two roots",
			src:  "<puzzle-view><span>a</span></puzzle-view>\n<puzzle-skeleton><span>x</span><span>y</span></puzzle-skeleton>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeComponent,
			want: "a component skeleton must have a single root element",
		},
		{
			name: "component skeleton with empty body",
			src:  "<puzzle-view><span>a</span></puzzle-view>\n<puzzle-skeleton></puzzle-skeleton>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeComponent,
			want: "a component skeleton must have a single root element",
		},
		{
			name: "component skeleton with component root",
			src:  "<puzzle-view><span>a</span></puzzle-view>\n<puzzle-skeleton><Spinner /></puzzle-skeleton>\n<script>\nexport default class C extends PuzzleView {}\n</script>",
			mode: ModeComponent,
			want: "a component skeleton's root must be a plain element",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sec, err := parser.SplitSections(tc.src, "C.pzl")
			if err != nil {
				t.Fatalf("split: %v", err)
			}
			_, err = Compile(sec, Options{Filename: "C.pzl", Mode: tc.mode})
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.want)
			}
		})
	}
}

// TestModeForPath checks the D20 directory convention.
func TestModeForPath(t *testing.T) {
	cases := map[string]EmissionMode{
		"app/views/Home.pzl":         ModeView,
		"app/layouts/Default.pzl":    ModeView,
		"app/components/Button.pzl":  ModeComponent,
		"app/components/ui/Card.pzl": ModeComponent,
	}
	for path, want := range cases {
		if got := ModeForPath(path); got != want {
			t.Errorf("ModeForPath(%q) = %v, want %v", path, got, want)
		}
	}
}
