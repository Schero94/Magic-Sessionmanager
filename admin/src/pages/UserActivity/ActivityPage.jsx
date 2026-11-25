import { useEffect, useMemo, useRef } from 'react';
import { useIntl } from 'react-intl';
import { BackButton, Pagination, useQueryParams } from '@strapi/strapi/admin';
import {
  Button,
  EmptyStateLayout,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Tag,
  Typography,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { PageShell } from '../../components/ui';
import { SESSION_VIEW_PATHS } from '../../components/SessionViewNav';
import { EventList, FilterSlot, PeriodSelect, RecordingOff } from '../AdminPanel/AdminEventPanels';
import { UserEventTable } from '../AdminPanel/EventTables';
import { useEventList } from '../AdminPanel/useEventList';
import { ACTIVITY_PAGE_SIZE_OPTIONS, EVENT_PAGE_SIZE } from '../AdminPanel/adminActivityModel.mjs';
import { userText } from '../AdminPanel/eventText.mjs';
import {
  USER_ACTIVITY_API_PATH,
  USER_ACTIVITY_FILTER_LABELS,
  USER_ACTIVITY_FILTER_OPTIONS,
  USER_ACTIVITY_SETTINGS_PATH,
  buildUserActivityCsv,
  buildUserActivityParams,
  hasUserActivityFilters,
  parseUserActivityQuery,
} from './userActivityModel.mjs';

/** Same 32 px touch targets and wrapping as the other paged lists. */
const PaginationTargets = styled.div`
  nav a {
    min-width: 3.2rem;
  }

  & > div {
    flex-wrap: wrap;
    gap: ${({ theme }) => theme.spaces[2]} ${({ theme }) => theme.spaces[4]};
  }

  & > div > div > span {
    white-space: nowrap;
  }
`;

/**
 * Security activity of app users on one page (4.22): the "Show all" of the
 * "Security activity" section on the App users tab and of the user's
 * Sessions panel. The shared event table across the full width, filters for
 * the kind of event, the period and one user, CSV export and Strapi's
 * pagination. Filters and page live in the URL, so a view can be shared and
 * the browser Back button restores it. Needs `user-activity.read` (route in
 * pages/App.jsx); the server checks it on every request.
 *
 * @returns {import('react').ReactElement} Page.
 */
const UserActivityPage = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [{ query }, setQuery] = useQueryParams();
  const view = parseUserActivityQuery(query);
  const captionRef = useRef(null);
  const params = useMemo(
    () =>
      buildUserActivityParams({
        userId: view.userId,
        event: view.event,
        period: view.period,
        page: view.page,
        pageSize: view.pageSize,
      }),
    [view.userId, view.event, view.period, view.page, view.pageSize]
  );
  const list = useEventList({
    path: USER_ACTIVITY_API_PATH,
    params,
    logKey: 'userActivity.page',
  });
  const pagination = list.meta?.pagination || { page: 1, pageCount: 1, total: 0 };

  // A page beyond the result (hand-edited URL, events removed by retention) goes to the last page.
  useEffect(() => {
    if (!list.loading && list.meta && view.page > pagination.pageCount) {
      setQuery({ page: String(pagination.pageCount) }, 'push', true);
    }
  }, [list.loading, list.meta, view.page, pagination.pageCount, setQuery]);

  const filtered = hasUserActivityFilters(view);
  const filteredUser =
    view.userId !== null ? list.rows.find((row) => row.user?.documentId === view.userId) : null;
  const userName = filteredUser
    ? userText(t, filteredUser)
    : t('userActivity.page.selectedUser', 'Selected user');

  /**
   * Writes filters to the URL and goes back to page 1.
   *
   * @param {Record<string, string|undefined>} next Changed query values.
   * @returns {void}
   */
  const setFilters = (next) => setQuery({ ...next, page: '1' });

  const clearFilters = () => {
    setQuery({ event: undefined, period: undefined, userId: undefined, page: '1' });
    captionRef.current?.focus();
  };

  const title = t('userActivity.page.title', 'Security activity of app users');
  const recordingOff = list.meta?.recording && list.meta.recording.userSignIns === false;

  return (
    <PageShell
      headingId="magic-sessionmanager-user-activity-title"
      title={title}
      subtitle={t(
        'userActivity.page.subtitle',
        'Failed and refused sign-ins, lockouts, session limits, new devices, impossible travel, “This wasn’t me” reports, data exports and impersonations of your app’s users. Newest first.'
      )}
      navigationAction={<BackButton fallback={SESSION_VIEW_PATHS.users} />}
    >
      <EventList
        list={list}
        filters={
          <>
            <FilterSlot>
              <SingleSelect
                size="S"
                aria-label={t('adminPanel.activity.filter.event', 'Event')}
                value={view.event}
                onChange={(next) =>
                  setFilters({ event: String(next) === 'all' ? undefined : String(next) })
                }
              >
                {USER_ACTIVITY_FILTER_OPTIONS.map((option) => (
                  <SingleSelectOption key={option} value={option}>
                    {t(...USER_ACTIVITY_FILTER_LABELS[option])}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </FilterSlot>
            <FilterSlot>
              <PeriodSelect
                value={view.period}
                onChange={(next) => setFilters({ period: next === '30' ? undefined : next })}
              />
            </FilterSlot>
            {view.userId !== null ? (
              <Tag
                icon={<Cross aria-hidden="true" />}
                label={t('userActivity.page.removeUser', 'Show all users again')}
                onClick={() => setFilters({ userId: undefined })}
                data-user-filter={view.userId}
              >
                {t('userActivity.page.userFilter', 'User: {name}', { name: userName })}
              </Tag>
            ) : null}
          </>
        }
        notice={
          <Flex direction="column" alignItems="stretch" gap={4}>
            {recordingOff ? (
              <RecordingOff to={USER_ACTIVITY_SETTINGS_PATH}>
                {t(
                  'userActivity.page.recordingOff',
                  'Failed and refused sign-ins are not recorded. The other events still are.'
                )}
              </RecordingOff>
            ) : null}
            <Typography
              ref={captionRef}
              tabIndex={-1}
              variant="pi"
              textColor="neutral600"
              aria-live="polite"
              data-activity-caption=""
            >
              {t(
                'adminPanel.activity.page.caption',
                '{total, plural, =0 {No events} one {# event} other {# events}}',
                { total: pagination.total }
              )}
            </Typography>
          </Flex>
        }
        empty={
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
            content={
              filtered
                ? t('adminPanel.activity.page.noResults', 'No events match these filters.')
                : t('userActivity.recent.empty', 'No security events of app users yet.')
            }
            action={
              filtered ? (
                <Button variant="secondary" onClick={clearFilters}>
                  {t('adminPanel.noResults.reset', 'Clear filters')}
                </Button>
              ) : null
            }
          />
        }
        renderList={(rows) => (
          <UserEventTable
            rows={rows}
            label={title}
            busy={list.loading}
            detailsAction={(row, close) =>
              row.user?.documentId && row.user.documentId !== view.userId ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    close();
                    setFilters({ userId: row.user.documentId });
                  }}
                >
                  {t('userActivity.page.onlyUser', 'Show only events of {name}', {
                    name: userText(t, row),
                  })}
                </Button>
              ) : null
            }
          />
        )}
        toCsv={buildUserActivityCsv}
        fileName="app-user-security-activity"
        exportLabel={t(
          'userActivity.page.export',
          'Export the security activity of app users with these filters as CSV'
        )}
        footer={
          <PaginationTargets>
            <Pagination.Root
              pageCount={pagination.pageCount}
              total={pagination.total}
              defaultPageSize={EVENT_PAGE_SIZE}
            >
              <Pagination.PageSize options={[...ACTIVITY_PAGE_SIZE_OPTIONS]} />
              <Pagination.Links />
            </Pagination.Root>
          </PaginationTargets>
        }
      />
    </PageShell>
  );
};

export default UserActivityPage;
