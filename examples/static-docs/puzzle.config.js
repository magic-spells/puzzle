// Puzzle app configuration (constellation/doc/DOC-DECISIONS.md D12/D26). Read by
// the compiler via node — the Go side never parses JS (D3).
export default {
	// Declaring the Tailwind pipeline makes `puzzle build` / `puzzle dev` run the
	// Tailwind CLI and fold its output into dist/styles.css ahead of the collected
	// <styles> blocks.
	styles: {
		use: ['tailwindcss'],
	},

	// Build output mode (SPEC §36 — D67/D79). `output: 'static'` (v1.46, D79)
	// prerenders every static route to its own dist/<path>/index.html as a TRUE
	// static page: no router, no SPA bundle, plain <a> navigation, and a small
	// per-page module that wakes each page's own components. The config-file
	// equivalent of `puzzle build --static`; either is sufficient. The other legal
	// value is 'hybrid' (the renamed D67 mode): the same prerendered pages PLUS the
	// full SPA bundle and a router that takes over at navigation #0. Anything else
	// is a config error.
	output: 'static',
};
