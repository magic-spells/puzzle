// Puzzle app configuration. Read by the compiler via node — the Go side never
// parses JS. Declaring the Tailwind pipeline makes `puzzle build` / `puzzle dev`
// run the Tailwind CLI and fold its output into dist/styles.css ahead of the
// collected <styles> blocks.
export default {
	styles: {
		use: ['tailwindcss'],
	},
};
