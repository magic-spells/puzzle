package codegen

import (
	"os/exec"
	"strings"
	"testing"
)

func TestComponentSelectorLoopLocalPrecedence(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"item", `{#for Card in cards}<Component is={Card}/>{/for}`, "__dc(s.item,"},
		{"counter", `{#for row in rows, Card}<Component is={Card}/>{/for}`, "__dc(s.i,"},
		{"map item", `{#for Card in cards}<Component is={Card} key={prefix + Card.id}/>{/for}`, "__dc(Card,"},
		{"range counter", `{#for 1...2, Card}<Component is={Card}/>{/for}`, "__dc(Card,"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view>`+tc.body+`</puzzle-view>
<script>import Card from './Card.pzl'; export default class Home extends Object {}</script>`)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("template local must take precedence over the module selector, want %q:\n%s", tc.want, got)
			}
		})
	}
}

func TestLoopInternalNamesRemainDataScoped(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"row key", `{#for row in rows}<div title={__pzlRowKey}/>{/for}`, "title: __d.__pzlRowKey"},
		{"range key", `{#for 1...2}<div title={__i}/>{/for}`, "title: __d.__i"},
		{"map key helper", `{#for row in rows}<div key={prefix + row.id} title={ViewNode}/>{/for}`, "title: __d.ViewNode"},
		{"explicit key helper", `{#for row in rows}<div key={ViewNode}/>{/for}`, "key: __d.ViewNode"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view>`+tc.body+`</puzzle-view>`)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("generated loop locals captured a data field, want %q:\n%s", tc.want, got)
			}
		})
	}
}

func TestComponentSelectorDeclarationComments(t *testing.T) {
	for _, declaration := range []string{
		"class /* binding */ Card extends Object {}",
		"class // binding\nCard extends Object {}",
		"function /* binding */ Card() {}",
		"function /* generator */ * /* binding */ Card() {}",
	} {
		t.Run(declaration, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view><Component is={Card}/></puzzle-view>
<script>`+declaration+` export default class Home extends Object {}</script>`)
			if !strings.Contains(got, "__dc(Card,") || strings.Contains(got, "__d.Card") {
				t.Fatalf("comment hid a module selector binding:\n%s", got)
			}
		})
	}
}

func TestProtoAttributesAreOwnProperties(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not available")
	}
	for _, tc := range []struct{ name, body, value string }{
		{"static", `<div __proto__="literal"/>`, "literal"},
		{"dynamic", `<div __proto__={value}/>`, "dynamic"},
		{"mixed", `<div __proto__="prefix-{value}"/>`, "prefix-dynamic"},
		{"component", `<Card __proto__={value}/>`, "dynamic"},
		{"selected component", `<Component is={Card} __proto__={value}/>`, "dynamic"},
		{"literal markup", `{#raw}<div __proto__="literal"/>{/raw}`, "literal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view>`+tc.body+`</puzzle-view>
<script>class Card {} export default class Home extends Object {}</script>`)
			var script strings.Builder
			script.WriteString("class ViewNode { constructor(tag, attrs, children) { Object.assign(this, {tag, attrs, children}); } }\n")
			script.WriteString("const __dc = (tag, attrs, children) => new ViewNode(tag, attrs, children);\n")
			script.WriteString("const __s = value => String(value);\n")
			for _, line := range strings.Split(got, "\n") {
				if !strings.HasPrefix(line, "import ") {
					script.WriteString(line + "\n")
				}
			}
			script.WriteString("const view = new Home(); view.getData = () => ({value: 'dynamic'});\n")
			script.WriteString("const attrs = view.render().children[0].attrs;\n")
			script.WriteString("if (!Object.hasOwn(attrs, '__proto__') || attrs.__proto__ !== " + jsString(tc.value) + ") throw new Error('missing own __proto__ attribute');\n")
			if out, err := exec.Command(node, "--input-type=module", "-e", script.String()).CombinedOutput(); err != nil {
				t.Fatalf("attribute evaluation failed: %v\n%s", err, out)
			}
		})
	}
}
