package codegen

import (
	"sort"
	"strconv"
	"strings"

	"github.com/magic-spells/puzzle/packages/puzzle-lang/parser"
)

// listblock.go — item-form {#for} lowering to a persistent list block
// (DECISION-D170-INCREMENTAL-VDOM-LISTS).
//
// Today an item-form loop compiles to `<coll>.map((todo) => <row>)`, so every
// parent render allocates and diffs N rows whether or not any row changed. It
// now compiles to a call into a per-site block that returns the same kind of
// array — cached row vnodes for rows whose inputs did not change:
//
//	import { ViewNode, listRows as __l } from '@magic-spells/puzzle';
//	const __L0 = { key: (todo) => ViewNode.keyOf(todo) };
//	…
//	__l(this, this, 0, __d.filteredTodos, (s) =>
//	  new ViewNode(TodoItem, { key: s.k, todo: s.item, … }, [])
//	, __L0)
//
// `listRows as __l` joins the injected import line only when the file lowers at
// least one site, the way `displayValue as __s` does — a loop-free module must
// not drag views/listBlock.js into the bundle. The call's first argument is
// always the VIEW (it owns the `__dirty` root mask and the dev counters); the
// second is the owner the block's rows hang off: `this` at depth 0, the
// enclosing row scope inside a row body.
//
// The block only decides WHICH vnode objects appear in that array; the array is
// spliced exactly where the `.map()` result was, so keyed reconciliation, mixed
// keyed/unkeyed pairing, leaving rows, FLIP and the shared sibling key
// namespace behave as they do today (D58 semantics unchanged).
//
// Everything the block needs to decide dirtiness is compile-time static and
// travels in the site meta const: the key function, whether the body reads the
// counter, whether it contains a controlled form value, which parent data roots
// it reads (a bitmask over the class's `__roots`), the item members it reads at
// depth one plus a `deep` flag for anything the record revision cannot cover,
// and `volatile` for a body that reads `this`. Defaults are omitted, so the
// common site is one short const.
//
// Two loops are deliberately NOT lowered:
//   - range loops, whose rows are cheap and keyed by value (D170, list blocks);
//   - loops inside a <Snippet> body, which is stamped fresh per expansion, so a
//     block keyed by site id would be shared between stamps (D170 emission contract).

// maxRootBits caps the file-level `__roots` array. The runtime tests the mask
// with a JS bitwise AND, which is 32-bit signed, so bit 31 is out of reach;
// a root past the cap makes its sites `volatile` (always dirty) instead of
// silently landing in the wrong bit.
const maxRootBits = 31

// rowKeyIdent is the sentinel binding forBody uses to put `key: s.k` on a
// lowered row root. The key attribute travels through the ordinary attribute
// emitter, which runs resolveExpr on it, so the row scope has to be reachable
// as an identifier — and binding the scope object's real name (`s`) would
// capture a data field of that name inside every loop body. The sentinel cannot
// collide with an authored identifier.
const rowKeyIdent = "__pzlRowKey"

// loopSite is one lowered {#for}: its identity in the emitted module plus the
// facts collected from its body while that body is emitted.
type loopSite struct {
	id    int    // `__L<id>` and the second argument of the __list call
	depth int    // 0 for a top-level loop, 1 for a loop inside a row, …
	scope string // the factory parameter: "s", "s1", "s2", …

	item    string // the loop variable name (for attributing item reads)
	counter string // the counter name, "" when the loop declares none

	keyArrow    string // the meta's `key:` function, always emitted
	counterRead bool   // the body reads the counter → `counter: true`
	ctrl        bool   // the body holds a controlled form value → `ctrl: true`
	rootBits    int    // bitmask over the file's `__roots` → `roots: <int>`
	fields      map[string]bool
	deep        bool
	volatile    bool

	handlerSites int // `s.h<n>` counter, per site
	cacheSites   int // `s.c[<n>]` counter, per site
}

// scopeName is the factory parameter at a given lowering depth: `s` at depth 0
// and `s1`, `s2`, … below it, so an inner row body can still reach an enclosing
// row's locals by name (D170 emission contract).
func scopeName(depth int) string {
	if depth == 0 {
		return "s"
	}
	return "s" + strconv.Itoa(depth)
}

