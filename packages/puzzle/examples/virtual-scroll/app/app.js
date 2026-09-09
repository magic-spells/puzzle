import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

// The whole point of this example: virtual scrolling with ZERO framework
// changes. No models, no custom formatters, no runtime patches — just the
// stock v1 config surface (constellation/doc/DOC-SPEC.md §2) plus a view that
// does fixed-height windowing in userland. See app/views/Home.pzl.
const app = new PuzzleApp({
	target: '#app',
	routes,
});

app.mount();

export default app;
