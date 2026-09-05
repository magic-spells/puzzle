// Menubar family barrel (D167). One import, dotted invocation:
//
//   import Menubar from '@/components/ui/Menubar';
//
//   <Menubar>
//     <Menubar.Menu>
//       <Menubar.Trigger>File</Menubar.Trigger>
//       <Menubar.Content>
//         <Menubar.Item value="new" @press={ run }>New file</Menubar.Item>
//       </Menubar.Content>
//     </Menubar.Menu>
//   </Menubar>
//
// Menu, Trigger and Content COMPOSE the shared DropdownPanel family rather than
// re-exporting it, which is what leaves them somewhere to hang the bar's chrome —
// and what lets you edit Menubar/Trigger.pzl in your own app without forking the
// shared base every other menu piece uses. Item, Link, Separator, Label and
// Shortcut are plain markup with no component underneath.
import Menubar from './Menubar.pzl';
import Menu from './Menu.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';
import Item from './Item.pzl';
import Link from './Link.pzl';
import Separator from './Separator.pzl';
import Label from './Label.pzl';
import Shortcut from './Shortcut.pzl';

export { Menubar, Menu, Trigger, Content, Item, Link, Separator, Label, Shortcut };

export default Object.assign(Menubar, {
  Menu,
  Trigger,
  Content,
  Item,
  Link,
  Separator,
  Label,
  Shortcut,
});
