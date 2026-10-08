package parser

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
)

func TestComponentSelectorAndSpread(t *testing.T) {
	root := parseContent(t, `<Component is={current} name="card" from={origin} title={title} {...extra}><p>slot</p></Component><Component is={embeds[embed.type]} {...embed.props}><p>slot</p></Component>`)
	children := elementChildren(root.Children)
	if len(children) != 2 {
		t.Fatalf("got %d selector nodes, want 2", len(children))
	}
	for i, node := range children {
		component, ok := node.(*Component)
		if !ok || component.Name != "Component" {
			t.Fatalf("selector %d = %#v", i, node)
		}
		spread, ok := component.Props[len(component.Props)-1].(*SpreadAttr)
		if !ok || spread.ExprAST == nil {
			t.Fatalf("spread %d = %#v", i, component.Props)
		}
	}
}

func TestComponentSelectorErrors(t *testing.T) {
	for _, tc := range []struct{ content, message string }{
		{`<Component/>`, "requires is={value}"},
		{`<Component name="card" from={cards}/>`, "requires is={value}"},
		{`<Component from={cards}/>`, "requires is={value}"},
		{`<Component {...props}/>`, "requires is={value}"},
		{`<Component is/>`, "requires a value"},
		{`<Component is="Card"/>`, "requires a component value expression"},
		{`<Component is={"Card"}/>`, "requires a component value expression"},
		{`<Component is={'Card'}/>`, "requires a component value expression"},
		{`<Component is={5}/>`, "requires a component value expression"},
		{`<Component is={-5}/>`, "requires a component value expression"},
		{`<Component is={true}/>`, "requires a component value expression"},
		{`<Component is={false}/>`, "requires a component value expression"},
		{"<Component is={`Card`}/>", "requires a component value expression"},
		{"<Component is={`Card${kind}`}/>", "requires a component value expression"},
		{`<Component is={Card} flip/>`, "flip is not supported on <Component>"},
		{`<Component is={Card} flip={enabled}/>`, "flip is not supported on <Component>"},
		{`<Component is={Card} flip="true"/>`, "flip is not supported on <Component>"},
		{`<Component is={Card} is={Other}/>`, "duplicate is"},
		{`<Component.Card/>`, "rename the component or import"},
		{`<div {...props}/>`, "only supported on component tags"},
		{`<Children {...props}/>`, "only supported on component tags"},
		{`<Card {...}/>`, "requires an expression"},
		{`<Card {props}/>`, "must be a spread"},
		{`<Component is={Card} bind:value={value}/>`, "reserved"},
	} {
		t.Run(tc.content, func(t *testing.T) {
			_, err := Parse([]byte("<puzzle-view>"+tc.content+"</puzzle-view>"), "selector.pzl")
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("error = %v, want %q", err, tc.message)
			}
		})
	}
}

func TestComponentNullishSelectorsRemainValid(t *testing.T) {
	parseContent(t, `<Component is={null}/><Component is={undefined}/><Component is={Card} @flip={flip}/>`)
}

func TestSpreadExpressionKeepsPositionAndBindings(t *testing.T) {
	source := "<puzzle-view>\n{#for row in rows}\n<Card { ...\n row.props }/>\n{/for}\n</puzzle-view>"
	root, err := Parse([]byte(source), "spread.pzl")
	if err != nil {
		t.Fatal(err)
	}
	loop := elementChildren(root.Children)[0].(*For)
	spread := elementChildren(loop.Body)[0].(*Component).Props[0].(*SpreadAttr)
	member := spread.ExprAST.(*expr.Member)
	position := member.Object.(*expr.Identifier).Start
	if position.Line != 4 || position.Col != 2 || position.Offset != strings.Index(source, "row.props") {
		t.Fatalf("spread expression position = %#v", position)
	}
}

func TestComponentChildrenUseOrdinarySlots(t *testing.T) {
	parseContent(t, `<Component is={cards[key]} name="card" from><Snippet><p>slot</p></Snippet></Component>`)
	_, err := Parse([]byte(`<puzzle-view><Component is={cards[key]}><p slot={target}>slot</p></Component></puzzle-view>`), "selector.pzl")
	if err == nil || !strings.Contains(err.Error(), "slot target must be a static") {
		t.Fatalf("error = %v, want ordinary component slot rejection", err)
	}
}
