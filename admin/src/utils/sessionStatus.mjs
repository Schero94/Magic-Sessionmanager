/**
 * Session lifecycle state model for every admin surface (dashboard, dialog,
 * user panel, analytics, widget, exports). IA section B.1:
 *
 *   isActive && isTrulyActive   -> 'active'
 *   isActive && !isTrulyActive  -> 'idle'   (open, unused longer than the timeout)
 *   !isActive                   -> 'ended'  + end reason (terminationReason ?? 'unrecorded')
 *
 * Badge = state, reason = a text line. Danger is not a session-state colour:
 * an ended session is not an error (IA B.3).
 */
export const SESSION_STATES = Object.freeze(['active', 'idle', 'ended']);

/** Kept for existing imports: the shared vocabulary is the state list. */
export const SESSION_STATUSES = SESSION_STATES;

/** States that describe a session which can no longer be used. */
export const ENDED_SESSION_STATUSES = Object.freeze(['ended']);

/** End reasons in filter order (IA A.4, D1 End reason select). */
export const SESSION_END_REASONS = Object.freeze(['logout', 'idle', 'expired', 'manual', 'blocked', 'unrecorded']);

const RECORDED_END_REASONS = new Set(['logout', 'idle', 'expired', 'manual', 'blocked']);

const ACTIVE_DEFINITION = Object.freeze({
  messageId: 'common.status.active.definition',
  defaultMessage: 'Open and used within the inactivity timeout.',
});

/**
 * Badge presentation per state. `tone` is a DS Badge variant; `help` is the
 * helper text shown as the badge tooltip (IA B.3) and `definition` the
 * glossary sentence used in the "How sessions work" legend (IA A.3).
 */
export const SESSION_STATUS_PRESENTATION = Object.freeze({
  active: Object.freeze({
    tone: 'success',
    messageId: 'common.status.active',
    defaultMessage: 'Active',
    // B.3 tooltip and A.3 definition are the same sentence: one message.
    help: ACTIVE_DEFINITION,
    definition: ACTIVE_DEFINITION,
  }),
  idle: Object.freeze({
    tone: 'warning',
    messageId: 'common.status.idle',
    defaultMessage: 'Idle',
    help: Object.freeze({
      messageId: 'common.status.idle.help',
      defaultMessage: 'Still open. It ends on its next request or at the next idle check. A token refresh makes it active again.',
    }),
    definition: Object.freeze({
      messageId: 'common.status.idle.definition',
      defaultMessage: 'Open, but not used for longer than the inactivity timeout. It ends on its next request or at the next idle check. A token refresh makes it active again.',
    }),
  }),
  ended: Object.freeze({
    tone: 'neutral',
    messageId: 'common.status.ended',
    defaultMessage: 'Ended',
    help: null,
    definition: Object.freeze({
      messageId: 'common.status.ended.definition',
      defaultMessage: 'The session can no longer be used. The user has to sign in again on this device.',
    }),
  }),
});

/**
 * End reason label and definition (IA A.4). The label is the reason line
 * under the badge, the filter option and the dialog value; the definition
 * is the badge tooltip and the dialog's explanation.
 */
export const SESSION_END_REASON_PRESENTATION = Object.freeze({
  logout: Object.freeze({
    messageId: 'common.endReason.logout',
    defaultMessage: 'Logged out',
    description: Object.freeze({ messageId: 'common.endReason.logout.description', defaultMessage: 'The user signed out.' }),
  }),
  idle: Object.freeze({
    messageId: 'common.endReason.idle',
    defaultMessage: 'Timed out',
    description: Object.freeze({
      messageId: 'common.endReason.idle.description',
      defaultMessage: 'Not used for longer than the inactivity timeout.',
    }),
  }),
  expired: Object.freeze({
    messageId: 'common.endReason.expired',
    defaultMessage: 'Expired',
    description: Object.freeze({
      messageId: 'common.endReason.expired.description',
      defaultMessage: 'Reached the maximum session age.',
    }),
  }),
  manual: Object.freeze({
    messageId: 'common.endReason.manual',
    defaultMessage: 'Ended manually',
    description: Object.freeze({
      messageId: 'common.endReason.manual.description',
      defaultMessage: 'Ended from the Strapi admin, or by the user from another of their devices.',
    }),
  }),
  blocked: Object.freeze({
    messageId: 'common.endReason.blocked',
    defaultMessage: 'User blocked',
    description: Object.freeze({
      messageId: 'common.endReason.blocked.description',
      defaultMessage: 'Ended because the user account was blocked.',
    }),
  }),
  unrecorded: Object.freeze({
    messageId: 'common.endReason.unrecorded',
    defaultMessage: 'Reason not recorded',
    description: Object.freeze({
      messageId: 'common.endReason.unrecorded.description',
      defaultMessage: 'No end reason was stored, for example because the session ended in Strapi’s own session store or was recorded by an older plugin version.',
    }),
  }),
});

