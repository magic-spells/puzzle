/**
 * devtools.js — the devtools_page script. Its only job is registering the
 * panel; everything else lives in panel.html / panel-glue.js.
 */
chrome.devtools.panels.create('Puzzle', 'icons/icon48.png', 'panel.html');
