package formatters

import _ "embed"

// BuiltinsJSON is the compiler's embedded copy of builtins.json.
//
//go:embed builtins.json
var BuiltinsJSON []byte
