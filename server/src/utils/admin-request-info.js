'use strict';

// @ts-check

/**
 * Request facts the admin sign-in history stores: client IP, user agent and a
 * hash of the browser's device id.
 *
 * Client IP: only `ctx.request.ip`. Koa derives it from the socket, or from
 * the proxy header when the host sets `server.proxy.koa: true`; Strapi passes
 * `server.proxy.ipHeader` and `server.proxy.maxIpsCount` to Koa
 * (`@strapi/core/dist/services/server/index.js`, docs: Configurations >
 * Server > proxy). This module never reads `X-Forwarded-For` itself, so a
 * client cannot choose the stored address unless the host trusts its proxy
 * headers, and with `maxIpsCount` set Koa reads only the hops the host's own
 * proxies added.
 */

const crypto = require('node:crypto');
const net = require('node:net');
const { parseUserAgent } = require('./user-agent-parser');

/**
 * Longest stored user agent (4.17: 256, was 500). Real browsers send about
 * 120 to 200 characters; the rest only let a client store more text.
 */
const MAX_USER_AGENT_LENGTH = 256;
/** Longest device id that is hashed (the admin panel sends a UUID). */
const MAX_DEVICE_ID_LENGTH = 200;

/**
 * Normalises an address: strips brackets, a port on IPv4, the IPv4-mapped
 * IPv6 prefix and an IPv6 zone id. Returns null for anything that is not an
 * IP address.
 *
 * @param {unknown} value Raw address.
 * @returns {string|null} IPv4 or IPv6 address, or null.
 */
function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  let ip = value.trim();
  if (!ip || ip.length > 100) return null;
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    ip = end === -1 ? ip.slice(1) : ip.slice(1, end);
  }
  if (/^::ffff:/i.test(ip) && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (ip.includes('.') && ip.split(':').length === 2) ip = ip.split(':')[0];
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  return net.isIP(ip) === 0 ? null : ip.toLowerCase();
}

/**
 * The client IP of a request as Strapi/Koa resolved it (`ctx.request.ip`).
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Normalised address, or null when unknown.
 */
function getRequestIp(ctx) {
  try {
    return normalizeIp(ctx?.request?.ip);
  } catch {
    return null;
  }
}

/**
 * The address of the TCP peer (the socket), normalised. Behind a proxy this
 * is the proxy; without one it equals `ctx.request.ip`. Stored, anonymised,
 * next to the client IP when the two differ (4.17, F7), so a spoofed
 * `X-Forwarded-For` value can be told apart.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Normalised address, or null when unknown.
 */
function getSocketIp(ctx) {
  try {
    return normalizeIp(ctx?.req?.socket?.remoteAddress ?? ctx?.request?.socket?.remoteAddress);
  } catch {
    return null;
  }
}

/**
 * Expands an IPv6 address to its eight 16-bit groups.
 *
 * @param {string} ip Valid IPv6 address (no zone id).
 * @returns {number[]} Eight groups.
 */
function ipv6Groups(ip) {
  let address = ip;
  /** @type {number[]} */
  let tail = [];
  // An embedded IPv4 suffix (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) counts as two groups.
  const lastColon = address.lastIndexOf(':');
  const suffix = address.slice(lastColon + 1);
  if (net.isIPv4(suffix)) {
    const [a, b, c, d] = suffix.split('.').map(Number);
    tail = [(a << 8) | b, (c << 8) | d];
    address = `${address.slice(0, lastColon + 1)}0`;
  }
  const [head, rest] = address.includes('::') ? address.split('::') : [address, null];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const fill = rest === null ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right].map((g) =>
    Number.parseInt(g || '0', 16)
  );
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups.slice(0, 8);
}

/**
 * Removes the host part of an address before storage: the last octet of an
 * IPv4 address (203.0.113.42 -> 203.0.113.0, a /24) and everything after the
 * first 48 bits of an IPv6 address (2001:db8:abcd:12::1 -> 2001:db8:abcd::).
 *
 * @param {string|null} ip Normalised address.
 * @returns {string|null} Anonymised address, or null.
 */
function anonymizeIp(ip) {
  if (!ip) return null;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (net.isIPv6(ip)) {
    const groups = ipv6Groups(ip);
    return `${groups
      .slice(0, 3)
      .map((group) => group.toString(16))
      .join(':')}::`;
  }
  return null;
}

/**
 * The counting identity of a client address for rate limits and the IP
 * lockout (security review 2, hardening 7): an IPv4 address as is, an IPv6
 * address as its /64 network, because one subscriber usually holds a whole
 * /64 and could otherwise use a new address for every attempt.
 *
 * @param {unknown} ip Client address.
 * @returns {string|null} `a.b.c.d`, `x:x:x:x::/64`, or null when not an IP address.
 */
function ipBucket(ip) {
  const value = normalizeIp(typeof ip === 'string' ? ip : '');
  if (!value) return null;
  if (net.isIPv4(value)) return value;
  if (net.isIPv6(value)) {
    return `${ipv6Groups(value)
      .slice(0, 4)
      .map((group) => group.toString(16))
      .join(':')}::/64`;
  }
  return null;
}

/**
 * User agent of a request, cut to the stored length.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} User agent or null.
 */
function getRequestUserAgent(ctx) {
  const value = ctx?.request?.headers?.['user-agent'];
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.slice(0, MAX_USER_AGENT_LENGTH);
}

/**
 * Browser, OS and device type for display, from the stored user agent.
 *
 * @param {string|null} userAgent User agent.
 * @returns {{browserName: string|null, osName: string|null, deviceType: string|null}} Parsed facts.
 */
function describeUserAgent(userAgent) {
  if (!userAgent) return { browserName: null, osName: null, deviceType: null };
  const parsed = parseUserAgent(userAgent);
  const known = (value) => (value && value !== 'unknown' ? String(value) : null);
  const browser = known(parsed.browserName);
  const os = known(parsed.osName);
  return {
    browserName: browser
      ? (parsed.browserVersion ? `${browser} ${parsed.browserVersion}` : browser).slice(0, 60)
      : null,
    osName: os ? (parsed.osVersion ? `${os} ${parsed.osVersion}` : os).slice(0, 60) : null,
    deviceType: known(parsed.deviceType)?.slice(0, 20) || null,
  };
}

/**
 * SHA-256 of the browser's device id, so a sign-in can be matched with the
 * Strapi session of the same browser without storing the id itself.
 *
 * @param {unknown} deviceId Device id from the request body or a session row.
 * @returns {string|null} 64 hex characters, or null.
 */
function hashDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) {
    return null;
  }
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}

module.exports = {
  MAX_USER_AGENT_LENGTH,
  anonymizeIp,
  ipBucket,
  describeUserAgent,
  getRequestIp,
  getSocketIp,
  getRequestUserAgent,
  hashDeviceId,
  normalizeIp,
};
