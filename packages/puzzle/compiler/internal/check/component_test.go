package check

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestComponentInvalidSelectorAndFlipArePositionedCheckErrors(t *testing.T) {
	for _, selector := range []string{`"Card"`, `'Card'`, "5", "-5", "true", "false", "`Card`", "`Card${kind}`"} {
		t.Run(selector, func(t *testing.T) {
			source := []byte("<puzzle-view>\n  <Component is={" + selector + "}/>\n</puzzle-view>")
			_, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
			if err == nil || !strings.Contains(err.Error(), "app/views/Home.pzl:2:14: <Component is> requires a component value expression") {
				t.Fatalf("selector check error = %v, want positioned literal rejection", err)
			}
		})
	}
	_, err := emitFiles([]byte("<puzzle-view>\n  <Component is={Card} flip/>\n</puzzle-view>"), "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err == nil || !strings.Contains(err.Error(), "app/views/Home.pzl:2:24: flip is not supported on <Component>") {
		t.Fatalf("flip check error = %v, want positioned unsupported-attribute rejection", err)
	}
}

func TestComponentSelectorAndSpreadExpressionsAreChecked(t *testing.T) {
	for _, language := range []string{"js", "ts"} {
		t.Run(language, func(t *testing.T) {
			source := `<puzzle-view>
  <Component is={Card} title={Card} {...extra}/>
  <Component is={embeds[prefix + kind]} name={prefix + kind} from={embeds} {...embed.props}>
    <Component is={current}/>
  </Component>
  <Component is={Card} name="card-{prefix}" from={origin}/>
  {#for embeds in rows}<Component is={embeds['card']}/>{/for}
</puzzle-view>
<script lang="` + language + `">
import { PuzzleView } from '@magic-spells/puzzle';
import Card from './Card.pzl';
const embeds = { card: Card };
const prefix = 'card-';
const origin = 'module-only-prop';
export default class Home extends PuzzleView {}
</script>`
			files, err := emitFiles([]byte(source), "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
			if err != nil {
				t.Fatal(err)
			}
			got := string(virtualFileWithExtension(t, files, ".ts").Contents)
			for _, want := range []string{"void (Card);", "void (__d.Card);", "void (__d.extra);", "void (__d.embed.props);", "void (embeds[prefix + __d.kind]);", "void (__d.prefix + __d.kind);", "void (__d.embeds);", "void (__d.current);", "void (__d.prefix);", "void (__d.origin);", "void (embeds['card']);"} {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q:\n%s", want, got)
				}
			}
			if language == "js" {
				mirror := string(virtualFileWithExtension(t, files, ".js").Contents)
				for _, name := range []string{"Card", "embeds", "prefix"} {
					if !strings.Contains(mirror, "export { "+name+" as __puzzle_component_selector_") {
						t.Errorf("missing mirror export for %s:\n%s", name, mirror)
					}
				}
				if !strings.Contains(got, " as embeds } from \"./Home.pzl.script.js\";") {
					t.Fatal(got)
				}
				if strings.Contains(mirror, "export { origin as") {
					t.Fatal("ordinary from prop received module-selector visibility:\n" + mirror)
				}
			}
		})
	}
}

func TestLiveTSCComponentSelectorsUseModuleValues(t *testing.T) {
	for _, language := range []string{"js", "ts"} {
		t.Run(language, func(t *testing.T) {
			root := liveTSCApp(t)
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			cardKey := "/** @type {'card'} */ ('card')"
			if language == "ts" {
				cardKey = "'card' as const"
			}
			source := `<puzzle-view>
<Component is={Card} title={title} {...extra}/>
<Component is={embeds[kind]}/>
</puzzle-view>
<script lang="` + language + `">
import { PuzzleView } from '@magic-spells/puzzle';
import Card from './Card.pzl';
const embeds = {card: Card};
export default class Home extends PuzzleView {
  title = 'hello';
  extra = {tone:'quiet'};
  kind = ` + cardKey + `;
}
</script>`
			writeLiveView(t, root, source)
			if _, err := Run(root); err != nil {
				t.Fatalf("valid selectors must check clean: %v", err)
			}
			bad := strings.Replace(source, "is={embeds[kind]}", "is={embeds.missing}", 1)
			writeLiveView(t, root, bad)
			_, err := Run(root)
			line, col := pzlPosition(t, bad, "missing")
			want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'missing' does not exist", line, col)
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("selector diagnostic = %v, want %q", err, want)
			}
		})
	}
}

func TestLiveTSCComponentSpreadPositionsAnError(t *testing.T) {
	root := liveTSCApp(t)
	source := `<puzzle-view><Component is={current} {...value.missing}/></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { value = 1; current = null; }
</script>`
	writeLiveView(t, root, source)
	_, err := Run(root)
	line, col := pzlPosition(t, source, "missing")
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'missing' does not exist on type 'number'.", line, col)
	if err == nil || err.Error() != want {
		t.Fatalf("spread diagnostic = %v, want %q", err, want)
	}
}

func TestLiveTSCComponentSelectorHygiene(t *testing.T) {
	for _, language := range []string{"js", "ts"} {
		t.Run(language, func(t *testing.T) {
			root := liveTSCApp(t)
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			cardKey := "/** @type {'card'} */ ('card')"
			if language == "ts" {
				cardKey = "'card' as const"
			}
			source := `<puzzle-view>
<Component is={__d}/>
<Component is={__f.cards[__f.prefix]}/>
{#for row in rows}<Component is={s[row.type]}/>{/for}
{#for s in rows}<Component is={s.cards[s.type]}/>{/for}
</puzzle-view>
<script lang="` + language + `">
import { PuzzleView } from '@magic-spells/puzzle';
import __d from './Card.pzl';
const __f = {prefix: ` + cardKey + `, cards: {card: __d}};
const s = {card: __d};
const __pzlComponentSelector0 = 'authored';
export default class Home extends PuzzleView {
  rows = [{type: ` + cardKey + `, cards: s}];
}
</script>`
			writeLiveView(t, root, source)
			if _, err := Run(root); err != nil {
				t.Fatalf("colliding module selectors must check clean: %v", err)
			}
			bad := strings.Replace(source, "is={__f.cards[__f.prefix]}", "is={__f.missing}", 1)
			writeLiveView(t, root, bad)
			_, err := Run(root)
			line, col := pzlPosition(t, bad, "missing")
			want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'missing' does not exist", line, col)
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("getter selector diagnostic = %v, want %q", err, want)
			}
		})
	}
}
