import { adapter } from '@magic-spells/puzzle/adapter';

// For an app-wide API dialect, replace the bare export with defaults such as:
// export default adapter.defaults({
//   loadMany: async (fetch, _options, { endpoint }) =>
//     (await (await fetch(`/api${endpoint}`)).json()).data,
// });
// `endpoint` is the raw model value, NOT apiURL-prefixed — only the generated
// transport prepends apiURL — so this app's '/api' is spelled out above.
export default adapter;
