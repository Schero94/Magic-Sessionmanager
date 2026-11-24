import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import {
  Button,
  Flex,
  Link,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { Download } from '@strapi/icons';
import { useNotification } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import { getTranslation } from '../../utils/getTranslation';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import Alert from '../../components/PersistentAlert';
import { SectionCard } from '../../components/ui';
import { ActivityEventRow, SignInEventRow } from './EventRows';
import { downloadCsv, useEventList } from './useEventList';
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ACTION_OPTIONS,
  MAX_EVENT_EXPORT_ROWS,
  PERIOD_OPTIONS,
  SIGN_IN_FILTER_OPTIONS,
  buildActivityParams,
  buildActivityCsv,
  buildSignInCsv,
  buildSignInParams,
} from './adminActivityModel.mjs';

/** Settings tab with the recording switches. */
export const ADMIN_ACTIVITY_SETTINGS_PATH = `/settings/${pluginId}/general?tab=admin-activity`;

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
 * Period filter (last day, week, month, quarter, everything kept).
 *
 * @param {{value: string, onChange: (value: string) => void}} props
 * @returns {import('react').ReactElement} Select.
 */
const PeriodSelect = ({ value, onChange }) => {
  const t = useT();
  const labels = {
    1: t('adminPanel.activity.period.day', 'Last 24 hours'),
    7: t('adminPanel.activity.period.week', 'Last 7 days'),
    30: t('adminPanel.activity.period.month', 'Last 30 days'),
    90: t('adminPanel.activity.period.quarter', 'Last 90 days'),
    all: t('adminPanel.activity.period.all', 'All kept events'),
  };
  return (
    <SingleSelect
      size="S"
      aria-label={t('adminPanel.activity.period.label', 'Period')}
      value={value}
      onChange={(next) => onChange(String(next))}
    >
      {PERIOD_OPTIONS.map((option) => (
        <SingleSelectOption key={option} value={option}>
          {labels[option]}
        </SingleSelectOption>
      ))}
    </SingleSelect>
  );
};

/**
 * One filter control: at least 180 px wide, sharing the row; on phones each
 * control takes its own line.
 *
 * @param {{children: import('react').ReactNode}} props
 * @returns {import('react').ReactElement} Wrapper.
 */
const FilterSlot = ({ children }) => (
  <Flex direction="column" alignItems="stretch" minWidth={0} flex="1 1 18rem">
    {children}
  </Flex>
);

/**
 * Shared list frame: filters and export, the recording notice, loading,
 * error with retry, empty text, the rows and "Show more".
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.filters Filter controls.
 * @param {import('react').ReactNode} [props.notice] Notice above the list.
 * @param {ReturnType<typeof useEventList>} props.list List state.
 * @param {string} props.listLabel Accessible name of the list.
 * @param {string} props.emptyText Text when nothing matches.
 * @param {(row: object) => import('react').ReactNode} props.renderRow Row renderer.
 * @param {(rows: object[]) => string} props.toCsv CSV builder.
 * @param {string} props.fileName Download name prefix.
 * @param {string} props.exportLabel Accessible name of the export button.
 * @returns {import('react').ReactElement} List.
 */
