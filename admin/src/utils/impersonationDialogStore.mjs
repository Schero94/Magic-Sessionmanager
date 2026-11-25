/**
 * State of an open "Impersonate…" dialog per user (4.20), shared by every
 * mounted copy of the Content Manager side panel.
 *
 * Below the large breakpoint Strapi moves the side panels into a drawer and
 * re-mounts them, and after the drawer was used it can keep a second copy
 * mounted. Without this store the dialog would close on a re-mount (and the
 * credential shown only once would be lost), or open twice. The store keeps
 * the dialog state in memory (this tab only, never persisted) and elects one
 * mounted panel copy as the owner that renders the dialog. Subscribe with
 * React's `useSyncExternalStore`.
 */

/** @type {Map<string, {open: true, owner: string|null, draft: object}>} */
const dialogs = new Map();
/** @type {Map<string, string[]>} Mounted panel copies per user, in mount order. */
const mounted = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * @param {() => void} listener Called after every change.
 * @returns {() => void} Unsubscribe.
 */
export function subscribeImpersonationDialogs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * @param {string} key User documentId.
 * @returns {{open: true, owner: string|null, draft: object}|null} Current dialog (stable object).
 */
export function getImpersonationDialog(key) {
  return dialogs.get(key) || null;
}

/**
 * Registers a mounted panel copy. When a dialog is open without a mounted
 * owner, this copy becomes the owner.
 *
 * @param {string} key User documentId.
 * @param {string} instance Panel copy id.
 * @returns {() => void} Unregister on unmount; ownership passes to another copy.
 */
export function registerImpersonationPanel(key, instance) {
  const list = [...(mounted.get(key) || []), instance];
  mounted.set(key, list);
  const dialog = dialogs.get(key);
  if (dialog && (!dialog.owner || !list.includes(dialog.owner))) {
    dialogs.set(key, { ...dialog, owner: instance });
    notify();
  }
  return () => {
    const rest = (mounted.get(key) || []).filter((id) => id !== instance);
    if (rest.length) mounted.set(key, rest);
    else mounted.delete(key);
    const current = dialogs.get(key);
    if (current && current.owner === instance) {
      dialogs.set(key, { ...current, owner: rest[rest.length - 1] || null });
      notify();
    }
  };
}

/**
 * Opens the dialog for a user, owned by the panel copy that opened it.
 *
 * @param {string} key User documentId.
 * @param {string} instance Panel copy id.
 * @returns {void}
 */
export function openImpersonationDialog(key, instance) {
  dialogs.set(key, { open: true, owner: instance, draft: {} });
  notify();
}

/**
 * Keeps the dialog's draft and result for a re-mount (no re-render).
 *
 * @param {string} key User documentId.
 * @param {object} draft Reason, duration, notify choice and result.
 * @returns {void}
 */
export function saveImpersonationDraft(key, draft) {
  const current = dialogs.get(key);
  if (current) dialogs.set(key, { ...current, draft });
}

/**
 * Closes the dialog for every panel copy and forgets its state.
 *
 * @param {string} key User documentId.
 * @returns {void}
 */
export function closeImpersonationDialog(key) {
  if (dialogs.delete(key)) notify();
}
