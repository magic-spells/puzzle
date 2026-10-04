// A prefix-routing static site (D177), built by `npm run build:locale-prefix`
// with the real compiler so tests/locale-redirect-build.test.js can read the
// first-visit redirect script exactly as a production build emits it.
export default {
	output: 'static',
	site: 'https://example.com',
	i18n: {
		locales: ['en', 'es', 'pt-BR'],
		defaultLocale: 'en',
		routing: 'prefix',
	},
};