// addRoot records that this site's body reads the parent data root at bit.
// A bit past the mask cap degrades to `volatile`.
func (s *loopSite) addRoot(bit int) {
	if bit < 0 {
		s.volatile = true
		return
	}
	s.rootBits |= 1 << uint(bit)
}

// rootBit assigns (or returns) the file-level `__roots` index for name. Indices
// are handed out in first-read order across the file, which is what makes a
// recompile of unchanged source byte-stable.
func (c *compiler) rootBit(name string) int {
	if i, ok := c.rootIndex[name]; ok {
		return i
	}
	if len(c.rootOrder) >= maxRootBits {
		return -1
	}
	if c.rootIndex == nil {
		c.rootIndex = map[string]int{}
	}
	i := len(c.rootOrder)
	c.rootOrder = append(c.rootOrder, name)
	c.rootIndex[name] = i
	return i
}

// factSink returns a fresh collector when expression facts are wanted, or nil.
// Nothing is collected outside a lowered loop body, and nothing is collected
// during a look-ahead pass (conditional arity, {#for} root extraction) — those
// re-resolve expressions in a scope that is NOT the one they will be emitted
// in, so a nested loop's locals would register as bogus parent data roots.
func (c *compiler) factSink() *exprFacts {
	if c.analyzing > 0 || len(c.loops) == 0 {
		return nil
	}
	return &exprFacts{}
}

// absorb distributes one expression's facts to every enclosing lowered loop.
// Roots, `this` and mutable-global reads reach all of them (the read happens
// inside every enclosing body). An item/counter read is attributed by matching
// the name's CURRENT resolution against the site's own rewrite, so a <Snippet>
// parameter or an inner range variable that shadows a row local is not mistaken
// for it.
//
// A read of a local owned by an ENCLOSING site makes the READING site volatile,
// and every site between it and the owner with it: a nested block only runs at
// all when its enclosing row runs, so "this body depends on something the outer
// row supplies" is exact, not an over-approximation. Without it an inner row
// whose own item did not change comes back cached while the outer row's item or
// counter changed underneath it. A middle site that cached its rows would never
// re-invoke the inner block, which is why the mark propagates the whole way up.
func (c *compiler) absorb(f *exprFacts, scope scopeMap) {
	if f == nil || len(c.loops) == 0 {
		return
	}
	for _, root := range f.roots {
		bit := c.rootBit(root)
		for _, site := range c.loops {
			site.addRoot(bit)
		}
	}
	if f.usesThis || f.volatileRead {
		for _, site := range c.loops {
			site.volatile = true
		}
	}
	for name, read := range f.locals {
		owner := siteIndexOwning(c.loops, scope, name)
		if owner < 0 {
			continue
		}
		site := c.loops[owner]
		if name == site.item {
			for _, field := range read.fields {
				site.fields[field] = true
			}
			if read.deep || read.bareInCall || read.opaque {
				site.deep = true
			}
		} else {
			site.counterRead = true
		}
		if read.renderRead {
			for i := owner + 1; i < len(c.loops); i++ {
				c.loops[i].volatile = true
			}
		}
	}
}

// siteOwning returns the lowered loop whose item or counter `name` currently
// resolves to, or nil when the binding is something else (a range variable, a
// snippet parameter, `ViewNode`, `event`).
func siteOwning(loops []*loopSite, scope scopeMap, name string) *loopSite {
	if i := siteIndexOwning(loops, scope, name); i >= 0 {
		return loops[i]
	}
	return nil
}

// siteIndexOwning is siteOwning by index, so a caller can tell an enclosing
// site's local from the innermost one's. -1 when nothing owns the name.
func siteIndexOwning(loops []*loopSite, scope scopeMap, name string) int {
	js, bound := scope[name]
	if !bound || js == "" {
		return -1
	}
	for i := len(loops) - 1; i >= 0; i-- {
		site := loops[i]
		if name == site.item && js == site.scope+".item" {
			return i
		}
		if site.counter != "" && name == site.counter && js == site.scope+".i" {
			return i
		}
	}
	return -1
}

