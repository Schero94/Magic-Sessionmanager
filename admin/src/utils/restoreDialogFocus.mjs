/**
 * @param {any} element Candidate focus target.
 * @returns {boolean} Whether the element is in the document and not disabled.
 */
const canTakeFocus = (element) => Boolean(
  element?.isConnected
  && typeof element.focus === 'function'
  && !element.disabled
  && element.getAttribute?.('aria-disabled') !== 'true'
);

/**
 * Picks where focus goes after a dialog closes: the opener when it can still
 * take focus, else the fallback. A disabled opener (for example "End all
 * sessions" after the last session ended) would drop focus on <body>.
 *
 * @param {any} opener Element that opened the dialog.
 * @param {any} fallback Stable focusable container.
 * @returns {any} The target, or null when neither can take focus.
 */
export function pickFocusTarget(opener, fallback) {
  if (canTakeFocus(opener)) return opener;
  return canTakeFocus(fallback) ? fallback : null;
}

/** Restore focus to a connected opener, or to a stable dashboard fallback. */
export function restoreDialogFocus(event, opener, fallback) {
  const target = pickFocusTarget(opener, fallback);
  if (!target) return;
  event.preventDefault();
  target.focus();
}

/**
 * After an action whose button is disabled while it runs (Save, Update
 * database, Save credentials), the browser drops keyboard focus on <body>.
 * Focus goes back to that button, or to the fallback, but only when it was
 * lost; focus the admin moved elsewhere stays where it is.
 *
 * @param {any} opener Button that started the action.
 * @param {any} [fallback] Focus target when the button cannot take focus.
 * @param {{activeElement: any, body: any}} [doc] Document (injectable for tests).
 * @returns {void}
 */
export function refocusIfLost(opener, fallback, doc = typeof document === 'undefined' ? undefined : document) {
  if (!doc) return;
  const active = doc.activeElement;
  if (active && active !== doc.body) return;
  pickFocusTarget(opener, fallback)?.focus();
}
