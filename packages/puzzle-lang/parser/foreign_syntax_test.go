package parser

import (
	"strings"
	"testing"
)

func TestForeignAttributes(t *testing.T) {
	tests := []struct{ attr, message string }{
		{`className="mt-4"`, "className is not supported — write class"},
		{`htmlFor="a"`, "htmlFor is not supported — write for"},
		{`v-if="subtitle"`, "v-if is not supported — wrap the element in {#if condition}…{/if}"},
		{`v-else-if="subtitle"`, "v-else-if is not supported — use {:else if condition} inside {#if}…{/if}"},
		{`v-else`, "v-else is not supported — use {:else} inside {#if}…{/if}"},
		{`v-show="subtitle"`, "v-show is not supported — use {#if condition}…{/if} to conditionally render the element"},
		{`v-for="item in items"`, "v-for is not supported — wrap the element in {#for item in items}…{/for}"},
		{`v-model="subtitle"`, "v-model is not supported — write value={ expr } (or checked={ expr }) on <input>, <textarea>, or <select> for two-way binding"},
		{`v-bind:title="subtitle"`, "v-bind:title is not supported — write title={ expr }"},
		{`v-bind:value="subtitle"`, "v-bind:value is not supported — write value={ expr }"},
		{`:class="subtitle"`, ":class is not supported — write class={ expr }"},
		{`:title="subtitle"`, ":title is not supported — write title={ expr }"},
		{`v-on:click="hello"`, "v-on:click is not supported — write @click={ handler }"},
		{`v-on:click={ hello }`, "v-on:click is not supported — write @click={ handler }"},
		{`v-html="subtitle"`, "v-html is not supported — put { raw(expr) } inside the element"},
		{`on:click={ hello }`, "on:click is not supported — write @click={ handler }"},
		{`class:active={ x }`, `class:active is not supported — write class="{#if cond}active{/if}"`},
		{`onClick={ save }`, "onClick is not supported — write @click={ save }"},
		{`onclick={ save }`, "onclick is not supported — write @click={ save }"},
		{`ONCLICK={ save }`, "ONCLICK is not supported — write @click={ save }"},
		{`oNcLiCk={ save }`, "oNcLiCk is not supported — write @click={ save }"},
		{`onInput={ save(event) }`, "onInput is not supported — write @input={ save(event) }"},
		{`oncustom-event={ save }`, "oncustom-event is not supported — write @custom-event={ save }"},
		{`onDoubleClick={ hello }`, "onDoubleClick is not supported — write @dblclick={ hello }"},
		{`ONDOUBLECLICK={ hello }`, "ONDOUBLECLICK is not supported — write @dblclick={ hello }"},
	}
	for _, tt := range tests {
		t.Run(tt.attr, func(t *testing.T) {
			markup := "  <button " + tt.attr + " />"
			_, err := Parse([]byte("<puzzle-view>\n"+markup+"\n</puzzle-view>"), "Foreign.pzl")
			assertForeignError(t, err, tt.message, 2, 11)
			// The wrapper-less host path has a preliminary lexer depth scan;
			// that scan must not replace the positioned diagnostic.
			_, err = ParseMarkup(markup, Position{Line: 20, Col: 3, Offset: 100}, "Foreign.pzl")
			assertForeignError(t, err, tt.message, 20, 13)
		})
	}
}

func assertForeignError(t *testing.T, err error, message string, line, col int) {
	t.Helper()
	pe, ok := err.(*ParseError)
	if !ok {
		t.Fatalf("expected *ParseError, got %T (%v)", err, err)
	}
	if pe.File != "Foreign.pzl" || pe.Line != line || pe.Col != col || pe.Message != message {
		t.Errorf("got %v, want Foreign.pzl:%d:%d: %s", pe, line, col, message)
	}
}

func TestForeignAttributeNamesWithoutValues(t *testing.T) {
	for _, name := range []string{"className", "htmlFor", "v-if", "v-else-if", "v-else", "v-show", "v-for", "v-model", "v-bind:title", ":title", "v-on:click", "v-html", "on:click", "class:active"} {
		t.Run(name, func(t *testing.T) {
			_, bare := ParseMarkup("<p "+name+"/>", Position{}, "Foreign.pzl")
			_, valued := ParseMarkup("<p "+name+`="x"/>`, Position{}, "Foreign.pzl")
			if bare == nil || valued == nil || bare.Error() != valued.Error() {
				t.Fatalf("valueless and valued names must agree: bare %v; valued %v", bare, valued)
			}
		})
	}
}

