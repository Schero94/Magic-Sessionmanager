/**
 * Pure helpers of the Admin panel sessions view: URL state, request
 * parameters, status mapping, durations and error mapping. No React, so
 * `node --test` covers them without a bundler.
 */

/** List filters, same values as the API. */
export const ADMIN_FILTER_OPTIONS = Object.freeze(['all', 'signed-in', 'not-signed-in']);

/** Page sizes offered by the pagination footer. */
export const ADMIN_PAGE_SIZE_OPTIONS = Object.freeze(['10', '25', '50', '100']);

/** Default page size. */
export const ADMIN_DEFAULT_PAGE_SIZE = '25';

/** Longest search the API accepts. */
export const ADMIN_MAX_SEARCH_LENGTH = 100;

/**
 * Reads the view state from the URL query (useQueryParams). Unknown or
 * out-of-range values fall back to the defaults instead of failing the page.
 *
 * @param {Record<string, unknown>|undefined} query Parsed URL query.
 * @returns {{page: number, pageSize: number, filter: string, search: string}} View state.
 */
export function parseAdminPanelQuery(query = {}) {
  const page = Number.parseInt(String(query?.page ?? ''), 10);
  const pageSize = String(query?.pageSize ?? '');
  const filter = String(query?.filter ?? '');
  // The search is stored URI-encoded (encodeSearchQuery), like the dashboard.
  let search = '';
  if (typeof query?.search === 'string') {
    try {
      search = decodeURIComponent(query.search).trim();
    } catch {
      search = query.search.trim();
    }
  }
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    pageSize: Number(
      ADMIN_PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ADMIN_DEFAULT_PAGE_SIZE
    ),
    filter: ADMIN_FILTER_OPTIONS.includes(filter) ? filter : 'all',
    search: search.slice(0, ADMIN_MAX_SEARCH_LENGTH),
  };
}

/**
 * Query parameters for `GET /admin-sessions/admins`.
 *
 * @param {{page: number, pageSize: number, filter: string, search: string}} state View state.
 * @returns {Record<string, string|number>} Request parameters (empty search omitted).
 */
export function buildAdminListParams(state) {
  return {
    page: state.page,
    pageSize: state.pageSize,
    filter: state.filter,
    ...(state.search ? { search: state.search } : {}),
  };
}

/**
 * Whether search or filter narrows the list (for "Clear filters").
 *
 * @param {{filter: string, search: string}} state View state.
 * @returns {boolean}
 */
export function hasAdminFilters(state) {
  return state.filter !== 'all' || Boolean(state.search);
}

/**
 * Badge and second line of an admin row. Colour never carries meaning
 * alone: every state has its own label. Danger is reserved for destructive
 * buttons, so a deactivated account is neutral.
 *
 * @param {{account: string, sessionCount: number}} row Admin row from the API.
 * @returns {{key: string, tone: string, label: {messageId: string, defaultMessage: string},
 *   detail: {messageId: string, defaultMessage: string, values?: object}}} Presentation.
 */
export function getAdminStatusPresentation(row) {
  if (row?.account === 'invited') {
    return {
      key: 'invited',
      tone: 'secondary',
      label: { messageId: 'adminPanel.status.invited', defaultMessage: 'Invited' },
      detail: {
        messageId: 'adminPanel.status.invited.detail',
        defaultMessage: 'Invitation not accepted yet',
      },
    };
  }
  if (row?.account === 'deactivated') {
    return {
      key: 'deactivated',
      tone: 'neutral',
      label: { messageId: 'adminPanel.status.deactivated', defaultMessage: 'Deactivated' },
      detail: {
        messageId: 'adminPanel.status.deactivated.detail',
        defaultMessage: 'Cannot sign in',
      },
    };
  }
  const count = Number(row?.sessionCount) || 0;
  if (count > 0) {
    return {
      key: 'signed-in',
      tone: 'success',
      label: { messageId: 'adminPanel.status.signedIn', defaultMessage: 'Signed in' },
      detail: {
        messageId: 'adminPanel.status.signedIn.detail',
        defaultMessage: '{count, plural, one {# session} other {# sessions}}',
        values: { count },
      },
    };
  }
  return {
    key: 'not-signed-in',
    tone: 'neutral',
    label: { messageId: 'adminPanel.status.notSignedIn', defaultMessage: 'Not signed in' },
    detail: {
      messageId: 'adminPanel.status.notSignedIn.detail',
      defaultMessage: 'No open session',
    },
  };
}

/**
 * Splits a duration in seconds into the largest whole unit for an ICU
 * plural message ("2 hours", "14 days", "30 minutes").
 *
 * @param {unknown} seconds Duration in seconds.
 * @returns {{unit: 'days'|'hours'|'minutes', count: number}|null} Null for invalid input.
 */
export function splitDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value % 86400 === 0) return { unit: 'days', count: value / 86400 };
  if (value % 3600 === 0) return { unit: 'hours', count: value / 3600 };
  return { unit: 'minutes', count: Math.max(1, Math.round(value / 60)) };
}

/**
 * Maps a failed sign-out to a translated message. The server's own 403
 * reason decides between the Super Admin guard and a missing permission.
 *
 * @param {unknown} error Rejected value of the request (Strapi FetchError).
 * @returns {{messageId: string, defaultMessage: string}} Message descriptor.
 */
export function getSignOutErrorMessage(error) {
  const response = /** @type {any} */ (error)?.response;
  const status = Number(response?.status ?? /** @type {any} */ (error)?.status);
  const reason = response?.data?.error?.details?.reason;
  if (status === 403 && reason === 'super-admin-protected') {
    return {
      messageId: 'adminPanel.signOut.error.protected',
      defaultMessage: 'Only a Super Admin can sign out a Super Admin.',
    };
  }
  if (status === 403) {
    return {
      messageId: 'adminPanel.signOut.error.forbidden',
      defaultMessage: 'You do not have permission to sign admins out.',
    };
  }
  if (status === 404) {
    return {
      messageId: 'adminPanel.signOut.error.gone',
      defaultMessage: 'This session has already ended. The list is up to date now.',
    };
  }
  if (status === 429) {
    return {
      messageId: 'adminPanel.signOut.error.rateLimited',
      defaultMessage: 'Too many sign-outs in a short time. Wait a minute and try again.',
    };
  }
  return {
    messageId: 'adminPanel.signOut.error.generic',
    defaultMessage: 'The admin could not be signed out. Try again.',
  };
}
