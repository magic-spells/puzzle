// Puzzle app configuration. Read by the compiler via node — the Go side never
// parses JS. Declaring the Tailwind pipeline makes `puzzle build` / `puzzle dev`
// run the Tailwind CLI and fold its output into the built stylesheet, ahead of
// the collected <style> blocks.
export default {
	styles: {
		use: ['tailwindcss'],
	},

	// Write every route as its own HTML page (/about is dist/about/index.html).
	// No router and no app bundle: each page loads only the components it uses.
	output: 'static',
};
