'use strict';

// @ts-check

/**
 * GraphQL side of the impersonation restrictions (security review 2, H1).
 *
 * Up to 4.22 the request guard (`middlewares/impersonation-guard.js`) looked
 * for restricted mutations in `ctx.request.body`. Strapi's body parser skips
 * the GraphQL endpoint (`@strapi/core` `middlewares/body.js`), and Apollo's
 * persisted queries send only a hash, so the check never saw the operation:
 * an impersonation could change the user's email through
 * `updateUsersPermissionsUser`.
 *
 * The rule now runs inside Apollo, after it has parsed and resolved the
 * operation (`didResolveOperation`, Apollo Server 4 request lifecycle): every
 * mutation is refused while the request carries an impersonation credential.
 * Aliases, fragments, persisted queries and batched requests all reach this
 * hook as a resolved operation. Queries stay allowed, so support can still
 * look at what the user sees.
 *
 * The plugin is added to `plugin::graphql.apolloServer.plugins` in the
 * plugin's `register` phase. The GraphQL plugin reads that config in its own
 * `bootstrap` and concatenates it with its default plugins
 * (`@strapi/plugin-graphql` `dist/server/bootstrap.js`, `mergeWith` with
 * array concat), so the host's own Apollo plugins are kept. The request
 * guard marks an impersonated request with `ctx.state.magicImpersonation`
 * before routing; the GraphQL context carries that Koa context as
 * `koaContext` (same file, `koaMiddleware` context factory).
 */

const { errors } = require('@strapi/utils');

const MARK = Symbol.for('magic-sessionmanager.graphql-impersonation-guard');
const MESSAGE = 'Not allowed while impersonating';
const REASON = 'impersonation-mutation';

/**
 * The refusal thrown from `didResolveOperation`. Apollo wraps a non-GraphQL
 * error in a `GraphQLError` that copies `extensions` from it (graphql 16), and
 * takes the HTTP status from `extensions.http` (Apollo Server 4
 * `errorNormalize.js`). Strapi's error formatter leaves a `GraphQLError`
 * without a path as it is, so the client gets the same `FORBIDDEN` code and
 * error shape as other Strapi GraphQL denials.
 *
 * @returns {Error} Error to throw.
 */
function impersonationRefusal() {
  const error = new errors.ForbiddenError(MESSAGE, { reason: REASON });
  Object.defineProperty(error, 'extensions', {
    value: {
      code: 'FORBIDDEN',
      http: { status: 403 },
      error: { name: 'ForbiddenError', message: MESSAGE, details: { reason: REASON } },
    },
    enumerable: false,
  });
  return error;
}

/**
 * The impersonation mark of a GraphQL request, or null.
 *
 * @param {any} contextValue Apollo context (`{ state, koaContext }`).
 * @returns {{id: string, actorId: string, targetId?: string|null}|null}
 */
function impersonationOf(contextValue) {
  const mark =
    contextValue?.koaContext?.state?.magicImpersonation ?? contextValue?.state?.magicImpersonation;
  return mark && typeof mark === 'object' && typeof mark.id === 'string' ? mark : null;
}

/**
 * Apollo Server plugin that refuses every mutation of an impersonated request.
 *
 * @param {any} strapi Strapi instance.
 * @returns {object} Apollo Server plugin.
 */
function createImpersonationApolloPlugin(strapi) {
  return {
    [MARK]: true,
    async requestDidStart() {
      return {
        /**
         * @param {any} requestContext Apollo request context.
         * @returns {Promise<void>}
         * @throws {Error} ForbiddenError (HTTP 403, code FORBIDDEN) for a mutation while impersonating.
         */
        async didResolveOperation(requestContext) {
          if (requestContext?.operation?.operation !== 'mutation') return;
          const impersonation = impersonationOf(requestContext.contextValue);
          if (!impersonation) return;
          try {
            strapi
              .plugin('magic-sessionmanager')
              .service('impersonation')
              .recordRefusedCall(impersonation, 'mutation');
          } catch {
            // Recording is best effort; the refusal stands.
          }
          throw impersonationRefusal();
        },
      };
    },
  };
}

/**
 * Adds the Apollo plugin to the GraphQL plugin's server config when the
 * GraphQL plugin is installed. Idempotent; keeps the host's own plugins.
 *
 * @param {any} strapi Strapi instance.
 * @param {{info?: Function, warn?: Function}} [log] Plugin logger.
 * @returns {boolean} Whether the guard is installed.
 * @sideeffect Writes `plugin::graphql.apolloServer.plugins` in the config store.
 */
function installGraphqlImpersonationGuard(strapi, log) {
  let graphql;
  try {
    graphql = strapi.plugin('graphql') || null;
  } catch {
    graphql = null;
  }
  if (!graphql) return false;
  if (typeof strapi.config?.get !== 'function' || typeof strapi.config?.set !== 'function') {
    return false;
  }
  try {
    const key = 'plugin::graphql.apolloServer';
    const current = strapi.config.get(key);
    const server = current && typeof current === 'object' ? current : {};
    const plugins = Array.isArray(server.plugins) ? server.plugins : [];
    if (plugins.some((plugin) => plugin && plugin[MARK])) return true;
    strapi.config.set(key, {
      ...server,
      plugins: [...plugins, createImpersonationApolloPlugin(strapi)],
    });
  } catch (err) {
    log?.warn?.('[IMPERSONATION] GraphQL guard could not be installed:', err?.name || 'Error');
    return false;
  }
  log?.info?.('[IMPERSONATION] GraphQL mutations are refused while impersonating');
  return true;
}

module.exports = {
  createImpersonationApolloPlugin,
  impersonationRefusal,
  installGraphqlImpersonationGuard,
};
