// Collapsible family barrel (D167). One import, dotted invocation:
//
//   import Collapsible from '@/components/ui/Collapsible';
//
//   <Collapsible>
//     <Collapsible.Trigger>Shipping and returns</Collapsible.Trigger>
//     <Collapsible.Content>…real markup…</Collapsible.Content>
//   </Collapsible>
//
// The members are deliberately thin — a <button> and a <collapsible-content>
// with tokens on them — so they are easy to restyle in your own app without
// touching the root, which is where the wrapper's whole state contract lives.
import Collapsible from './Collapsible.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';

export { Collapsible, Trigger, Content };

export default Object.assign(Collapsible, { Trigger, Content });