/**
 * Derives the display state (IA B.1).
 *
 * @param {object} session Session view-model row.
 * @returns {'active'|'idle'|'ended'} State.
 */
export function getSessionState(session = {}) {
  const row = session || {};
  if (row.isActive === true) return row.isTrulyActive ? 'active' : 'idle';
  return 'ended';
}

/**
 * Same derivation under the name every screen already imports.
 *
 * @param {object} session Session view-model row.
 * @returns {'active'|'idle'|'ended'} State.
 */
export function getSessionStatus(session = {}) {
  return getSessionState(session);
}

/**
 * Why an ended session ended, or null for an open one. A row without a
 * recorded reason is "unrecorded", even when it has an end time: the reason
 * is no longer guessed from `logoutTime` (decision I.2-1).
 *
 * @param {object} session Session view-model row.
 * @returns {null|'logout'|'idle'|'expired'|'manual'|'blocked'|'unrecorded'} End reason.
 */
export function getSessionEndReason(session = {}) {
  const row = session || {};
  if (row.isActive === true) return null;
  const reason = typeof row.terminationReason === 'string' ? row.terminationReason.trim().toLowerCase() : '';
  return RECORDED_END_REASONS.has(reason) ? /** @type {any} */ (reason) : 'unrecorded';
}

/**
 * @param {object} session Session row.
 * @returns {boolean} Whether the row was synthesised from Strapi's own session store (IA A.2).
 */
export function isNativeOnlySession(session) {
  const id = session?.id;
  return typeof id === 'string' && id.startsWith('native_');
}

/**
 * @param {unknown} status A display state.
 * @returns {boolean} Whether the value is one of the three states.
 */
export function isSessionStatus(status) {
  return SESSION_STATES.includes(/** @type {any} */ (status));
}

/**
 * @param {unknown} status A display state.
 * @returns {boolean} Whether a session in this state has ended.
 */
export function isEndedSessionStatus(status) {
  return ENDED_SESSION_STATUSES.includes(/** @type {any} */ (status));
}

/**
 * @param {unknown} reason An end reason.
 * @returns {boolean} Whether the value is one of the six end reasons.
 */
export function isSessionEndReason(reason) {
  return SESSION_END_REASONS.includes(/** @type {any} */ (reason));
}

/**
 * Presentation (tone, label, tooltip, legend definition) for a state or a
 * session row. Unknown values fall back to the neutral "Ended" badge so a
 * badge is never empty and never red.
 *
 * @param {string|object} statusOrSession State key or session row.
 * @returns {{status: string, tone: string, messageId: string, defaultMessage: string, help: {messageId: string, defaultMessage: string}|null, definition: {messageId: string, defaultMessage: string}}} Presentation.
 */
export function getSessionStatusPresentation(statusOrSession) {
  const status = typeof statusOrSession === 'string'
    ? statusOrSession
    : getSessionState(statusOrSession);
  const key = isSessionStatus(status) ? status : 'ended';
  return { status: key, ...SESSION_STATUS_PRESENTATION[key] };
}

/**
 * Label and definition descriptors for an end reason key (the EndReason
 * text helper, IA I.1 item 2).
 *
 * @param {string} reason End reason key.
 * @returns {{reason: string, messageId: string, defaultMessage: string, description: {messageId: string, defaultMessage: string}}} Presentation.
 */
export function getEndReasonPresentation(reason) {
  const key = isSessionEndReason(reason) ? reason : 'unrecorded';
  return { reason: key, ...SESSION_END_REASON_PRESENTATION[key] };
}

/**
 * Label and definition for an ended session, or null for an open one.
 *
 * @param {object} session Session row.
 * @returns {null|{reason: string, messageId: string, defaultMessage: string, description: {messageId: string, defaultMessage: string}}} Presentation.
 */
export function getSessionEndReasonPresentation(session) {
  const reason = getSessionEndReason(session);
  return reason ? getEndReasonPresentation(reason) : null;
}
