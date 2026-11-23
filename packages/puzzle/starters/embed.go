// Package starters holds the apps `puzzle init` writes (compiler/internal/
// scaffold). Each folder is one starter app exactly as it is written, and
// <name>-ts beside it holds only the files its TypeScript variant writes
// differently.
package starters

import "embed"

// FS holds every starter. the all: prefix keeps the dotfiles (.gitignore),
// which a plain directory embed would silently drop.
//
//go:embed all:default all:default-ts all:static all:static-ts
var FS embed.FS
