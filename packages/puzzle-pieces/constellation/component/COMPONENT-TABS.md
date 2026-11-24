---
name: Tabs family
status: verified
framework: puzzle
props:
  - name: value
    type: string
  - name: defaultValue
    type: string
  - name: variant
    type: string
  - name: class
    type: string
variants:
  - underline
  - pills
  - buttons
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
notes:
  - kind: state
    text: >-
      Known bug: adding or inserting a tab and selecting it in the same update can activate the
      wrong tab. tab-group's `active` setter resolves the index against the buttons it last
      collected while DOM mutations are still queued for its MutationObserver; the piece's
      member-key edge (`#members`/`#memberKey`) only works around part of it. The fix is upstream:
      flush the observer in tab-group's `set active` (`takeRecords()`, then `_sync()`), then delete
      the member tracking from the piece and bump the floor.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

`Tabs` · `Tabs.List` · `Tabs.Tab` · `Tabs.Panel`, a D167 family over
`@magic-spells/tab-group` 1.2.0.

## value ↔ index

Upstream identifies a tab by its 0-based INDEX. The registry's convention is a
string handle, so the root carries it as `data-value` and maps between the two by
reading the DOM: `:scope > tab-list > tab-button[data-value]`. The `:scope >`
is what keeps a nested Tabs' own list out of the lookup.

Driving `value` to a handle no member has, or to a disabled tab, is refused with
a one-shot console warning rather than silently doing nothing — upstream's
`_parseIndex` returns null for both, and forcing a disabled tab would desync
`aria-selected`.

## The seed is imperative, not a frozen template attribute

Every other family in the registry freezes its seed inside `data()`. Tabs cannot:
the index is only knowable once the buttons exist, and `data()` also runs under
Node with no DOM. So the template renders no `active` at all and `mounted()`
writes the attribute (pre-upgrade) or the property (post-upgrade) before the
dynamic import resolves. An authored `active` is applied by `connectedCallback`
silently, which is the no-flash path.

## Panels pair by POSITION

`_collect()` matches the nth `tab-button` to the nth `tab-panel`; `data-value` on
a Panel is only what this piece reads back. A mismatched order therefore shows
the wrong body with no error, and upstream will inject filler `<tab-panel>`
elements on FIRST CONNECT if the counts differ — foreign nodes Puzzle's patcher
knows nothing about. The root dev-asserts the two `data-value` sequences on mount
and on every `afterUpdate`, warning once per instance.

## The member set is the second re-sync edge

A keyed `{#for}` row inserted mid-list shifts every index after it while `value`
never moves. `afterUpdate` therefore fires on `props.value !== #last` OR a changed
member key.

## Variant without context

Puzzle has no cross-component context, so the root stamps `data-variant` and
List/Tab carry every look (`underline`, `pills`, `buttons`), switching on a descendant
attribute selector (`[tab-group[data-variant=pills]_&]:…`). Underline is unconditional;
pills and buttons win on specificity. Documented limitation: a nested Tabs with a
DIFFERENT variant collides, because the match has equal specificity at both depths. The
same specificity means a plain call-site utility on a List or Tab loses to any property a
pills/buttons rule sets: override with the `!` suffix or the same
`[tab-group[data-variant=…]_&]:` prefix in `class=` on the inner members.
