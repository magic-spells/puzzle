package fsutil

import (
	"crypto/sha256"
	"encoding/base32"
)

// ContentHash is 8 base32 characters of the content's SHA-256 — the same shape
// as esbuild's [hash] in the D160 chunk names.
func ContentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return base32.StdEncoding.EncodeToString(sum[:])[:8]
}
