// Puzzle app configuration (constellation/doc/DOC-DECISIONS.md D12/D26). Read by
// the compiler via node — the Go side never parses JS (D3).
export default {
	// Declaring the Tailwind pipeline makes `puzzle build` / `puzzle dev` run the
	// Tailwind CLI and fold its output into dist/styles.css ahead of the collected
	// <styles> blocks.
	styles: {
		use: ['tailwindcss'],
	},

	// Static site generation (v1.33, D67 — SPEC §36). `output: 'static'` prerenders
	// every static route to its own dist/<path>/index.html. This is the config-file
	// equivalent of the `puzzle build --static` flag; either one is sufficient.
	// `'static'` is the only legal value — anything else is a config error.
	output: 'static',
};
