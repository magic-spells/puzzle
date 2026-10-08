---
name: Component selector validation
status: built
path: parser/component.go
language: go
summary: 'D180: validates the reserved Component tag''s required expression-valued is selector.'
connections:
  - FILE-PARSER
  - FILE-PARSER-SLOT
  - TEST-COMPILER-PARSER
---

# Component selector validation

The parser half of DECISION-D180-COMPONENT-SLOT in the framework plan (`repo=puzzle`): `<Component is={value}>` is a `Component` AST node with a reserved exact name. The authored `is` selector is required, unique and expression-valued; a spread cannot supply it. Missing, valueless, string or duplicate `is` gives a positioned error.

Every other attribute uses normal component rules, including ordinary `name`/`from` props and `SpreadAttr` (`ast.go`/`parser.go`). Event callback attrs remain props; component `bind:` stays unsupported. No lexer or expression-language spelling changes.

Children keep ordinary call-site slot validation and forwarding through [[FILE-PARSER-SLOT]]. A map uses the normal expression `is={ cards[key] }`; the host compiles or evaluates its value. This module performs no runtime module lookup.
