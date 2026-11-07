'use strict';

const SERVER_ERROR_METHODS = {
  500: 'internalServerError',
  502: 'badGateway',
  503: 'serviceUnavailable',
};

const SERVER_ERROR_NAMES = {
  500: 'InternalServerError',
  502: 'BadGatewayError',
  503: 'ServiceUnavailableError',
};

/**
 * Writes a server-side failure (5xx) with a fixed, safe message. Strapi 5
 * registers one context helper per HTTP status; older hosts in the supported
 * `^5.0.0` range may lack some of them, so the helper falls back to
 * `internalServerError` and finally to the standard error envelope.
 *
 * @param {object} ctx Koa context
 * @param {500|502|503} status Server error status
 * @param {string} message Caller-safe message without exception details
 * @param {object} [details] Optional caller-safe details
 * @returns {unknown} Result of the context helper
 */
function sendServerError(ctx, status, message, details) {
  const method = SERVER_ERROR_METHODS[status] || SERVER_ERROR_METHODS[500];
  if (typeof ctx[method] === 'function') return ctx[method](message, details || {});
  if (status === 500 && typeof ctx.internalServerError === 'function') {
    return ctx.internalServerError(message, details || {});
  }

  const finalStatus = SERVER_ERROR_METHODS[status] ? status : 500;
  ctx.status = finalStatus;
  ctx.body = {
    data: null,
    error: {
      status: finalStatus,
      name: SERVER_ERROR_NAMES[finalStatus],
      message,
      details: details || {},
    },
  };
  return ctx.body;
}

/**
 * Writes a 400 response that names every invalid field in Strapi's
 * ValidationError detail shape: `{ errors: [{ path, message, name }] }`.
 *
 * @param {object} ctx Koa context
 * @param {string} message Summary message
 * @param {{path: string[], message: string}[]} errors Field errors
 * @returns {unknown} Result of `ctx.badRequest`
 */
function sendValidationError(ctx, message, errors) {
  return ctx.badRequest(message, {
    errors: errors.map((error) => ({ ...error, name: 'ValidationError' })),
  });
}

module.exports = { sendServerError, sendValidationError };
