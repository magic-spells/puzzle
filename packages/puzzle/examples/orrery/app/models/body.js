import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

// A `body` record holds a planet's ORBITAL PARAMETERS — never its position.
// The canvas derives (x, y) every frame from these fields plus elapsed time:
//
//     angle = phase + elapsedSeconds * speed      (degrees)
//     x = centerX + cos(angle) * distance
//     y = centerY + sin(angle) * distance
//
// So the store stays tiny and write-free during animation: 60fps positions live
// only in the canvas, and the reactive datastore is edited only when a parameter
// actually changes (a slider drag, a spawn, a delete).
export default class Body extends PuzzleModel {
  static schema = {
    id:       Puzzle.string().primary(),
    name:     Puzzle.string().required(),
    color:    Puzzle.string().default('#7dd3fc'),
    size:     Puzzle.number().default(6),    // planet radius, logical px
    distance: Puzzle.number().default(120),  // orbit radius, logical px
    speed:    Puzzle.number().default(20),   // degrees/second — NEGATIVE = retrograde
    phase:    Puzzle.number().default(0),    // starting angle, degrees
  };
}
