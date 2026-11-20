import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

/**
 * the sign-in form's rules. never stored: it is not in the model registry,
 * it only gives createForm() a schema to validate the draft against (D192).
 */
export default class Credentials extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
    email: Puzzle.string()
      .required('Enter your email.')
      .validate((value) => /^[^@\s]+@[^@\s]+$/.test(value), 'That does not look like an email address.'),
    password: Puzzle.string().required('Enter your password.'),
  };
}
