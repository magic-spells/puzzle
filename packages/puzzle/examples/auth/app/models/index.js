import Session from './session.js';
import Note from './note.js';

// the registry: each key is the type string every store call takes.
// credentials is left out on purpose; it is a form schema, never a record.
export default {
  session: Session,
  note: Note,
};