const EventList = ({
  filters,
  notice,
  list,
  listLabel,
  emptyText,
  renderRow,
  toCsv,
  fileName,
  exportLabel,
}) => {
  const t = useT();
  const { toggleNotification } = useNotification();
  const [exporting, setExporting] = useState(false);
  const total = list.meta?.pagination?.total ?? 0;

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { rows, capped } = await list.exportAll();
      downloadCsv(toCsv(rows), fileName);
      if (capped) {
        toggleNotification({
          type: 'warning',
          message: t(
            'adminPanel.activity.export.capped',
            'The export contains the newest {limit, number} events. Narrow the filter to export the rest.',
            { limit: MAX_EVENT_EXPORT_ROWS }
          ),
        });
      }
    } catch (err) {
      if (isCancelledRequest(err)) return;
      logSafeAdminError('adminPanel.activity.export', err);
      toggleNotification({
        type: 'danger',
        message: t('adminPanel.activity.export.error', 'The export could not be created.'),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
      <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Flex gap={2} wrap="wrap" alignItems="center" flex="1 1 auto" minWidth={0}>
          {filters}
        </Flex>
        <Button
          size="S"
          variant="tertiary"
          startIcon={<Download />}
          onClick={handleExport}
          loading={exporting}
          disabled={list.loading || total === 0}
          aria-label={exportLabel}
        >
          {t('adminPanel.activity.export.csv', 'Export CSV')}
        </Button>
      </Flex>
      {notice}
      {list.loading ? (
        <Flex justifyContent="center" padding={4}>
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
        <Typography variant="omega" textColor="neutral600" data-event-empty="">
          {emptyText}
        </Typography>
      ) : null}
      {list.rows.length > 0 ? (
        <Flex
          tag="ul"
          direction="column"
          alignItems="stretch"
          gap={2}
          width="100%"
          aria-label={listLabel}
        >
          {list.rows.map((row) => renderRow(row))}
        </Flex>
      ) : null}
      {list.hasMore ? (
        <Flex justifyContent="center">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>
            {t('adminPanel.activity.showMore', 'Show more')}
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
};

/**
 * "Recording is off" notice with a link to the switch.
 *
 * @param {{children: import('react').ReactNode}} props Text.
 * @returns {import('react').ReactElement} Notice.
 */
const RecordingOff = ({ children }) => {
  const t = useT();
  return (
    <Alert
      variant="neutral"
      action={
        <Link tag={RouterLink} to={ADMIN_ACTIVITY_SETTINGS_PATH}>
          {t('adminPanel.activity.openSettings', 'Open settings')}
        </Link>
      }
    >
      {children}
    </Alert>
  );
};

/**
 * Sign-in history of one admin: sign-ins with address, location, browser
 * and session state, failed attempts, lockouts and sign-outs.
 *
 * @param {{admin: {id: number, name: string}}} props Admin of the dialog.
 * @returns {import('react').ReactElement} Tab content.
 */
export const SignInHistoryPanel = ({ admin }) => {
  const t = useT();
  const [event, setEvent] = useState('all');
  const [period, setPeriod] = useState('30');
  const params = useMemo(
    () => buildSignInParams({ adminId: admin.id, event, period }),
    [admin.id, event, period]
  );
  const list = useEventList({
    path: `/${pluginId}/admin-activity/sign-ins`,
    params,
    logKey: 'adminPanel.activity.signIns',
  });
  const recording = list.meta?.recording;
  const labels = {
    all: t('adminPanel.activity.filter.allEvents', 'All events'),
    succeeded: t('adminPanel.activity.filter.succeeded', 'Sign-ins'),
    failed: t('adminPanel.activity.filter.failed', 'Failed and locked out'),
    'signed-out': t('adminPanel.activity.filter.signedOut', 'Sign-outs'),
  };

  return (
    <EventList
      list={list}
      filters={
        <>
          <FilterSlot>
            <SingleSelect
              size="S"
              aria-label={t('adminPanel.activity.filter.event', 'Event')}
              value={event}
              onChange={(next) => setEvent(String(next))}
            >
              {SIGN_IN_FILTER_OPTIONS.map((option) => (
                <SingleSelectOption key={option} value={option}>
                  {labels[option]}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </FilterSlot>
          <FilterSlot>
            <PeriodSelect value={period} onChange={setPeriod} />
          </FilterSlot>
        </>
      }
      notice={
        recording && !recording.signIns ? (
          <RecordingOff>
            {t(
              'adminPanel.activity.signIns.off',
              'Sign-in history is turned off. New sign-ins are not recorded.'
            )}
          </RecordingOff>
        ) : null
      }
      listLabel={t('adminPanel.activity.signIns.listLabel', 'Sign-in history of {name}', {
        name: admin.name,
      })}
      emptyText={t('adminPanel.activity.signIns.empty', 'No sign-in events in this period.')}
      renderRow={(row) => <SignInEventRow key={row.id} row={row} />}
      toCsv={buildSignInCsv}
      fileName="admin-sign-in-history"
      exportLabel={t(
        'adminPanel.activity.signIns.export',
        'Export the sign-in history of {name} as CSV',
        {
          name: admin.name,
        }
      )}
    />
  );
};

/**
 * Content Manager activity of one admin: which entries they opened,
 * created, edited, published, unpublished or deleted.
 *
 * @param {{admin: {id: number, name: string}}} props Admin of the dialog.
 * @returns {import('react').ReactElement} Tab content.
 */
export const ContentActivityPanel = ({ admin }) => {
  const t = useT();
  const [action, setAction] = useState('all');
  const [contentType, setContentType] = useState('all');
  const [period, setPeriod] = useState('30');
  const params = useMemo(
    () => buildActivityParams({ adminId: admin.id, action, contentType, period }),
    [admin.id, action, contentType, period]
  );
  const list = useEventList({
    path: `/${pluginId}/admin-activity/content`,
    params,
    logKey: 'adminPanel.activity.content',
  });
  const recording = list.meta?.recording;
  const types = Array.isArray(list.meta?.contentTypes) ? list.meta.contentTypes : [];
  const noAccess = list.meta?.contentManagerAccess === false;

  let notice = null;
  if (recording && !recording.contentActivity) {
    notice = (
      <RecordingOff>
        {t(
          'adminPanel.activity.content.off',
          'Content Manager activity is not recorded. An admin can turn it on in the settings; inform your team first.'
        )}
      </RecordingOff>
    );
  } else if (noAccess) {
    notice = (
      <Alert variant="neutral">
        {t(
          'adminPanel.activity.content.noAccess',
          '{name} has no Content Manager access, so there is no activity to show.',
          { name: admin.name }
        )}
      </Alert>
    );
  }

  return (
    <EventList
      list={list}
      filters={
        <>
          <FilterSlot>
            <SingleSelect
              size="S"
              aria-label={t('adminPanel.activity.filter.action', 'Action')}
              value={action}
              onChange={(next) => setAction(String(next))}
            >
              {ACTIVITY_ACTION_OPTIONS.map((option) => (
                <SingleSelectOption key={option} value={option}>
                  {t(
                    ACTIVITY_ACTION_LABELS[option].messageId,
                    ACTIVITY_ACTION_LABELS[option].defaultMessage
                  )}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </FilterSlot>
          <FilterSlot>
            <SingleSelect
              size="S"
              aria-label={t('adminPanel.activity.filter.contentType', 'Content type')}
              value={contentType}
              onChange={(next) => setContentType(String(next))}
            >
              <SingleSelectOption value="all">
                {t('adminPanel.activity.filter.allTypes', 'All content types')}
              </SingleSelectOption>
              {types.map((type) => (
                <SingleSelectOption key={type.uid} value={type.uid}>
                  {type.name}
                </SingleSelectOption>
              ))}
            </SingleSelect>
          </FilterSlot>
          <FilterSlot>
            <PeriodSelect value={period} onChange={setPeriod} />
          </FilterSlot>
        </>
      }
      notice={notice}
      listLabel={t('adminPanel.activity.content.listLabel', 'Content Manager activity of {name}', {
        name: admin.name,
      })}
      emptyText={t(
        'adminPanel.activity.content.empty',
        'No Content Manager activity in this period.'
      )}
      renderRow={(row) => <ActivityEventRow key={row.id} row={row} />}
      toCsv={buildActivityCsv}
      fileName="admin-content-activity"
      exportLabel={t(
        'adminPanel.activity.content.export',
        'Export the Content Manager activity of {name} as CSV',
        { name: admin.name }
      )}
    />
  );
};

/**
 * The latest sign-in events of all admins (sign-ins, failed attempts,
 * lockouts, sign-outs) as a short list under the admin table. A name opens
 * that admin's details at "Sign-in history"; the full history and filters
 * live there.
 *
 * @param {{onOpenAdmin: (admin: object, trigger: HTMLElement) => void}} props
 * @returns {import('react').ReactElement|null} Section, or null while sign-in history is off.
 */
export const RecentSignInActivity = ({ onOpenAdmin }) => {
  const t = useT();
  const params = useMemo(() => buildSignInParams({ pageSize: 5 }), []);
  const list = useEventList({
    path: `/${pluginId}/admin-activity/sign-ins`,
    params,
    logKey: 'adminPanel.activity.recent',
  });
  if (list.meta?.recording && !list.meta.recording.signIns) return null;
  return (
    <SectionCard
      title={t('adminPanel.activity.recent.title', 'Recent sign-in activity')}
      subtitle={t(
        'adminPanel.activity.recent.subtitle',
        'The latest sign-ins, failed attempts and sign-outs of all admins. Open an admin for their full history.'
      )}
    >
      {list.loading ? (
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
        <Typography variant="omega" textColor="neutral600">
          {t('adminPanel.activity.recent.empty', 'No sign-in events yet.')}
        </Typography>
      ) : null}
      {list.rows.length > 0 ? (
        <Flex
          tag="ul"
          direction="column"
          alignItems="stretch"
          gap={2}
          width="100%"
          aria-label={t('adminPanel.activity.recent.title', 'Recent sign-in activity')}
        >
          {list.rows.map((row) => (
            <SignInEventRow key={row.id} row={row} showAdmin onOpenAdmin={onOpenAdmin} />
          ))}
        </Flex>
      ) : null}
    </SectionCard>
  );
};
