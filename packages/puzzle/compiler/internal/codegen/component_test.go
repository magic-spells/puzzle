package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

func TestComponentSlotEmission(t *testing.T) {
	got := compileFile(t, "testdata/component_slot.pzl", ModeView)
	for _, want := range []string{
		"dynamicComponent as __dc",
		"__dc(TaskCard, {", "__dc(__d.current, { ...(__d.embed?.props) }, [])",
		"close: ((this.__h ??= {})[0] ??= (event) => this.events.close(event))",
		"...(__d.extra)", "...(__d.embed?.props)",
		"__dc(embeds?.[__d.embed?.type], {", "name: __d.embed?.type", "from: __d.origin",
		"__dc(embeds?.['task'], {}, [])", "new ViewNode(Card, {",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q:\n%s", want, got)
		}
	}
	for _, absent := range []string{"__d.TaskCard", "__d.embeds", "new ViewNode(Component", "is: TaskCard", "namedComponent", "__nc("} {
		if strings.Contains(got, absent) {
			t.Errorf("unexpected %q:\n%s", absent, got)
		}
	}
}

func TestComponentSelectorScope(t *testing.T) {
	got := compileSrc(t, `<puzzle-view>
<Component is={TaskCard} title={TaskCard}/>
<Component is={embeds[PREFIX + kind]}/>
{#for embeds in rows}<Component is={embeds['card']}/>{/for}
<Card><Snippet TaskCard><Component is={TaskCard}/></Snippet></Card>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import TaskCard from './TaskCard.pzl';
import Card from './Card.pzl';
const unused = 1, embeds = { card: TaskCard };
const PREFIX = 'card-';
export default class Home extends PuzzleView { data() { const current = TaskCard; return {current}; } }
</script>`)
	for _, want := range []string{"__dc(TaskCard, { title: __d.TaskCard }", "__dc(embeds?.[PREFIX + __d.kind]", "__dc(s.item?.['card']", "__dc(TaskCard, {}, [])"} {
		if !strings.Contains(got, want) {
			t.Errorf("selector scope missing %q:\n%s", want, got)
		}
	}
	// Imports are allowed in selectors, but a prop reading one still warns.
	sec, _ := parser.SplitSections(`<puzzle-view><Component is={TaskCard}/><Component is={embeds['card']}/></puzzle-view><script>import TaskCard from './Card.pzl'; const embeds = {card: TaskCard}; export default class Home extends Object {}</script>`, "Scope.pzl")
	result, err := Compile(sec, Options{Filename: "Scope.pzl", Mode: ModeView})
	if err != nil || len(result.Warnings) != 0 {
		t.Fatalf("selector imports produced warning: %v %v", err, result.Warnings)
	}
}

func TestComponentSelectorSimpleDeclarationLists(t *testing.T) {
	bindings := ScriptValueBindings(`import Card from './Card.pzl';
const ignored = 1, embeds = {card: Card};
let first = () => {}, current = Card;
var helper = class Inner {}, variant = Card;
declare /* erased */ const typed: number, erased: number;
function local() { const nested = Card, hidden = Card; }
object.const;
`)
	for _, name := range []string{"Card", "embeds", "current", "variant"} {
		if _, ok := bindings[name]; !ok {
			t.Errorf("missing module binding %q: %v", name, bindings)
		}
	}
	for _, name := range []string{"Inner", "nested", "hidden", "typed", "erased"} {
		if _, ok := bindings[name]; ok {
			t.Errorf("non-module binding %q leaked: %v", name, bindings)
		}
	}
}

