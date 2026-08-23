import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.js'],
		// The panel app is compiled by the Go toolchain, not vitest — nothing under
		// panel/ or dist-extension/ is a test target.
		exclude: ['node_modules/**', 'dist-extension/**', 'panel/dist/**'],
	},
});
