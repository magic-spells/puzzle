module github.com/magic-spells/puzzle/packages/puzzle-lang

// 1.24 is the floor because its linker is the first to emit LC_UUID on
// Darwin by default — dyld on current macOS aborts binaries without it
// (Abort trap 6, "missing LC_UUID load command"), which would kill both
// the shipped darwin CLI binaries and any CI-built compiler on a mac runner.
// This module is a library, but it sits in the CLI's build graph and keeps
// the same floor as packages/puzzle/go.mod so the two never disagree.
go 1.24.0
