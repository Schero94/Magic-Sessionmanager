/**
 * Runs the impersonation tab of "Sign in as this admin" (4.23).
 *
 * `bootImpersonationTab()` runs when the plugin's admin module loads: on
 * the landing page it takes the one-time code from the URL hash (and removes
 * it at once), keeps the real admin's token in memory for the exchange only,
 * and installs the tab shim; in a tab that already impersonates it installs
 * the shim before Strapi reads the token. `startImpersonationTab()` runs in
 * the plugin's `register`, when `window.strapi.backendURL` is known: it
 * exchanges the code, then reloads the tab into the admin panel, and mounts
 * the banner. Every other tab is untouched: nothing here runs without this
 * tab's own sessionStorage state.
 */

import {
  installTabShim,
  landingBase,
  parseLandingHash,
  readRealToken,
  readTabState,
  writeTabState,
} from './utils/adminImpersonationTab.mjs';

/** In-memory only: the real admin's token for the one exchange call. */
let landingCredential = null;
/** Admin base path of the landing page. */
let adminBase = null;
let started = false;

/**
 * Backend URL of the admin API.
 *
 * @returns {string}
 */
const backendURL = () => String(window.strapi?.backendURL || window.location.origin);

/**
 * Admin base path of this tab: from the landing page, or `/admin`.
 *
 * @returns {string}
 */
const adminPath = () => {
  if (adminBase !== null) return adminBase;
  const stored = readTabState(window)?.adminBase;
  return typeof stored === 'string' && /^(\/[A-Za-z0-9._~-]+)*$/.test(stored) ? stored : '/admin';
};

/**
 * Marks the tab ended (state kept so the tab stays out of the real
 * admin's session until the person chooses).
 *
 * @param {string} reason `ended`, `expired` or `failed`.
 * @returns {void}
 */
export function markEnded(reason) {
  const state = readTabState(window);
  if (!state) return;
  writeTabState(window, {
    phase: state.phase === 'landing' ? 'failed' : 'ended',
    cookieName: state.cookieName,
    adminBase: state.adminBase,
    impersonation: state.impersonation,
    reason,
  });
  window.dispatchEvent(new Event('msm-impersonation-change'));
}

/**
 * Ends the impersonation of this tab on the server (its own session only)
 * and marks the tab ended.
 *
 * @param {string} [reason] Why.
 * @returns {Promise<void>}
 */
export async function endImpersonation(reason = 'ended') {
  const state = readTabState(window);
  if (state?.phase === 'active' && state.token) {
    try {
      await window.fetch(`${backendURL()}/magic-sessionmanager/admin-impersonation/self/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' },
      });
    } catch {
      // The session expires on the server either way.
    }
  }
  markEnded(reason);
}

/**
 * Leaves the ended tab: removes the tab state and loads the admin panel
 * with the browser's own (real) session.
 *
 * @returns {void}
 */
export function leaveImpersonationTab() {
  writeTabState(window, null);
  window.location.replace(`${adminPath()}/`);
}

/**
 * First step, at module load. Safe to call more than once.
 *
 * @returns {void}
 * @sideeffect May rewrite the URL, write this tab's sessionStorage and install the tab shim.
 */
export function bootImpersonationTab() {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  const base = landingBase(window.location.pathname);
  if (base !== null) {
    adminBase = base;
    const handoff = parseLandingHash(window.location.hash);
    // The code never stays in the address bar or the history entry.
    window.history.replaceState(null, '', window.location.pathname);
    if (handoff && readTabState(window)?.phase !== 'active') {
      landingCredential = readRealToken(window, handoff.cookieName);
      writeTabState(window, {
        phase: 'landing',
        code: handoff.code,
        cookieName: handoff.cookieName,
        adminBase: base,
      });
    }
  }
  const state = readTabState(window);
  if (!state) return;
  installTabShim(window, {
    onLogout: () => {
      endImpersonation('ended');
    },
  });
}

/**
 * Exchanges the landing code for the target's token, then opens the admin.
 *
 * @returns {Promise<void>}
 */
async function completeLanding() {
  const state = readTabState(window);
  if (state?.phase !== 'landing') return;
  const credential = landingCredential;
  landingCredential = null;
  let data = null;
  if (credential && state.code) {
    try {
      const response = await window.fetch(
        `${backendURL()}/magic-sessionmanager/admin-impersonation/exchange`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credential}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ code: state.code }),
        }
      );
      if (response.ok) data = (await response.json())?.data || null;
    } catch {
      data = null;
    }
  }
  if (!data?.token) {
    writeTabState(window, {
      phase: 'failed',
      cookieName: state.cookieName,
      adminBase: state.adminBase,
      reason: 'exchange',
    });
    window.dispatchEvent(new Event('msm-impersonation-change'));
    return;
  }
  writeTabState(window, {
    phase: 'active',
    token: data.token,
    expiresAt: data.expiresAt,
    cookieName: data.cookieName || state.cookieName,
    adminBase: state.adminBase,
    impersonation: data.impersonation,
  });
  window.location.replace(`${adminPath()}/`);
}

/**
 * Second step, from the plugin's `register`: finishes the landing and
 * mounts the banner.
 *
 * @returns {void}
 */
export function startImpersonationTab() {
  if (started || typeof window === 'undefined') return;
  const state = readTabState(window);
  if (!state) return;
  started = true;
  if (state.phase === 'landing') completeLanding();
  import('./components/impersonation/ImpersonationTabBanner')
    .then(({ mountImpersonationBanner }) =>
      mountImpersonationBanner({
        end: endImpersonation,
        leave: leaveImpersonationTab,
        markEnded,
        backendURL,
      })
    )
    .catch(() => {
      // Without the banner the server still enforces the impersonation.
    });
}
