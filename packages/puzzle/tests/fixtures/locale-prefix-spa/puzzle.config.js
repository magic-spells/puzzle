// The plain-SPA twin of tests/fixtures/locale-prefix-hybrid (D177): the same
// app with no prerender, so every URL is served the one index.html shell. Built
// by `npm run build:locale-prefix`; tests/locale-prefix-app.test.js runs it.
export default {
	i18n: {
		locales: ['en', 'es', 'pt-BR'],
		defaultLocale: 'en',
		routing: 'prefix',
	},
};
