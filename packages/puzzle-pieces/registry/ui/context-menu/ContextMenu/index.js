// ContextMenu family barrel (D167). One import, dotted invocation:
//
//   import ContextMenu from '@/components/ui/ContextMenu';
//
//   <ContextMenu @select={ onSelect }>
//     <div class="…">Right-click here</div>
//     <ContextMenu.Content>
//       <ContextMenu.Item value="open" @press={ run }>Open</ContextMenu.Item>
//     </ContextMenu.Content>
//   </ContextMenu>
//
// THE ROW MEMBERS ARE RE-EXPORTED FROM DropdownMenu, NOT DUPLICATED, and that is
// deliberate. The rule elsewhere — compose the shared base, do not re-export it —
// exists so a family has somewhere of its own to hang chrome, and so you can edit
// one family's Trigger without forking the base every other menu shares. Neither
// reason applies to a row: a context-menu Item IS a dropdown-menu Item, same
// markup, same tokens, same @press contract, with nothing piece-specific to add.
// And in a copy-in registry the re-export is the BETTER answer — dropdown-menu is
// copied into your app anyway as this piece's registry dependency, so you edit
// one Item.pzl and both menus follow. Seven duplicated files would be seven files
// to keep in sync by hand.
//
// ContextMenu keeps its own root and its own Content because those genuinely
// differ: a pointer trigger with no <dropdown-trigger>, and a panel with `flip`
// on and no `align`. Trigger is re-exported too — the ROOT has no trigger, but a
// Sub's row still needs one.
import ContextMenu from './ContextMenu.pzl';
import Content from './Content.pzl';
import {
  Trigger,
  Item,
  Link,
  Group,
  Label,
  Separator,
  Shortcut,
  Sub,
} from '../DropdownMenu/index.js';

export { ContextMenu, Content, Trigger, Item, Link, Group, Label, Separator, Shortcut, Sub };

export default Object.assign(ContextMenu, {
  Content,
  Trigger,
  Item,
  Link,
  Group,
  Label,
  Separator,
  Shortcut,
  Sub,
});
