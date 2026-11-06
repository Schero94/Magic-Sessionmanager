/**
 * Single session status vocabulary for every admin surface (dashboard,
 * modal, user panel, analytics, widget, exports).
 *
 * - active: the session is valid and was used recently.
 * - idle: the session is still valid but has not been used for a while.
 * - loggedout: the user ended the session.
 * - terminated: the session was ended by an administrator, a policy, expiry
 *   or the inactivity timeout. Use getSessionEndReason() for the cause.
 */
export const SESSION_STATUSES = Object.freeze(['active', 'idle', 'loggedout', 'terminated']);

/** Statuses that describe a session which can no longer be used. */
export const ENDED_SESSION_STATUSES = Object.freeze(['loggedout', 'terminated']);

/**
 * Presentation for each status. The tone is a DS Badge/Status variant; the
 * message id is relative to the plugin translation namespace (getTranslation).
 */
export const SESSION_STATUS_PRESENTATION = Object.freeze({
  active: Object.freeze({ tone: 'success', messageId: 'common.status.active', defaultMessage: 'Active' }),
  idle: Object.freeze({ tone: 'warning', messageId: 'common.status.idle', defaultMessage: 'Idle' }),
  loggedout: Object.freeze({ tone: 'neutral', messageId: 'common.status.loggedOut', defaultMessage: 'Logged out' }),
  terminated: Object.freeze({ tone: 'danger', messageId: 'common.status.terminated', defaultMessage: 'Terminated' }),
});

/**
 * Translated causes for an ended session, shown as secondary text next to the
 * status so "ended due to inactivity" is never confused with a valid idle session.
 */
export const SESSION_END_REASON_PRESENTATION = Object.freeze({
  logout: Object.freeze({ messageId: 'common.endReason.logout', defaultMessage: 'Logged out by the user' }),
  idle: Object.freeze({ messageId: 'common.endReason.idle', defaultMessage: 'Ended due to inactivity' }),
  expired: Object.freeze({ messageId: 'common.endReason.expired', defaultMessage: 'Expired' }),
  manual: Object.freeze({ messageId: 'common.endReason.manual', defaultMessage: 'Ended by an administrator' }),
  blocked: Object.freeze({ messageId: 'common.endReason.blocked', defaultMessage: 'Ended because the user was blocked' }),
  other: Object.freeze({ messageId: 'common.endReason.other', defaultMessage: 'Ended' }),
});

const KNOWN_END_REASONS = new Set(['logout', 'idle', 'expired', 'manual', 'blocked']);

/**
 * Normalizes the supported session lifecycle fields into a display status.
 * Sessions ended by the inactivity timeout are "terminated" (end reason
 * "idle"), never "idle": idle means the session can still be refreshed.
 *
 * @param {object} session Session view-model row.
 * @returns {'active'|'idle'|'loggedout'|'terminated'} Display status.
 */
export function getSessionStatus(session = {}) {
  const row = session || {};
  if (row.isActive) {
    return row.isTrulyActive ? 'active' : 'idle';
  }

  if (row.terminationReason === 'logout') return 'loggedout';
  if (row.terminationReason) return 'terminated';

  return row.logoutTime ? 'loggedout' : 'terminated';
}

/**
 * Returns why an ended session ended, or null for a session that is still valid.
 *
 * @param {object} session Session view-model row.
 * @returns {null|'logout'|'idle'|'expired'|'manual'|'blocked'|'other'} End reason.
 */
export function getSessionEndReason(session = {}) {
  const row = session || {};
  if (row.isActive) return null;
  const reason = typeof row.terminationReason === 'string' ? row.terminationReason.trim().toLowerCase() : '';
  if (KNOWN_END_REASONS.has(reason)) return reason;
  if (reason) return 'other';
  return row.logoutTime ? 'logout' : 'other';
}

/**
 * @param {unknown} status A display status.
 * @returns {boolean} Whether the status is part of the shared vocabulary.
 */
export function isSessionStatus(status) {
  return SESSION_STATUSES.includes(/** @type {string} */ (status));
}

/**
 * @param {unknown} status A display status.
 * @returns {boolean} Whether a session with this status has ended.
 */
export function isEndedSessionStatus(status) {
  return ENDED_SESSION_STATUSES.includes(/** @type {string} */ (status));
}

/**
 * Resolves the presentation (tone + message) for a status or a session row.
 * Unknown values fall back to "terminated" so a badge is never empty.
 *
 * @param {string|object} statusOrSession Status key or session row.
 * @returns {{status: string, tone: string, messageId: string, defaultMessage: string}} Presentation.
 */
export function getSessionStatusPresentation(statusOrSession) {
  const status = typeof statusOrSession === 'string'
    ? statusOrSession
    : getSessionStatus(statusOrSession);
  const key = isSessionStatus(status) ? status : 'terminated';
  return { status: key, ...SESSION_STATUS_PRESENTATION[key] };
}

/**
 * Resolves the translated end reason message for an ended session.
 *
 * @param {object} session Session row.
 * @returns {null|{reason: string, messageId: string, defaultMessage: string}} Presentation or null.
 */
export function getSessionEndReasonPresentation(session) {
  const reason = getSessionEndReason(session);
  if (!reason) return null;
  return { reason, ...SESSION_END_REASON_PRESENTATION[reason] };
}
