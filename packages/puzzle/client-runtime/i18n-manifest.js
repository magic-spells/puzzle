// The default `@magic-spells/puzzle/i18n/manifest` (D175) for everything that is
// not a Puzzle build: vitest, a raw import, another bundler. A Puzzle build never
// reaches this file — its esbuild plugin serves the real manifest
// (`{ defaultLocale, locales: { tag: 'locales/<tag>.<hash>.json' } }`) when
// puzzle.config.js configures i18n, and `null` when it does not. `null` means
// "no translations": createI18n() returns null and nothing is wired.
export default null;
