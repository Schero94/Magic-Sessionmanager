/** Restore focus to a connected opener, or to a stable dashboard fallback. */
export function restoreDialogFocus(event, opener, fallback) {
  const target = opener?.isConnected ? opener : fallback?.isConnected ? fallback : null;
  if (!target || typeof target.focus !== 'function') return;
  event.preventDefault();
  target.focus();
}
