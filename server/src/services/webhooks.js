'use strict';

// @ts-check

/**
 * Webhooks (4.17): one event selection (`webhookEvents`) for Discord, Slack
 * and the signed generic webhook.
 *
 * - The signed webhook gets a JSON body with `id`, `event`, `createdAt` and
 *   `data` (user documentId, IP as the security log stores it, user agent,
 *   country and city when known, and event details), signed as described in
 *   utils/webhook-delivery.js. Its URL and secret are write-only: the admin
 *   API never returns them.
 * - Discord and Slack keep their message format; events other than the
 *   sign-in events get a short message with the same fields.
 * - Delivery never runs on the request path: `emit` queues and returns.
 */

const { decryptToken } = require('../utils/encryption');
const { getPluginSettings } = require('../utils/settings-loader');
const { resolveDetectionSettings } = require('../utils/detection-settings');
const { resolveSecurityLogSettings } = require('../utils/security-log-settings');
const { anonymizeIp, normalizeIp } = require('../utils/admin-request-info');
const { SECURITY_EVENTS } = require('../utils/security-log-model');
const {
  buildSignedRequest,
  deliverOnce,
  deliverWithRetries,
} = require('../utils/webhook-delivery');
const { createLogger } = require('../utils/logger');

/** Security log events that have a webhook event. */
const EVENT_OF_SECURITY_EVENT = Object.freeze({
  [SECURITY_EVENTS.USER_SIGN_IN_FAILED]: 'login.failed',
  [SECURITY_EVENTS.USER_SIGN_IN_REFUSED]: 'login.refused',
  [SECURITY_EVENTS.USER_LOCKOUT]: 'lockout',
  [SECURITY_EVENTS.USER_LOCKOUT_LIFTED]: 'lockout.lifted',
  [SECURITY_EVENTS.USER_SESSION_LIMIT]: 'session.limit',
  [SECURITY_EVENTS.USER_PASSWORD_CHANGE_ENDED]: 'password.changed',
  'user.sign-in.new-device': 'login.new_device',
  'user.sign-in.impossible-travel': 'login.impossible_travel',
  'user.not-me': 'user.not_me',
});

/** Human titles for Discord and Slack messages of non-sign-in events. */
const CHAT_TITLES = Object.freeze({
  'login.failed': 'Failed sign-in',
  'login.refused': 'Refused sign-in',
  'login.new_device': 'Sign-in from a new device',
  'login.impossible_travel': 'Impossible travel',
  lockout: 'Sign-in locked',
  'lockout.lifted': 'Sign-in lock lifted',
  'session.limit': 'Session limit reached',
  'password.changed': 'Other sessions ended after a password change',
  'user.not_me': 'User reported a sign-in as not theirs',
  test: 'Test message',
});

