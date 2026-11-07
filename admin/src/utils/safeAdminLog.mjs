const SAFE_SCOPE = /^[A-Za-z0-9_.:-]{1,48}$/;
const CANCEL_NAMES = new Set(['AbortError', 'TimeoutError', 'CanceledError']);

/**
 * Reads a property without letting a hostile getter or proxy throw.
 *
 * @param {unknown} value Object to read from.
 * @param {string} key Property name.
 * @returns {unknown} The property value, or undefined.
 */
function safeGet(value, key) {
  try {
    return value && typeof value === 'object' ? value[key] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a rejected admin request was cancelled rather than failed.
 * `useFetchClient` (Strapi 5) aborts its AbortController when the component
 * unmounts, so leaving a page mid-request rejects with a DOMException named
 * `AbortError`. Strapi 5.61 ships `isAbortError` for this, but the plugin
 * supports `@strapi/strapi ^5.0.0`, so the check is done by name here.
 *
 * @param {unknown} error Rejected value from an admin request.
 * @returns {boolean} True when the request was aborted or timed out.
 */
export function isCancelledRequest(error) {
  const name = safeGet(error, 'name');
  return typeof name === 'string' && CANCEL_NAMES.has(name);
}

/**
 * Logs only a fixed scope and an HTTP status, never the raw browser error.
 * Fetch errors can retain authorization headers, response bodies, or user data.
 *
 * Cancelled requests are not failures and are not logged. Real failures are
 * already shown in the UI (alert, notification or error state), so they are
 * reported as a console warning, not a console error.
 *
 * @param {string} scope Static operation name used to locate the failing UI flow.
 * @param {unknown} error Rejected value from an admin request or browser API.
 * @returns {void}
 */
export function logSafeAdminError(scope, error) {
  if (isCancelledRequest(error)) return;

  const safeScope = typeof scope === 'string' && SAFE_SCOPE.test(scope) ? scope : 'admin';
  // Strapi's FetchError carries the HTTP status on `error.status`; older
  // axios-style errors used `error.response.status`.
  const directStatus = safeGet(error, 'status');
  const status = Number.isInteger(directStatus)
    ? directStatus
    : safeGet(safeGet(error, 'response'), 'status');

  const statusSuffix =
    Number.isInteger(status) && status >= 400 && status <= 599 ? ` (HTTP ${status})` : '';

  console.warn(`[${safeScope}] Request failed${statusSuffix}`);
}
