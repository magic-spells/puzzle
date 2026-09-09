// DropdownPanel family barrel (D167). One import, dotted invocation:
//
//   import DropdownPanel from '@/components/ui/DropdownPanel';
//
//   <DropdownPanel>
//     <DropdownPanel.Trigger>Menu</DropdownPanel.Trigger>
//     <DropdownPanel.Panel>…</DropdownPanel.Panel>
//   </DropdownPanel>
//
// The named exports are there for the other shape — `import { Panel } from …` —
// and for pieces that compose a single member.
import DropdownPanel from './DropdownPanel.pzl';
import Trigger from './Trigger.pzl';
import Panel from './Panel.pzl';

export { DropdownPanel, Trigger, Panel };

export default Object.assign(DropdownPanel, { Trigger, Panel });
