'use strict';

// @ts-check

/**
 * What a user's own data export (`GET /my-data`, GDPR Art. 15) shows of a
 * security event (security review 2, L3).
 *
 * Impersonation events carry what the admins see: the reason an admin typed,
 * which admin started it (`startedBy`), why it ended. Up to 4.22 the export
 * passed that `meta` through, so an internal note such as "suspected fraud"
 * reached the user although the admin UI said the reason is shown only in the
 * optional email. The export now shows a fixed sentence with the time
 * (`createdAt`) and the duration instead; the reason stays internal.
 */

const { SECURITY_EVENTS } = require('./security-log-model');

/** Fixed sentences per impersonation event. */
const IMPERSONATION_TEXT = Object.freeze({
  [SECURITY_EVENTS.IMPERSONATION_STARTED]: 'An administrator opened your account',
  [SECURITY_EVENTS.IMPERSONATION_ENDED]: 'The administrator access to your account ended',
  [SECURITY_EVENTS.IMPERSONATION_EXPIRED]: 'The administrator access to your account ended',
  [SECURITY_EVENTS.IMPERSONATION_REFUSED]: 'An administrator access to your account was refused',
});

/**
 * One security event as the user's export shows it. Database ids are
 * dropped; impersonation events get a fixed description and the duration
 * only.
 *
 * @param {Record<string, any>} row Event row (`event`, `createdAt`, `ip`, `userAgent`, `geo`, `meta`).
 * @returns {Record<string, any>} Exported event.
 */
function toUserExportEvent(row) {
  const { id: _id, ...rest } = row || {};
  const text = IMPERSONATION_TEXT[rest.event];
  if (!text) return rest;
  const minutes = Number(rest.meta?.durationMinutes);
  return {
    event: rest.event,
    createdAt: rest.createdAt,
    ip: null,
    userAgent: null,
    geo: null,
    meta: {
      description: text,
      ...(Number.isInteger(minutes) && minutes > 0 ? { durationMinutes: minutes } : {}),
    },
  };
}

module.exports = { IMPERSONATION_TEXT, toUserExportEvent };
