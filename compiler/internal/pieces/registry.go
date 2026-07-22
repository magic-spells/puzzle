// Package pieces implements `puzzle add piece <name…>`: copying copy-in UI
// components ("pieces") out of a registry into a Puzzle app. Pieces are copied
// VERBATIM — the Go side never stamps, rewrites, or reformats a piece's bytes
// (that is the D3 print-don't-rewrite boundary the whole CLI honors). Instead of
// mutating copied files, we record a sha256 of every copied byte in pieces.lock,
// so a future diff/update command can tell "upstream changed" from "the user
// customized it locally" from "both" without ever having touched user content.
package pieces

import (
	"fmt"
	"strings"
)

// Registry is the parsed registry.json index.
type Registry struct {
	Version int     `json:"version"`
	Theme   string  `json:"theme"`
	Pieces  []Piece `json:"pieces"`
}

// Piece is one registry entry.
type Piece struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Files       []string `json:"files"`
	// RegistryDependencies is a mixed list: a bare name ("calendar") is another
	// PIECE; a "lib/…"-prefixed value ("lib/date-math.js") is a shared JS util
	// copied to app/lib/. The prefix is the ONLY discriminator (see resolveAll).
	RegistryDependencies []string `json:"registryDependencies"`
	// Dependencies are npm package names the piece needs at runtime. We never run
	// npm (D3) — they are accumulated and printed as a next step.
	Dependencies []string `json:"dependencies"`
	// TargetDir is the app-relative destination for this piece's files; empty
	// means the default (app/components/ui).
	TargetDir string `json:"targetDir"`
}

const (
	// defaultTargetDir is where a piece's files land when the manifest omits
	// targetDir.
	defaultTargetDir = "app/components/ui"
	// libPrefix marks a registryDependency as a shared lib path rather than a
	// piece name.
	libPrefix = "lib/"
	// suggestMaxDistance is the edit-distance ceiling for an unknown-piece
	// did-you-mean hint (mirrors the parser's D43/scoped-styles hints).
	suggestMaxDistance = 2
)

// resolveAll expands the requested piece names into the full transitive set of
// pieces and lib deps. It is cycle-safe (a name is marked visited before its
// deps are walked) and dedupes: a piece or lib reached by two paths appears
// once. Order is deterministic — a requested piece precedes the deps it pulls in,
// which is what the ✓ summary and lock read out.
func resolveAll(reg *Registry, names []string) (pieces []Piece, libs []string, err error) {
	index := make(map[string]Piece, len(reg.Pieces))
	for _, p := range reg.Pieces {
		index[p.Name] = p
	}

	seenPiece := make(map[string]bool)
	seenLib := make(map[string]bool)

	var visit func(name string) error
	visit = func(name string) error {
		if seenPiece[name] {
			return nil
		}
		p, ok := index[name]
		if !ok {
			return unknownPieceError(reg, name)
		}
		// Mark BEFORE recursing so a dependency cycle (a→b→a) terminates.
		seenPiece[name] = true
		pieces = append(pieces, p)
		for _, dep := range p.RegistryDependencies {
			if strings.HasPrefix(dep, libPrefix) {
				if !seenLib[dep] {
					seenLib[dep] = true
					libs = append(libs, dep)
				}
				continue
			}
			if err := visit(dep); err != nil {
				return err
			}
		}
		return nil
	}

	for _, n := range names {
		if err := visit(n); err != nil {
			return nil, nil, err
		}
	}
	return pieces, libs, nil
}

// unknownPieceError reports an unresolvable name, with a did-you-mean when a
// registry piece is within suggestMaxDistance edits — the same affordance the
// compiler gives for a typo'd formatter/attribute.
func unknownPieceError(reg *Registry, name string) error {
	if s := suggest(reg, name); s != "" {
		return fmt.Errorf("unknown piece %q — did you mean %q?", name, s)
	}
	return fmt.Errorf("unknown piece %q", name)
}

// suggest returns the closest registry piece name within suggestMaxDistance, or
// "" when nothing is close enough.
func suggest(reg *Registry, name string) string {
	best := ""
	bestDist := suggestMaxDistance + 1
	for _, p := range reg.Pieces {
		d := editDistance(name, p.Name)
		if d < bestDist {
			bestDist, best = d, p.Name
		}
	}
	return best
}

// editDistance is the Levenshtein distance between a and b (ASCII, small inputs).
// A local copy rather than importing the parser's unexported helper — the two
// packages have no dependency edge and this keeps pieces self-contained.
func editDistance(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			m := del
			if ins < m {
				m = ins
			}
			if sub < m {
				m = sub
			}
			curr[j] = m
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}
