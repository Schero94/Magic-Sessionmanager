'use strict';

// @ts-check

/**
 * End-user self-service routes (4.17), Content API:
 *
 * - `GET  /magic-sessionmanager/not-me?token=` (public): confirmation page of
 *   the "This wasn't me" email link. Never ends a session (mail scanners
 *   open links).
 * - `POST /magic-sessionmanager/not-me` (public): ends the session of the link
 *   (or every session of the user with `scope=all`). The signed, single-use,
 *   expiring token is the only authorisation; both routes are rate-limited
 *   per client address.
 * - `GET  /magic-sessionmanager/my-data` (signed-in user): the user's own
 *   sessions and security events as a JSON download (GDPR Art. 15).
 */

const { getCoordinator } = require('../utils/coordination');
const { consumeNotMeToken, readNotMeToken } = require('../utils/not-me-link');
const { recordUserEvent } = require('../utils/sign-in-policies');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { SECURITY_EVENTS } = require('../utils/security-log-model');
const { sendServerError } = require('../utils/http-errors');
const { createLogger } = require('../utils/logger');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const USER_UID = 'plugin::users-permissions.user';
/** Most rows of each kind in one export. */
const EXPORT_LIMIT = 5000;
const EXPORT_BATCH = 500;

/** Texts of the confirmation pages. */
const PAGE_TEXT = Object.freeze({
  en: {
    title: 'Was this sign-in not you?',
    body: 'Sign the device of that sign-in out now. Then change your password.',
    one: 'Sign out that device',
    all: 'Sign out everywhere',
    done: 'Done. The session was ended. Change your password now.',
    doneAll: 'Done. Every session of your account was ended. Change your password now.',
    invalid: 'This link is no longer valid. It works once and expires after 72 hours.',
  },
  de: {
    title: 'Waren Sie das nicht?',
    body: 'Melden Sie das Gerät dieser Anmeldung jetzt ab. Ändern Sie danach Ihr Passwort.',
    one: 'Dieses Gerät abmelden',
    all: 'Überall abmelden',
    done: 'Erledigt. Die Sitzung wurde beendet. Ändern Sie jetzt Ihr Passwort.',
    doneAll: 'Erledigt. Alle Sitzungen Ihres Kontos wurden beendet. Ändern Sie jetzt Ihr Passwort.',
    invalid:
      'Dieser Link ist nicht mehr gültig. Er funktioniert einmal und läuft nach 72 Stunden ab.',
  },
  fr: {
    title: 'Cette connexion n’était pas vous ?',
    body: 'Déconnectez maintenant l’appareil de cette connexion, puis changez votre mot de passe.',
    one: 'Déconnecter cet appareil',
    all: 'Se déconnecter partout',
    done: 'C’est fait. La session a été terminée. Changez maintenant votre mot de passe.',
    doneAll:
      'C’est fait. Toutes les sessions de votre compte ont été terminées. Changez maintenant votre mot de passe.',
    invalid: 'Ce lien n’est plus valide. Il fonctionne une fois et expire après 72 heures.',
  },
  es: {
    title: '¿Este inicio de sesión no fue usted?',
    body: 'Cierre ahora la sesión del dispositivo de ese inicio de sesión y después cambie su contraseña.',
    one: 'Cerrar la sesión de ese dispositivo',
    all: 'Cerrar sesión en todas partes',
    done: 'Hecho. La sesión ha terminado. Cambie ahora su contraseña.',
    doneAll: 'Hecho. Todas las sesiones de su cuenta han terminado. Cambie ahora su contraseña.',
    invalid: 'Este enlace ya no es válido. Funciona una vez y caduca a las 72 horas.',
  },
  pt: {
    title: 'Este início de sessão não foi seu?',
    body: 'Termine agora a sessão do dispositivo desse início de sessão e depois altere a sua palavra-passe.',
    one: 'Terminar a sessão desse dispositivo',
    all: 'Terminar sessão em todo o lado',
    done: 'Feito. A sessão foi terminada. Altere agora a sua palavra-passe.',
    doneAll:
      'Feito. Todas as sessões da sua conta foram terminadas. Altere agora a sua palavra-passe.',
    invalid: 'Esta ligação já não é válida. Funciona uma vez e expira após 72 horas.',
  },
});

/**
 * The page language from Accept-Language (en, de, fr, es, pt).
 *
 * @param {any} ctx Koa context.
 * @returns {keyof typeof PAGE_TEXT} Language.
 */
