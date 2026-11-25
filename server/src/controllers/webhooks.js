'use strict';

// @ts-check

/**
 * Admin actions of the signed webhook (4.17). The URL and secret are saved
 * through PUT /settings as write-only values; nothing here returns them.
 */

const { sendServerError } = require('../utils/http-errors');
const { createLogger } = require('../utils/logger');

/** Codes the UI translates; anything else is reported as `network_error`. */
const RESULT_CODES = new Set([
  'no_url',
  'no_secret',
  'invalid_url',
  'dns_failed',
  'address_not_allowed',
  'timeout',
  'network_error',
  'redirect_not_followed',
]);

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  return {
    /**
     * Sends one signed `test` event to the stored URL, without retries.
     *
     * @route POST /magic-sessionmanager/webhook/test
     * @auth admin session or admin API token
     * @access plugin::magic-sessionmanager.access
     * @param {any} ctx Koa context.
     * @returns {Promise<void>} `{ data: { ok, status, code } }` (status of the receiver's answer;
     *   code: no_url, no_secret, invalid_url, dns_failed, address_not_allowed, timeout,
     *   network_error, redirect_not_followed or http_<status>).
     * @sideeffect One HTTPS request to the stored webhook URL.
     */
    async sendTest(ctx) {
      try {
        const result = await strapi.plugin('magic-sessionmanager').service('webhooks').sendTest();
        const code =
          result.code === null || RESULT_CODES.has(result.code) || /^http_\d{3}$/.test(result.code)
            ? result.code
            : 'network_error';
        ctx.body = { data: { ok: result.ok === true, status: result.status ?? null, code } };
      } catch (err) {
        log.error('[webhooks] Test send failed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'The test event could not be sent');
      }
    },
  };
};
