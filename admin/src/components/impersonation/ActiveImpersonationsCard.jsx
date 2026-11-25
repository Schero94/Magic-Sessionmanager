import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  IconButton,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, SignOut } from '@strapi/icons';
import { EmptyPermissions } from '@strapi/icons/symbols';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import { ConfirmAction, RowActions, SectionCard } from '../ui';
import Alert from '../PersistentAlert';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { useElementWidth } from '../../utils/useElementWidth';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { shouldIsolateActionKey } from '../../pages/Dashboard/dashboardModel.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';

/** Below this card width (px) the table becomes a list. */
const TABLE_MIN_WIDTH = 720;

/** Keeps Enter and Space on the row's buttons (the DS grid cell swallows them). */
const keepActionKeys = (event) => {
  if (shouldIsolateActionKey(event.key, true)) event.stopPropagation();
};

/**
 * "Active impersonations" (Settings > Impersonation, 4.20): who is acting as
 * which app user (or previews which admin), why and until when, with End for
 * each. Only admins with an impersonate permission see it; the server lists
 * only what they may end.
 *
 * States: loading, empty, error with retry, list (table from 720 px card
 * width, else a list), refresh keeps the list mounted.
 *
 * @returns {import('react').ReactElement} Card.
 */
const ActiveImpersonationsCard = () => {
  const { t } = useSettingsTranslate();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { formatDate } = useSessionFormatters();
  const [widthRef, width] = useElementWidth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(null);
  const requestRef = useRef(0);

  const apply = useCallback(async (request, pending) => {
    try {
      const { data } = await pending;
      if (request !== requestRef.current) return;
      if (!Array.isArray(data?.data)) throw new Error('Invalid impersonation list');
      setRows(data.data);
      setError(false);
    } catch (err) {
      if (isCancelledRequest(err) || request !== requestRef.current) return;
      logSafeAdminError('impersonation.list', err);
      setError(true);
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, []);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setRefreshing(true);
    return apply(request, get(`/${pluginId}/impersonation/active`));
  }, [apply, get]);

  useEffect(() => {
    apply(++requestRef.current, get(`/${pluginId}/impersonation/active`));
  }, [apply, get]);

  /**
   * Ends one impersonation and reloads the list. Throws on failure so the
   * dialog stays open for a retry.
   *
   * @param {object} row Impersonation.
   * @returns {Promise<void>}
   */
  const end = async (row) => {
    try {
      await post(`/${pluginId}/impersonation/${row.id}/end`, {});
      toggleNotification({
        type: 'success',
        message: t('impersonation.ended', 'Impersonation ended.'),
      });
    } catch (err) {
      logSafeAdminError('impersonation.end', err);
      toggleNotification({
        type: 'danger',
        message: t('impersonation.error.end', 'The impersonation could not be ended.'),
      });
      throw err;
    } finally {
      await load();
    }
  };

  const endAction = (row) => (
    <ConfirmAction
      key={row.id}
      fallbackFocusRef={refreshRef}
      title={t('impersonation.confirm.title', 'End the impersonation of {user}?', {
        user: label(row),
      })}
      body={t(
        'impersonation.confirm.body',
        'The short-lived sign-in stops working at once. This is recorded in the security log.'
      )}
      confirmLabel={t('impersonation.end', 'End impersonation')}
      onConfirm={() => end(row)}
      trigger={
        <IconButton
          variant="ghost"
          label={t('impersonation.endLabel', 'End impersonation of {user}', {
            user: label(row),
          })}
        >
          <SignOut />
        </IconButton>
      }
    />
  );

  const label = (row) =>
    row.targetLabel ||
    (row.targetType === 'admin'
      ? t('impersonation.list.adminFallback', 'Admin #{id}', { id: row.targetId })
      : row.targetId);
  const kind = (row) => {
    if (row.targetType !== 'admin') return null;
    if (row.handoff === 'admin-session') {
      return (
        <Badge
          backgroundColor={row.allowChanges ? 'danger100' : 'primary100'}
          textColor="neutral800"
        >
          {row.allowChanges
            ? t('impersonation.list.kind.adminChanges', 'Admin, signed in, changes allowed')
            : t('impersonation.list.kind.adminSignedIn', 'Admin, signed in, read-only')}
        </Badge>
      );
    }
    return (
      <Badge backgroundColor="primary100" textColor="neutral800">
        {t('impersonation.list.kind.admin', 'Admin, view only')}
      </Badge>
    );
  };

  const time = (iso) => (
    <Typography tag="time" dateTime={iso} variant="omega" textColor="neutral800">
      {formatDate(iso, { hour: '2-digit', minute: '2-digit' })}
    </Typography>
  );
  const startedBy = (row) =>
    row.startedByYou ? t('impersonation.list.you', 'You') : row.actorLabel || '—';

  let content;
  if (rows === null && !error) {
    content = (
      <Flex justifyContent="center" padding={6}>
        <Loader small>{t('impersonation.list.loading', 'Loading impersonations…')}</Loader>
      </Flex>
    );
  } else if (error && rows === null) {
    content = (
      <Alert
        variant="danger"
        closeLabel={t('common.close', 'Close')}
        title={t('impersonation.list.error', 'Impersonations could not be loaded.')}
        action={
          <Button variant="tertiary" onClick={load}>
            {t('common.tryAgain', 'Try again')}
          </Button>
        }
      >
        {t(
          'impersonation.list.errorBody',
          'Running impersonations still end on time; only this list is missing.'
        )}
      </Alert>
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyStateLayout
        icon={<EmptyPermissions width="16rem" height="8rem" />}
        content={t(
          'impersonation.list.empty',
          'No impersonation is running. Start one from a user’s entry in the Content Manager.'
        )}
      />
    );
  } else if (width === 0 || width >= TABLE_MIN_WIDTH) {
    content = (
      <Box hasRadius borderColor="neutral150" data-impersonations-table="">
        <Table colCount={5} rowCount={rows.length + 1} aria-busy={refreshing}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('impersonation.list.col.user', 'User')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('impersonation.list.col.startedBy', 'Started by')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('impersonation.list.col.reason', 'Reason')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('impersonation.list.col.ends', 'Ends')}
                </Typography>
              </Th>
              <Th>
                <VisuallyHidden>{t('impersonation.list.col.actions', 'Actions')}</VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.id} data-impersonation-row="">
                <Td>
                  <Flex gap={2} wrap="wrap" alignItems="center">
                    <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
                      {label(row)}
                    </Typography>
                    {kind(row)}
                  </Flex>
                </Td>
                <Td>
                  <Typography variant="omega" textColor="neutral800">
                    {startedBy(row)}
                  </Typography>
                </Td>
                <Td style={{ maxWidth: 0, width: '40%' }}>
                  <Typography
                    variant="omega"
                    textColor="neutral800"
                    tag="p"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {row.reason}
                  </Typography>
                </Td>
                <Td>{time(row.expiresAt)}</Td>
                <Td>
                  <RowActions onKeyDown={keepActionKeys}>{endAction(row)}</RowActions>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    );
  } else {
    content = (
      <Flex direction="column" alignItems="stretch" gap={2} tag="ul" data-impersonations-list="">
        {rows.map((row) => (
          <Box key={row.id} tag="li" padding={4} hasRadius borderColor="neutral150">
            <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
              <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                <Flex gap={2} wrap="wrap" alignItems="center">
                  <Typography variant="omega" textColor="neutral800" fontWeight="semiBold">
                    {label(row)}
                  </Typography>
                  {kind(row)}
                </Flex>
                <Typography
                  variant="pi"
                  textColor="neutral800"
                  tag="p"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {row.reason}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t('impersonation.list.summary', '{admin}, until {time}', {
                    admin: startedBy(row),
                    time: formatDate(row.expiresAt, { hour: '2-digit', minute: '2-digit' }),
                  })}
                </Typography>
              </Flex>
              <RowActions onKeyDown={keepActionKeys}>{endAction(row)}</RowActions>
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  }

  return (
    <SectionCard
      id="active-impersonations"
      title={t('impersonation.list.title', 'Active impersonations')}
      subtitle={t(
        'impersonation.list.intro',
        'Each one ends by itself at the time shown. End stops it at once.'
      )}
      action={
        <Button
          ref={refreshRef}
          variant="tertiary"
          startIcon={<ArrowClockwise />}
          onClick={load}
          loading={refreshing && rows !== null}
        >
          {t('impersonation.list.refresh', 'Refresh')}
        </Button>
      }
    >
      <div ref={widthRef} aria-live="polite">
        {error && rows !== null ? (
          <Box paddingBottom={3}>
            <Alert
              variant="warning"
              closeLabel={t('common.close', 'Close')}
              title={t('impersonation.list.refreshErrorTitle', 'Not refreshed')}
            >
              {t(
                'impersonation.list.refreshError',
                'The list could not be refreshed. It shows the last known impersonations.'
              )}
            </Alert>
          </Box>
        ) : null}
        {content}
      </div>
    </SectionCard>
  );
};

export default ActiveImpersonationsCard;
