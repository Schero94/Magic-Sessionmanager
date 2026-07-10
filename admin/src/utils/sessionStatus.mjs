export function getSessionStatus(session = {}) {
  if (session.isActive) {
    return session.isTrulyActive ? 'active' : 'idle';
  }

  if (session.terminationReason === 'logout') return 'loggedout';
  if (session.terminationReason === 'idle') return 'idle';
  if (session.terminationReason) return 'terminated';

  return session.logoutTime ? 'loggedout' : 'terminated';
}
