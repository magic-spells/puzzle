package codegen

import (
	"strconv"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// staticcache.go — build-once static subtrees (plan/Puzzle-Render-Upgrade.md
// §3.3/§4.3, D170).
//
// A static-heavy template rebuilds thousands of identical vnodes per render and
// produces zero DOM writes from them. A subtree whose every vnode is fully
// determined at compile time is therefore allocated ONCE per owner and returned
// by reference on later renders; the patcher's identity short-circuit skips it:
//
//	(this.__c[0] ??= new ViewNode('header', …))   // view level
//	(s.c[0] ??= new ViewNode('svg', …))           // inside a row body
//
// Static means: only static attributes (the framework-owned `ref`, `key`,
// `island` and `flip` included — they are per-instance stable) plus `@event`
// values the D62 rule already caches; literal text; static element children.
// Anything that can differ between renders makes the subtree dynamic:
// interpolation, a dynamic or mixed attribute, a non-cacheable handler, a
// component, a composition marker, a snippet, a portal, or control flow. A
// controlled form value is excluded rather than tracked — a cached subtree
// holding one would need the row block's re-assert machinery for no measured
// gain.
//
// Only the MAXIMAL qualifying subtree is wrapped (the emitter stops analysing
// once it is inside one), and only when it is worth the wrapper bytes: three or
// more vnodes, or an `island` element's children array at any size, since an
// island's children are frozen after mount and must never be allocated twice.
// Snippet bodies are excluded outright — they are stamped per expansion and own
// no cache.

// minCachedVnodes is the size threshold from plan §3.3: a lone static text or
// leaf element costs more in wrapper bytes than it saves in allocation.
const minCachedVnodes = 3

// staticCachePrefix returns the cache wrapper's opening text for an element
// that qualifies, allocating its site index. The empty string means "emit this
// element normally".
//
// The wrapper is a pure PREFIX on the subtree's first line with a single ')'
// suffix on its closing line; inner lines keep their indentation, and the
// prefix counts toward startCol in the attrsMultiline width decision, so the
// wrapped element wraps its attributes exactly as the fixture does (plan §4.3).
func (c *compiler) staticCachePrefix(n *parser.Element, scope scopeMap) string {
	if !c.cachingAllowed() {
		return ""
	}
	ok, count := c.staticSubtree(n, scope)
	if !ok || count < minCachedVnodes {
		return ""
	}
	return c.nextCacheSlot()
}

// cachingAllowed reports whether a cache wrapper may be emitted here at all:
// not inside an already-wrapped subtree (maximality) and not inside a snippet
// body (no owner to cache on).
func (c *compiler) cachingAllowed() bool {
	return c.staticCacheDepth == 0 && c.snippetDepth == 0
}

// nextCacheSlot allocates the next cache index on the current owner: the view
// instance at view level (one counter per file, shared by render() and
// renderSkeleton()) or the innermost row scope inside a lowered loop (one
// counter per site).
func (c *compiler) nextCacheSlot() string {
	if site := c.rowScope(); site != nil {
		slot := "(" + site.scope + ".c[" + strconv.Itoa(site.cacheSites) + "] ??= "
		site.cacheSites++
		return slot
	}
	slot := "(this.__c[" + strconv.Itoa(c.viewCacheSites) + "] ??= "
	c.viewCacheSites++
	return slot
}

// islandChildrenCache returns the wrapper for an `island` element's children
// array, or "". The element itself may be dynamic — its attrs and listeners
// still patch (D44) — but its children are frozen after mount, so the seed is
// allocated once at any size (plan §3.3).
func (c *compiler) islandChildrenCache(attrs []parser.Attr, children []parser.Node, isComponent bool, scope scopeMap) string {
	if isComponent || !c.cachingAllowed() || len(children) == 0 || !hasIslandAttr(attrs) {
		return ""
	}
	if ok, count := c.staticChildren(children, scope); !ok || count == 0 {
		return ""
	}
	return c.nextCacheSlot()
}

// hasIslandAttr reports the D44 `island` directive (an authored-literal
// `island` captured inside {#raw} is markup, not the directive).
func hasIslandAttr(attrs []parser.Attr) bool {
	for _, a := range attrs {
		if at, ok := a.(*parser.StaticAttr); ok && at.Name == "island" && !at.LiteralName {
			return true
		}
	}
	return false
}

// staticSubtree reports whether one node's whole subtree is cache-eligible and
// how many vnodes it occupies.
func (c *compiler) staticSubtree(n parser.Node, scope scopeMap) (bool, int) {
	el, ok := n.(*parser.Element)
	if !ok {
		// Components, markers, snippets, portals and control flow are dynamic by
		// construction; an unresolved {#svg} never reaches emission.
		return false, 0
	}
	if !c.staticElementAttrs(el, scope) {
		return false, 0
	}
	if el.RawInner != nil {
		// A resolved {#svg}: string children, set once via innerHTML and never
		// reconciled (D46/D44). One vnode, fully static.
		return true, 1
	}
	childOK, childCount := c.staticChildren(el.Children, scope)
	if !childOK {
		return false, 0
	}
	return true, 1 + childCount
}

// staticChildren reports whether every child of an element is cache-eligible
// and how many vnodes they occupy. Text runs coalesce exactly as they do at
// emission, so the count matches the emitted array.
func (c *compiler) staticChildren(children []parser.Node, scope scopeMap) (bool, int) {
	for _, ch := range children {
		if _, dynamic := ch.(*parser.Interpolation); dynamic {
			return false, 0
		}
	}
	// Coalescing is what decides how many text vnodes the array holds, so reuse
	// the emitter's own pass — under the analysis guard, since its output is
	// discarded here.
	c.analyzing++
	items, err := c.processChildren(children, scope)
	c.analyzing--
	if err != nil {
		return false, 0
	}
	count := 0
	for _, it := range items {
		if it.textOK {
			count++
			continue
		}
		ok, n := c.staticSubtree(it.node, scope)
		if !ok {
			return false, 0
		}
		count += n
	}
	return true, count
}

// staticElementAttrs reports whether an element's attributes are all stable
// across renders. A form control carrying `value`/`checked` is excluded
// outright: the runtime re-asserts those against the live DOM on every pass,
// which a by-reference subtree would skip.
func (c *compiler) staticElementAttrs(el *parser.Element, scope scopeMap) bool {
	if elementIsControl(el) {
		return false
	}
	for _, a := range el.Attrs {
		switch at := a.(type) {
		case *parser.StaticAttr:
			// Includes `ref`, `key`, `island` and `flip`: framework-owned, but
			// per-instance stable, so they survive caching (plan §3.3).
		case *parser.EventAttr:
			ev, err := compileEventValue(at.Expr, scope, nil)
			if err != nil || !ev.cacheable {
				return false
			}
		default:
			// Dynamic and mixed values change between renders.
			return false
		}
	}
	return true
}
