// Pure panel-state helpers for PanelStack. Panels stay parent-authored and
// mounted; swapping these Tailwind classes is what gives push/pop transitions
// time to animate in both directions.
// Tailwind v4's translate-x-*/scale-* utilities set the CSS `translate` and
// `scale` properties (NOT `transform`), so those exact properties must be in
// the transition list or push/pop snaps instead of sliding.
const BASE =
  'absolute inset-0 overflow-hidden rounded-[inherit] ' +
  'transition-[translate,scale,filter,opacity] duration-[420ms] ' +
  'ease-[cubic-bezier(0.16,0.87,0.64,1)] motion-reduce:transition-none';

const CURRENT = 'translate-x-0 z-[1]';

const SLIDE_PREVIOUS =
  'translate-x-[calc(-100%-50px)] scale-x-110 blur-[2px] opacity-10 z-0 ' +
  'pointer-events-none motion-reduce:opacity-0';

const SLIDE_NEXT =
  'translate-x-[calc(100%+50px)] scale-x-110 blur-[2px] opacity-10 z-[2] ' +
  'pointer-events-none motion-reduce:opacity-0';

const STACK_OVERLAY =
  "after:absolute after:inset-0 after:rounded-[inherit] after:pointer-events-none " +
  "after:content-[''] after:transition-shadow after:duration-[420ms]";

const STACK_PREVIOUS =
  'translate-x-0 scale-95 blur-[1px] brightness-50 -z-[1] pointer-events-none ' +
  'after:shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]';

const STACK_NEXT =
  'translate-x-[calc(100%+50px)] scale-x-110 blur-[2px] z-[2] pointer-events-none';

export function panelState(stack, handle) {
  const items = Array.isArray(stack) ? stack : [];
  if (items.length && items[items.length - 1] === handle) return 'current';
  return items.includes(handle) ? 'previous' : 'next';
}

export function panelClass(stack, handle, effect = 'slide') {
  const state = panelState(stack, handle);
  const stacked = effect === 'stack';

  let stateClass = CURRENT;
  if (state === 'previous') stateClass = stacked ? STACK_PREVIOUS : SLIDE_PREVIOUS;
  if (state === 'next') stateClass = stacked ? STACK_NEXT : SLIDE_NEXT;

  return [BASE, stacked ? STACK_OVERLAY : '', stateClass].filter(Boolean).join(' ');
}

export function panelInert(stack, handle) {
  return panelState(stack, handle) !== 'current';
}
