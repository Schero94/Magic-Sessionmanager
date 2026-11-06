import { getSessionStatus } from './sessionStatus.mjs';
import { presentText } from './missingValue.mjs';

/** The only Content Manager model that gets the session side panel. */
export const USER_MODEL_UID = 'plugin::users-permissions.user';

/** Maximum number of session cards in the side panel; the rest is behind "Show all". */
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
 * Summarises the current (still valid) sessions of one user for the panel header.
 * The user is "active" when any session is active, "idle" when all current
 * sessions are idle, and "none" without current sessions.
 *
 * @param {object[]} sessions Current sessions (see getManageableSessions).
 * @returns {{status: 'active'|'idle'|'none', currentCount: number, activeCount: number}} Summary.
 */
export function getUserSessionSummary(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const activeCount = rows.filter((session) => getSessionStatus(session) === 'active').length;
  let status = 'none';
  if (activeCount > 0) status = 'active';
  else if (rows.length > 0) status = 'idle';
  return { status, currentCount: rows.length, activeCount };
}

/**
 * Splits the session list into the cards shown in the panel and the hidden rest.
 *
 * @param {object[]} sessions Current sessions.
 * @param {number} [limit] Maximum visible cards.
 * @returns {{visible: object[], hiddenCount: number}} Visible cards and number of hidden sessions.
 */
export function getVisiblePanelSessions(sessions, limit = PANEL_SESSION_LIMIT) {
  const rows = Array.isArray(sessions) ? sessions : [];
  return { visible: rows.slice(0, limit), hiddenCount: Math.max(0, rows.length - limit) };
}

/**
 * Builds the dashboard link filtered to one user. The dashboard search uses
 * Strapi's standard `_q` query parameter (SearchInput) and matches e-mail
 * addresses and user names.
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
