import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import { Flex, Typography } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import styled from 'styled-components';
import pluginId from '../pluginId';
import pluginPermissions from '../permissions';
import { getTranslation } from '../utils/getTranslation';

/** Admin paths of the two session views (relative to the admin root). */
export const SESSION_VIEW_PATHS = Object.freeze({
  users: `/plugins/${pluginId}`,
  admins: `/plugins/${pluginId}/admin-panel`,
});

/**
 * One view link, drawn like a DS tab: neutral text, the current view in
 * primary with a bottom bar. The bar is a 2 px border inside the element, so
 * the row height does not change between states. Touch targets are at least
 * 32 px tall at every width (WCAG 2.5.8 and the plugin's mobile rule).
 */
const ViewLink = styled(NavLink)`
  display: inline-flex;
  align-items: center;
  min-height: 4rem;
  padding: 0 ${({ theme }) => theme.spaces[4]};
  border-bottom: 2px solid transparent;
  color: ${({ theme }) => theme.colors.neutral600};
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    color: ${({ theme }) => theme.colors.neutral800};
  }

  &[aria-current='page'] {
    color: ${({ theme }) => theme.colors.primary700};
    border-bottom-color: ${({ theme }) => theme.colors.primary600};
  }

  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`;

/** Navigation landmark with a hairline under both links. */
const ViewNav = styled.nav`
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  min-width: 0;
`;

/**
 * Switch between the app-user sessions and the Strapi admin panel sessions.
 * A navigation landmark with two links (not ARIA tabs: each view is its own
 * route). It renders nothing for admins who may not read admin panel
 * sessions, so their dashboard looks exactly as before; hiding it is UX
 * only, the server checks every route.
 *
 * @param {object} props
 * @param {'users'|'admins'} props.current The view on screen.
 * @returns {import('react').ReactElement|null} View switch, or null.
 */
const SessionViewNav = ({ current }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage) => formatMessage({ id: getTranslation(id), defaultMessage });
  const {
    allowedActions: { canRead },
    isLoading,
  } = useRBAC(pluginPermissions.adminSessionsRead);

  if (isLoading || (!canRead && current !== 'admins')) return null;

  const link = (view, label) => (
    <ViewLink to={SESSION_VIEW_PATHS[view]} end data-session-view={view}>
      <Typography variant="omega" fontWeight="semiBold">
        {label}
      </Typography>
    </ViewLink>
  );

  return (
    <ViewNav aria-label={t('views.label', 'Session views')} data-session-views="">
      <Flex gap={2} wrap="wrap">
        {link('users', t('views.users', 'App users'))}
        {link('admins', t('views.admins', 'Admin panel'))}
      </Flex>
    </ViewNav>
  );
};

export default SessionViewNav;
