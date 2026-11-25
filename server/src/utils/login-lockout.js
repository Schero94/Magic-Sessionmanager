'use strict';

// @ts-check

/**
 * Failed sign-in lockout per IP address and per account, on the shared
 * coordination store (`utils/coordination.js`), so every pm2 worker and
 * replica sees the same counts and locks.
 *
 * Flow for one sign-in request:
 *   1. `reserve()` before the password check: refuses a request whose IP or
 *      account is locked, then counts the attempt on both counters. A
 *      request over a threshold gives its reservation back and gets a short
 *      "try again" (it may be one of several correct sign-ins at once from
 *      one office address); it does not lock.
 *   2. `settle()` after the handler: a success clears the account counter
 *      and gives the IP hit back (it never clears the IP counter, so a
 *      sign-in to an attacker's own account cannot reset the address,
 *      security review 2, M2), a failure keeps the hits and locks a counter
 *      that reached its threshold, anything else (5xx, 429 from another
 *      limiter, a refused but correct sign-in) gives the hits back.
 *
 * A trusted address, and a request whose device the account has signed in
 * with before (`accountExempt`), is neither counted nor refused by the
 * account counter, so a stranger who knows the email cannot lock the owner
 * out of their usual device or office (security review 2, L1).
 *
 * Counter keys are SHA-256 hashes (`lf:` IP, `la:` lower-cased account
 * identifier); the typed identifier is never stored. A lock also writes a
 * listable entry (`lock:<key>`) with what the admin list shows: the IP
 * (already shortened when the log anonymises IPs) or the account's user
 * documentId, the number of failures and the lock end. Unlocking deletes
 * the counter and the entry.
 */

const { hashedKey } = require('./coordination');
const { isTrustedAddress } = require('./policy-settings');
const { ipBucket } = require('./admin-request-info');

const LOCK_PREFIX = 'lock:';
const KEY_PATTERN = /^(lf|la):[a-f0-9]{48}$/;
/** Most entries the "Locked now" list returns. */
const MAX_LISTED_LOCKS = 200;

/**
 * Normalises a typed sign-in identifier (email or username) the way
 * Users & Permissions matches emails: trimmed and lower-cased.
 *
 * @param {unknown} identifier Raw identifier from the request body.
 * @returns {string|null} Normalised identifier, or null when unusable.
 */
function normalizeIdentifier(identifier) {
  if (typeof identifier !== 'string') return null;
  const value = identifier.trim().toLowerCase();
  if (!value || value.length > 254) return null;
  return value;
}

/**
 * Counter key of a client address; IPv6 addresses count per /64 (security
 * review 2, hardening 7).
 *
 * @param {string} ip Client address.
 * @returns {string}
 */
const ipKey = (ip) => hashedKey('lf', ipBucket(ip) || ip);
/** @param {string} identifier Normalised identifier. @returns {string} */
const accountKey = (identifier) => hashedKey('la', identifier);

/**
 * @typedef {object} LockoutPolicy
 * @property {number} ipMax IP threshold (0 = off).
 * @property {number} windowMs Counting window.
 * @property {number} durationMs Lock duration.
 * @property {string[]} trusted Trusted addresses (never locked by IP).
 */

/**
 * @typedef {object} Reservation
 * @property {string|null} ipKey Counter key of the IP, when counted.
 * @property {number} ipHits Hits after this request.
 * @property {string|null} accountKey Counter key of the account, when counted.
 * @property {number} accountHits Hits after this request.
 */

/**
 * @typedef {object} LockDisplay
 * @property {string|null} [ip] IP to show for an IP lock (null to hide).
 * @property {string|null} [userDocumentId] Account owner of an account lock, if known.
 */

/**
 * Creates the lockout engine on a coordinator.
 *
 * @param {object} coordinator Coordinator from `getCoordinator(strapi)`.
 * @param {{now?: () => number}} [options] Clock for tests.
 * @returns {object} Engine with reserve, settle, listLocks and unlock.
 */
