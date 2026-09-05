// DropdownMenu family barrel (D167). One import, dotted invocation:
//
//   import DropdownMenu from '@/components/ui/DropdownMenu';
//
//   <DropdownMenu @select={ onSelect }>
//     <DropdownMenu.Trigger>Options</DropdownMenu.Trigger>
//     <DropdownMenu.Content align="end">
//       <DropdownMenu.Item value="new" @press={ run }>New file</DropdownMenu.Item>
//     </DropdownMenu.Content>
//   </DropdownMenu>
//
// DropdownMenu, Trigger and Content COMPOSE the shared DropdownPanel family
// rather than re-exporting it, which is what leaves them somewhere to hang the
// menu's chrome — and what lets you edit DropdownMenu/Trigger.pzl in your own app
// without forking the shared base every other menu piece uses. Item, Link,
// Group, Label, Separator and Shortcut are plain markup with no component
// underneath, and Sub is a nested DropdownMenu.
//
// These row members are the ones ContextMenu and SplitButton re-export rather
// than duplicate: a context-menu row IS a dropdown-menu row, and in a copy-in
// registry that means the consumer edits one Item.pzl and every menu follows.
import DropdownMenu from './DropdownMenu.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';
import Item from './Item.pzl';
import Link from './Link.pzl';
import Group from './Group.pzl';
import Label from './Label.pzl';
import Separator from './Separator.pzl';
import Shortcut from './Shortcut.pzl';
import Sub from './Sub.pzl';

export { DropdownMenu, Trigger, Content, Item, Link, Group, Label, Separator, Shortcut, Sub };

export default Object.assign(DropdownMenu, {
  Trigger,
  Content,
  Item,
  Link,
  Group,
  Label,
  Separator,
  Shortcut,
  Sub,
});
