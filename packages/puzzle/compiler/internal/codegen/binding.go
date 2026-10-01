package codegen

import (
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/expr"
	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

type autoBind struct {
	event  string // "input" | "change"
	target string // "" for bare; else the RAW root segment (resolution happens at emit)
	field  string
	spec   string // "v" | "vn" | "c"
}

// classifyBindExpr reports whether an expression is exactly `ident` or
// `ident.ident` — a data field the edit can be written back to.
// bare==true  => field is the local key ("draft"), target is "".
// bare==false => target is the ROOT name (unresolved), field the member.
// A literal, a global, a call, an operator, a computed or optional step, or a
// deeper path never classifies. A bare root that is a template binding (a
// {#for} variable) never classifies; a binding's member does.
func classifyBindExpr(n expr.Node, scope scopeMap) (target, field string, bare, ok bool) {
	switch n := n.(type) {
	case *expr.Identifier:
		if _, bound := scope[n.Name]; bound || n.Name == "this" {
			return "", "", false, false
		}
		return "", n.Name, true, true
	case *expr.Member:
		root, isIdent := n.Object.(*expr.Identifier)
		if !isIdent || n.Computed || n.Optional || root.Name == "this" {
			return "", "", false, false
		}
		// `x.size` classifies like any field: on an object it IS the field
		// (`product.size`). A `.length` count is a field read too; binding one
		// is meaningless and is not special-cased.
		return root.Name, n.Property, false, true
	}
	return "", "", false, false
}

// detectAutoBind inspects the whole element (conditions are sibling-aware) and
// returns nil when nothing binds. Pure; safe to call from both the width trial
// and the real pass. Consumes no compiler state.
func detectAutoBind(tag string, attrs []parser.Attr, scope scopeMap) *autoBind {
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

	// EXACT match, not EqualFold: the runtime routes `value`/`checked` through the
	// property path via a case-SENSITIVE lookup (viewManager's PROPS set), so a
	// `VALUE={ x }` never becomes a property write — setAttribute lands it on the
	// content attribute (an input's defaultValue) instead. Synthesizing a bind for a
	// spelling the runtime will not treat as controlled desynced the DOM from state
	// the moment the field went dirty; matching exactly leaves that spelling the
	// plain one-way attribute it was before D147.
	for _, a := range attrs {
		at, ok := a.(*parser.DynamicAttr)
		if !ok || at.Name != attrName {
			continue
		}
		target, field, _, ok := classifyBindExpr(at.ExprAST, scope)
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
func autoBindKV(bind *autoBind, scope scopeMap) string {
	target := "null"
	if bind.target != "" {
		target = "__d." + bind.target
		if local, ok := scopeRef(scope, bind.target); ok {
			// A {#for} local resolves through its scope map entry, so a row
			// inside a lowered list block binds `s.item` (D170 emission contract).
			target = local
		}
		// A member-path bind whose root is missing must stay inert, not fall into
		// __bind's `target == null` branch, which belongs to the bare-local form
		// and would write the field as a stray top-level local. Coalescing to a
		// primitive routes it to INERT_BIND — the same one-way display a
		// primitive-rooted path gets — and the guarded value read (D173 V4) shows
		// nothing. The next render with a real root binds normally.
		target += " ?? 0"
	}
	return jsKey("@"+bind.event+":bind") + ": this.__bind(" +
		target + ", " + jsString(bind.field) + ", " + jsString(bind.spec) + ")"
}
