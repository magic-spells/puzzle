// SplitButton family barrel (D167). One import, dotted invocation:
//
//   import SplitButton from '@/components/ui/SplitButton';
//
//   <SplitButton>
//     <SplitButton.Action variant="primary" @press={ save }>Save</SplitButton.Action>
//     <SplitButton.Menu variant="primary" label="More save actions" @select={ run }>
//       <SplitButton.Item value="save-as" @press={ run }>Save as…</SplitButton.Item>
//     </SplitButton.Menu>
//   </SplitButton>
//
// Three members of its own — the layout shell, the primary half and the caret
// half — because each carries the fusion classes that make the pair one pill. A
// pure layout shell would have had to reach its halves with descendant selectors
// like [&>dropdown-component>dropdown-trigger]:rounded-l-none, which is fragile
// and leaks the custom-element names into your markup.
//
// THE ROW MEMBERS ARE RE-EXPORTED FROM DropdownMenu, NOT DUPLICATED. A split
// button's menu row IS a dropdown-menu row — same markup, same tokens, same
// @press contract — and dropdown-menu is copied into your app anyway as this
// piece's registry dependency, so you edit one Item.pzl and every menu follows.
import SplitButton from './SplitButton.pzl';
import Action from './Action.pzl';
import Menu from './Menu.pzl';
import {
  Item,
  Link,
  Group,
  Label,
  Separator,
  Shortcut,
  Sub,
} from '../DropdownMenu/index.js';

export { SplitButton, Action, Menu, Item, Link, Group, Label, Separator, Shortcut, Sub };

export default Object.assign(SplitButton, {
  Action,
  Menu,
  Item,
  Link,
  Group,
  Label,
  Separator,
  Shortcut,
  Sub,
});
