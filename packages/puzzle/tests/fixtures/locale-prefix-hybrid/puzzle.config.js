// A prefix-routing hybrid app (D177), built by `npm run build:locale-prefix`
// with the real compiler. tests/locale-prefix-app.test.js loads its pages into
// jsdom and imports the built app.js, so the router takeover, the locale island
// and the inline first-visit redirect run exactly as a production build ships
// them. tests/fixtures/locale-prefix-spa is the same app as a plain SPA.
export default {
	output: 'hybrid',
	i18n: {
		locales: ['en', 'es', 'pt-BR'],
		defaultLocale: 'en',
		routing: 'prefix',
	},
};
