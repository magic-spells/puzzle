// Package skills exposes the agent skills shipped with this Puzzle CLI version.
package skills

import "embed"

// FS contains the complete embedded skill payload.
//
//go:embed puzzle
var FS embed.FS
