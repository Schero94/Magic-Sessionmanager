'use strict';

/**
 * Plugin-scoped logger.
 *
 * `info` and `debug` are suppressed unless `config.debug === true`, but
 * `warn` and `error` are ALWAYS emitted to avoid creating a debugging
 * black-box in production deployments.
 */

const PLUGIN_NAME = 'magic-sessionmanager';
const PREFIX = '[magic-sessionmanager]';

/**
 * Formats a message prefix and non-sensitive scalar arguments for Strapi.
 * Exception details and arbitrary objects are omitted because they can hold
 * credentials, request data, or personal identifiers.
 *
 * @param {string} prefix
 * @param {Array<unknown>} args
 * @returns {string}
 */
function formatMessage(prefix, args) {
  if (args.length === 0) return prefix;
  const parts = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return '[Error]';
    if (arg === null || ['number', 'boolean'].includes(typeof arg)) return String(arg);
    return '[non-scalar omitted]';
  });
  return `${prefix} ${parts.join(' ')}`;
}

/**
 * Creates a logger bound to the given Strapi instance.
 *
 * @param {object} strapi
 * @returns {{info: Function, debug: Function, warn: Function, error: Function, forceError: Function}}
 */
function createLogger(strapi) {
  const getDebugMode = () => {
    try {
      const config = strapi.config.get(`plugin::${PLUGIN_NAME}`) || {};
      return config.debug === true;
    } catch {
      return false;
    }
  };

  return {
    /**
     * Info log. Only emitted when `debug: true`.
     * @param {...unknown} args
     */
    info: (...args) => {
      if (getDebugMode()) {
        strapi.log.info(formatMessage(PREFIX, args));
      }
    },

    /**
     * Debug log. Only emitted when `debug: true`.
     * @param {...unknown} args
     */
    debug: (...args) => {
      if (getDebugMode()) {
        strapi.log.debug(formatMessage(PREFIX, args));
      }
    },

    /**
     * Warning log. Always emitted.
     * @param {...unknown} args
     */
    warn: (...args) => {
      strapi.log.warn(formatMessage(PREFIX, args));
    },

    /**
     * Error log. Always emitted.
     * @param {...unknown} args
     */
    error: (...args) => {
      strapi.log.error(formatMessage(PREFIX, args));
    },

    /**
     * Deprecated alias kept for backwards compatibility. Identical to `error`.
     * @param {...unknown} args
     */
    forceError: (...args) => {
      strapi.log.error(formatMessage(PREFIX, args));
    },
  };
}

module.exports = { createLogger };
