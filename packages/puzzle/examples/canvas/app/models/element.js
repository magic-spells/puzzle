import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Element extends PuzzleModel {
  static schema = {
    id:         Puzzle.string().primary(),
    type:       Puzzle.string().required(),   // 'frame' | 'rect' | 'ellipse' | 'text'
    name:       Puzzle.string().default(''),
    frameId:    Puzzle.string().default(''),  // '' = top-level on the stage
    x:          Puzzle.number().default(0),   // relative to parent frame box (or stage)
    y:          Puzzle.number().default(0),
    w:          Puzzle.number().default(120),
    h:          Puzzle.number().default(120),
    z:          Puzzle.number().default(0),   // sibling order: stacking AND stack-layout order
    fill:       Puzzle.string().default('#5B8DEF'),
    opacity:    Puzzle.number().default(100), // 0..100
    radius:     Puzzle.number().default(0),   // rect + frame only
    shadowBlur: Puzzle.number().default(0),   // 0 = no shadow
    shadowY:    Puzzle.number().default(0),
    text:       Puzzle.string().default(''),  // type 'text' only
    fontSize:   Puzzle.number().default(16),  // type 'text' only
    layout:     Puzzle.string().default('free'), // frame: 'free' | 'stack-v' | 'stack-h'
    gap:        Puzzle.number().default(12),
    padding:    Puzzle.number().default(16),
  };
}
