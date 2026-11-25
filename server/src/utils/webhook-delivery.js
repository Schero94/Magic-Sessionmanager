'use strict';

// @ts-check

/**
 * Signed generic webhook delivery (4.17).
 *
 * - Signature: `X-Magic-Sessionmanager-Signature: t=<unix seconds>,v1=<hex>`
 *   where `<hex>` is HMAC-SHA256 with the webhook secret over
 *   `<t>.<raw body>`. Receivers recompute it, compare in constant time and
 *   reject old timestamps (README "Signed webhook").
 * - SSRF protection: https only, no credentials in the URL; the host name is
 *   resolved first and EVERY resolved address must be public (no loopback,
 *   private, link-local incl. 169.254.169.254, CGNAT, multicast, reserved,
 *   documentation, IPv4-mapped or unique-local IPv6). The connection is then
 *   pinned to the checked address (no second DNS lookup, so DNS rebinding
 *   cannot switch it), redirects are not followed, the request times out
 *   and at most 64 KB of the answer are read.
 * - Retries: network errors, timeouts, 429 and 5xx are retried with backoff
 *   (default 3 attempts: now, after 2 s, after 10 s). Other answers are final.
 */

const crypto = require('node:crypto');
const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const SIGNATURE_HEADER = 'X-Magic-Sessionmanager-Signature';
const EVENT_HEADER = 'X-Magic-Sessionmanager-Event';
const DELIVERY_HEADER = 'X-Magic-Sessionmanager-Delivery';
const USER_AGENT = 'Strapi-Magic-SessionManager-Webhook/2.0';
const TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RETRY_DELAYS_MS = Object.freeze([0, 2000, 10000]);

/** Address ranges a webhook must never reach. */
const BLOCKED = (() => {
  const list = new net.BlockList();
  for (const [address, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]) {
    list.addSubnet(address, prefix, 'ipv4');
  }
  for (const [address, prefix] of [
    ['::', 128],
    ['::1', 128],
    // IPv4-mapped addresses (::ffff:0:0/96) are not listed: BlockList
    // checks them against the IPv4 rules above, and a listed /96 would
    // match every IPv4 address.
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001::', 23],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
  ]) {
    list.addSubnet(address, prefix, 'ipv6');
  }
  return list;
})();

/**
 * Whether an address must not be contacted.
 *
 * @param {string} address IP address.
 * @returns {boolean} True for non-public addresses and unparsable input.
 */
