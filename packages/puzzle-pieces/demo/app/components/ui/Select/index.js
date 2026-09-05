// Select family barrel (D167). One import, dotted invocation:
//
//   import Select from '@/components/ui/Select';
//
//   <Select value={ country } @change={ setCountry }>
//     <Select.Label>North America</Select.Label>
//     <Select.Option value="us">United States</Select.Option>
//     <Select.Divider/>
//     <Select.Option value="mx" disabled>Mexico (sold out)</Select.Option>
//   </Select>
//
// The members are deliberately thin — a <select-option>, a <select-label> and a
// <select-divider> with tokens on them — so they are easy to restyle in your own
// app without touching the root, which is where the wrapper's whole state
// contract lives.
import Select from './Select.pzl';
import Option from './Option.pzl';
import Label from './Label.pzl';
import Divider from './Divider.pzl';

export { Select, Option, Label, Divider };

export default Object.assign(Select, { Option, Label, Divider });