/** At most this many deliveries run at once per process; more wait. */
const MAX_PARALLEL = 4;
const MAX_QUEUE = 500;

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  /** @type {Array<() => Promise<void>>} */
  const queue = [];
  let running = 0;
  let stopped = false;

  const pump = () => {
    while (!stopped && running < MAX_PARALLEL && queue.length) {
      const job = /** @type {() => Promise<void>} */ (queue.shift());
      running += 1;
      job()
        .catch(() => {})
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  /** @param {() => Promise<void>} job */
  const enqueue = (job) => {
    if (stopped) return;
    if (queue.length >= MAX_QUEUE) {
      queue.shift();
      log.warn('[webhooks] Queue full; the oldest delivery was dropped');
    }
    queue.push(job);
    pump();
  };

  /**
   * The decrypted secret of the signed webhook, or null.
   *
   * @param {Record<string, any>} settings Merged settings.
   * @returns {string|null} Secret.
   */
  const secretOf = (settings) => {
    const stored = settings?.genericWebhookSecret;
    if (typeof stored !== 'string' || !stored) return null;
    try {
      return decryptToken(stored) || null;
    } catch {
      return null;
    }
  };

  /**
   * The data part of a payload, following the security log's IP options.
   *
   * @param {Record<string, any>} settings Merged settings.
   * @param {{userId?: string|null, ip?: string|null, userAgent?: string|null,
   *   geo?: any, details?: Record<string, unknown>|null}} input Event facts.
   * @returns {Record<string, unknown>} Data.
   */
  const dataOf = (settings, input) => {
    const options = resolveSecurityLogSettings(settings);
    const ip = options.storeIp ? normalizeIp(input.ip || '') : null;
    return {
      user: input.userId ? { documentId: String(input.userId) } : null,
      ip: ip && options.anonymizeIp ? anonymizeIp(ip) : ip,
      userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 256) : null,
      location:
        input.geo && (input.geo.country_code || input.geo.city)
          ? { country: input.geo.country_code || null, city: input.geo.city || null }
          : null,
      details: input.details || null,
    };
  };

  /**
   * Discord or Slack body for a non-sign-in event.
   *
   * @param {'discord'|'slack'} kind Target.
   * @param {string} event Event.
   * @param {Record<string, any>} data Payload data.
   * @returns {object} Provider body.
   */
  const chatBody = (kind, event, data) => {
    const title = CHAT_TITLES[event] || event;
    const fields = [
      ['User', data.user?.documentId || '-'],
      ['IP', data.ip || '-'],
      ...Object.entries(data.details || {})
        .slice(0, 6)
        .map(([key, value]) => [key, String(value)]),
    ];
    if (kind === 'discord') {
      return {
        embeds: [
          {
            title,
            color: 0x5865f2,
            fields: fields.map(([name, value]) => ({
              name,
              value: value.slice(0, 200),
              inline: true,
            })),
            timestamp: new Date().toISOString(),
            footer: { text: 'Magic Session Manager' },
          },
        ],
      };
    }
    return {
      text: title,
      attachments: [
        {
          color: '#2563eb',
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: title } },
            {
              type: 'section',
              fields: fields.map(([name, value]) => ({
                type: 'mrkdwn',
                text: `*${name}*\n${value.slice(0, 200)}`,
              })),
            },
          ],
        },
      ],
    };
  };

  const service = {
    EVENT_OF_SECURITY_EVENT,

    /**
     * Whether an event is selected.
     *
     * @param {Record<string, any>} settings Merged settings.
     * @param {string} event Webhook event.
     * @returns {boolean} True when selected.
     */
    isSelected(settings, event) {
      return resolveDetectionSettings(settings).webhookEvents.includes(event);
    },

    /**
     * Queues an event for the signed webhook and, for non-sign-in events,
     * Discord and Slack. Sign-in events (`login.success`, `login.suspicious`,
     * `login.new_location`) reach Discord and Slack through the login alerts
     * with their richer message. Returns at once.
     *
     * @param {string} event Webhook event.
     * @param {{userId?: string|null, ip?: string|null, userAgent?: string|null, geo?: any,
     *   details?: Record<string, unknown>|null}} input Event facts.
     * @param {{chat?: boolean}} [options] Whether Discord/Slack get it here.
     * @returns {void}
     */
    emit(event, input, { chat = true } = {}) {
      enqueue(async () => {
        const settings = await getPluginSettings(strapi);
        if (!service.isSelected(settings, event)) return;
        const data = dataOf(settings, input);
        const detection = resolveDetectionSettings(settings);
        const secret = secretOf(settings);
        if (detection.genericWebhookEnabled && detection.genericWebhookUrl && secret) {
          const request = buildSignedRequest({ event, data, secret });
          const result = await deliverWithRetries({ url: detection.genericWebhookUrl, ...request });
          if (!result.ok) {
            log.warn(
              `[webhooks] Signed webhook delivery failed (${result.code}, ${result.attempts} attempts)`
            );
          }
        }
        if (chat && settings.enableWebhooks) {
          const notifications = strapi.plugin('magic-sessionmanager').service('notifications');
          const targets = [
            ['discord', settings.discordWebhookUrl],
            ['slack', settings.slackWebhookUrl],
          ].filter(([, url]) => typeof url === 'string' && url);
          await Promise.allSettled(
            targets.map(([kind, url]) =>
              notifications.sendWebhook({
                event,
                data: chatBody(kind, event, data),
                webhookUrl: url,
              })
            )
          );
        }
      });
    },

    /**
     * Emits the webhook event that belongs to a security log event, if any.
     *
     * @param {{event: string, actorType?: string, actorId?: any, targetId?: any, ip?: any,
     *   userAgent?: any, meta?: any}} input Security event input.
     * @returns {void}
     */
    emitSecurityEvent(input) {
      const event = EVENT_OF_SECURITY_EVENT[input?.event];
      if (!event) return;
      service.emit(event, {
        userId: input.targetId || (input.actorType === 'user' ? input.actorId : null) || null,
        // An admin's own address is not sent for admin actions.
        ip: input.actorType === 'admin' ? null : input.ip,
        userAgent: input.actorType === 'admin' ? null : input.userAgent,
        details: input.meta || null,
      });
    },

    /**
     * Sends one `test` event to the signed webhook now, without retries.
     *
     * @returns {Promise<{ok: boolean, status: number|null, code: string|null}>} Result.
     */
    async sendTest() {
      const settings = await getPluginSettings(strapi);
      const detection = resolveDetectionSettings(settings);
      const secret = secretOf(settings);
      if (!detection.genericWebhookUrl) return { ok: false, status: null, code: 'no_url' };
      if (!secret) return { ok: false, status: null, code: 'no_secret' };
      const request = buildSignedRequest({
        event: 'test',
        data: { user: null, ip: null, userAgent: null, location: null, details: { test: true } },
        secret,
      });
      try {
        const { status } = await deliverOnce({ url: detection.genericWebhookUrl, ...request });
        return { ok: true, status, code: null };
      } catch (err) {
        return {
          ok: false,
          status: Number.isInteger(err?.status) ? err.status : null,
          code: typeof err?.code === 'string' ? err.code : 'network_error',
        };
      }
    },

    /**
     * Stops new deliveries (plugin destroy).
     *
     * @returns {void}
     */
    stop() {
      stopped = true;
      queue.length = 0;
    },
  };
  return service;
};
