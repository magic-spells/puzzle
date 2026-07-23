package codegen

import (
	"strings"
	"testing"
)

// a11y_test.go — the five D82 accessibility warnings (v1.48). Warnings are
// out-of-band diagnostics: every case here compiles successfully, and the
// emission tests prove the generated JS is unaffected by a finding. Fixtures
// are scriptless (a synthesized class) so positions stay easy to read: the
// template starts at line 1, two-space indent per level.

// TestA11yWarnings drives every rule through the shared compile path. A
// non-empty wantMsg expects EXACTLY ONE warning containing it at the exact
// file position; an empty wantMsg expects zero warnings.
func TestA11yWarnings(t *testing.T) {
	cases := []struct {
		name     string
		src      string
		wantMsg  string
		wantLine int
		wantCol  int
	}{
		// -- rule 1: <img> without alt --------------------------------------
		{
			name: "img without alt warns",
			src: `<puzzle-view>
  <img src="/a.png"/>
</puzzle-view>
`,
			wantMsg: "<img> has no alt attribute", wantLine: 2, wantCol: 3,
		},
		{
			name: "empty alt is a decorative image and does not warn",
			src: `<puzzle-view>
  <img src="/a.png" alt=""/>
</puzzle-view>
`,
		},
		{
			name: "static alt text does not warn",
			src: `<puzzle-view>
  <img src="/a.png" alt="a cat"/>
</puzzle-view>
`,
		},
		{
			name: "dynamic alt counts as present",
			src: `<puzzle-view>
  <img src="/a.png" alt={desc}/>
</puzzle-view>
`,
		},
		{
			name: "mixed alt counts as present",
			src: `<puzzle-view>
  <img src="/a.png" alt="photo of { name }"/>
</puzzle-view>
`,
		},

		// -- rule 2: <input type="image"> without alt -----------------------
		{
			name: "input type=image without alt warns",
			src: `<puzzle-view>
  <input type="image" src="/go.png"/>
</puzzle-view>
`,
			wantMsg: `<input type="image"> has no alt attribute`, wantLine: 2, wantCol: 3,
		},
		{
			name: "input type is matched case-insensitively",
			src: `<puzzle-view>
  <input type="IMAGE" src="/go.png"/>
</puzzle-view>
`,
			wantMsg: `<input type="image"> has no alt attribute`, wantLine: 2, wantCol: 3,
		},
		{
			name: "input type=image with alt does not warn",
			src: `<puzzle-view>
  <input type="image" src="/go.png" alt="submit"/>
</puzzle-view>
`,
		},
		{
			name: "dynamic input type never warns",
			src: `<puzzle-view>
  <input type={t} src="/go.png"/>
</puzzle-view>
`,
		},
		{
			name: "mixed input type never warns",
			src: `<puzzle-view>
  <input type="im{ g }age" src="/go.png"/>
</puzzle-view>
`,
		},
		{
			name: "non-image input without alt does not warn",
			src: `<puzzle-view>
  <input type="text"/>
</puzzle-view>
`,
		},

		// -- rule 3: <iframe> without title ---------------------------------
		{
			name: "iframe without title warns",
			src: `<puzzle-view>
  <iframe src="/x.html"></iframe>
</puzzle-view>
`,
			wantMsg: "<iframe> has no title attribute", wantLine: 2, wantCol: 3,
		},
		{
			name: "iframe with title does not warn",
			src: `<puzzle-view>
  <iframe src="/x.html" title="embedded map"></iframe>
</puzzle-view>
`,
		},

		// -- rule 4: <a> without href ---------------------------------------
		{
			name: "a without href warns",
			src: `<puzzle-view>
  <a>home</a>
</puzzle-view>
`,
			wantMsg: "<a> has no href attribute", wantLine: 2, wantCol: 3,
		},
		{
			name: "a with static href does not warn",
			src: `<puzzle-view>
  <a href="/home">home</a>
</puzzle-view>
`,
		},
		{
			name: "a with dynamic href does not warn",
			src: `<puzzle-view>
  <a href={url}>home</a>
</puzzle-view>
`,
		},
		{
			name: "a with mixed href does not warn",
			src: `<puzzle-view>
  <a href="/todos/{ id }">open</a>
</puzzle-view>
`,
		},

		// -- rule 5: statically positive tabindex ---------------------------
		{
			name: "positive tabindex warns",
			src: `<puzzle-view>
  <div tabindex="2">x</div>
</puzzle-view>
`,
			wantMsg: `tabindex="2" is positive`, wantLine: 2, wantCol: 3,
		},
		{
			name: "tabindex zero does not warn",
			src: `<puzzle-view>
  <div tabindex="0">x</div>
</puzzle-view>
`,
		},
		{
			name: "tabindex minus one does not warn",
			src: `<puzzle-view>
  <div tabindex="-1">x</div>
</puzzle-view>
`,
		},
		{
			name: "dynamic tabindex never warns",
			src: `<puzzle-view>
  <div tabindex={i}>x</div>
</puzzle-view>
`,
		},
		{
			name: "valueless tabindex does not warn",
			src: `<puzzle-view>
  <div tabindex>x</div>
</puzzle-view>
`,
		},

		// -- the walk descends into block bodies and the skeleton -----------
		{
			name: "fires inside an if body",
			src: `<puzzle-view>
  {#if ok}
    <iframe src="/x.html"></iframe>
  {/if}
</puzzle-view>
`,
			wantMsg: "<iframe> has no title attribute", wantLine: 3, wantCol: 5,
		},
		{
			name: "fires inside a for body",
			src: `<puzzle-view>
  {#for t in todos}
    <img src={t.src}/>
  {/for}
</puzzle-view>
`,
			wantMsg: "<img> has no alt attribute", wantLine: 3, wantCol: 5,
		},
		{
			name: "fires inside a case clause body",
			src: `<puzzle-view>
  {#case kind}
    {:when 1}
      <a>bad</a>
    {:else}
      <p>ok</p>
  {/case}
</puzzle-view>
`,
			wantMsg: "<a> has no href attribute", wantLine: 4, wantCol: 7,
		},
		{
			name: "fires inside the skeleton",
			src: `<puzzle-view>
  <p>hi</p>
</puzzle-view>

<puzzle-skeleton>
  <img src="/s.png"/>
</puzzle-skeleton>
`,
			wantMsg: "<img> has no alt attribute", wantLine: 6, wantCol: 3,
		},

		// -- a fully valid template is silent -------------------------------
		{
			name: "valid template yields zero warnings",
			src: `<puzzle-view>
  <img src="/a.png" alt="logo"/>
  <a href="/home">home</a>
  <iframe src="/x.html" title="map"></iframe>
  <input type="image" src="/go.png" alt="go"/>
  <div tabindex="0">focusable</div>
</puzzle-view>
`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res := compileResult(t, tc.src)
			if tc.wantMsg == "" {
				if len(res.Warnings) != 0 {
					t.Fatalf("expected no warnings, got %#v", res.Warnings)
				}
				return
			}
			if len(res.Warnings) != 1 {
				t.Fatalf("expected exactly one warning, got %#v", res.Warnings)
			}
			w := res.Warnings[0]
			if !strings.Contains(w.Message, tc.wantMsg) {
				t.Errorf("warning message %q does not contain %q", w.Message, tc.wantMsg)
			}
			if w.File != "T.pzl" || w.Line != tc.wantLine || w.Col != tc.wantCol {
				t.Errorf("warning position = %s:%d:%d, want T.pzl:%d:%d",
					w.File, w.Line, w.Col, tc.wantLine, tc.wantCol)
			}
		})
	}
}

// TestA11yWarningsAreOutOfBand proves findings never alter emission: a
// template with two problems compiles to a full module that still emits both
// offending elements, and each finding is reported once, in document order.
func TestA11yWarningsAreOutOfBand(t *testing.T) {
	res := compileResult(t, `<puzzle-view>
  <img src="/a.png"/>
  <a>home</a>
</puzzle-view>
`)
	if len(res.Warnings) != 2 {
		t.Fatalf("expected two warnings, got %#v", res.Warnings)
	}
	if !strings.Contains(res.Warnings[0].Message, "<img>") {
		t.Errorf("first warning should be the <img> finding, got %q", res.Warnings[0].Message)
	}
	if !strings.Contains(res.Warnings[1].Message, "<a>") {
		t.Errorf("second warning should be the <a> finding, got %q", res.Warnings[1].Message)
	}
	if res.JS == "" {
		t.Fatal("expected generated JS despite warnings")
	}
	if !strings.Contains(res.JS, "new ViewNode('img'") || !strings.Contains(res.JS, "new ViewNode('a'") {
		t.Errorf("expected both elements emitted unchanged:\n%s", res.JS)
	}
}
