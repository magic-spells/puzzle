// Tabs family barrel (D167). One import, dotted invocation:
//
//   import Tabs from '@/components/ui/Tabs';
//
//   <Tabs value={ tab } @change={ setTab }>
//     <Tabs.List>
//       <Tabs.Tab value="account">Account</Tabs.Tab>
//       <Tabs.Tab value="billing">Billing</Tabs.Tab>
//     </Tabs.List>
//     <Tabs.Panel value="account">…</Tabs.Panel>
//     <Tabs.Panel value="billing">…</Tabs.Panel>
//   </Tabs>
//
// Every member is thin — a host element, a class string, no behaviour — so
// they are meant to be edited in your own app. The behaviour lives in
// @magic-spells/tab-group; the root is the only file that talks to it.
import Tabs from './Tabs.pzl';
import List from './List.pzl';
import Tab from './Tab.pzl';
import Panel from './Panel.pzl';

export { Tabs, List, Tab, Panel };

export default Object.assign(Tabs, { List, Tab, Panel });
