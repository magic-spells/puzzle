import { PuzzleApp } from '@magic-spells/puzzle';
import Home from './views/Home.pzl';

// The smallest possible Puzzle app: mount the runtime and paint one view.
// This exists to measure the framework's baseline size — no layouts, no
// components, no styles, no formatters. Just what it takes to boot.
const app = new PuzzleApp({
	target: '#app',
	routes: [{ path: '/', view: Home }],
});

app.mount();

export default app;
