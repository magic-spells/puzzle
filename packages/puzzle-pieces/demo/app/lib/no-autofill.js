// Docs-site only: keep password managers from offering to fill the live demo
// inputs. The pieces themselves stay untouched — an app that copies
// `password-field` should still get its manager's autofill.
const FIELDS = 'input, textarea, select';

function mark(root) {
	if (root.matches?.(FIELDS)) root.setAttribute('data-1p-ignore', '');
	for (const el of root.querySelectorAll?.(FIELDS) ?? []) el.setAttribute('data-1p-ignore', '');
}

export function ignoreAutofill(root = document.body) {
	mark(root);
	new MutationObserver((records) => {
		for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) mark(node);
	}).observe(root, { childList: true, subtree: true });
}
