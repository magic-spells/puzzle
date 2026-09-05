// SplitPanel family barrel (D167). One import, dotted invocation:
//
//   import SplitPanel from '@/components/ui/SplitPanel';
//
//   <SplitPanel class="h-80" id="editor">
//     <SplitPanel.Pane size={ 30 } min="180px">…</SplitPanel.Pane>
//     <SplitPanel.Divider/>
//     <SplitPanel.Pane>…</SplitPanel.Pane>
//   </SplitPanel>
//
// Every divider is authored on purpose — see SplitPanel.pzl. The members are
// thin hosts with no behaviour; everything moving lives in
// @magic-spells/split-panel, and the root is the only file that talks to it.
import SplitPanel from './SplitPanel.pzl';
import Pane from './Pane.pzl';
import Divider from './Divider.pzl';

export { SplitPanel, Pane, Divider };

export default Object.assign(SplitPanel, { Pane, Divider });
