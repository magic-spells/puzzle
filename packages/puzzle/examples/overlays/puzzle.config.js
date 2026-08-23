// Plain SPA output. Portals serialize to nothing under the prerenderers
// (D144), so an overlay showcase has nothing to gain from `hybrid`/`static` —
// every panel here appears at takeover anyway.
export default {};
