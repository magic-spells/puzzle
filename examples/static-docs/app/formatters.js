// App formatters module (SPEC §2 · display transforms only — logic belongs in
// data()). In static mode (D79) the build reads formatters from THIS file so they
// exist in the per-page bundle and re-render identically client-side. Formatters
// registered only in app.js config are available at build time (prerender) but
// NOT client-side in static mode, so the build warns; keeping them here is the fix.
export default {
  // Uppercase the first letter — used on the guide section headings.
  titlecase: (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''),
  // Pluralize a unit against a count — used by the Home counter.
  plural: (n, unit) => (n === 1 ? unit : unit + 's'),
};
