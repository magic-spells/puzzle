import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes';

// Create and configure the Puzzle app: where it mounts (matches #app in
// public/index.html) and its routes.
const app = new PuzzleApp({
	target: '#app',
	routes,
});

// Start the app. A static build runs this file under node to write the pages,
// then gives each page its own small module instead, so dist/ has no app.js.
app.mount();

// The static build reads the app's config through this export.
export default app;
