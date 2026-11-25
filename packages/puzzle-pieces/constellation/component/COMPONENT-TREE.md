---
name: Tree
status: verified
framework: puzzle
props:
  - name: nodes
    type: array
    required: true
  - name: value
    type: string
  - name: expanded
    type: string[]
slots:
  - name: node
    accepts:
      - node
      - depth
      - expanded
      - selected
code_refs:
  - registry/ui/tree/Tree.pzl
  - registry/ui/tree/piece.json
connections:
  - DOC-REGISTRY
  - DECISION-CONFIG-FIRST-API
verified_at: '2026-11-25T20:18:49.983Z'
verified_sha: 90b1721ee44900bf72257e0b2cee7bbf6159ecb6
---

# Tree

Config-first WAI-ARIA tree over nested node data. The component flattens the currently visible hierarchy into one keyed row loop so roving focus, selection, expansion, and sibling metadata share a single ordered model.

The `node` snippet customizes only the label region. Its one marker declaration sits in the visible-row loop and hands over the raw `node`, zero-based `depth`, `expanded`, and `selected`; the current truncated text label is the fallback when no matching snippet is supplied. The piece continues to own the row element, disclosure affordance, indentation, ARIA tree metadata, selection state, and all pointer/keyboard behavior.

Because rendering is flattened in this component rather than delegated recursively, caller content needs no forwarding hop.
