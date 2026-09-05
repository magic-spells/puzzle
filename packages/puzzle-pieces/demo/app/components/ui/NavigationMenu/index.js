// NavigationMenu family barrel (D167). One import, dotted invocation:
//
//   import NavigationMenu from '@/components/ui/NavigationMenu';
//
//   <NavigationMenu>
//     <NavigationMenu.Item>
//       <NavigationMenu.Trigger>Products</NavigationMenu.Trigger>
//       <NavigationMenu.Content>
//         <NavigationMenu.Link href="/a" label="Analytics"/>
//       </NavigationMenu.Content>
//     </NavigationMenu.Item>
//   </NavigationMenu>
//
// The members COMPOSE the shared DropdownPanel family rather than re-exporting
// it, which is what leaves them somewhere to hang this bar's chrome — and what
// lets you edit NavigationMenu/Trigger.pzl in your own app without forking the
// shared base every other menu piece uses.
import NavigationMenu from './NavigationMenu.pzl';
import Item from './Item.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';
import Link from './Link.pzl';

export { NavigationMenu, Item, Trigger, Content, Link };

export default Object.assign(NavigationMenu, { Item, Trigger, Content, Link });
