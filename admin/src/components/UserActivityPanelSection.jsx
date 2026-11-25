import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import { Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import pluginPermissions from '../permissions';
import { getTranslation } from '../utils/getTranslation';
import Alert from './PersistentAlert';
import ReadableText from './ReadableText';
import { TargetLink } from './ui';
import { UserEventTable } from '../pages/AdminPanel/EventTables';
import { useEventList } from '../pages/AdminPanel/useEventList';
import {
  PANEL_USER_EVENT_LIMIT,
  USER_ACTIVITY_API_PATH,
  buildUserActivityParams,
  userActivityPagePath,
} from '../pages/UserActivity/userActivityModel.mjs';

/**
 * The latest security events of one app user, loaded only once the section
 * is shown.
 *
 * @param {{documentId: string, userLabel: string}} props User of the edit view.
 * @returns {import('react').ReactElement} Section.
 */
const UserActivityList = ({ documentId, userLabel }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const params = useMemo(
    () => buildUserActivityParams({ userId: documentId, pageSize: PANEL_USER_EVENT_LIMIT }),
    [documentId]
  );
  const list = useEventList({ path: USER_ACTIVITY_API_PATH, params, logKey: 'userActivity.panel' });
  const title = t('userActivity.panel.title', 'Security activity');

  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-panel-user-activity="">
      <Typography variant="sigma" textColor="neutral600" tag="h3">
        {title}
      </Typography>
      {list.loading && list.rows.length === 0 ? (
        <Flex justifyContent="center" padding={2}>
          <Loader small>{t('adminPanel.activity.loading', 'Loading events')}</Loader>
        </Flex>
      ) : null}
      {!list.loading && list.error ? (
        <Alert
          variant="danger"
          action={
            <Button size="S" variant="secondary" onClick={list.reload}>
              {t('common.tryAgain', 'Try again')}
            </Button>
          }
        >
          {t('adminPanel.activity.error', 'The events could not be loaded.')}
        </Alert>
      ) : null}
      {!list.loading && !list.error && list.rows.length === 0 ? (
        <Box padding={3} background="neutral0" borderColor="neutral200" hasRadius>
          <ReadableText variant="omega" textColor="neutral800" tag="p">
            {t('userActivity.panel.empty', 'No security events recorded for {user}.', {
              user: userLabel,
            })}
          </ReadableText>
        </Box>
      ) : null}
      {list.rows.length > 0 ? (
        <UserEventTable
          rows={list.rows}
          showUser={false}
          busy={list.loading}
          label={t('userActivity.panel.listLabel', 'Security activity of {user}', {
            user: userLabel,
          })}
        />
      ) : null}
      <TargetLink tag={NavLink} to={userActivityPagePath(documentId)} data-user-activity-link="">
        {t('userActivity.panel.showAll', 'Show all security activity')}
      </TargetLink>
    </Flex>
  );
};

/**
 * "Security activity" in the user's Sessions panel in the Content Manager
 * (4.22): the latest PANEL_USER_EVENT_LIMIT events of this user and "Show
 * all security activity" (the full page filtered to the user). Only for
 * roles with "View app-user security activity"; without it nothing is
 * requested. The server checks the same action.
 *
 * @param {{documentId: string, userLabel: string}} props User of the edit view.
 * @returns {import('react').ReactElement|null} Section, or null without the permission.
 */
const UserActivityPanelSection = ({ documentId, userLabel }) => {
  const {
    allowedActions: { canRead },
    isLoading,
  } = useRBAC(pluginPermissions.userActivityRead);
  if (isLoading || !canRead || !documentId) return null;
  return <UserActivityList documentId={documentId} userLabel={userLabel} />;
};

export default UserActivityPanelSection;
