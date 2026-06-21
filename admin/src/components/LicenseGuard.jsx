/**
 * LicenseGuard — kept for backwards compatibility with older admin routes.
 *
 * Magic Session Manager is free to use without activation. The optional
 * license page can still store a key for install tracking / display, but it
 * must not block access to the plugin.
 */
const LicenseGuard = ({ children }) => <>{children}</>;

export default LicenseGuard;
