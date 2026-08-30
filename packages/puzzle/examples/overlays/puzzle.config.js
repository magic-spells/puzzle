// The environment switch keeps this example useful for exercising both lazy
// route build shapes: an emitted chunk when true and an inlined import when
// false/unset. `puzzle build --static` still overrides splitting for its
// per-page bundles.
export default {
	build: { splitting: process.env.PUZZLE_SPLITTING === 'true' },
};
