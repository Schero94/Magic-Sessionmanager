'use strict';

// @ts-check

/**
 * Sign-in checks inside the Users & Permissions `auth` controller (security
 * review 2, M1, L2 and hardening 3).
 *
 * Up to 4.22 the IP and account lockout and the pre-sign-in location check
 * matched exact request paths, so `/api/auth/local/`, `/API/auth/local` and
 * the GraphQL `login` mutation (which calls the same controller) were never
 * counted or refused. The checks now also run in the controller actions
 * themselves, which every route, path spelling and the GraphQL mutations
 * reach:
 *
 * - `callback`: location check, then the lockout (local provider only);
 * - `register`, `resetPassword`, `emailConfirmation`: location check.
 *
 * The actions are replaced on the resolved controller instance in the
 * plugin's `register` phase, because Strapi binds route handlers when it
 * builds the router, before any `bootstrap` runs (`@strapi/core`
 * `Strapi.bootstrap()`: `initRouting()` before the plugin bootstrap
 * lifecycles; `services/server/compose-endpoint.js` `getAction` binds
 * `controller[action]`). This is the pattern the Strapi docs describe for
 * overriding `auth` actions: keep the original, replace the action on the
 * resolved controller. GraphQL resolvers look the controller up per request
 * (`@strapi/plugin-users-permissions/server/src/graphql/mutations/auth/*.js`).
 *
 * The checks themselves are supplied by bootstrap (`setAuthControllerHandlers`)
 * once the shared coordination store is ready; until then the original
 * action runs unchanged.
 */

const WRAPPED = Symbol.for('magic-sessionmanager.auth-controller.wrapped');

/** Actions and the kind of check each one gets. */
const GUARDED_ACTIONS = Object.freeze({
  callback: 'callback',
  register: 'newSession',
  resetPassword: 'newSession',
  emailConfirmation: 'newSession',
});

/**
 * @typedef {object} AuthControllerHandlers
 * @property {(ctx: any, run: () => Promise<unknown>) => Promise<unknown>} callback
 *   Location check and lockout around `auth.callback`.
 * @property {(ctx: any, run: () => Promise<unknown>) => Promise<unknown>} newSession
 *   Location check around the other actions that start a session.
 */

/** @type {WeakMap<object, AuthControllerHandlers>} */
const handlersByStrapi = new WeakMap();

/**
 * Replaces the guarded actions of the Users & Permissions `auth` controller
 * with wrappers that call the handlers set by bootstrap. Idempotent.
 *
 * @param {any} strapi Strapi instance.
 * @param {{debug?: Function, warn?: Function}} [log] Plugin logger.
 * @returns {string[]} Names of the actions now wrapped.
 * @sideeffect Replaces actions on the resolved `plugin::users-permissions.auth` controller.
 */
function installAuthControllerGuard(strapi, log) {
  let controller;
  try {
    controller = strapi.plugin('users-permissions')?.controller('auth');
  } catch {
    controller = null;
  }
  if (!controller || typeof controller !== 'object') {
    log?.warn?.(
      '[AUTH] Users & Permissions auth controller not found; sign-in checks use paths only'
    );
    return [];
  }
  const wrapped = [];
  for (const [action, kind] of Object.entries(GUARDED_ACTIONS)) {
    const original = controller[action];
    if (typeof original !== 'function') continue;
    if (original[WRAPPED]) {
      wrapped.push(action);
      continue;
    }
    /**
     * @this {any}
     * @param {any} ctx Koa context.
     * @param {...any} rest Further arguments.
     * @returns {Promise<unknown>} What the original action returns.
     */
    const guarded = async function magicSessionAuthGuard(ctx, ...rest) {
      const run = () => original.call(this, ctx, ...rest);
      const handlers = handlersByStrapi.get(strapi);
      if (!handlers || typeof handlers[kind] !== 'function') return run();
      return handlers[kind](ctx, run);
    };
    Object.defineProperty(guarded, WRAPPED, { value: original });
    controller[action] = guarded;
    wrapped.push(action);
  }
  return wrapped;
}

/**
 * Supplies the checks the wrapped actions run.
 *
 * @param {any} strapi Strapi instance.
 * @param {AuthControllerHandlers|null} handlers Checks, or null to run the actions unchanged.
 * @returns {void}
 */
function setAuthControllerHandlers(strapi, handlers) {
  if (handlers) handlersByStrapi.set(strapi, handlers);
  else handlersByStrapi.delete(strapi);
}

/**
 * Restores the original actions (plugin `destroy`).
 *
 * @param {any} strapi Strapi instance.
 * @returns {void}
 * @sideeffect Restores actions on the `auth` controller.
 */
function uninstallAuthControllerGuard(strapi) {
  setAuthControllerHandlers(strapi, null);
  let controller;
  try {
    controller = strapi.plugin('users-permissions')?.controller('auth');
  } catch {
    return;
  }
  if (!controller) return;
  for (const action of Object.keys(GUARDED_ACTIONS)) {
    const original = controller[action]?.[WRAPPED];
    if (typeof original === 'function') controller[action] = original;
  }
}

/** Message Users & Permissions throws for a wrong identifier or password. */
const INVALID_CREDENTIALS_MESSAGE = 'Invalid identifier or password';

/**
 * Outcome of `auth.callback` for the lockout (L2): only Users & Permissions'
 * "Invalid identifier or password" is a failed guess. A missing field, a
 * disabled provider, a blocked or unconfirmed account and every refusal by
 * another rule (session limit, location, rate limit) are neutral.
 *
 * @param {unknown} thrown Error the action threw, or null.
 * @param {any} ctx Koa context after the action.
 * @returns {'success'|'failure'|'neutral'} Outcome.
 */
function classifyCallbackOutcome(thrown, ctx) {
  if (thrown) {
    const error = /** @type {any} */ (thrown);
    return error?.name === 'ValidationError' && error?.message === INVALID_CREDENTIALS_MESSAGE
      ? 'failure'
      : 'neutral';
  }
  const body = ctx?.body;
  return body && typeof body === 'object' && body.jwt ? 'success' : 'neutral';
}

module.exports = {
  GUARDED_ACTIONS,
  INVALID_CREDENTIALS_MESSAGE,
  classifyCallbackOutcome,
  installAuthControllerGuard,
  setAuthControllerHandlers,
  uninstallAuthControllerGuard,
};
