'use strict';

/**
 * Allows a request when the admin holds either impersonation action:
 * `impersonate.users` or `impersonate.admins` (4.20). `admin::hasPermissions`
 * requires all listed actions, so "either" needs its own policy. Always
 * returns an explicit boolean (a policy returning `undefined` passes).
 *
 * @param {any} policyContext Strapi policy context.
 * @returns {boolean}
 */
module.exports = (policyContext) => {
  const ability = policyContext?.state?.userAbility;
  const can = (action) => {
    try {
      return ability?.can?.(action) === true;
    } catch {
      return false;
    }
  };
  return (
    can('plugin::magic-sessionmanager.impersonate.users') ||
    can('plugin::magic-sessionmanager.impersonate.admins')
  );
};
