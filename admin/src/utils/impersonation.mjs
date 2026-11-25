/**
 * Impersonation in the admin panel (4.20): durations, reason validation with
 * the server's bounds, the remaining time and the frontend hand-off. Pure
 * functions (the hand-off takes the document), so `node --test` covers them.
 */

/** Durations of an app-user impersonation in minutes (server: USER_DURATIONS). */
export const USER_IMPERSONATION_DURATIONS = Object.freeze([15, 30, 60]);

/** Default duration. */
export const DEFAULT_IMPERSONATION_MINUTES = 15;

/** Reason bounds after trimming (server: REASON_MIN / REASON_MAX). */
export const REASON_MIN = 3;
export const REASON_MAX = 255;

/**
 * Validates a reason the way the server does.
 *
 * @param {unknown} value Draft reason.
 * @returns {{messageId: string, defaultMessage: string, values?: object}|null} Error
 *   descriptor, or null when valid.
 */
export function validateReason(value) {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (clean.length < REASON_MIN) {
    return {
      messageId: 'impersonation.reason.tooShort',
      defaultMessage: 'Enter a reason of at least {min} characters.',
      values: { min: REASON_MIN },
    };
  }
  if (clean.length > REASON_MAX) {
    return {
      messageId: 'impersonation.reason.tooLong',
      defaultMessage: 'Use at most {max} characters.',
      values: { max: REASON_MAX },
    };
  }
  return null;
}

/**
 * Whole seconds until an ISO time (never below 0).
 *
 * @param {string|null|undefined} iso End time.
 * @param {number} [now] Current time in milliseconds.
 * @returns {number} Seconds left.
 */
export function secondsUntil(iso, now = Date.now()) {
  const end = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - now) / 1000));
}

/**
 * Seconds as `m:ss` (or `h:mm:ss` from one hour).
 *
 * @param {number} seconds Seconds.
 * @returns {string} Clock text.
 */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Sends the one-time code to the configured frontend in a new tab with an
 * HTTP POST, so the code never appears in a URL, the browser history, a
 * Referer header or an access log. The form is removed right after submit.
 *
 * @param {Document} doc Document to build the form in.
 * @param {{url: string, field: string, code: string}} handoff Hand-off from the start response.
 * @returns {boolean} Whether the form was submitted.
 */
export function submitFrontendHandoff(doc, handoff) {
  if (!doc || !handoff || typeof handoff.url !== 'string' || typeof handoff.code !== 'string') {
    return false;
  }
  let url;
  try {
    url = new URL(handoff.url);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = url.toString();
  form.target = '_blank';
  form.rel = 'noopener noreferrer';
  form.style.display = 'none';
  const input = doc.createElement('input');
  input.type = 'hidden';
  input.name = typeof handoff.field === 'string' && handoff.field ? handoff.field : 'code';
  input.value = handoff.code;
  form.appendChild(input);
  doc.body.appendChild(form);
  try {
    form.submit();
  } finally {
    form.remove();
  }
  return true;
}
