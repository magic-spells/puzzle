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
			// A selector is untyped like any template data, so its module names
			// read through __d in the check; a loop binding still shadows them.
			for _, want := range []string{"void (__d.Card);", "void (__d.extra);", "void (__d.embed.props);", "void (__d.embeds[__d.prefix + __d.kind]);", "void (__d.prefix + __d.kind);", "void (__d.embeds);", "void (__d.current);", "void (__d.prefix);", "void (__d.origin);", "void (embeds['card']);"} {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q:\n%s", want, got)
				}
			}
		})
	}
}

// The documented D180 example checks clean under strict in both languages: a
// selector's map lookup is untyped like any template data, so
// cards[embed.type] is not TS7053.
func TestLiveTSCDocumentedComponentSelectorChecksClean(t *testing.T) {
	for _, language := range []string{"js", "ts"} {
		t.Run(language, func(t *testing.T) {
			root := liveTSCApp(t)
			if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
				t.Fatal(err)
			}
			writeLiveView(t, root, `<puzzle-view>
  <div>
    <Component is={ current } title={ title } @close={ close }>
      <p>Default content for the selected card</p>
    </Component>

    <Component is={ cards[embed.type] } {...embed.props}/>
  </div>
</puzzle-view>

<script lang="`+language+`">
import { PuzzleView } from '@magic-spells/puzzle';
import TaskCard from './TaskCard.pzl';
import BacktestCard from './BacktestCard.pzl';
const cards = { task: TaskCard, backtest: BacktestCard };

export default class EmbedHost extends PuzzleView {
  events = { close: () => {} };
}
</script>`)
			if _, err := Run(root); err != nil {
				t.Fatalf("the documented selector must check clean: %v", err)
			}
		})
	}
}

func TestLiveTSCComponentSpreadPositionsAnError(t *testing.T) {
	root := liveTSCApp(t)
	source := `<puzzle-view><Component is={current} {...round(value).missing}/></puzzle-view>
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