func TestComponentModuleSelectorRowCaching(t *testing.T) {
	for _, tc := range []struct {
		name, binding, selector, item string
		volatile                      bool
	}{
		{"import", "", "Card", "row", false},
		{"const map", "const cards = {card: Card};", "cards[row.type]", "row", false},
		{"later const", "const ignored = 1, cards = {card: Card};", "cards[row.type]", "row", false},
		{"let map", "let cards = {card: Card};", "cards[row.type]", "row", true},
		{"later let", "export let ignored = 1, cards = {card: Card};", "cards[row.type]", "row", true},
		{"var map", "var cards = {card: Card};", "cards[row.type]", "row", true},
		{"later var", "var ignored = 1, cards = {card: Card};", "cards[row.type]", "row", true},
		{"commented let", "let /* binding */ cards = {card: Card};", "cards[row.type]", "row", true},
		{"row shadows let", "let cards = {card: Card};", "cards.component", "cards", false},
		{"arrow shadows let", "let cards = Card;", "[Card].map(cards => cards)[0]", "row", false},
		{"unread let", "let cards = Card;", "Card", "row", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := compileSrc(t, `<puzzle-view>{#for `+tc.item+` in rows}<Component is={`+tc.selector+`}/>{/for}</puzzle-view>
<script>import Card from './Card.pzl'; `+tc.binding+` export default class Home extends Object {}</script>`)
			if !strings.Contains(got, "__l(this, this, 0,") {
				t.Fatalf("selector loop must keep persistent row caching:\n%s", got)
			}
			if volatile := strings.Contains(got, "volatile: true"); volatile != tc.volatile {
				t.Fatalf("volatile = %v, want %v:\n%s", volatile, tc.volatile, got)
			}
		})
	}
}

func TestComponentLoopKeyWinsOverSpreads(t *testing.T) {
	for _, tag := range []string{"Component is={Card}", "Card"} {
		for _, tc := range []struct{ name, body, key string }{
			{"lowered synthetic", `{#for row in rows}<` + tag + ` {...row.props} title={row.title}/>{/for}`, "s.k"},
			{"lowered explicit", `{#for row in rows}<` + tag + ` key={row.slug} {...row.props} title={row.title}/>{/for}`, "s.k"},
			{"map explicit", `{#for row in rows}<` + tag + ` key={prefix + row.slug} {...row.props} title={row.title}/>{/for}`, "__d.prefix + row?.slug"},
			{"range synthetic", `{#for 1...3, i}<` + tag + ` {...props} title={i}/>{/for}`, "i"},
			{"range explicit", `{#for 1...3, i}<` + tag + ` key={prefix + i} {...props} title={i}/>{/for}`, "__d.prefix + i"},
		} {
			t.Run(tag+"/"+tc.name, func(t *testing.T) {
				got := compileSrc(t, `<puzzle-view>`+tc.body+`</puzzle-view>
<script>import Card from './Card.pzl'; export default class Home extends Object {}</script>`)
				keyIndex := strings.LastIndex(got, "key: "+tc.key)
				spreadIndex := strings.LastIndex(got, "...(")
				titleIndex := strings.LastIndex(got, "title:")
				if spreadIndex < 0 || titleIndex < spreadIndex || keyIndex < titleIndex {
					t.Fatalf("row key must follow spreads without reordering other props:\n%s", got)
				}
			})
		}
	}
}

func TestComponentSelectorHygiene(t *testing.T) {
	source := `<puzzle-view>
<Component is={__d} title={capitalize('ready')}/>
<Component is={__f.cards[__f.prefix]}/>
{#for row in rows}<div>
  <Component is={s[row.type]}/>
  {#for child in row.children}<Component is={s1[child.type]}/>{/for}
  {#for s in row.localCards}<Component is={s['card']}/>{/for}
</div>{/for}
</puzzle-view>
<script>
import __d from './Card.pzl';
const __f = {prefix: 'card', cards: {card: __d}};
let s = {card: __d}, s1 = s;
const __pzlComponentSelector0 = 'authored';
export default class Home extends Object {}
</script>`
	got := compileSrc(t, source)
	for _, want := range []string{
		"const __pzlComponentSelector1 = () => __d;",
		"const __pzlComponentSelector2 = () => __f;",
		"const __pzlComponentSelector3 = () => s;",
		"const __pzlComponentSelector4 = () => s1;",
		"const __d = this.getData();", "const __f = this.ctx.formatters.getAll();",
		"__dc(__pzlComponentSelector1(),",
		"__dc(__pzlComponentSelector2()?.cards?.[__pzlComponentSelector2()?.prefix],",
		"__dc(__pzlComponentSelector3()?.[s.item?.type],",
		"__dc(__pzlComponentSelector4()?.[s1.item?.type],",
		"__dc(s1.item?.['card'],",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("selector hygiene missing %q:\n%s", want, got)
		}
	}
	if again := compileSrc(t, source); again != got {
		t.Fatal("selector getter emission is not deterministic")
	}
}

