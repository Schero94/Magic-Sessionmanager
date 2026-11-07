/** Return the session collection only when the admin API provides an array. */
export function requireSessionList(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('Invalid session response');
  return payload.data;
}

/** Require the explicit success flag used by admin mutation endpoints. */
export function requireSuccessfulMutation(payload) {
  if (payload?.success !== true) throw new Error('Invalid mutation response');
  return payload;
}
