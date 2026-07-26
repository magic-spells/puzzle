/**
 * devtools.js — the devtools_page script. Its only job is registering the
 * panel; everything else lives in panel.html / panel-glue.js.
 */
// icon16, not icon48: the DevTools tab strip draws this at ~16px, and letting
// Chrome downscale the 48 softens it. icon16 is rendered with its own geometry
// (larger shapes, wider gaps) so it stays legible at that size.
chrome.devtools.panels.create('Puzzle', 'icons/icon16.png', 'panel.html');
