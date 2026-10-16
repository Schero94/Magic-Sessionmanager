const SAFE_SCOPE = /^[A-Za-z0-9_.:-]{1,48}$/;

/**
 * Logs only a fixed scope and an HTTP status, never the raw browser error.
 * Fetch errors can retain authorization headers, response bodies, or user data.
 *
 * @param {string} scope Static operation name used to locate the failing UI flow.
 * @param {unknown} error Rejected value from an admin request or browser API.
 * @returns {void}
 */
export function logSafeAdminError(scope, error) {
  const safeScope = typeof scope === 'string' && SAFE_SCOPE.test(scope) ? scope : 'admin';
  let status;

  try {
    status = error && typeof error === 'object' ? error.response?.status : undefined;
  } catch {
    status = undefined;
  }

  const statusSuffix = Number.isInteger(status) && status >= 400 && status <= 599
    ? ` (HTTP ${status})`
    : '';

  console.error(`[${safeScope}] Request failed${statusSuffix}`);
}
