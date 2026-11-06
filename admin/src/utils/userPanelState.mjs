import { presentText } from './missingValue.mjs';
import { toValidDate } from './sessionDates.mjs';

/** The only Content Manager model that gets the session side panel. */
export const USER_MODEL_UID = 'plugin::users-permissions.user';

/** Maximum number of open-session cards in the side panel; the rest is "+n more". */
export const PANEL_SESSION_LIMIT = 5;

/** Dashboard route (relative to the admin router) used by the panel and the home widget. */
export const DASHBOARD_PATH = '/plugins/magic-sessionmanager';

/**
 * @param {unknown} model Content Manager model uid.
 * @returns {boolean} Whether the panel may render for this model.
 */
export function isUserModel(model) {
  return model === USER_MODEL_UID;
}

/**
 * Last known activity of a session row: "Last active", else the sign-in time.
 *
 * @param {object} session Session row.
 * @returns {Date|null} Activity time or null.
 */
const getActivity = (session) => toValidDate(session?.lastActive) || toValidDate(session?.loginTime);

/**
 * Summarises one user's sessions for the panel header (IA D3):
 * - isOnline: at least one open session is active (the shared "Online" rule);
 * - openCount: open sessions, active or idle;
 * - lastActive: the latest activity over every row the panel received,
 *   including ended sessions; null means "No sessions recorded".
 *
 * @param {object[]} sessions All session rows of the user.
 * @returns {{isOnline: boolean, openCount: number, activeCount: number, lastActive: Date|null}} Summary.
 */
export function getUserSessionSummary(sessions) {
  const rows = Array.isArray(sessions) ? sessions.filter((row) => row && typeof row === 'object') : [];
  const open = rows.filter((session) => session.isActive === true);
  const activeCount = open.filter((session) => session.isTrulyActive === true).length;
  let lastActive = null;
  for (const session of rows) {
    const activity = getActivity(session);
    if (activity && (!lastActive || activity.getTime() > lastActive.getTime())) lastActive = activity;
  }
  return { isOnline: activeCount > 0, openCount: open.length, activeCount, lastActive };
}

/**
 * Sorts the open sessions by last activity (newest first) and splits them into
 * the cards shown in the panel and the number behind "+n more".
 *
 * @param {object[]} sessions Open sessions.
 * @param {number} [limit] Maximum visible cards.
 * @returns {{visible: object[], hiddenCount: number}} Visible cards and number of hidden sessions.
 */
export function getVisiblePanelSessions(sessions, limit = PANEL_SESSION_LIMIT) {
  const rows = Array.isArray(sessions) ? [...sessions] : [];
  rows.sort((a, b) => (getActivity(b)?.getTime() ?? -Infinity) - (getActivity(a)?.getTime() ?? -Infinity));
  return { visible: rows.slice(0, limit), hiddenCount: Math.max(0, rows.length - limit) };
}

/**
 * Marks every open row as ended after "End all sessions" or "Block user"
 * succeeded, so the panel updates in place and keeps the "Last active" line.
 *
 * @param {object[]} sessions All session rows.
 * @param {'manual'|'blocked'} reason End reason the server records.
 * @returns {object[]} New rows; ended rows are returned unchanged.
 */
export function endOpenSessions(sessions, reason) {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((session) => (session?.isActive === true
    ? { ...session, isActive: false, isTrulyActive: false, terminationReason: reason }
    : session));
}

/**
 * Name used for the user in confirmations and notifications.
 *
 * @param {{username?: unknown, email?: unknown}|null|undefined} user Content Manager document.
 * @returns {string} User name, else e-mail, else ''.
 */
export function getPanelUserLabel(user) {
  return presentText(user?.username) || presentText(user?.email);
}

/**
 * @param {unknown} error Error thrown by useFetchClient.
 * @returns {boolean} Whether the server answered 404.
 */
export function isNotFoundError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.status === 404 || error.response?.status === 404;
}

/**
 * Builds the "Show all sessions" link: the dashboard with its search set to
 * the user's e-mail (IA C, D3). The dashboard search is Strapi's SearchInput,
 * which keeps its value in the standard `_q` query parameter.
 *
 * @param {{email?: unknown, username?: unknown}|null|undefined} user Content Manager document.
 * @returns {string} Dashboard path, filtered when the user has an e-mail or user name.
 */
export function buildUserSessionsHref(user) {
  const query = presentText(user?.email) || presentText(user?.username);
  if (!query) return DASHBOARD_PATH;
  return `${DASHBOARD_PATH}?${new URLSearchParams({ _q: query }).toString()}`;
}

/**
 * Decides how the open Content Manager edit form learns the new "blocked"
 * value after the panel blocked or unblocked the user, so a later Save cannot
 * write the stale value back (F1, UX-04).
 *
 * - reset: the form has no unsaved edits; replace its initial values so it stays clean.
 * - change: the form has unsaved edits; set only the "blocked" field and keep the edits.
 * - notice: no edit form with a "blocked" field is available; ask the admin to reload.
 *
 * @param {{initialValues?: unknown, modified?: unknown, blocked: boolean}} input Form state and new value.
 * @returns {{mode: 'reset', initialValues: object}|{mode: 'change', field: 'blocked', value: boolean}|{mode: 'notice'}} Plan.
 */
export function planBlockedFormSync({ initialValues, modified, blocked }) {
  const hasBlockedField = Boolean(initialValues)
    && typeof initialValues === 'object'
    && Object.prototype.hasOwnProperty.call(initialValues, 'blocked');
  if (!hasBlockedField || typeof blocked !== 'boolean') return { mode: 'notice' };
  if (!modified) return { mode: 'reset', initialValues: { ...initialValues, blocked } };
  return { mode: 'change', field: 'blocked', value: blocked };
}

/**
 * Applies a plan from planBlockedFormSync to the form API. Any failure falls
 * back to the reload notice instead of breaking the panel.
 *
 * @param {ReturnType<typeof planBlockedFormSync>} plan Sync plan.
 * @param {{resetForm?: Function, onChange?: Function}} form Form API from useForm.
 * @returns {boolean} Whether the form now holds the new value.
 */
export function applyBlockedFormSync(plan, form) {
  try {
    if (plan.mode === 'reset' && typeof form?.resetForm === 'function') {
      form.resetForm(plan.initialValues);
      return true;
    }
    if (plan.mode === 'change' && typeof form?.onChange === 'function') {
      form.onChange(plan.field, plan.value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
