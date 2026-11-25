import { useEffect, useMemo, useRef } from 'react';
import { useIntl } from 'react-intl';
import { BackButton, Pagination, useQueryParams } from '@strapi/strapi/admin';
import {
  Button,
  EmptyStateLayout,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { EmptyDocuments } from '@strapi/icons/symbols';
import styled from 'styled-components';
import pluginId from '../../pluginId';
import { getTranslation } from '../../utils/getTranslation';
import { PageShell } from '../../components/ui';
import { SESSION_VIEW_PATHS } from '../../components/SessionViewNav';
import { EventList, FilterSlot, FilterTag, PeriodSelect, RecordingOff } from './AdminEventPanels';
import { SignInEventTable } from './EventTables';
import { useEventList } from './useEventList';
import {
  ACTIVITY_PAGE_SIZE_OPTIONS,
  EVENT_PAGE_SIZE,
  ALL_ADMINS_FILTER_OPTIONS,
  buildSignInCsv,
  buildSignInParams,
  hasActivityPageFilters,
  parseActivityPageQuery,
} from './adminActivityModel.mjs';

/** Same 32 px touch targets and wrapping as the admin list pagination. */
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
 * Translation helper bound to the plugin prefix.
 *
 * @returns {(id: string, defaultMessage: string, values?: object) => string}
 */
const useT = () => {
  const { formatMessage } = useIntl();
  return (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
};

/**
 * Security activity of all admins on one page (the "Show all" of the
 * "Recent security activity" table): the same table across the full width,
 * filters for event, period and one admin, CSV export and Strapi's
 * pagination. Filters and page live in the URL, so the view can be shared
 * and the browser Back button restores it. Reached from the admin panel
 * sessions; needs `admin-sessions.read` and `admin-activity.read` (route in
 * pages/App.jsx), and the server checks both on every request.
 *
 * @returns {import('react').ReactElement} Page.
 */
const AdminActivityPage = () => {
  const t = useT();
  const [{ query }, setQuery] = useQueryParams();
  const view = parseActivityPageQuery(query);
  const captionRef = useRef(null);
  const params = useMemo(
    () =>
      buildSignInParams({
        adminId: view.adminId ?? undefined,
        event: view.event,
        period: view.period,
        page: view.page,
        pageSize: view.pageSize,
      }),
    [view.adminId, view.event, view.period, view.page, view.pageSize]
  );
  const list = useEventList({
    path: `/${pluginId}/admin-activity/sign-ins`,
    params,
    logKey: 'adminPanel.activity.page',
  });
  const pagination = list.meta?.pagination || { page: 1, pageCount: 1, total: 0 };

  // A page beyond the result (hand-edited URL, events removed by retention) goes to the last page.
  useEffect(() => {
    if (!list.loading && list.meta && view.page > pagination.pageCount) {
      setQuery({ page: String(pagination.pageCount) }, 'push', true);
    }
  }, [list.loading, list.meta, view.page, pagination.pageCount, setQuery]);
  const recording = list.meta?.recording;
  const filtered = hasActivityPageFilters(view);
  const adminName =
    view.adminId !== null
      ? list.rows.find((row) => row.admin?.id === view.adminId)?.admin?.name ||
        t('adminPanel.identity.placeholder', 'Admin #{id}', { id: view.adminId })
      : null;

  /**
   * Writes filters to the URL and goes back to page 1.
   *
   * @param {Record<string, string|undefined>} next Changed query values.
   * @returns {void}
   */
  const setFilters = (next) => setQuery({ ...next, page: '1' });

  const clearFilters = () => {
    setQuery({ event: undefined, period: undefined, adminId: undefined, page: '1' });
    captionRef.current?.focus();
  };

  const labels = {
    all: t('adminPanel.activity.filter.allEvents', 'All events'),
    succeeded: t('adminPanel.activity.filter.succeeded', 'Sign-ins'),
    failed: t('adminPanel.activity.filter.failed', 'Failed and locked out'),
    'signed-out': t('adminPanel.activity.filter.signedOut', 'Sign-outs'),
    impersonation: t('adminPanel.activity.filter.impersonation', 'Impersonation'),
    changes: t('adminPanel.activity.filter.changes', 'Settings and log access'),
  };
  const title = t('adminPanel.activity.page.title', 'Security activity');
  const total = pagination.total;

  return (
    <PageShell
      headingId="magic-sessionmanager-admin-activity-title"
      title={title}
      subtitle={t(
        'adminPanel.activity.page.subtitle',
        'Sign-ins, failed attempts, lockouts and sign-outs of every admin, plus settings changes, reads of this log with an API token and retention runs. Newest first.'
      )}
      navigationAction={<BackButton fallback={SESSION_VIEW_PATHS.admins} />}
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
                {ALL_ADMINS_FILTER_OPTIONS.map((option) => (
                  <SingleSelectOption key={option} value={option}>
                    {labels[option]}
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
            {view.adminId !== null ? (
              <FilterTag
                label={t('adminPanel.activity.page.removeAdmin', 'Show all admins again')}
                onRemove={() => setFilters({ adminId: undefined })}
                data-admin-filter={view.adminId}
              >
                {t('adminPanel.activity.page.adminFilter', 'Admin: {name}', { name: adminName })}
              </FilterTag>
            ) : null}
          </>
        }
        notice={
          <Flex direction="column" alignItems="stretch" gap={4}>
            {recording && !recording.signIns ? (
              <RecordingOff>
                {t(
                  'adminPanel.activity.signIns.off',
                  'Sign-in history is turned off. New sign-ins are not recorded.'
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
                { total }
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
                : t('adminPanel.activity.recent.empty', 'No events recorded yet.')
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
          <SignInEventTable
            rows={rows}
            label={title}
            showAdmin
            busy={list.loading}
            detailsAction={(row, close) =>
              row.admin && row.admin.id !== view.adminId ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    close();
                    setFilters({ adminId: String(row.admin.id) });
                  }}
                >
                  {t('adminPanel.activity.page.onlyAdmin', 'Show only events of {name}', {
                    name: row.admin.name,
                  })}
                </Button>
              ) : null
            }
          />
        )}
        toCsv={buildSignInCsv}
        fileName="admin-security-activity"
        exportLabel={t(
          'adminPanel.activity.page.export',
          'Export the security activity with these filters as CSV'
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

export default AdminActivityPage;
