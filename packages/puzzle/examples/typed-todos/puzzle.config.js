// Puzzle app configuration. Read by the compiler via node (the Go side never
// parses JS). Declaring the Tailwind pipeline makes `puzzle build` / `puzzle dev`
// run the Tailwind CLI and fold its output into the built stylesheet.
export default {
	styles: {
		use: ['tailwindcss'],
	},
};
