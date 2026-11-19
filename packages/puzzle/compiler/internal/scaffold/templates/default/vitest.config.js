// vitest runs the tests in tests/ (npm test). the puzzle plugin compiles the
// .pzl files a test imports, and jsdom gives the tests a browser dom to render
// into.
import { defineConfig } from 'vitest/config';
import { puzzle } from '@magic-spells/puzzle/vitest';

export default defineConfig({
  plugins: [puzzle()],
  test: {
    environment: 'jsdom',
  },
});
