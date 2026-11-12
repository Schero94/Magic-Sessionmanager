/**
 * Pure helpers for the untracked-session notice on the Sessions dashboard:
 * Strapi sign-ins (Users & Permissions refresh tokens) that Strapi still
 * accepts but that have no session details in this plugin.
 */

/** Admin API path of the count-only diagnostics. */
export const UNTRACKED_SUMMARY_PATH = '/magic-sessionmanager/sessions/native-only/summary';

/** Admin API path that ends untracked sessions (bounded per request). */
export const UNTRACKED_END_PATH = '/magic-sessionmanager/sessions/native-only/end';

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Tone of the notice. Untracked sessions created only before the plugin
 * started tracking are legacy and expire on their own (neutral). Any created
 * afterwards point to a sign-in path the plugin does not see (warning).
 * An unknown split (`null`) stays neutral: no alarm without evidence.
 *
 * @param {{nativeOnly: number, nativeOnlyAfterTracking: number|null}} stats
 * @returns {'neutral'|'warning'}
 */
export function untrackedTone(stats) {
  return isCount(stats?.nativeOnlyAfterTracking) && stats.nativeOnlyAfterTracking > 0
    ? 'warning'
    : 'neutral';
}

/**
 * Reads and checks the summary response. Every count must be a whole,
 * non-negative number; anything else is an invalid response.
 *
 * @param {unknown} payload `{ data: summary }`
 * @returns {object} The summary.
 * @throws {Error} When the response does not have the expected shape.
 */
export function readUntrackedSummary(payload) {
  const data = /** @type {any} */ (payload)?.data;
  const fail = () => {
    throw new Error('Invalid untracked session summary');
  };
  if (!data || typeof data !== 'object') fail();
  const counts = [
    data.total,
    data.beforeTracking,
    data.afterTracking,
    data.earlier,
    data.bySource?.signIn,
    data.bySource?.passwordChange,
    data.bySource?.tokenOnly,
    data.byDevice?.desktop,
    data.byDevice?.mobile,
    data.byDevice?.unknown,
    data.deviceSample?.scanned,
    data.deviceSample?.limit,
    data.expiring?.within7Days,
    data.expiring?.within30Days,
  ];
  if (!counts.every(isCount)) fail();
  if (!Array.isArray(data.byMonth)) fail();
  const byMonth = data.byMonth.filter(
    (entry) => typeof entry?.month === 'string' && /^\d{4}-\d{2}$/.test(entry.month)
  );
  if (!byMonth.every((entry) => isCount(entry.count))) fail();
  const since = typeof data.trackingSince === 'string' ? new Date(data.trackingSince) : null;
  return {
    total: data.total,
    trackingSince: since && Number.isFinite(since.getTime()) ? since : null,
    beforeTracking: data.beforeTracking,
    afterTracking: data.afterTracking,
    byMonth,
    earlier: data.earlier,
    bySource: { ...data.bySource },
    byDevice: { ...data.byDevice },
    deviceSample: { ...data.deviceSample, complete: data.deviceSample.complete === true },
    expiring: { ...data.expiring },
  };
}

/**
 * Share of `part` in `total` as a fraction for `formatNumber(..., {style: 'percent'})`.
 *
 * @param {number} part
 * @param {number} total
 * @returns {number} 0..1
 */
export function shareOf(part, total) {
  if (!isCount(part) || !isCount(total) || total === 0) return 0;
  return Math.min(1, part / total);
}

/**
 * First day (UTC) of a `YYYY-MM` month, for locale-aware month labels.
 *
 * @param {string} month `YYYY-MM`
 * @returns {Date|null}
 */
export function monthToDate(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || '');
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/**
 * Reads the end response.
 *
 * @param {unknown} payload `{ data: { ended, remaining, limit } }`
 * @returns {{ended: number, remaining: number, limit: number}}
 * @throws {Error} When a count is missing.
 */
export function readEndResult(payload) {
  const data = /** @type {any} */ (payload)?.data;
  if (!isCount(data?.ended) || !isCount(data?.remaining) || !isCount(data?.limit)) {
    throw new Error('Invalid end response');
  }
  return { ended: data.ended, remaining: data.remaining, limit: data.limit };
}
