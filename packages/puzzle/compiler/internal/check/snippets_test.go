package check

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// pzlPosition returns the 1-based line and column of needle in a .pzl source,
// computed from the source itself so the expectation is independent of the
// segment table being asserted.
func pzlPosition(t *testing.T, source, needle string) (int, int) {
	t.Helper()
	at := strings.Index(source, needle)
	if at < 0 {
		t.Fatalf("%q is not in the test source", needle)
	}
	line := 1 + strings.Count(source[:at], "\n")
	col := at - (strings.LastIndex(source[:at], "\n") + 1) + 1
	return line, col
}

// D166 marker arguments are real expressions: codegen emits them into the
// marker vnode's args object and the runtime evaluates them at every render.
// The node walk stepped straight to a marker's fallback children, so nothing
// inside `<Slot name="x" total={ … }>` or `<Children item={ … }>` was checked.
func TestMarkerArgumentExpressionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view>
  <div>
    <header>
      <Slot name="heading" total={ members.length }>Team</Slot>
    </header>
    {#for member in members, index}
      <li key={ member.id }>
        <Children member={ member } position={ index }>{ member.name }</Children>
      </li>
    {/for}
  </div>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Roster extends PuzzleView {}
</script>
`)
	files, err := emitFiles(source, "app/components/Roster.pzl", ".puzzle/check/src/components/Roster.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	got := string(files[0].Contents)
	for _, want := range []string{
		"void (__d.members.length);", // <Slot name="…"> argument
		"void (member);",             // <Children> argument, the loop binding
		"void (index);",              // <Children> argument, the loop counter
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated wrapper is missing %q:\n%s", want, got)
		}
	}
}

// A <Snippet> body is compiled and executed like any other template body, with
// its declared parameters shadowing the caller's data and every other name
// still resolving against the caller's view instance.
func TestSnippetBodyExpressionsAreChecked(t *testing.T) {
	source := []byte(`<puzzle-view>
  <Roster members={ team }>
    <Snippet member index>
      <span>{ index + 1 }</span>
      <span>{ member.name }</span>
      <span>{ caption }</span>
    </Snippet>
  </Roster>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import Roster from '../components/Roster.pzl';
export default class Home extends PuzzleView {}
</script>
`)
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	got := string(files[0].Contents)
	for _, want := range []string{
		"void (index + 1);",   // a parameter read stays a bare identifier
		"void (member.name);", // …including through a member access
		"void (__d.caption);", // the caller scope is still visible in the body
	} {
		if !strings.Contains(got, want) {
			t.Errorf("generated wrapper is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "__d.member") || strings.Contains(got, "__d.index") {
		t.Errorf("snippet parameters must shadow caller data, not resolve through __d:\n%s", got)
	}
}

// A parameter shadows a caller field of the same name, exactly as codegen
// scopes it — otherwise the check would type the body against the wrong value.
func TestSnippetParameterShadowsCallerData(t *testing.T) {
	source := []byte(`<puzzle-view>
  <Roster>
    <Snippet caption>
      <span>{ caption }</span>
    </Snippet>
  </Roster>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import Roster from '../components/Roster.pzl';
export default class Home extends PuzzleView { caption = 1; }
</script>
`)
	files, err := emitFiles(source, "app/views/Home.pzl", ".puzzle/check/src/views/Home.pzl", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := string(files[0].Contents); !strings.Contains(got, "void (caption);") || strings.Contains(got, "void (__d.caption);") {
		t.Errorf("snippet parameter did not shadow the caller field:\n%s", got)
	}
}

// `void` binds tighter than every binary operator, so an unparenthesized
// `void a + 1` checked `undefined + 1` — inventing "Object is possibly
// 'undefined'" on a correct template under strictNullChecks, and checking
// nothing about the expression the user actually wrote.
func TestInterpolationIsCheckedAsAWholeExpression(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	writeLiveView(t, root, `<puzzle-view><p>{ count + 1 }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { count = 1; }
</script>
`)
	if _, err := Run(root); err != nil {
		t.Fatalf("a binary-operator interpolation must check clean under strict: %v", err)
	}

	// …and the added parentheses must not disturb the remap of a real error.
	bad := `<puzzle-view><p>{ count.toUpperCase() + 1 }</p></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { count = 1; }
</script>
`
	writeLiveView(t, root, bad)
	line, col := pzlPosition(t, bad, "toUpperCase")
	_, err := Run(root)
	if err == nil {
		t.Fatal("expected a type error inside the interpolation")
	}
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'toUpperCase' does not exist on type 'number'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("interpolation diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}

// The live-tsc leg: a bad marker argument must reach the user as a diagnostic
// positioned on the .pzl expression, not on the generated wrapper.
func TestLiveTSCPositionsAMarkerArgumentError(t *testing.T) {
	root := liveTSCApp(t)
	source := `<puzzle-view><Slot name="heading" total={ value.toUpperCase() }>Team</Slot></puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView { value = 123; }
</script>
`
	writeLiveView(t, root, source)

	_, err := Run(root)
	if err == nil {
		t.Fatal("expected a type error for the marker argument expression")
	}
	line, col := pzlPosition(t, source, "toUpperCase")
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'toUpperCase' does not exist on type 'number'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("marker-argument diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}

// The same for an expression inside a <Snippet> body.
func TestLiveTSCPositionsASnippetBodyError(t *testing.T) {
	root := liveTSCApp(t)
	source := `<puzzle-view>
  <Roster>
    <Snippet member>
      <span>{ member.name }</span>
      <span>{ value.toUpperCase() }</span>
    </Snippet>
  </Roster>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import Roster from '../components/Roster.pzl';
export default class Home extends PuzzleView { value = 123; }
</script>
`
	writeLiveView(t, root, source)

	_, err := Run(root)
	if err == nil {
		t.Fatal("expected a type error for the snippet body expression")
	}
	line, col := pzlPosition(t, source, "toUpperCase")
	want := fmt.Sprintf("app/views/Home.pzl:%d:%d: Property 'toUpperCase' does not exist on type 'number'.", line, col)
	if got := err.Error(); got != want {
		t.Fatalf("snippet-body diagnostic mismatch\nwant: %s\ngot:  %s", want, got)
	}
}

// The false-positive guard: parameters are declared bindings and captured
// caller names still resolve, so a correct roster checks clean — under a strict
// app tsconfig, where an undeclared or implicitly-any parameter would report.
func TestLiveTSCAcceptsSnippetParamsAndCapturedNames(t *testing.T) {
	root := liveTSCApp(t)
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), []byte(`{"compilerOptions":{"strict":true}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	source := `<puzzle-view>
  <Roster members={ team }>
    <Snippet fits="heading" total>
      <span>{ total } members of { caption }</span>
    </Snippet>
    <Snippet member index>
      <span>{ index + 1 }</span>
      <span>{ member.name } of { caption }</span>
    </Snippet>
  </Roster>
</puzzle-view>
<script lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';
import Roster from '../components/Roster.pzl';
export default class Home extends PuzzleView {
  caption = 'the roster';
  team = [{ id: 1, name: 'Ada' }];
}
</script>
`
	writeLiveView(t, root, source)

	if _, err := Run(root); err != nil {
		t.Fatalf("snippet parameters and captured caller data must check clean:\n%v", err)
	}
}
