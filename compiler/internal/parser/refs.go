package parser

// refs.go — compile-time validation for the `ref` directive (v1.39, D72). See
// [[DOC-SPEC]] §38 and [[DECISION-D72-ELEMENT-REFS]].
//
// A static `ref="name"` on a PLAIN element links that element's DOM node to
// `this.refs.name` on the owning PuzzleView. Like `key` and `island`, `ref` is
// framework-owned: it never reaches the DOM. Codegen turns a valid ref into a
// `ref: this.__ref("name")` vnode-attr property (the runtime supplies __ref);
// the parser's job is to reject every shape the runtime cannot honor, as
// positioned errors in the D38/D44 fail-fast style:
//
//   1. ref={ expr } / ref="a{ x }" — dynamic or interpolated: ref names a
//      static compile-time slot, not a runtime expression.
//   2. bare `ref` / ref="" — a name is required (it becomes this.refs.<name>).
//   3. ref="my-chart" / ref="a.b" — the name must be a bare JS identifier (the
//      same isBareIdent rule as the {#for} counter), since it becomes a
//      property access this.refs.<name>.
//   4. ref on a Component tag — a ref wires a DOM node, not a child instance;
//      the @ready callback-prop idiom is how a parent reaches into a child.
//   5. ref on a <slot>/<Slot> — a slot is a render target, not a real element.
//   6. ref anywhere inside a {#for} body — per-iteration array refs are deferred
//      (v1); key the data instead.
//   7. ref anywhere inside a <puzzle-skeleton> body — skeleton nodes are
//      destroyed at the real-template swap, so a ref there would dangle.
//   8. duplicate ref name within one template body — two nodes claiming
//      this.refs.<name> would clobber each other.
//   9. ref on the <puzzle-view> root — the root is already this.element.
//
// The check runs as a post-pass over the built AST (like validateIslands /
// validateSlots) so ref errors surface alongside the other parse errors. Each
// template body (the <puzzle-view> template and its <puzzle-skeleton>) is
// validated separately, so a name may appear once in each; a skeleton body,
// however, admits NO refs at all.

// validateRefs walks a parsed template/skeleton root and returns the first
// ref-directive violation (nil when clean).
func validateRefs(root *Element, file string) *ParseError {
	for _, a := range root.Attrs {
		if attrNameOf(a) == "ref" {
			return errAt(file, attrPos(a), "the <puzzle-view> root cannot carry a ref — the view root is already available as this.element")
		}
	}
	inSkeleton := root.Tag == "puzzle-skeleton"
	return walkRefs(root.Children, file, map[string]Position{}, false, inSkeleton)
}

// walkRefs descends the node list validating ref usage. inFor is true inside a
// {#for} body (at any depth); inSkeleton is true throughout a <puzzle-skeleton>
// body. seen accumulates the valid ref names claimed so far in this body, so a
// second claim on the same name is a positioned duplicate error.
func walkRefs(nodes []Node, file string, seen map[string]Position, inFor, inSkeleton bool) *ParseError {
	for _, n := range nodes {
		switch node := n.(type) {
		case *Element:
			if ref := findRefAttr(node.Attrs); ref != nil {
				if perr := checkElementRef(ref, seen, inFor, inSkeleton, file); perr != nil {
					return perr
				}
			}
			if perr := walkRefs(node.Children, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
		case *Component:
			if ref := findRefAttr(node.Props); ref != nil {
				return errAt(file, attrPos(ref), "ref cannot be placed on the component <%s> — a ref wires a DOM node, not a child instance; use an @ready callback prop to reach into a child component", node.Name)
			}
			if perr := walkRefs(node.Children, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
		case *Slot:
			// A marker's own attributes are validated in parseElement
			// (childrenMarkerAttrs/slotOutletAttrs/namedSlotFromAttrs — each rejects
			// a ref with a ref-specific message); only a <children>'s or named
			// slot's fallback children reach here, and they are ordinary nodes.
			if perr := walkRefs(node.Children, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
		case *If:
			if perr := walkRefs(node.Then, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
			if perr := walkRefs(node.Else, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
		case *For:
			if perr := walkRefs(node.Body, file, seen, true, inSkeleton); perr != nil {
				return perr
			}
		case *Case:
			for _, cl := range node.Clauses {
				if perr := walkRefs(cl.Body, file, seen, inFor, inSkeleton); perr != nil {
					return perr
				}
			}
			if perr := walkRefs(node.Else, file, seen, inFor, inSkeleton); perr != nil {
				return perr
			}
		}
	}
	return nil
}

// checkElementRef validates a `ref` attribute found on a plain element. Context
// gates (skeleton, then {#for}) fire before the value-shape checks: the feature
// is deferred wholesale in those positions, so the shape of the name is moot.
func checkElementRef(ref Attr, seen map[string]Position, inFor, inSkeleton bool, file string) *ParseError {
	pos := attrPos(ref)
	if inSkeleton {
		return errAt(file, pos, "ref is not allowed inside a <puzzle-skeleton> — skeleton nodes are destroyed at the real-template swap, so the ref would dangle")
	}
	if inFor {
		return errAt(file, pos, "ref is not allowed inside a {#for} block — per-iteration refs are not supported; key the looped data and query it instead")
	}
	switch at := ref.(type) {
	case *DynamicAttr:
		return errAt(file, pos, `ref must be a static string name, not ref={ ... } — write ref="name"`)
	case *MixedAttr:
		return errAt(file, pos, `ref must be a static string name, not an interpolated value — write ref="name"`)
	case *StaticAttr:
		if at.Valueless {
			return errAt(file, pos, `ref requires a name — write ref="name"`)
		}
		if at.Value == "" {
			return errAt(file, pos, `ref cannot be empty — write ref="name"`)
		}
		if !isBareIdent(at.Value) {
			return errAt(file, pos, "ref name %q must be a valid identifier — it becomes this.refs.<name>", at.Value)
		}
		if prev, dup := seen[at.Value]; dup {
			return errAt(file, pos, "duplicate ref name %q — already declared at %d:%d", at.Value, prev.Line, prev.Col)
		}
		seen[at.Value] = pos
	}
	return nil
}

// findRefAttr returns the first `ref` attribute among attrs (any kind), or nil.
func findRefAttr(attrs []Attr) Attr {
	for _, a := range attrs {
		if attrNameOf(a) == "ref" {
			return a
		}
	}
	return nil
}