// bareBinding binds an AUTHORED name that stays BARE in the emitted JS and
// returns the identifier to emit for it. Inside a lowered {#for} body the row
// scope objects are named `s`, `s1`, … , so an authored binding spelled the same
// way (a range counter, a non-lowered loop's item or counter, a <Snippet>
// parameter) would shadow the object the surrounding row reads its locals off
// — `{#for 1...2, s}` inside a row emits `.map((s) => … s.item.text …)`, a
// TypeError on the first iteration. The colliding binding is mangled to a
// `__`-prefixed identifier (authored names cannot start with `__`, and no
// emitted name is spelled this way) and its reads are rewritten through the
// scope map exactly as a loop local's are. The row scope names themselves never
// move: `s` is the byte contract in the todos fixtures.
func (c *compiler) bareBinding(scope scopeMap, name string) (scopeMap, string) {
	for _, site := range c.loops {
		if site.scope != name {
			continue
		}
		mangled := "__pzl" + name
		return scopeAddAs(scope, name, mangled), mangled
	}
	return scopeAdd(scope, name), name
}

// resolve is resolveExpr plus fact collection. Every template expression the
// emitter resolves goes through it, so a loop body's roots/fields/`this` reads
// are gathered by the SAME pass that rewrites them — handler arguments and
// interpolations inside template literals included (D170, compiler lowering).
func (c *compiler) resolve(expr string, scope scopeMap) string {
	f := c.factSink()
	out := resolveValueScan(expr, scope, f)
	c.absorb(f, scope)
	return out
}

// rowScope is the innermost lowered loop's scope object name, or "" when the
// emitter is not inside a row body (or is inside a <Snippet> body, which owns
// no cache).
func (c *compiler) rowScope() *loopSite {
	if c.snippetDepth > 0 || len(c.loops) == 0 {
		return nil
	}
	return c.loops[len(c.loops)-1]
}

// rowStableRefs reports whether every binding a handler's arguments captured
// belongs to a lowered loop. A range-loop variable or a snippet parameter is
// re-bound per iteration/expansion, so a closure over it must stay fresh even
// when a row scope is available to cache it on.
func (c *compiler) rowStableRefs(refs []string, scope scopeMap) bool {
	for _, name := range refs {
		if siteOwning(c.loops, scope, name) == nil {
			return false
		}
	}
	return true
}

// emitListCall emits the lowered item-form loop. The call replaces the `.map(…)`
// expression in place and keeps its surrounding layout: the body at ind+2 and
// the `, __L<id>)` closer at the call's own column (D170 emission contract).
func (c *compiler) emitListCall(f *parser.For, ind int, scope scopeMap, keyArrow string) (string, error) {
	depth := len(c.loops)
	owner := "this"
	if depth > 0 {
		owner = c.loops[depth-1].scope
	}
	name := scopeName(depth)

	site := &loopSite{
		id:       len(c.listSites),
		depth:    depth,
		scope:    name,
		item:     f.Item,
		counter:  f.Counter,
		keyArrow: keyArrow,
		ctrl:     forBodyHasControl(f.Body),
		fields:   map[string]bool{},
	}
	c.listSites = append(c.listSites, site)

	// The collection is resolved in the ENCLOSING scope, before the row locals
	// exist — and its roots belong to the enclosing sites, not to this one.
	coll := c.resolve(f.Collection, scope)

	bodyScope := scopeAddAs(scope, f.Item, name+".item")
	if f.Counter != "" {
		bodyScope = scopeAddAs(bodyScope, f.Counter, name+".i")
	}
	bodyScope = scopeAddAs(bodyScope, rowKeyIdent, name+".k")

	c.loops = append(c.loops, site)
	body, err := c.forBody(f, bodyScope, rowKeyIdent, ind+2, site)
	c.loops = c.loops[:len(c.loops)-1]
	if err != nil {
		return "", err
	}

	return "__l(this, " + owner + ", " + strconv.Itoa(site.id) + ", " + coll +
		", (" + name + ") =>\n" +
		sp(ind+2) + body + "\n" +
		sp(ind) + ", __L" + strconv.Itoa(site.id) + ")", nil
}

