import { useId, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { CaretDown } from '@strapi/icons';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import {
  UNTRACKED_END_PATH,
  UNTRACKED_SUMMARY_PATH,
  monthToDate,
  readEndResult,
  readUntrackedSummary,
  shareOf,
  untrackedTone,
} from '../../utils/untrackedSessions.mjs';
import Alert from '../../components/PersistentAlert';
import ReadableText from '../../components/ReadableText';
import { ConfirmAction } from '../../components/ui';

/** Caret that points down when open and right when closed. */
const Caret = styled(CaretDown)`
  transform: rotate(${({ $open }) => ($open ? '0deg' : '-90deg')});
`;

/**
 * Metric groups of the disclosure: one column on small screens, two from the
 * DS medium breakpoint, three from large. Grid cells shrink (`minmax(0, 1fr)`).
 */
const Groups = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[6]};

  ${({ theme }) => theme.breakpoints.medium} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  ${({ theme }) => theme.breakpoints.large} {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

/** Label/value rows without browser bullets. */
const Rows = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};

  && > li {
    margin: 0;
    max-width: none;
  }
`;

/**
 * One label/value row.
 *
 * @param {{label: import('react').ReactNode, value: import('react').ReactNode}} props
 * @returns {import('react').ReactElement}
 */
const Row = ({ label, value }) => (
  <Flex tag="li" justifyContent="space-between" alignItems="baseline" gap={4} minWidth={0}>
    <Typography variant="omega" textColor="neutral700" minWidth={0}>
      {label}
    </Typography>
    <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
      {value}
    </Typography>
  </Flex>
);

/**
 * One titled metric group.
 *
 * @param {{title: import('react').ReactNode, children: import('react').ReactNode, hint?: import('react').ReactNode}} props
 * @returns {import('react').ReactElement}
 */
const Group = ({ title, children, hint }) => (
  <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
    <Typography variant="omega" fontWeight="bold" tag="h3" textColor="neutral800">
      {title}
    </Typography>
    <Rows>{children}</Rows>
    {hint ? (
      <Typography variant="pi" textColor="neutral600">
        {hint}
      </Typography>
    ) : null}
  </Flex>
);

/**
 * Notice above the stat cards about Strapi sign-ins that this plugin does
 * not track: Users & Permissions refresh tokens that Strapi still accepts
 * but that have no session details here. They are not in the list and are
 * not active or online sessions.
 *
 * - Neutral tone when every untracked sign-in is older than the plugin's
 *   tracking start (legacy rows that expire on their own); warning tone,
 *   "possible tracking gap", when any was created afterwards.
 * - "Why?" opens a disclosure with the count-only server summary (loaded on
 *   first open; loading, error with retry, data).
 * - "End these sessions" ends them after a ConfirmDialog. The server ends at
 *   most a bounded number per request and reports what remains.
 *
 * @param {{
 *   stats: {nativeOnly: number, nativeOnlyAfterTracking: number|null},
 *   onChanged: () => Promise<void>|void,
 *   fallbackFocusRef?: {current: HTMLElement|null},
 * }} props
 * @returns {import('react').ReactElement|null}
 */
const UntrackedSessionsNotice = ({ stats, onChanged, fallbackFocusRef }) => {
  const { formatMessage, formatNumber, formatDate } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState('idle');
  const requestRef = useRef(0);
  const panelId = `untracked-sessions-${useId().replace(/:/g, '')}`;

  const count = stats?.nativeOnly || 0;
  const after = stats?.nativeOnlyAfterTracking;
  const tone = untrackedTone(stats);

  const loadSummary = async () => {
    const request = ++requestRef.current;
    setSummaryState('loading');
    try {
      const response = await get(UNTRACKED_SUMMARY_PATH);
      const next = readUntrackedSummary(response.data);
      if (request !== requestRef.current) return;
      setSummary(next);
      setSummaryState('ready');
    } catch (err) {
      if (request !== requestRef.current) return;
      logSafeAdminError('dashboard.untrackedSummary', err);
      setSummaryState('error');
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && summaryState !== 'ready' && summaryState !== 'loading') loadSummary();
  };

  const endSessions = async () => {
    try {
      const response = await post(UNTRACKED_END_PATH, {});
      const result = readEndResult(response.data);
      setSummary(null);
      setSummaryState('idle');
      if (open) loadSummary();
      await onChanged?.();
      toggleNotification({
        type: 'success',
        message:
          result.remaining > 0
            ? t(
                'homepage.untracked.end.partial',
                '{ended, plural, one {# untracked session ended.} other {# untracked sessions ended.}} {remaining, plural, one {# is left; run the action again to end it.} other {# are left; run the action again to end them.}}',
                { ended: result.ended, remaining: result.remaining }
              )
            : t(
                'homepage.untracked.end.success',
                '{ended, plural, one {# untracked session ended.} other {# untracked sessions ended.}}',
                { ended: result.ended }
              ),
      });
    } catch (err) {
      logSafeAdminError('dashboard.untrackedEnd', err);
      toggleNotification({
        type: 'danger',
        message: t(
          'homepage.untracked.end.error',
          'The untracked sessions could not be ended. Please try again.'
        ),
      });
      throw err;
    }
  };

  if (count <= 0) return null;

  const title =
    tone === 'warning'
      ? t(
          'homepage.untracked.title.gap',
          'Possible tracking gap: {count, plural, one {# Strapi sign-in is} other {# Strapi sign-ins are}} not tracked',
          { count }
        )
      : t(
          'homepage.untracked.title.legacy',
          '{count, plural, one {# older Strapi sign-in is} other {# older Strapi sign-ins are}} not tracked',
          { count }
        );

  const body =
    tone === 'warning'
      ? t(
          'homepage.untracked.body.gap',
          'Strapi still accepts these sign-ins (refresh tokens), but they are not in this list and are not active or online sessions. {after, plural, one {# was} other {# were}} created after this plugin started tracking, so one sign-in path may not be tracked. Select “Why?” for details.',
          { after }
        )
      : t(
          'homepage.untracked.body.legacy',
          'Strapi still accepts these sign-ins (refresh tokens) until they expire, but they are not in this list and are not active or online sessions. They were created before this plugin tracked sessions.'
        );

  const pct = (part, total) =>
    formatNumber(shareOf(part, total), { style: 'percent', maximumFractionDigits: 0 });
  const num = (value) => formatNumber(value);

  const actions = (
    <Flex gap={2} wrap="wrap">
      <Button
        size="S"
        variant="tertiary"
        startIcon={<Caret $open={open} aria-hidden focusable={false} />}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {t('homepage.untracked.why', 'Why?')}
      </Button>
      <ConfirmAction
        trigger={
          <Button size="S" variant="danger-light">
            {t('homepage.untracked.end.action', 'End these sessions')}
          </Button>
        }
        title={t(
          'homepage.untracked.end.title',
          'End {count, plural, one {# untracked Strapi sign-in} other {# untracked Strapi sign-ins}}?',
          { count }
        )}
        body={t(
          'homepage.untracked.end.body',
          'Strapi deletes these sign-ins now, so their refresh tokens stop working. Users on those devices must sign in again once their current access token expires, within minutes. Sessions listed here and Strapi administrator sessions are not affected. This cannot be undone.'
        )}
        confirmLabel={t('homepage.untracked.end.confirm', 'End sessions')}
        onConfirm={endSessions}
        fallbackFocusRef={fallbackFocusRef}
      />
    </Flex>
  );

  let panel = null;
  if (summaryState === 'loading' && !summary) {
    panel = (
      <Flex justifyContent="center" padding={4}>
        <Loader small>{t('homepage.untracked.summary.loading', 'Loading details')}</Loader>
      </Flex>
    );
  } else if (summaryState === 'error') {
    panel = (
      <Flex direction="column" alignItems="flex-start" gap={3}>
        <Typography variant="omega" textColor="danger600" role="alert">
          {t('homepage.untracked.summary.error', 'The details could not be loaded.')}
        </Typography>
        <Button size="S" variant="secondary" onClick={loadSummary}>
          {t('common.tryAgain', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (summary) {
    const since = summary.trackingSince
      ? formatDate(summary.trackingSince, { dateStyle: 'medium' })
      : null;
    panel = (
      <Flex direction="column" alignItems="stretch" gap={6}>
        <Groups>
          <Group
            title={t('homepage.untracked.summary.tracking', 'Created before or after tracking')}
            hint={
              since
                ? t(
                    'homepage.untracked.summary.trackingSince',
                    'This plugin has linked new sign-ins since {date}.',
                    { date: since }
                  )
                : t(
                    'homepage.untracked.summary.trackingUnknown',
                    'The tracking start date is not known yet.'
                  )
            }
          >
            <Row
              label={t(
                'homepage.untracked.summary.before',
                'Before tracking (expire on their own)'
              )}
              value={num(summary.beforeTracking)}
            />
            <Row
              label={t('homepage.untracked.summary.after', 'After tracking (possible gap)')}
              value={num(summary.afterTracking)}
            />
          </Group>
          <Group
            title={t('homepage.untracked.summary.source', 'How Strapi created them')}
            hint={t(
              'homepage.untracked.summary.sourceHint',
              '“Token only” comes from code that issues a token without Strapi’s sign-in details: GraphQL email confirmation, custom login routes or other plugins.'
            )}
          >
            <Row
              label={t('homepage.untracked.summary.signIn', 'Sign-in with device details')}
              value={num(summary.bySource.signIn)}
            />
            <Row
              label={t('homepage.untracked.summary.passwordChange', 'Password change or reset')}
              value={num(summary.bySource.passwordChange)}
            />
            <Row
              label={t('homepage.untracked.summary.tokenOnly', 'Token only')}
              value={num(summary.bySource.tokenOnly)}
            />
          </Group>
          <Group title={t('homepage.untracked.summary.expiring', 'Expiry')}>
            <Row
              label={t('homepage.untracked.summary.within7', 'Expire within 7 days')}
              value={t('homepage.untracked.summary.share', '{count} ({share})', {
                count: num(summary.expiring.within7Days),
                share: pct(summary.expiring.within7Days, summary.total),
              })}
            />
            <Row
              label={t('homepage.untracked.summary.within30', 'Expire within 30 days')}
              value={t('homepage.untracked.summary.share', '{count} ({share})', {
                count: num(summary.expiring.within30Days),
                share: pct(summary.expiring.within30Days, summary.total),
              })}
            />
          </Group>
          <Group title={t('homepage.untracked.summary.months', 'Created per month')}>
            {summary.byMonth.map((entry) => {
              const date = monthToDate(entry.month);
              return (
                <Row
                  key={entry.month}
                  label={
                    date
                      ? formatDate(date, { month: 'long', year: 'numeric', timeZone: 'UTC' })
                      : entry.month
                  }
                  value={num(entry.count)}
                />
              );
            })}
            {summary.earlier > 0 ? (
              <Row
                label={t('homepage.untracked.summary.earlier', 'Earlier')}
                value={num(summary.earlier)}
              />
            ) : null}
          </Group>
          <Group
            title={t('homepage.untracked.summary.devices', 'Devices')}
            hint={
              summary.deviceSample.complete
                ? t(
                    'homepage.untracked.summary.devicesHint',
                    'From the device label Strapi stores; Strapi stores no device type.'
                  )
                : t(
                    'homepage.untracked.summary.devicesSample',
                    'From the device label Strapi stores, for the first {limit, number} sign-ins.',
                    { limit: summary.deviceSample.limit }
                  )
            }
          >
            <Row
              label={t('homepage.untracked.summary.desktop', 'Desktop')}
              value={num(summary.byDevice.desktop)}
            />
            <Row
              label={t('homepage.untracked.summary.mobile', 'Mobile')}
              value={num(summary.byDevice.mobile)}
            />
            <Row
              label={t('homepage.untracked.summary.unknownDevice', 'Unknown device')}
              value={num(summary.byDevice.unknown)}
            />
          </Group>
        </Groups>
        <ReadableText variant="pi" textColor="neutral600" tag="p">
          {t(
            'homepage.untracked.summary.next',
            'Sessions created after tracking started point to a sign-in path this plugin does not see: a custom login route, GraphQL sign-ins or a plugin that issues tokens. The plugin documentation explains each case. Older sessions need no action.'
          )}
        </ReadableText>
      </Flex>
    );
  }

  return (
    <Flex direction="column" alignItems="stretch" gap={2} data-untracked-sessions={tone}>
      <Alert variant={tone} title={title} titleAs="h2" stacked action={actions}>
        <ReadableText variant="omega" textColor="neutral800" tag="span">
          {body}
        </ReadableText>
      </Alert>
      <Box
        id={panelId}
        hidden={!open}
        width="100%"
        background="neutral0"
        hasRadius
        shadow="tableShadow"
        padding={{ initial: 4, medium: 6 }}
        aria-live="polite"
        aria-busy={summaryState === 'loading'}
      >
        {open ? panel : null}
      </Box>
    </Flex>
  );
};

export default UntrackedSessionsNotice;
