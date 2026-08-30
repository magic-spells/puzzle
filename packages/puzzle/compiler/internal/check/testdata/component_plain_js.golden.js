
import { PuzzleView } from '@magic-spells/puzzle';

export default class PlainCard extends PuzzleView {
  events = {
    update: (event) => event.currentTarget.value,
  };
}
