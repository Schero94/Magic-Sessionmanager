/**
 * Normalizes the supported session lifecycle fields into a dashboard status.
 *
 * @param {object} session Session view-model row.
 * @returns {'active'|'idle'|'loggedout'|'terminated'} Display status.
 */
export function getSessionStatus(session = {}) {
  if (session.isActive) {
    return session.isTrulyActive ? 'active' : 'idle';
  }

  if (session.terminationReason === 'logout') return 'loggedout';
  if (session.terminationReason === 'idle') return 'idle';
  if (session.terminationReason) return 'terminated';

  return session.logoutTime ? 'loggedout' : 'terminated';
}
