// The build's entry point is always app/app.js — the one path `puzzle build`
// and `puzzle dev` resolve. The app itself is TypeScript: this file only hands
// off to app/main.ts, where the PuzzleApp is configured and mounted.
export { default } from './main';
