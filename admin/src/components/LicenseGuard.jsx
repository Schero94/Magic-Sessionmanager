/**
 * LicenseGuard: kept for backwards compatibility with older admin routes.
 *
 * Magic Session Manager never gates features behind a license key. The
 * License page only shows whether a key is stored and valid, so this guard
 * must never block access to the plugin.
 */
const LicenseGuard = ({ children }) => <>{children}</>;

export default LicenseGuard;