// listKeyArrow builds the site meta's `key:` function and reports whether the
// site can be lowered at all.
//
// The synthetic key is the D58 resolver, hoisted verbatim. An explicit
// `key={ … }` moves into the meta with the loop locals left BARE (they are the
// arrow's own parameters), which is only possible while the expression reads
// nothing that lives inside render(): the const sits at module scope, where
// `__d`, `__f` and `this` do not exist. A key that reads any of them keeps
// today's `.map(…)` emission for the whole site rather than emitting an arrow
// that throws on its first call.
func (c *compiler) listKeyArrow(f *parser.For, scope scopeMap) (arrow string, lowerable bool, err error) {
	root, explicitKey, err := c.forBodyRoot(f, scope)
	if err != nil {
		return "", false, err
	}
	if !explicitKey {
		return "(" + f.Item + ") => ViewNode.keyOf(" + f.Item + ")", true, nil
	}

	// The arrow's scope is its OWN parameters plus the module's ViewNode import
	// — deliberately NOT the enclosing render scope. A key reading anything else
	// (an enclosing row's local, a snippet parameter, a range variable) resolves
	// to `__d.<name>` here and bails out below, rather than emitting a
	// module-scope arrow that closes over a binding only render() has.
	keyScope := scopeMap{f.Item: "", "ViewNode": ""}
	if f.Counter != "" {
		keyScope[f.Counter] = ""
	}
	facts := &exprFacts{}
	var js string
	switch attr := findKeyAttr(attrsOf(root)).(type) {
	case *parser.StaticAttr:
		js = jsString(attr.Value)
		if attr.Valueless {
			js = "true"
		}
	case *parser.DynamicAttr:
		if startsWithObjectLiteral(attr.Expr) {
			return "", false, c.cgErr(attr.Pos, objectLiteralMsg)
		}
		// A chained key (`key={ id | slug }`) reads `__f`, which the `__f[`
		// check below turns into a `.map` site.
		js = c.resolveChain(attr.Expr, attr.Formatters, keyScope, facts)
	case *parser.MixedAttr:
		js = c.emitMixedFacts(attr.Parts, keyScope, facts)
	default:
		return "", false, nil
	}
	if len(facts.roots) > 0 || facts.usesThis || strings.Contains(js, "__f[") {
		return "", false, nil
	}
	params := f.Item
	if f.Counter != "" {
		if _, reads := facts.locals[f.Counter]; reads {
			params += ", " + f.Counter
		}
	}
	return "(" + params + ") => " + js, true, nil
}

// attrsOf returns the attribute list of a {#for} body root (element or
// component).
func attrsOf(n parser.Node) []parser.Attr {
	switch t := n.(type) {
	case *parser.Element:
		return t.Attrs
	case *parser.Component:
		return t.Props
	}
	return nil
}

// findKeyAttr returns the explicit `key` attribute hasKeyAttr detected, or nil.
func findKeyAttr(attrs []parser.Attr) parser.Attr {
	for _, a := range attrs {
		if isExplicitKeyAttr(a) {
			return a
		}
	}
	return nil
}

// dropKeyAttrs removes the explicit `key` attribute from a lowered row root:
// the author's expression became the site meta's key function, and the root
// carries the block's resolved `key: s.k` instead. Authored-literal `key`
// captured inside {#raw} or on a {#svg} root is left alone — it is markup, not
// the directive, and dropReservedLiteralAttrs already handles it.
func dropKeyAttrs(attrs []parser.Attr) []parser.Attr {
	out := make([]parser.Attr, 0, len(attrs))
	for _, a := range attrs {
		if isExplicitKeyAttr(a) {
			continue
		}
		out = append(out, a)
	}
	return out
}

// isExplicitKeyAttr reports whether a is the author's `key` directive (the same
// test hasKeyAttr applies, one attribute at a time).
func isExplicitKeyAttr(a parser.Attr) bool {
	switch at := a.(type) {
	case *parser.StaticAttr:
		return at.Name == "key" && !at.LiteralName
	case *parser.DynamicAttr:
		return at.Name == "key"
	case *parser.MixedAttr:
		return at.Name == "key"
	}
	return false
}

