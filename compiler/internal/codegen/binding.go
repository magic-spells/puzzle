package codegen

import "strings"

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
