import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

const app = new PuzzleApp({ target: '#app', routes });

app.mount();

export default app;
