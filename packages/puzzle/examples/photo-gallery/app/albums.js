// Albums are DERIVED from photo records — there is NO album model. Every Lorem
// Picsum photo carries an `author`, and an "album" is simply all the photos by
// one author (the Apple Photos "Albums" section, reimagined as photographers).
//
// Views compute albums inside data() from a live `store.findMany('photo')`
// query, so the sidebar list and the album grids stay reactive through the
// ordinary store-subscription path — no extra model, adapter, or store wiring.

// Deterministic kebab-case slug for an author name — the /album/:slug key.
// Same input always yields the same slug, so links are stable across reloads.
export function albumSlug(author) {
  return String(author)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Group a flat list of photo records into albums:
//   [{ slug, name, count, cover }]  sorted by count desc, then name asc.
// `cover` is the FIRST photo record encountered for that author (its id drives
// the sidebar thumbnail). The count-desc sort surfaces prolific photographers
// first; the name tiebreak keeps ordering stable when counts match.
export function groupAlbums(photos) {
  const byAuthor = new Map();
  for (const photo of photos) {
    const slug = albumSlug(photo.author);
    let album = byAuthor.get(slug);
    if (!album) {
      album = { slug, name: photo.author, count: 0, cover: photo };
      byAuthor.set(slug, album);
    }
    album.count += 1;
  }
  return [...byAuthor.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name)
  );
}
