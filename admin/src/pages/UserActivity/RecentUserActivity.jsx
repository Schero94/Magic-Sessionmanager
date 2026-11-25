import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { useRBAC } from '@strapi/strapi/admin';
import pluginPermissions from '../../permissions';
import { getTranslation } from '../../utils/getTranslation';
import { RecentEvents } from '../AdminPanel/AdminEventPanels';
import { UserEventTable } from '../AdminPanel/EventTables';
import { useEventList } from '../AdminPanel/useEventList';
import {
  RECENT_USER_EVENT_LIMIT,
  USER_ACTIVITY_API_PATH,
  USER_ACTIVITY_PAGE_PATH,
  buildUserActivityParams,
} from './userActivityModel.mjs';

/**
 * The newest app-user security events (RECENT_USER_EVENT_LIMIT), loaded
 * only once the section is shown.
 *
 * @returns {import('react').ReactElement} Section.
 */
const RecentUserActivityList = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const params = useMemo(() => buildUserActivityParams({ pageSize: RECENT_USER_EVENT_LIMIT }), []);
  const list = useEventList({
    path: USER_ACTIVITY_API_PATH,
    params,
    logKey: 'userActivity.recent',
  });
  return (
    <RecentEvents
      title={t('userActivity.recent.title', 'Recent security activity')}
      subtitle={t(
        'userActivity.recent.subtitle',
        'The latest failed and refused sign-ins, lockouts, new devices, impossible travel and impersonations of your app’s users. Select an event for its details.'
      )}
      showAllTo={USER_ACTIVITY_PAGE_PATH}
      emptyText={t('userActivity.recent.empty', 'No security events of app users yet.')}
      list={list}
      dataKey="recent-user-activity"
      renderTable={(title) => <UserEventTable rows={list.rows} label={title} busy={list.loading} />}
    />
  );
};

/**
 * "Security activity" on the App users tab (4.22): the latest app-user
 * events with "Show all" (the full page). Shown only to roles with "View
 * app-user security activity"; without it nothing is requested. Hiding it is
 * UX only: the server checks the same action on every request.
 *
 * @returns {import('react').ReactElement|null} Section, or null without the permission.
 */
const RecentUserActivity = () => {
  const {
    allowedActions: { canRead },
    isLoading,
  } = useRBAC(pluginPermissions.userActivityRead);
  if (isLoading || !canRead) return null;
  return <RecentUserActivityList />;
};

export default RecentUserActivity;
