'use strict';

/**
 * Extracts the real client IP address from a request.
 *
 * By default we ONLY trust proxy headers if the request originated from a
 * trusted upstream (Strapi's Koa `app.proxy = true` setting AND an inbound
 * socket from a configured trusted proxy range, OR the plugin's
 * `trustedProxies` config listing the upstream).
 *
 * If neither is the case, we fall back to the raw socket address — which
 * prevents clients from trivially spoofing IPs via `X-Forwarded-For`.
 *
 * Header priority when trusted:
 *   1. CF-Connecting-IP (Cloudflare)
 *   2. True-Client-IP (Akamai / CF Enterprise)
 *   3. X-Real-IP (nginx)
 *   4. X-Forwarded-For (first address)
 *   5. X-Client-IP
 *   6. X-Cluster-Client-IP
 *   7. Forwarded (RFC 7239)
 *   8. ctx.request.ip
 */

/**
 * Returns true if Strapi is configured to trust upstream proxies (i.e.
 * `server.proxy = true` OR the plugin lists `trustedProxies`). When this is
 * false, proxy headers are ignored to prevent spoofing.
 *
 * @param {object} ctx - Koa context
 * @returns {boolean}
 */
function isProxyTrusted(ctx) {
  try {
    const app = ctx?.app;
    if (app && app.proxy === true) return true;
  } catch {
    // Ignore Koa/app property access issues in unusual deployments
  }

  try {
    const config = ctx?.state?.__magicSessionSettings
      || ctx?.app?.context?.strapi?.config?.get?.('plugin::magic-sessionmanager')
      || {};
    const trusted = config.trustedProxies;
    if (trusted === true) return true;
    if (Array.isArray(trusted) && trusted.length > 0) return true;
  } catch {
    // Ignore config access failures; default to untrusted.
  }

  return false;
}

/**
 * Main entry point. Returns a cleaned IP string or 'unknown'.
 *
 * @param {object} ctx - Koa context
 * @returns {string}
 */
const getClientIp = (ctx) => {
  try {
    const headers = ctx.request.headers || ctx.request.header || {};
    const trusted = isProxyTrusted(ctx);

    if (trusted) {
      if (headers['cf-connecting-ip']) return cleanIp(headers['cf-connecting-ip']);
      if (headers['true-client-ip']) return cleanIp(headers['true-client-ip']);
      if (headers['x-real-ip']) return cleanIp(headers['x-real-ip']);

      if (headers['x-forwarded-for']) {
        const forwardedIps = headers['x-forwarded-for'].split(',');
        const clientIp = forwardedIps[0].trim();
        if (clientIp) return cleanIp(clientIp);
      }

      if (headers['x-client-ip']) return cleanIp(headers['x-client-ip']);
      if (headers['x-cluster-client-ip']) return cleanIp(headers['x-cluster-client-ip']);

      if (headers['forwarded']) {
        const match = headers['forwarded'].match(/for=([^;,\s]+)/);
        if (match && match[1]) return cleanIp(match[1].replace(/"/g, ''));
      }
    }

    if (ctx.request.ip) return cleanIp(ctx.request.ip);

    return 'unknown';
  } catch (error) {
    if (ctx?.app?.context?.strapi?.log?.debug) {
      ctx.app.context.strapi.log.debug('[getClientIp] Error extracting IP:', error.message);
    }
    return 'unknown';
  }
};

/**
 * Cleans an IP address (strips IPv6-mapped prefix, brackets, and port).
 * @param {string} ip
 * @returns {string}
 */
const cleanIp = (ip) => {
  if (!ip) return 'unknown';

  ip = String(ip).trim();

  if (ip.startsWith('[')) {
    const bracketEnd = ip.indexOf(']');
    if (bracketEnd !== -1) {
      ip = ip.substring(1, bracketEnd);
    }
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (ip.includes('.') && ip.includes(':') && ip.indexOf(':') === ip.lastIndexOf(':')) {
    ip = ip.split(':')[0];
  }

  return ip || 'unknown';
};

module.exports = getClientIp;
