// Popover family barrel (D167). One import, dotted invocation:
//
//   import Popover from '@/components/ui/Popover';
//
//   <Popover>
//     <Popover.Trigger>Options</Popover.Trigger>
//     <Popover.Content align="end">…</Popover.Content>
//   </Popover>
//
// The members COMPOSE the shared DropdownPanel family rather than re-exporting
// it, which is what leaves them somewhere to hang this piece's chrome — and what
// lets you edit Popover/Trigger.pzl in your own app without forking the shared
// base every other menu piece uses.
import Popover from './Popover.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';

export { Popover, Trigger, Content };

export default Object.assign(Popover, { Trigger, Content });
