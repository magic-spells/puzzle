package codegen

import (
	"strings"
	"testing"
)

func TestDynamicURLAttributes(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view><a href={url} title={url}>Link</a><img src="{url}" srcset={images}/><iframe src={url}/><svg><a xlink:href={url}/></svg><Card href={url}/></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"urlValue as __u", "href: __u(__d.url)", "src: __u(`", "srcset: __u(__d.images, 3)", "'xlink:href': __u(__d.url)"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if !strings.Contains(got, "title: __d.url") || !strings.Contains(got, "new ViewNode(Card, { href: __d.url }") {
		t.Errorf("non-URL values must retain their type:\n%s", got)
	}
}

func TestStaticURLAttributesNeedNoGuard(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view><a href="javascript:author()">Link</a></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "urlValue") || !strings.Contains(got, "javascript:author()") {
		t.Fatal(got)
	}
}

// A mixed value whose literal head already decides the scheme cannot become a
// script URL, so it skips the guard; a head that leaves the scheme open keeps it.
func TestMixedURLWithFixedSchemeNeedsNoGuard(t *testing.T) {
	for _, tt := range []struct {
		href  string
		guard bool
	}{
		{href: `/users/{id}`},
		{href: `https://example.com/{id}`},
		{href: `mailto:{email}`},
		{href: `?q={q}`},
		{href: `#{id}`},
		{href: `./{id}`},
		{href: `{base}/x`, guard: true},
		{href: `java{rest}`, guard: true},
		{href: ` java{rest}`, guard: true},
		{href: `&#106;{rest}`, guard: true},
		{href: `{#if a}/x{:else}y{/if}{rest}`, guard: true},
	} {
		got, err := compileMarkup(t, `<puzzle-view><a href="`+tt.href+`">x</a></puzzle-view>`, ModeView)
		if err != nil {
			t.Fatalf("%s: %v", tt.href, err)
		}
		if strings.Contains(got, "__u(") != tt.guard {
			t.Errorf("href=%q: guarded = %v, want %v:\n%s", tt.href, !tt.guard, tt.guard, got)
		}
	}
	got, err := compileMarkup(t, `<puzzle-view><img srcset="/a.png 1x, {b} 2x"/></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "__u(") {
		t.Errorf("a candidate list keeps the guard past a fixed first candidate:\n%s", got)
	}
}

func TestPassiveCaptureCodegen(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view><div @wheel:passive:capture={go} @click:outside:passive={close}/></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"'@wheel:passive:capture'", "'@click:outside:passive'"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %s", want, got)
		}
	}
}

// D186: animation elements can write href, so their value attributes are
// guarded whatever attributeName says; `values` is checked per `;` entry.
func TestSVGAnimationValuesGuarded(t *testing.T) {
	got, err := compileMarkup(t, `<puzzle-view><svg><a><animate attributeName="href" values={v} from={f}/><set attributeName="href" to={u}/><animateMotion by={b}/><animateTransform to={u} type="scale"/><rect to={u}/></a><set attributeName="href" to="javascript:author()"/></svg></puzzle-view>`, ModeView)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"values: __u(__d.v, 4)", "from: __u(__d.f)", "to: __u(__d.u)", "by: __u(__d.b)", "javascript:author()"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Count(got, "to: __u(") != 2 || !strings.Contains(got, "to: __d.u") {
		t.Errorf("only animation elements guard `to`:\n%s", got)
	}
}

func TestDynamicSrcdocNeedsStaticSandbox(t *testing.T) {
	for _, tt := range []struct {
		markup string
		ok     bool
	}{
		{markup: `<iframe srcdoc={html}></iframe>`},
		{markup: `<iframe srcdoc="<p>{html}</p>"></iframe>`},
		{markup: `<iframe sandbox="allow-scripts" srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox={mode} srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox="" sandbox={policy} srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox={policy} sandbox="" srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox="" sandbox="allow-{x}" srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox="" sandbox="allow-scripts" srcdoc={html}></iframe>`},
		{markup: `<iframe sandbox srcdoc={html}></iframe>`, ok: true},
		{markup: `<iframe sandbox="allow-same-origin" srcdoc={html}></iframe>`, ok: true},
		{markup: `<iframe srcdoc="<p>static</p>"></iframe>`, ok: true},
	} {
		_, err := compileMarkup(t, `<puzzle-view>`+tt.markup+`</puzzle-view>`, ModeView)
		if tt.ok != (err == nil) {
			t.Errorf("%s: err = %v, want ok=%v", tt.markup, err, tt.ok)
		}
		if err != nil && !strings.Contains(err.Error(), "sandbox") {
			t.Errorf("%s: message should steer to sandbox: %v", tt.markup, err)
		}
	}
}
