'use strict';

// @ts-check

/**
 * Client IP address of a request (security review 2, H2).
 *
 * The address is Koa's `ctx.request.ip`. Koa resolves it from the socket,
 * or, when Strapi's `server.proxy.koa` is on, from `server.proxy.ipHeader`
 * (default `X-Forwarded-For`) limited to the last `server.proxy.maxIpsCount`
 * entries (Koa 2.16 `request.ips`). The plugin does not read any proxy
 * header on its own, so a client cannot choose its address with
 * `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP` or a left-most
 * `X-Forwarded-For` entry.
 *
 * One exception: when the `trustedProxies` setting lists addresses or CIDR
 * ranges and the TCP peer is on that list, the address is the right-most
 * `X-Forwarded-For` entry that is not a listed proxy (each listed proxy
 * appends the address it received the request from). With a list, a peer
 * that is not listed is used as is, even when Koa trusts proxy headers.
 */

const net = require('node:net');
const { isTrustedAddress } = require('./policy-settings');
const { normalizeTrustedProxies } = require('./trusted-proxies');

/** Longest `X-Forwarded-For` value that is read; longer ones are cut. */
const MAX_FORWARDED_LENGTH = 2048;
/** Most hops read from `X-Forwarded-For`. */
const MAX_FORWARDED_HOPS = 20;

/**
 * Cleans an IP address: strips brackets, a port and the IPv4-mapped IPv6
 * prefix.
 *
 * @param {unknown} ip Raw address.
 * @returns {string} Cleaned address, or 'unknown'.
 */
const cleanIp = (ip) => {
  if (!ip) return 'unknown';

  let value = String(ip).trim();

  if (value.startsWith('[')) {
    const bracketEnd = value.indexOf(']');
    if (bracketEnd !== -1) {
      value = value.substring(1, bracketEnd);
    }
  }

  if (value.toLowerCase().startsWith('::ffff:') && net.isIPv4(value.substring(7))) {
    value = value.substring(7);
  }

  if (value.includes('.') && value.includes(':') && value.indexOf(':') === value.lastIndexOf(':')) {
    value = value.split(':')[0];
  }

  return value || 'unknown';
};

/**
 * The configured trusted proxy list: the request's merged settings first,
 * then the plugin config.
 *
 * @param {any} ctx Koa context.
 * @returns {string[]} Address and CIDR texts.
 */
function trustedProxyList(ctx) {
  const fromSettings = ctx?.state?.__magicSessionSettings?.trustedProxies;
  if (fromSettings !== undefined) return normalizeTrustedProxies(fromSettings);
  try {
    const config = ctx?.app?.context?.strapi?.config?.get?.('plugin::magic-sessionmanager');
    return normalizeTrustedProxies(config?.trustedProxies);
  } catch {
    return [];
  }
}

/**
 * The address of the TCP peer.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Cleaned address, or null when unknown.
 */
function socketAddress(ctx) {
  const raw = ctx?.req?.socket?.remoteAddress ?? ctx?.request?.socket?.remoteAddress;
  const cleaned = cleanIp(raw);
  return cleaned !== 'unknown' && net.isIP(cleaned) ? cleaned : null;
}

/**
 * The right-most `X-Forwarded-For` entry that is not a trusted proxy.
 *
 * @param {any} ctx Koa context.
 * @param {string[]} proxies Trusted proxy list.
 * @returns {string|null} Client address, or null when the header has none.
 */
function rightMostUntrustedHop(ctx, proxies) {
  const headers = ctx?.request?.headers || ctx?.request?.header || {};
  let header = headers['x-forwarded-for'];
  if (Array.isArray(header)) header = header.join(',');
  if (typeof header !== 'string' || !header) return null;
  const hops = header
    .slice(0, MAX_FORWARDED_LENGTH)
    .split(',')
    .map((hop) => cleanIp(hop))
    .slice(-MAX_FORWARDED_HOPS);
  let lastValid = null;
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index];
    // A malformed entry ends the chain: everything left of it is unverified.
    if (!net.isIP(hop)) return lastValid;
    if (!isTrustedAddress(proxies, hop)) return hop;
    lastValid = hop;
  }
  return lastValid;
}

/**
 * Main entry point. Returns a cleaned IP string or 'unknown'.
 *
 * @param {any} ctx Koa context.
 * @returns {string} Client address.
 */
const getClientIp = (ctx) => {
  try {
    const proxies = trustedProxyList(ctx);
    if (proxies.length > 0) {
      const peer = socketAddress(ctx);
      if (peer && isTrustedAddress(proxies, peer)) {
        return rightMostUntrustedHop(ctx, proxies) || peer;
      }
      if (peer) return peer;
    }
    if (ctx?.request?.ip) return cleanIp(ctx.request.ip);
    return 'unknown';
  } catch (error) {
    if (ctx?.app?.context?.strapi?.log?.debug) {
      ctx.app.context.strapi.log.debug(
        '[getClientIp] Error extracting IP:',
        error?.name || 'Error'
      );
    }
    return 'unknown';
  }
};

module.exports = getClientIp;
module.exports.cleanIp = cleanIp;
