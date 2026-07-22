// The default scene: five bodies at varied distances, sizes, and speeds — one
// retrograde (negative speed) — with hues spread around the wheel and phases
// evenly spaced (72° apart) so they don't all start on the same ray.
//
// app.js seeds these once when the store is empty; the "Reset" button reseeds
// them after wiping the store. Positions are absent by design — see models/body.js.
export const seedBodies = [
  { id: 'body-mercury', name: 'Mercury', color: '#f4a259', size: 4,  distance: 62,  speed: 44,  phase: 0 },
  { id: 'body-venus',   name: 'Venus',   color: '#e7c86a', size: 6,  distance: 104, speed: 30,  phase: 72 },
  { id: 'body-terra',   name: 'Terra',   color: '#5aa9e6', size: 7,  distance: 152, speed: 22,  phase: 144 },
  { id: 'body-ares',    name: 'Ares',    color: '#e05a47', size: 5,  distance: 204, speed: -16, phase: 216 }, // retrograde
  { id: 'body-jove',    name: 'Jove',    color: '#c98a5e', size: 11, distance: 258, speed: 10,  phase: 288 },
];

export default seedBodies;
