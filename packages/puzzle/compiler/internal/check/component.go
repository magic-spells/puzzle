package check

import (
	"fmt"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/codegen"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

type selectorBinding struct {
	name, alias string
}

// The JS mirror keeps the authored script bytes, then exposes only the module
// values selectors need under fresh export aliases. The TS wrapper imports
// them by their original names; props retain their ordinary view/data scope.
func selectorAliases(scripts string, names []string) []selectorBinding {
	bindings := make([]selectorBinding, 0, len(names))
	next := 0
	for _, name := range names {
		var alias string
		for {
			alias = fmt.Sprintf("__puzzle_component_selector_%d", next)
			next++
			if !strings.Contains(scripts, alias) {
				break
			}
		}
		bindings = append(bindings, selectorBinding{name: name, alias: alias})
	}
	return bindings
}

func componentSelectorGetters(scripts string, names []string) []selectorBinding {
	getters := []selectorBinding{}
	next := 0
	for _, name := range names {
		if !strings.HasPrefix(name, "__") {
			continue
		}
		var alias string
		for {
			alias = fmt.Sprintf("__pzlComponentSelector%d", next)
			next++
			if !strings.Contains(scripts, alias) {
				break
			}
		}
		getters = append(getters, selectorBinding{name: name, alias: alias})
	}
	return getters
}

func (e *emitter) emitComponentSelector(attr *parser.DynamicAttr, scope map[string]bool, indent int) {
	e.emitSelectorVoid(attr.ExprAST, scope, indent)
}

func (e *emitter) emitSelectorVoid(node expr.Node, scope map[string]bool, indent int) {
	e.b.WriteString(spaces(indent) + "void (")
	codegen.WriteCheckSelectorValue(e.b, node, scope, e.componentSelectors)
	e.b.WriteString(");\n")
}