function pageLanguage(ctx) {
  const header = String(ctx.request?.headers?.['accept-language'] || '').slice(0, 200);
  for (const part of header.split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PAGE_TEXT, code)) {
      return /** @type {keyof typeof PAGE_TEXT} */ (code);
    }
  }
  return 'en';
}

/**
 * @param {unknown} value Text.
 * @returns {string} HTML-escaped text.
 */
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Sends a minimal, self-contained HTML page (no scripts, no external files).
 *
 * @param {any} ctx Koa context.
 * @param {number} status HTTP status.
 * @param {string} lang Page language.
 * @param {string} title Heading.
 * @param {string} body Inner HTML (already escaped).
 * @returns {void}
 */
function sendPage(ctx, status, lang, title, body) {
  ctx.status = status;
  ctx.set('Content-Type', 'text/html; charset=utf-8');
  ctx.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  ctx.set('Referrer-Policy', 'no-referrer');
  ctx.set('Cache-Control', 'no-store');
  ctx.set('X-Robots-Tag', 'noindex');
  ctx.body = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#212134;background:#fff}button{font:inherit;padding:.6rem 1rem;margin:.25rem .5rem .25rem 0;border-radius:4px;border:1px solid #4945ff;background:#4945ff;color:#fff;cursor:pointer}button.secondary{background:#fff;color:#4945ff}@media (prefers-color-scheme:dark){body{background:#181826;color:#eaeaef}button.secondary{background:#181826}}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
}

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);

  return {
    /**
     * Confirmation page of the "This wasn't me" link. Uses nothing.
     *
     * @route GET /api/magic-sessionmanager/not-me?token=
     * @auth none (public on purpose: the link is opened from an email; the
     *   signed token is checked, and nothing changes until the POST)
     * @param {any} ctx Koa context.
     * @returns {Promise<void>} 200 page with two buttons, or 410 when the link is invalid.
     */
    async notMePage(ctx) {
      const lang = pageLanguage(ctx);
      const text = PAGE_TEXT[lang];
      const token = typeof ctx.query?.token === 'string' ? ctx.query.token : '';
      if (!readNotMeToken(token)) {
        return sendPage(ctx, 410, lang, text.title, `<p>${escapeHtml(text.invalid)}</p>`);
      }
      const form = (scope, label, className) =>
        `<form method="post" style="display:inline"><input type="hidden" name="token" value="${escapeHtml(token)}"><input type="hidden" name="scope" value="${scope}"><button type="submit"${className ? ` class="${className}"` : ''}>${escapeHtml(label)}</button></form>`;
      return sendPage(
        ctx,
        200,
        lang,
        text.title,
        `<p>${escapeHtml(text.body)}</p>${form('session', text.one, '')}${form('all', text.all, 'secondary')}`
      );
    },

    /**
     * Uses a "This wasn't me" token: ends that session, or every session of
     * the user with `scope=all`, and records `user.not-me`.
     *
     * @route POST /api/magic-sessionmanager/not-me
     * @auth none (public on purpose; the signed single-use token authorises)
     * @param {any} ctx Koa context; body `{ token, scope?: 'session'|'all' }` (form or JSON).
     * @returns {Promise<void>} 200 page (or JSON `{ ended }` with Accept: application/json);
     *   410 when the token is invalid, expired or used.
     * @sideeffect Ends sessions (and native sessions); writes a security event.
     */
    async notMeConfirm(ctx) {
      const lang = pageLanguage(ctx);
      const text = PAGE_TEXT[lang];
      const wantsJson = String(ctx.request?.headers?.accept || '').includes('application/json');
      const body =
        ctx.request?.body && typeof ctx.request.body === 'object' ? ctx.request.body : {};
      const scope = body.scope === 'all' ? 'all' : 'session';
      const claims = await consumeNotMeToken(getCoordinator(strapi), body.token);
      if (!claims) {
        if (wantsJson) {
          ctx.status = 410;
          ctx.body = {
            data: null,
            error: { status: 410, name: 'GoneError', message: 'This link is no longer valid' },
          };
          return;
        }
        return sendPage(ctx, 410, lang, text.title, `<p>${escapeHtml(text.invalid)}</p>`);
      }
      try {
        const sessionService = strapi.plugin('magic-sessionmanager').service('session');
        let ended = 0;
        if (scope === 'all') {
          ended =
            Number(
              (await sessionService.terminateSession({ userId: claims.userId, reason: 'manual' }))
                ?.terminatedCount
            ) || 0;
        } else {
          const session = await strapi.documents(SESSION_UID).findFirst({
            filters: { documentId: claims.sessionId, user: { documentId: claims.userId } },
            fields: ['documentId', 'isActive'],
          });
          if (session?.isActive) {
            ended =
              Number(
                (
                  await sessionService.terminateSession({
                    sessionId: session.documentId,
                    reason: 'manual',
                  })
                )?.terminatedCount
              ) || 0;
          }
        }
        recordUserEvent(strapi, {
          event: SECURITY_EVENTS.USER_NOT_ME,
          actorType: 'user',
          actorId: claims.userId,
          targetType: 'user',
          targetId: claims.userId,
          ip: ctx.request?.ip || null,
          userAgent: ctx.request?.headers?.['user-agent'] || null,
          meta: { scope, ended },
        });
        if (wantsJson) {
          ctx.body = { data: { ended, scope } };
          return;
        }
        return sendPage(
          ctx,
          200,
          lang,
          text.title,
          `<p>${escapeHtml(scope === 'all' ? text.doneAll : text.done)}</p>`
        );
      } catch (err) {
        log.error('[not-me] Ending the session failed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'The session could not be ended');
      }
    },

    /**
     * The signed-in user's own sessions and security events as JSON (GDPR
     * Art. 15). Tokens, token hashes, device keys and native ids are never
     * included. At most 5,000 rows of each kind, newest first.
     *
     * @route GET /api/magic-sessionmanager/my-data
     * @auth users-permissions JWT (own data only; the user comes from the token)
     * @access plugin::magic-sessionmanager.self-service.exportOwnData (Authenticated role)
     * @param {any} ctx Koa context.
     * @returns {Promise<void>} 200 JSON attachment; 401 without a user.
     * @sideeffect Writes a `user.data.exported` security event.
     */
    async exportOwnData(ctx) {
      const authUser = ctx.state?.user;
      const userDocumentId =
        authUser?.documentId ||
        (authUser?.id ? await resolveUserDocumentId(strapi, authUser.id) : null);
      if (!userDocumentId) return ctx.unauthorized('Authentication required');
      try {
        const user = await strapi.db.query(USER_UID).findOne({
          where: { documentId: userDocumentId },
          select: ['documentId', 'username', 'email', 'createdAt'],
        });
        const sessions = [];
        for (let start = 0; start < EXPORT_LIMIT; start += EXPORT_BATCH) {
          const rows = await strapi.documents(SESSION_UID).findMany({
            filters: { user: { documentId: userDocumentId } },
            fields: [
              'documentId',
              'loginTime',
              'lastActive',
              'logoutTime',
              'isActive',
              'terminationReason',
              'ipAddress',
              'userAgent',
              'deviceType',
              'browserName',
              'osName',
              'geoLocation',
            ],
            sort: [{ loginTime: 'desc' }, { id: 'desc' }],
            start,
            limit: EXPORT_BATCH,
          });
          const list = Array.isArray(rows) ? rows : [];
          sessions.push(...list.map(({ id: _id, ...row }) => row));
          if (list.length < EXPORT_BATCH) break;
        }
        const events = await strapi.db.query(EVENT_UID).findMany({
          where: {
            $or: [
              { targetType: 'user', targetId: userDocumentId },
              { actorType: 'user', actorId: userDocumentId },
            ],
          },
          select: ['event', 'createdAt', 'ip', 'userAgent', 'geo', 'meta'],
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          limit: EXPORT_LIMIT,
        });
        recordUserEvent(strapi, {
          event: SECURITY_EVENTS.USER_DATA_EXPORTED,
          actorType: 'user',
          actorId: userDocumentId,
          targetType: 'user',
          targetId: userDocumentId,
          ip: ctx.request?.ip || null,
          userAgent: ctx.request?.headers?.['user-agent'] || null,
          meta: { sessions: sessions.length, events: Array.isArray(events) ? events.length : 0 },
        });
        ctx.set('Content-Disposition', 'attachment; filename="my-session-data.json"');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = {
          exportedAt: new Date().toISOString(),
          user: user
            ? { documentId: user.documentId, username: user.username, email: user.email }
            : { documentId: userDocumentId },
          sessions,
          securityEvents: (Array.isArray(events) ? events : []).map(({ id: _id, ...row }) => row),
        };
      } catch (err) {
        log.error('[my-data] Export failed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'Your data could not be exported');
      }
    },
  };
};