// forBodyHasControl reports whether a loop body contains a form control with a
// `value`/`checked` attribute, static or dynamic (`ctrl: true`). A cached row
// must still re-assert those against the live DOM on a clean pass, which the
// block does from a collected control list rather than by diffing (D170, list blocks).
func forBodyHasControl(nodes []parser.Node) bool {
	for _, n := range nodes {
		switch t := n.(type) {
		case *parser.Element:
			if elementIsControl(t) || forBodyHasControl(t.Children) {
				return true
			}
		case *parser.Component:
			if forBodyHasControl(t.Children) {
				return true
			}
		case *parser.Slot:
			if forBodyHasControl(t.Children) {
				return true
			}
		case *parser.Snippet:
			if forBodyHasControl(t.Body) {
				return true
			}
		case *parser.Portal:
			if forBodyHasControl(t.Children) {
				return true
			}
		case *parser.If:
			if forBodyHasControl(t.Then) || forBodyHasControl(t.Else) {
				return true
			}
		case *parser.For:
			if forBodyHasControl(t.Body) {
				return true
			}
		case *parser.Case:
			for _, cl := range t.Clauses {
				if forBodyHasControl(cl.Body) {
					return true
				}
			}
			if forBodyHasControl(t.Else) {
				return true
			}
		}
	}
	return false
}

// elementIsControl reports whether el is a form control carrying a
// `value`/`checked` attribute in any form.
func elementIsControl(el *parser.Element) bool {
	switch strings.ToLower(el.Tag) {
	case "input", "textarea", "select":
	default:
		return false
	}
	for _, a := range el.Attrs {
		name := ""
		switch at := a.(type) {
		case *parser.StaticAttr:
			name = at.Name
		case *parser.DynamicAttr:
			name = at.Name
		case *parser.MixedAttr:
			name = at.Name
		}
		if name == "value" || name == "checked" {
			return true
		}
	}
	return false
}

// emitListMetaConsts emits one `const __L<id> = {…};` per lowered site, in
// source order, for the block after the injected import line. Returns "" when
// the file has no lowered loop, so a loop-free module is byte-identical to
// pre-D170 output.
func (c *compiler) emitListMetaConsts() string {
	if len(c.listSites) == 0 {
		return ""
	}
	var b strings.Builder
	for _, site := range c.listSites {
		b.WriteString("const __L")
		b.WriteString(strconv.Itoa(site.id))
		b.WriteString(" = { key: ")
		b.WriteString(site.keyArrow)
		// Non-default fields only, in the fixed order of the D170 emission
		// contract; the runtime reads the rest with defaults (false, 0, []).
		if site.counterRead {
			b.WriteString(", counter: true")
		}
		if site.ctrl {
			b.WriteString(", ctrl: true")
		}
		if site.rootBits != 0 {
			b.WriteString(", roots: ")
			b.WriteString(strconv.Itoa(site.rootBits))
		}
		if len(site.fields) > 0 {
			names := make([]string, 0, len(site.fields))
			for name := range site.fields {
				names = append(names, name)
			}
			sort.Strings(names)
			b.WriteString(", fields: [")
			for i, name := range names {
				if i > 0 {
					b.WriteString(", ")
				}
				b.WriteString(jsString(name))
			}
			b.WriteString("]")
		}
		if site.deep {
			b.WriteString(", deep: true")
		}
		if site.volatile {
			b.WriteString(", volatile: true")
		}
		b.WriteString(" };\n")
	}
	return b.String()
}

// emitRootsStamp emits `Class.__roots = […];` — the file-level array a site's
// `roots` mask indexes into. Emitted only when some site carries a mask, so a
// view whose loops read no parent root pays nothing and PuzzleView skips the
// dirty-mask computation entirely (D170, root dirty mask).
func (c *compiler) emitRootsStamp(className string) string {
	if len(c.rootOrder) == 0 {
		return ""
	}
	used := false
	for _, site := range c.listSites {
		if site.rootBits != 0 {
			used = true
			break
		}
	}
	if !used {
		return ""
	}
	quoted := make([]string, len(c.rootOrder))
	for i, name := range c.rootOrder {
		quoted[i] = jsString(name)
	}
	return className + ".__roots = [" + strings.Join(quoted, ", ") + "];\n"
}

// listMetaNames returns the module-scope names this file emits for its list
// sites, so a <script> that binds one of them is a positioned compile error
// rather than an esbuild duplicate-declaration against an injected line.
func (c *compiler) listMetaNames() []string {
	out := make([]string, 0, len(c.listSites))
	for _, site := range c.listSites {
		out = append(out, "__L"+strconv.Itoa(site.id))
	}
	return out
}
