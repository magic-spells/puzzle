/**
 * emptystate.js — the copy every panel shows when there is no app to inspect.
 *
 * Four panels render this identically, so it lives in one place: a wording
 * change is one edit, and the panels cannot drift into saying subtly different
 * things about the same condition.
 */
import { CONNECTION_STATE } from './models/connection.js';

/**
 * The single most common support answer, and the one thing the panel cannot
 * detect: the page hook is injected at `document_start`, so a tab that was
 * already open when the extension was installed or reloaded has no hook at all
 * and never will until it reloads. Appended to every not-connected state.
 */
export const REFRESH_HINT =
	'If this page loaded before the extension was installed or updated, refresh the page.';

const MISMATCH_HINT =
	'The page speaks a wire protocol this extension cannot render, so nothing below would be trustworthy. See the Connection panel.';

const WAITING_HINT =
	'This panel reads a dev-only runtime bridge. Run the app with `puzzle dev` (or build with --mode development), then reload the page with DevTools open.';

/**
 * Title + description for a panel's disconnected Empty block.
 *
 * @param {string} state the connection singleton's `state`
 * @returns {{ title: string, description: string }}
 */
export function disconnectedEmpty(state) {
	if (state === CONNECTION_STATE.MISMATCH) {
		return {
			title: 'Protocol version mismatch',
			description: MISMATCH_HINT,
		};
	}
	return {
		title: 'No Puzzle app detected',
		description: `${WAITING_HINT} ${REFRESH_HINT}`,
	};
}
