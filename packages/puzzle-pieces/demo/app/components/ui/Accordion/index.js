// Accordion family barrel (D167). One import, dotted invocation:
//
//   import Accordion from '@/components/ui/Accordion';
//
//   <Accordion value={ open } @change={ setOpen }>
//     <Accordion.Item value="shipping">
//       <Accordion.Trigger>Shipping</Accordion.Trigger>
//       <Accordion.Content>…real markup…</Accordion.Content>
//     </Accordion.Item>
//   </Accordion>
//
// Trigger and Content COMPOSE the sibling Collapsible family rather than
// re-exporting it, which is what leaves them somewhere to hang the accordion's
// padding — and what lets you edit Accordion/Trigger.pzl in your own app without
// forking the base every disclosure piece shares. Item is the exception: it renders
// the raw <collapsible-component>, because wrapping it in Collapsible's own
// non-exclusive group would shield it from its own accordion. See Item.pzl.
import Accordion from './Accordion.pzl';
import Item from './Item.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';

export { Accordion, Item, Trigger, Content };

export default Object.assign(Accordion, { Item, Trigger, Content });