function createLoginLockout(coordinator, { now = () => Date.now() } = {}) {
  /**
   * Remaining lock time of a counter in seconds, or 0.
   *
   * @param {string|null} key Counter key.
   * @returns {Promise<number>} Seconds.
   */
  const remainingSeconds = async (key) => {
    if (!key) return 0;
    const entry = await coordinator.peek(key);
    const until = Number(entry?.blockedUntil) || 0;
    const left = until - now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  };

  /**
   * Gives back the hits of a reservation.
   *
   * @param {Reservation} reservation Reservation.
   * @returns {Promise<void>}
   */
  const release = async (reservation) => {
    if (reservation.ipKey) await coordinator.release(reservation.ipKey);
    if (reservation.accountKey) await coordinator.release(reservation.accountKey);
  };

  return {
    normalizeIdentifier,

    /**
     * Checks the locks and counts the attempt before the password check.
     *
     * @param {{ip: string|null, identifier: string|null, policy: LockoutPolicy,
     *   accountMax: number, accountExempt?: boolean}} input Client IP, normalised
     *   identifier, policy, the account threshold for this account's role, and
     *   whether the request comes from a device the account is known to use.
     * @returns {Promise<{outcome: 'allow'|'locked'|'busy', retryAfter: number,
     *   lockedKind: 'ip'|'account'|null, reservation: Reservation}>} Decision.
     * @sideeffect Increments the shared counters.
     */
    async reserve({ ip, identifier, policy, accountMax, accountExempt = false }) {
      const knownIp = typeof ip === 'string' && !!ip && ip !== 'unknown';
      const trusted = knownIp && isTrustedAddress(policy.trusted, ip);
      const countIp = policy.ipMax > 0 && knownIp && !trusted;
      const countAccount =
        accountMax > 0 &&
        typeof identifier === 'string' &&
        !!identifier &&
        !trusted &&
        accountExempt !== true;
      /** @type {Reservation} */
      const reservation = {
        ipKey: countIp ? ipKey(/** @type {string} */ (ip)) : null,
        ipHits: 0,
        accountKey: countAccount ? accountKey(/** @type {string} */ (identifier)) : null,
        accountHits: 0,
      };
      if (!reservation.ipKey && !reservation.accountKey) {
        return { outcome: 'allow', retryAfter: 0, lockedKind: null, reservation };
      }

      const [ipLeft, accountLeft] = await Promise.all([
        remainingSeconds(reservation.ipKey),
        remainingSeconds(reservation.accountKey),
      ]);
      if (ipLeft > 0 || accountLeft > 0) {
        return {
          outcome: 'locked',
          retryAfter: Math.max(ipLeft, accountLeft),
          lockedKind: accountLeft >= ipLeft && accountLeft > 0 ? 'account' : 'ip',
          reservation: { ipKey: null, ipHits: 0, accountKey: null, accountHits: 0 },
        };
      }

      if (reservation.ipKey) {
        reservation.ipHits = (await coordinator.hit(reservation.ipKey, policy.windowMs)).hits;
      }
      if (reservation.accountKey) {
        reservation.accountHits = (
          await coordinator.hit(reservation.accountKey, policy.windowMs)
        ).hits;
      }
      if (
        (reservation.ipKey && reservation.ipHits > policy.ipMax) ||
        (reservation.accountKey && reservation.accountHits > accountMax)
      ) {
        await release(reservation);
        return { outcome: 'busy', retryAfter: 1, lockedKind: null, reservation };
      }
      return { outcome: 'allow', retryAfter: 0, lockedKind: null, reservation };
    },

    /**
     * Records the result of the sign-in.
     *
     * @param {Reservation} reservation From `reserve`.
     * @param {'success'|'failure'|'neutral'} result Outcome of the handler.
     * @param {{policy: LockoutPolicy, accountMax: number, display?: LockDisplay}} options
     *   Policy, account threshold and what the lock list shows.
     * @returns {Promise<Array<{kind: 'ip'|'account', id: string, failures: number, until: number}>>}
     *   Locks this request created.
     * @sideeffect Clears, releases or blocks shared counters; writes lock entries.
     */
    async settle(reservation, result, { policy, accountMax, display = {} }) {
      if (result === 'success') {
        if (reservation.ipKey) await coordinator.release(reservation.ipKey);
        if (reservation.accountKey) await coordinator.clear(reservation.accountKey);
        return [];
      }
      if (result !== 'failure') {
        await release(reservation);
        return [];
      }
      /** @type {Array<{kind: 'ip'|'account', id: string, failures: number, until: number}>} */
      const locks = [];
      const until = now() + policy.durationMs;
      const candidates = [
        reservation.ipKey && reservation.ipHits >= policy.ipMax
          ? {
              kind: /** @type {const} */ ('ip'),
              id: reservation.ipKey,
              failures: reservation.ipHits,
            }
          : null,
        reservation.accountKey && reservation.accountHits >= accountMax
          ? {
              kind: /** @type {const} */ ('account'),
              id: reservation.accountKey,
              failures: reservation.accountHits,
            }
          : null,
      ];
      for (const lock of candidates) {
        if (!lock) continue;
        // The window now ends with the lock, so the failures that caused it
        // do not count again once it ends.
        await coordinator.block(lock.id, until, { windowStart: until - policy.windowMs });
        await coordinator.registryPut(
          `${LOCK_PREFIX}${lock.id}`,
          {
            kind: lock.kind,
            ip: lock.kind === 'ip' ? display.ip || null : null,
            user: lock.kind === 'account' ? display.userDocumentId || null : null,
            failures: lock.failures,
            lockedAt: now(),
            until,
          },
          policy.durationMs
        );
        locks.push({ ...lock, until });
      }
      return locks;
    },

    /**
     * Active locks, soonest end last.
     *
     * @returns {Promise<Array<{id: string, kind: 'ip'|'account', ip: string|null,
     *   user: string|null, failures: number, lockedAt: number, until: number}>>} Locks.
     */
    async listLocks() {
      const entries = await coordinator.registryList(LOCK_PREFIX, MAX_LISTED_LOCKS);
      const current = now();
      return entries
        .map(({ key, value }) => ({
          id: key.slice(LOCK_PREFIX.length),
          kind: value?.kind === 'account' ? 'account' : 'ip',
          ip: typeof value?.ip === 'string' ? value.ip : null,
          user: typeof value?.user === 'string' ? value.user : null,
          failures: Number(value?.failures) || 0,
          lockedAt: Number(value?.lockedAt) || 0,
          until: Number(value?.until) || 0,
        }))
        .filter((lock) => KEY_PATTERN.test(lock.id) && lock.until > current)
        .sort((a, b) => b.lockedAt - a.lockedAt);
    },

    /**
     * Lifts a lock: deletes the counter and the list entry.
     *
     * @param {string} id Lock id from `listLocks` (`lf:…` or `la:…`).
     * @returns {Promise<{kind: 'ip'|'account', ip: string|null, user: string|null}|null>}
     *   The lifted lock, or null when the id is invalid or nothing was locked.
     * @sideeffect Deletes the shared counter and the lock entry.
     */
    async unlock(id) {
      if (typeof id !== 'string' || !KEY_PATTERN.test(id)) return null;
      const entries = await coordinator.registryList(`${LOCK_PREFIX}${id}`, 1);
      const entry = entries.find((candidate) => candidate.key === `${LOCK_PREFIX}${id}`);
      const counter = await coordinator.peek(id);
      const blocked = Number(counter?.blockedUntil) > now();
      await coordinator.clear(id);
      await coordinator.registryDelete(`${LOCK_PREFIX}${id}`);
      if (!entry && !blocked) return null;
      return {
        kind: id.startsWith('la:') ? 'account' : 'ip',
        ip: typeof entry?.value?.ip === 'string' ? entry.value.ip : null,
        user: typeof entry?.value?.user === 'string' ? entry.value.user : null,
      };
    },
  };
}

module.exports = {
  LOCK_ID_PATTERN: KEY_PATTERN,
  accountKey,
  createLoginLockout,
  ipKey,
  normalizeIdentifier,
};
