---
name: Component selector validation
status: verified
path: parser/component.go
language: go
summary: 'D180: validates the reserved Component tag''s required expression-valued is selector.'
connections:
  - FILE-PARSER
  - FILE-PARSER-SLOT
  - TEST-COMPILER-PARSER
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Component selector validation

The parser half of DECISION-D180-COMPONENT-SLOT in the framework plan (`repo=puzzle`): `<Component is={value}>` is a `Component` AST node with a reserved exact name.

- **`is` is required, unique and expression-valued**; a spread cannot supply it. Missing, valueless, string, number, boolean, template-literal or duplicate `is` is a positioned error, including those literals inside braces; `null`/`undefined` stay valid selectors (they render nothing). A map read such as `is={ cards[key] }` is an ordinary expression the host compiles or evaluates — no runtime module lookup here.
- **An authored `flip` is rejected** with a wrapping-element hint; `@flip` stays an ordinary callback prop.
- Every other attribute follows normal component rules (`name`/`from` are ordinary props; `SpreadAttr` allowed; event attrs are callback props; component `bind:` stays unsupported). Children keep ordinary call-site slot validation and forwarding ([[FILE-PARSER-SLOT]]).