func TestComponentSelectorGettersAvoidAuthoredArrowBindings(t *testing.T) {
	got := compileSrc(t, `<puzzle-view><Component is={[null].map(__pzlComponentSelector0 => __d)[0]}/></puzzle-view>
<script>import __d from './Card.pzl'; export default class Home extends Object {}</script>`)
	for _, want := range []string{
		"const __pzlComponentSelector1 = () => __d;",
		"(__pzl__pzlComponentSelector0) => __pzlComponentSelector1()",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("selector getter captures authored arrow binding, missing %q:\n%s", want, got)
		}
	}
}

func TestComponentSlotRootAndLoopKey(t *testing.T) {
	for _, mode := range []EmissionMode{ModeView, ModeComponent} {
		source := `<puzzle-view><Component is={current}/></puzzle-view>`
		if mode == ModeView {
			source = `<puzzle-view>{#for row in rows}<Component is={row.component} {...row.props}/>{/for}</puzzle-view>`
		}
		sec, err := parser.SplitSections(source, "Root.pzl")
		if err != nil {
			t.Fatal(err)
		}
		result, err := Compile(sec, Options{Filename: "Root.pzl", Mode: mode})
		if err != nil {
			t.Fatal(err)
		}
		if mode == ModeComponent && !strings.Contains(result.JS, "return __dc(__d.current, {}, []);") {
			t.Fatal(result.JS)
		}
		if mode == ModeView && (!strings.Contains(result.JS, "__dc(s.item?.component") || !strings.Contains(result.JS, "key: s.k")) {
			t.Fatal(result.JS)
		}
	}
}

func TestComponentReservedUserNamesAndHelperNames(t *testing.T) {
	for _, tc := range []struct{ file, template, script, message string }{
		{"Component.pzl", `<div/>`, `export default class Component extends Object {}`, "rename Component.pzl"},
		{"Home.pzl", `<Component is={current}/>`, `import Component from './Card.pzl'; export default class Home extends Object {}`, "rename the user component or import"},
		{"Home.pzl", `<Component is={current}/>`, `const __dc = 1; export default class Home extends Object {}`, "dynamicComponent as __dc"},
		{"Home.pzl", `<Component name="card" from={cards}/>`, `export default class Home extends Object {}`, "requires is={value}"},
		{"Home.pzl", `<Component is={current} @close:once={close}/>`, `export default class Home extends Object {}`, "modifiers are not allowed"},
		{"Home.pzl", `<Component is={current} {...raw(props)}/>`, `export default class Home extends Object {}`, "not a spread prop"},
		{"Home.pzl", `<Component is={current} {...{a: 1}}/>`, `export default class Home extends Object {}`, objectLiteralMsg},
	} {
		sec, err := parser.SplitSections("<puzzle-view>"+tc.template+"</puzzle-view><script>"+tc.script+"</script>", tc.file)
		if err != nil {
			t.Fatal(err)
		}
		_, err = Compile(sec, Options{Filename: tc.file, Mode: ModeView})
		if err == nil || !strings.Contains(err.Error(), tc.message) {
			t.Errorf("%s error = %v, want %q", tc.template, err, tc.message)
		}
	}
}

func TestComponentNameAndFromAreOrdinaryProps(t *testing.T) {
	source := `<puzzle-view><Component is={Card} name={Card} from={source} @name={rename} @from={move}/></puzzle-view>
<script>import Card from './Card.pzl'; const source = {card: Card}; const __nc = 1; export default class Home extends Object {}</script>`
	got := compileSrc(t, source)
	for _, want := range []string{"__dc(Card, {", "name: __d.Card", "from: __d.source", "this.events.rename(event)", "this.events.move(event)", "const __nc = 1;"} {
		if !strings.Contains(got, want) {
			t.Errorf("ordinary name/from prop missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "namedComponent") {
		t.Fatal(got)
	}
}
