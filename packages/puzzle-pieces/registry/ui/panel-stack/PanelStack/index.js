// PanelStack family barrel (D167). One import, dotted invocation:
//
//   import PanelStack from '@/components/ui/PanelStack';
//
//   <PanelStack class="h-80" current={ panel } @change={ setPanel }>
//     <PanelStack.Panel handle="root">
//       <button data-action-stack-push target="shop">Shop</button>
//     </PanelStack.Panel>
//     <PanelStack.Panel handle="shop">
//       <button data-action-stack-pop>Back</button>
//     </PanelStack.Panel>
//   </PanelStack>
//
// The push/pop triggers are the component's own delegated markup contract, not
// props — see PanelStack.pzl. Panel is a thin host; the root is the only file
// that talks to @magic-spells/panel-stack.
import PanelStack from './PanelStack.pzl';
import Panel from './Panel.pzl';

export { PanelStack, Panel };

export default Object.assign(PanelStack, { Panel });
