import { adapter } from '@magic-spells/puzzle/adapter';

// For an app-wide API dialect, replace the bare export with defaults such as:
// export default adapter.defaults({
//   loadMany: async (fetch, _options, { endpoint }) =>
//     (await (await fetch(endpoint)).json()).data,
// });
export default adapter;