func TestForeignAttributeExemptions(t *testing.T) {
	props := `className="x" htmlFor="a" v-if="x" v-else-if="x" v-else v-show="x" v-for="x" v-model="x" v-html="x" onClick={ f } onclick={ f } ONCLICK={ f } onDoubleClick={ f }`
	for _, markup := range []string{
		`<Button ` + props + `/>`,
		`<Frame.Button ` + props + `/>`,
		`<Button><button onclick="save()"/><Button ` + props + `/></Button>`,
		`<button onclick="save()" ONCLICK="save()" onClick="save()"/>`,
		`<button onclick onClick/>`,
		`<button on={ x }/>`,
		`<toggle-switch on={ x }/>`,
		`<my-el once={ x } only={ x } onboarding={ x } onclick={ f } onDoubleClick={ f }/>`,
		`<button @click={ hello }/>`,
		`<p class="{#if x}active{/if}" for="a">{ raw(subtitle) }</p>`,
		`{#raw}<button className="x" v-if="x" on:click={ hello } onclick={ save }>{@html subtitle}</button>{/raw}`,
	} {
		t.Run(markup, func(t *testing.T) {
			if _, err := ParseMarkup(markup, Position{}, "Foreign.pzl"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestForeignColonAttributesOnComponents(t *testing.T) {
	for _, tt := range []struct{ attr, message string }{
		{`on:click={ save }`, "on:click is not supported — write @click={ handler }"},
		{`class:active={ x }`, `class:active is not supported — write class="{#if cond}active{/if}"`},
		{`v-bind:title="x"`, "v-bind:title is not supported — write title={ expr }"},
		{`v-on:click="x"`, "v-on:click is not supported — write @click={ handler }"},
		{`:class="x"`, ":class is not supported — write class={ expr }"},
	} {
		_, err := Parse([]byte("<puzzle-view>\n  <Button "+tt.attr+"/>\n</puzzle-view>"), "Foreign.pzl")
		assertForeignError(t, err, tt.message, 2, 11)
	}
}

func TestForeignAttributeReviewRegressions(t *testing.T) {
	_, err := Parse([]byte("<puzzle-view>\n  <input type=\"checkbox\" v-model=\"done\">\n</puzzle-view>"), "Foreign.pzl")
	assertForeignError(t, err, "v-model is not supported — write value={ expr } (or checked={ expr }) on <input>, <textarea>, or <select> for two-way binding", 2, 26)
	_, err = Parse([]byte("\n<puzzle-view className=\"min-h-screen\"><p/></puzzle-view>"), "Foreign.pzl")
	assertForeignError(t, err, "className is not supported — write class", 2, 14)
	root, err := Parse([]byte(`<puzzle-view onclick={ f }><p/></puzzle-view>`), "Foreign.pzl")
	if err != nil {
		t.Fatal(err)
	}
	if attr, ok := root.Attrs[0].(*DynamicAttr); !ok || attr.Name != "onclick" || attr.Expr != "f" {
		t.Fatalf("custom root attribute changed: %#v", root.Attrs[0])
	}
	_, err = Parse([]byte("<puzzle-view>\n  <form on:submit|preventDefault={ hello }></form>\n</puzzle-view>"), "Foreign.pzl")
	assertForeignError(t, err, "on:submit is not supported — write @submit={ handler }", 2, 9)
	_, err = ParseMarkup("  <my-el className=\"x\"/>", Position{}, "Foreign.pzl")
	assertForeignError(t, err, "className is not supported — write class", 1, 10)
	_, err = ParseMarkup("  <rect onclick={ f }/>", Position{}, "Foreign.pzl")
	assertForeignError(t, err, "onclick is not supported — write @click={ f }", 1, 9)
}

func TestSkipForeignSyntaxCheck(t *testing.T) {
	opts := Options{SkipForeignSyntaxCheck: true}
	for _, attr := range []string{`className="x"`, `htmlFor="a"`, `v-if="x"`, `v-else-if="x"`, `v-else`, `v-show="x"`, `v-for="x"`, `v-model="x"`, `v-html="x"`, `onClick={ save }`, `onclick={ save }`, `ONCLICK={ save }`, `onDoubleClick={ save }`} {
		markup := "<button " + attr + "/>"
		if _, err := ParseMarkup(markup, Position{}, "Foreign.pzl", opts); err != nil {
			t.Errorf("%s: %v", attr, err)
		}
	}
	for _, name := range []string{"v-bind:title", "v-on:click", "on:click", "class:active", ":class"} {
		for _, tag := range []string{"button", "Button"} {
			_, err := ParseMarkup("<"+tag+" "+name+`="x"/>`, Position{}, "Foreign.pzl", opts)
			if err == nil || strings.Contains(err.Error(), "is not supported") || strings.Contains(err.Error(), "@click") {
				t.Errorf("%s on %s should keep its old diagnostic: %v", name, tag, err)
			}
		}
	}
	// Section parsing used by the second host keeps its existing diagnostics.
	if _, err := ParseAttrString(`className="x" onClick={ f }`, Position{Line: 1, Col: 1}, "Foreign.pzl", "div"); err != nil {
		t.Fatal(err)
	}
	_, err := ParseAttrString(`:class="x"`, Position{Line: 1, Col: 1}, "Foreign.pzl", "div")
	assertForeignError(t, err, `unexpected character ":" in tag`, 1, 1)
	_, err = AttrNames(`:class="x"`, Position{Line: 1, Col: 1}, "Foreign.pzl")
	assertForeignError(t, err, `unexpected character ":" in tag`, 1, 1)
}

func TestForeignHTMLInterpolation(t *testing.T) {
	for _, spelling := range []string{"{@html subtitle}", "{@html\n subtitle}", "{ @html subtitle }"} {
		_, err := Parse([]byte("<puzzle-view>\n  <p>"+spelling+"</p>\n</puzzle-view>"), "Foreign.pzl")
		assertForeignError(t, err, "{@html expr} is not supported — write { raw(expr) }", 2, 6)
	}
	// raw() is shared syntax, so its steer is also valid for the second host.
	_, err := ParseMarkup("{@html subtitle}", Position{}, "Foreign.pzl", Options{SkipForeignSyntaxCheck: true})
	assertForeignError(t, err, "{@html expr} is not supported — write { raw(expr) }", 1, 1)
}
