// HoverCard family barrel (D167). One import, dotted invocation:
//
//   import HoverCard from '@/components/ui/HoverCard';
//
//   <HoverCard>
//     <HoverCard.Trigger>@ada</HoverCard.Trigger>
//     <HoverCard.Content>…profile preview…</HoverCard.Content>
//   </HoverCard>
//
// The members COMPOSE the shared DropdownPanel family rather than re-exporting
// it, which is what leaves them somewhere to hang this piece's chrome — and what
// lets you edit HoverCard/Content.pzl in your own app without forking the shared
// base every other menu piece uses.
import HoverCard from './HoverCard.pzl';
import Trigger from './Trigger.pzl';
import Content from './Content.pzl';

export { HoverCard, Trigger, Content };

export default Object.assign(HoverCard, { Trigger, Content });
