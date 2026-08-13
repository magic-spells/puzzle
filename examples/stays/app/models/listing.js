import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Listing extends PuzzleModel {
  // Schema — see constellation/doc/DOC-SPEC.md §7. Listings are the heart of the
  // marketplace and touch nearly every schema type: string (title/type/city),
  // number (price/rating/counts), boolean (guestFavorite/saved), and array
  // (amenities/photos/tags). `photos` and `tags` are seeded from JSON as real
  // nested arrays; `saved` is local-only wishlist state (never persisted to a
  // server in this demo — app.js mirrors it to localStorage instead).
  static schema = {
    id:           Puzzle.string().primary(),
    title:        Puzzle.string().required(),
    // e.g. 'Entire cabin', 'Entire villa', 'Entire loft', 'Private room', …
    type:         Puzzle.string().required(),

    city:         Puzzle.string().required(),
    country:      Puzzle.string().required(),

    pricePerNight: Puzzle.number().required(),
    cleaningFee:   Puzzle.number().default(45),

    rating:       Puzzle.number(),
    reviewCount:  Puzzle.number(),

    guests:       Puzzle.number(),
    bedrooms:     Puzzle.number(),
    beds:         Puzzle.number(),
    baths:        Puzzle.number(),

    // Canonical amenity strings only (see the seed for the allowed list).
    amenities:    Puzzle.array().default(() => []),
    // Exactly 5 per listing: { from, to, icon } — two hex gradient stops plus a
    // scene emoji. photos[0] drives the cover; the rest fill the gallery.
    photos:       Puzzle.array().default(() => []),
    // Category slugs: 'cabin','beach','city','countryside','design','trending'.
    tags:         Puzzle.array().default(() => []),

    hostId:       Puzzle.string().required(),
    description:  Puzzle.string(),

    // Airbnb "Guest favorite" badge, and the wishlist heart. Both are booleans;
    // `saved` starts false and is toggled locally + persisted via app.js.
    guestFavorite: Puzzle.boolean().default(false),
    saved:         Puzzle.boolean().default(false),
  };

  // Computed getters (plain JS). location joins city + country for one-line
  // display; cover turns the first photo's gradient into a ready-to-use CSS
  // value so templates read `style="background:{ listing.cover }"` instead of
  // rebuilding it each time (mirrors album.js's artwork getter, with fallbacks).
  get location() {
    return `${this.city}, ${this.country}`;
  }

  get cover() {
    const p = (Array.isArray(this.photos) && this.photos[0]) || {};
    return `linear-gradient(135deg, ${p.from || '#e8e8ee'}, ${p.to || '#d4d4de'})`;
  }

  // Toggle the wishlist flag. app.js persists saved ids to localStorage, so a
  // model method keeps that one mutation in a single, testable place.
  toggleSaved() {
    return this.update({ saved: !this.saved });
  }

  // Deterministic pseudo-availability so the booking calendar works on ANY date
  // without a server: hash the listing id + the ISO date into a small integer
  // and mark ~1-in-5 dates as booked. Pure and stable — the same (id, date)
  // always yields the same answer across reloads, so views can render a
  // consistent month grid with no persisted booking state.
  isDateBooked(iso) {
    let h = 0;
    const s = this.id + iso;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
    return h % 5 === 0;
  }

  // Server location (D21): consumed by store.loadAll('listing') on the read path.
  static adapter = {
    endpoint: '/listings.json',
  };
}