function isBlockedAddress(address) {
  let value = String(address || '').trim();
  if (value.toLowerCase().startsWith('::ffff:') && net.isIPv4(value.slice(7))) {
    value = value.slice(7);
  }
  const version = net.isIP(value);
  if (version === 0) return true;
  return BLOCKED.check(value, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Signature header value for a body.
 *
 * @param {string} secret Webhook secret.
 * @param {string} body Raw JSON body.
 * @param {number} [timestamp] Unix seconds (default now).
 * @returns {string} `t=…,v1=…`.
 */
function signPayload(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * Verifies a signature header (the receiver side; used by the tests and
 * shown in the README).
 *
 * @param {string} secret Webhook secret.
 * @param {string} body Raw body as received.
 * @param {string} header Signature header.
 * @param {{toleranceSeconds?: number, now?: number}} [options] Replay window.
 * @returns {boolean} True when valid and fresh.
 */
function verifySignature(secret, body, header, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(String(header || ''));
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const given = Buffer.from(match[2], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Error with a stable, safe code. */
class DeliveryError extends Error {
  /**
   * @param {string} code Stable code.
   * @param {boolean} retryable Whether another attempt may succeed.
   * @param {number|null} [status] HTTP status, when there was one.
   */
  constructor(code, retryable, status = null) {
    super(code);
    this.name = 'DeliveryError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

/**
 * Resolves a host name to every address.
 *
 * @param {string} hostname Host.
 * @returns {Promise<Array<{address: string, family: number}>>} Addresses.
 */
const resolveAll = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Sends one HTTPS POST to a pinned, checked address.
 *
 * @param {{url: URL, address: {address: string, family: number}, headers: Record<string, string>,
 *   body: string, timeoutMs: number}} input Request.
 * @returns {Promise<number>} HTTP status.
 */
function httpsPost({ url, address, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        timeout: timeoutMs,
        // Pinned to the address that passed the check: no second lookup.
        lookup: (_hostname, options, callback) => {
          if (options && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        let received = 0;
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) response.destroy();
        });
        response.on('end', () => resolve(response.statusCode || 0));
        response.on('close', () => resolve(response.statusCode || 0));
        response.on('error', () => resolve(response.statusCode || 0));
      }
    );
    request.on('timeout', () => request.destroy(new DeliveryError('timeout', true)));
    request.on('error', (err) =>
      reject(err instanceof DeliveryError ? err : new DeliveryError('network_error', true))
    );
    request.end(body);
  });
}

/**
 * One delivery attempt: checks the URL and every resolved address, then posts.
 *
 * @param {{url: string, body: string, headers: Record<string, string>,
 *   resolve?: typeof resolveAll, post?: typeof httpsPost, timeoutMs?: number}} input Request and seams.
 * @returns {Promise<{status: number}>} Status of a 2xx answer.
 * @throws {DeliveryError} With a safe code: invalid_url, dns_failed, address_not_allowed,
 *   timeout, network_error, redirect_not_followed, http_<status>.
 */
async function deliverOnce({
  url,
  body,
  headers,
  resolve = resolveAll,
  post = httpsPost,
  timeoutMs = TIMEOUT_MS,
}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new DeliveryError('invalid_url', false);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new DeliveryError('invalid_url', false);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host, family: net.isIP(host) }];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new DeliveryError('dns_failed', true);
    }
  }
  if (!Array.isArray(addresses) || addresses.length === 0)
    throw new DeliveryError('dns_failed', true);
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new DeliveryError('address_not_allowed', false);
  }
  const status = await post({ url: parsed, address: addresses[0], headers, body, timeoutMs });
  if (status >= 200 && status < 300) return { status };
  if (status >= 300 && status < 400)
    throw new DeliveryError('redirect_not_followed', false, status);
  throw new DeliveryError(`http_${status}`, status === 429 || status >= 500, status);
}

/**
 * Builds the signed request of one event.
 *
 * @param {{event: string, data: Record<string, unknown>, secret: string, id?: string,
 *   now?: Date}} input Event, data and secret.
 * @returns {{id: string, body: string, headers: Record<string, string>}} Request parts.
 */
function buildSignedRequest({ event, data, secret, id = crypto.randomUUID(), now = new Date() }) {
  const body = JSON.stringify({ id, event, createdAt: now.toISOString(), data });
  return {
    id,
    body,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      [EVENT_HEADER]: event,
      [DELIVERY_HEADER]: id,
      [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(now.getTime() / 1000)),
    },
  };
}

/**
 * Delivers with retries.
 *
 * @param {{url: string, body: string, headers: Record<string, string>,
 *   resolve?: typeof resolveAll, post?: typeof httpsPost, delays?: readonly number[],
 *   sleep?: (ms: number) => Promise<void>, timeoutMs?: number}} input Request and seams.
 * @returns {Promise<{ok: boolean, status: number|null, code: string|null, attempts: number}>} Outcome.
 */
async function deliverWithRetries({
  delays = RETRY_DELAYS_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
  ...request
}) {
  let attempts = 0;
  let last = { ok: false, status: null, code: 'not_sent' };
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    attempts += 1;
    try {
      const { status } = await deliverOnce(request);
      return { ok: true, status, code: null, attempts };
    } catch (err) {
      const error = err instanceof DeliveryError ? err : new DeliveryError('network_error', true);
      last = { ok: false, status: error.status, code: error.code };
      if (!error.retryable) break;
    }
  }
  return { ...last, attempts };
}

module.exports = {
  DELIVERY_HEADER,
  DeliveryError,
  EVENT_HEADER,
  RETRY_DELAYS_MS,
  SIGNATURE_HEADER,
  buildSignedRequest,
  deliverOnce,
  deliverWithRetries,
  isBlockedAddress,
  signPayload,
  verifySignature,
};
