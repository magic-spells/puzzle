package codegen

// scripttokens.go exports the <script> tokenizer for tools outside the
// compiler that need to read a script body without parsing it — today the
// `puzzle check --fix` upgrade codemod (D199). the token stream is the one every
// script scan in this package shares (tokenizeJS), so strings, comments,
// template literals and regex literals are single opaque tokens and an
// identifier inside one is never reported.

// ScriptToken is one lexical token of a script body: an identifier, a single
// punctuation byte, or an opaque unit (string, template literal, comment or
// regex literal). Off is the byte offset of its first byte in the body.
type ScriptToken struct {
	Ident   string
	Ch      byte
	Opaque  bool
	Comment bool
	Off     int
}

// TokenizeScript lexes a script body into ScriptTokens, skipping whitespace.
func TokenizeScript(s string) []ScriptToken {
	toks := tokenizeJS(s)
	out := make([]ScriptToken, len(toks))
	for i, t := range toks {
		out[i] = ScriptToken{Ident: t.ident, Ch: t.ch, Opaque: t.opaque, Comment: t.comment, Off: t.off}
	}
	return out
}
