// Frame family barrel (D167). One import, dotted invocation:
//
//   import Frame from '../components/Frame/index.js';
//
//   <Frame>
//     <Frame.Header>…</Frame.Header>
//     <Frame.Body>…</Frame.Body>
//   </Frame>
//
// The members are deliberately behaviour-free — this family is the lab's
// grammar specimen, not chrome worth reusing.
import Frame from './Frame.pzl';
import Header from './Header.pzl';
import Body from './Body.pzl';

export { Frame, Header, Body };

export default Object.assign(Frame, { Header, Body });
