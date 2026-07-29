package codegen

import (
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

type autoBind struct {
	event  string // "input" | "change"
	target string // "" for bare; else the RAW root segment (resolution happens at emit)
	field  string
	spec   string // "v" | "vn" | "c"
}

// classifyBindExpr reports whether raw is exactly `ident` or `ident.ident`.
// bare==true  => field is the local key ("draft"), target is "".
// bare==false => target is the ROOT segment (unresolved), field the second.
// Roots in jsKeywords/jsGlobals never classify. A bare root present in scope
// (a {#for} variable) never classifies. A scoped root of a member path does.
func classifyBindExpr(raw string, scope map[string]bool) (target, field string, bare, ok bool) {
	parts := strings.Split(strings.TrimSpace(raw), ".")
	if len(parts) < 1 || len(parts) > 2 {
		return "", "", false, false
	}

	root := parts[0]
	if !isJSIdentifier(root) || jsKeywords[root] || jsGlobals[root] {
		return "", "", false, false
	}
	// `event` is the reserved handler identifier (evScope); unless a scope
	// explicitly names it, a path rooted on it is never a bindable data path.
	if root == "event" && !scope[root] {
		return "", "", false, false
	}

	if len(parts) == 1 {
		if scope[root] {
			return "", "", false, false
		}
		return "", root, true, true
	}

	if !isJSIdentifier(parts[1]) {
		return "", "", false, false
	}
	return root, parts[1], false, true
}

// detectAutoBind inspects the whole element (conditions are sibling-aware) and
// returns nil when nothing binds. Pure; safe to call from both the width trial
// and the real pass. Consumes no compiler state.
func detectAutoBind(tag string, attrs []parser.Attr, scope map[string]bool) *autoBind {
	tag = strings.ToLower(tag)
	if tag != "input" && tag != "textarea" && tag != "select" {
		return nil
	}

	inputType := ""
	hasInputType := false
	for _, a := range attrs {
		switch at := a.(type) {
		case *parser.EventAttr:
			base := at.Name
			if i := strings.IndexByte(base, ':'); i >= 0 {
				base = base[:i]
			}
			if base == "input" || base == "change" {
				return nil
			}
		case *parser.StaticAttr:
			name := strings.ToLower(at.Name)
			if name == "readonly" || name == "disabled" {
				return nil
			}
			if tag == "select" && name == "multiple" {
				return nil
			}
			if tag == "input" && name == "type" {
				if at.Valueless {
					return nil
				}
				inputType = strings.ToLower(at.Value)
				hasInputType = true
			}
		case *parser.DynamicAttr:
			name := strings.ToLower(at.Name)
			if tag == "input" && name == "type" {
				return nil
			}
			if tag == "select" && name == "multiple" {
				return nil
			}
		case *parser.MixedAttr:
			name := strings.ToLower(at.Name)
			if tag == "input" && name == "type" {
				return nil
			}
			if tag == "select" && name == "multiple" {
				return nil
			}
		}
	}

	attrName, event, spec := "", "", ""
	switch tag {
	case "textarea":
		attrName, event, spec = "value", "input", "v"
	case "select":
		attrName, event, spec = "value", "change", "v"
	case "input":
		if !hasInputType {
			attrName, event, spec = "value", "input", "v"
			break
		}
		switch inputType {
		case "text", "search", "email", "password", "url", "tel", "color":
			attrName, event, spec = "value", "input", "v"
		case "number":
			attrName, event, spec = "value", "change", "vn"
		case "range":
			attrName, event, spec = "value", "input", "vn"
		case "checkbox":
			attrName, event, spec = "checked", "change", "c"
		case "date", "time", "month", "week", "datetime-local":
			attrName, event, spec = "value", "change", "v"
		default:
			return nil
		}
	}

	for _, a := range attrs {
		at, ok := a.(*parser.DynamicAttr)
		if !ok || !strings.EqualFold(at.Name, attrName) {
			continue
		}
		target, field, _, ok := classifyBindExpr(at.Expr, scope)
		if !ok {
			return nil
		}
		return &autoBind{event: event, target: target, field: field, spec: spec}
	}
	return nil
}

// autoBindKV emits the synthesized listener without touching compiler state.
// Member roots resolve exactly like template expressions: loop bindings stay
// bare, while data roots read through __d.
func autoBindKV(bind *autoBind, scope map[string]bool) string {
	target := "null"
	if bind.target != "" {
		target = "__d." + bind.target
		if scope[bind.target] {
			target = bind.target
		}
	}
	return jsKey("@"+bind.event+":bind") + ": this.__bind(" +
		target + ", " + jsString(bind.field) + ", " + jsString(bind.spec) + ")"
}
