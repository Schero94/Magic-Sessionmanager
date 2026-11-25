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
import { ArrowClockwise, Key, Lock } from '@strapi/icons';
import { EmptyPermissions } from '@strapi/icons/symbols';
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import pluginPermissions from '../../permissions';
import { ConfirmAction, RowActions, SectionCard } from '../../components/ui';
import Alert from '../../components/PersistentAlert';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { useElementWidth } from '../../utils/useElementWidth';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { sortLocks } from '../../utils/policyForm.mjs';
import { shouldIsolateActionKey } from '../Dashboard/dashboardModel.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/** Below this card width (px) the table becomes a list. */
const TABLE_MIN_WIDTH = 640;

/** Keeps Enter and Space on the row's buttons (the DS grid cell swallows them). */
const keepActionKeys = (event) => {
  if (shouldIsolateActionKey(event.key, true)) event.stopPropagation();
};

/**
 * Who or what a lock applies to: the account's username and email, an
 * unknown account, or the IP address.
 *
 * @param {{lock: object}} props Lock from GET /lockouts.
 * @returns {import('react').ReactElement} Label.
 */
const LockTarget = ({ lock }) => {
  const { t } = useSettingsTranslate();
  if (lock.kind === 'ip') {
    return (
      <Typography
        variant="omega"
        textColor="neutral800"
        tag="p"
        style={{ overflowWrap: 'anywhere' }}
      >
        {lock.ip || t('settings.lockouts.ipHidden', 'IP address not stored')}
      </Typography>
    );
  }
  if (!lock.user) {
    return (
      <Typography variant="omega" textColor="neutral600">
        {t('settings.lockouts.unknownAccount', 'Account that does not exist')}
      </Typography>
    );
  }
  // A long user name or email wraps inside its cell instead of running
  // under the next column: the stack stretches to the cell width.
  return (
    <Flex direction="column" alignItems="stretch" gap={1} minWidth={0} width="100%">
      <Typography
        variant="omega"
        fontWeight="semiBold"
        textColor="neutral800"
        tag="p"
        style={{ overflowWrap: 'anywhere' }}
      >
        {lock.user.username || lock.user.email}
      </Typography>
      {lock.user.email && lock.user.username ? (
        <Typography
          variant="pi"
          textColor="neutral600"
          tag="p"
          style={{ overflowWrap: 'anywhere' }}
        >
          {lock.user.email}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * Lock kind as a neutral badge (a lock is a state, not an error).
 *
 * @param {{kind: 'ip'|'account'}} props Kind.
 * @returns {import('react').ReactElement} Badge.
 */
const KindBadge = ({ kind }) => {
  const { t } = useSettingsTranslate();
  return (
    <Badge backgroundColor="neutral150" textColor="neutral800">
      {kind === 'ip'
        ? t('settings.lockouts.kind.ip', 'IP address')
        : t('settings.lockouts.kind.account', 'Account')}
    </Badge>
  );
};

/**
 * Accessible name of a lock for buttons and dialogs.
 *
 * @param {object} lock Lock.
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @returns {string} Name.
 */
const lockName = (lock, t) => {
  if (lock.kind === 'ip')
    return lock.ip || t('settings.lockouts.ipHidden', 'IP address not stored');
  if (lock.user) return lock.user.username || lock.user.email;
  return t('settings.lockouts.unknownAccount', 'Account that does not exist');
};

/**
 * "Locked now" (Login protection tab): the IP addresses and accounts that
 * the failed sign-in lockout currently refuses, with Unlock for admins who
 * hold "Unlock locked sign-ins". Unlocking is recorded in the security log.
 *
 * States: loading, empty, error with retry, list (table from 640 px card
 * width, else a list), refresh keeps the list mounted.
 *
 * @returns {import('react').ReactElement} Card.
 */
const LockedNowCard = () => {
  const { t } = useSettingsTranslate();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { formatDate } = useSessionFormatters();
  const {
    isLoading: permissionsLoading,
    allowedActions: { canUnlock },
  } = useRBAC(pluginPermissions.lockoutsUnlock);
  const [widthRef, width] = useElementWidth();
  const [locks, setLocks] = useState(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(null);
  const requestRef = useRef(0);

  /**
   * Applies one GET /lockouts result unless a newer request was started.
   *
   * @param {number} request Request number.
   * @param {Promise<object>} pending Fetch promise.
   * @returns {Promise<void>}
   */
  const apply = useCallback(async (request, pending) => {
    try {
      const { data } = await pending;
      if (request !== requestRef.current) return;
      if (!Array.isArray(data?.data)) throw new Error('Invalid lock list');
      setLocks(sortLocks(data.data));
      setError(false);
    } catch (err) {
      if (isCancelledRequest(err) || request !== requestRef.current) return;
      logSafeAdminError('lockouts', err);
      setError(true);
    } finally {
      if (request === requestRef.current) setRefreshing(false);
    }
  }, []);

  const load = useCallback(() => {
    const request = ++requestRef.current;
    setRefreshing(true);
    return apply(request, get(`/${pluginId}/lockouts`));
  }, [apply, get]);

  useEffect(() => {
    // First load: the loading state is the initial `locks === null`.
    apply(++requestRef.current, get(`/${pluginId}/lockouts`));
  }, [apply, get]);

  /**
   * Lifts one lock and reloads the list. Throws on failure so the dialog
   * stays open for a retry.
   *
   * @param {object} lock Lock.
   * @returns {Promise<void>}
   */
  const unlock = async (lock) => {
    try {
      await post(`/${pluginId}/lockouts/unlock`, { id: lock.id });
      toggleNotification({
        type: 'success',
        message: t('settings.lockouts.unlocked', '{name} was unlocked.', {
          name: lockName(lock, t),
        }),
      });
    } catch (err) {
      if (err?.response?.status === 404) {
        toggleNotification({
          type: 'info',
          message: t('settings.lockouts.alreadyEnded', 'This lock had already ended.'),
        });
      } else {
        logSafeAdminError('lockouts', err);
        toggleNotification({
          type: 'danger',
          message: t('settings.lockouts.unlockFailed', 'The lock could not be lifted.'),
        });
        throw err;
      }
    } finally {
      await load();
    }
  };

  const showActions = !permissionsLoading && canUnlock;
  const asTable = width === 0 || width >= TABLE_MIN_WIDTH;

  const unlockAction = (lock) =>
    showActions ? (
      <ConfirmAction
        key={lock.id}
        fallbackFocusRef={refreshRef}
        title={t('settings.lockouts.confirm.title', 'Unlock {name}?', { name: lockName(lock, t) })}
        body={
          lock.kind === 'ip'
            ? t(
                'settings.lockouts.confirm.bodyIp',
                'Sign-ins from this address are allowed again at once, and its failed attempts are reset. This is recorded in the security log.'
              )
            : t(
                'settings.lockouts.confirm.bodyAccount',
                'Sign-ins to this account are allowed again at once, and its failed attempts are reset. This is recorded in the security log.'
              )
        }
        confirmLabel={t('settings.lockouts.confirm.action', 'Unlock')}
        variant="default"
        onConfirm={() => unlock(lock)}
        trigger={
          <IconButton
            variant="ghost"
            label={t('settings.lockouts.unlockLabel', 'Unlock {name}', { name: lockName(lock, t) })}
          >
            <Key />
          </IconButton>
        }
      />
    ) : null;

  const ends = (lock) => (
    <Typography tag="time" dateTime={lock.until} variant="omega" textColor="neutral800">
      {formatDate(lock.until, { hour: '2-digit', minute: '2-digit' })}
    </Typography>
  );

  let content;
  if (locks === null && !error) {
    content = (
      <Flex justifyContent="center" padding={6}>
        <Loader small>{t('settings.lockouts.loading', 'Loading locks…')}</Loader>
      </Flex>
    );
  } else if (error && locks === null) {
    content = (
      <Alert
        variant="danger"
        closeLabel={t('common.close', 'Close')}
        title={t('settings.lockouts.error', 'Locks could not be loaded.')}
        action={
          <Button variant="tertiary" onClick={load}>
            {t('common.tryAgain', 'Try again')}
          </Button>
        }
      >
        {t('settings.lockouts.errorBody', 'Sign-ins are still checked; only this list is missing.')}
      </Alert>
    );
  } else if (locks.length === 0) {
    content = (
      <EmptyStateLayout
        icon={<EmptyPermissions width="16rem" height="8rem" />}
        content={t(
          'settings.lockouts.empty',
          'Nothing is locked. Locked IP addresses and accounts appear here until their lock ends.'
        )}
      />
    );
  } else if (asTable) {
    content = (
      <Box hasRadius borderColor="neutral150" data-locks-table="">
        <Table colCount={showActions ? 5 : 4} rowCount={locks.length + 1} aria-busy={refreshing}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('settings.lockouts.col.locked', 'Locked')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('settings.lockouts.col.kind', 'Type')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('settings.lockouts.col.failures', 'Failed sign-ins')}
                </Typography>
              </Th>
              <Th>
                <Typography variant="sigma" textColor="neutral600">
                  {t('settings.lockouts.col.until', 'Locked until')}
                </Typography>
              </Th>
              {showActions ? (
                <Th>
                  <VisuallyHidden>{t('settings.lockouts.col.actions', 'Actions')}</VisuallyHidden>
                </Th>
              ) : null}
            </Tr>
          </Thead>
          <Tbody>
            {locks.map((lock) => (
              <Tr key={lock.id} data-lock-row={lock.kind}>
                <Td style={{ maxWidth: 0, width: '40%' }}>
                  <LockTarget lock={lock} />
                </Td>
                <Td>
                  <KindBadge kind={lock.kind} />
                </Td>
                <Td>
                  <Typography variant="omega" textColor="neutral800">
                    {lock.failures}
                  </Typography>
                </Td>
                <Td>{ends(lock)}</Td>
                {showActions ? (
                  <Td>
                    <RowActions onKeyDown={keepActionKeys}>{unlockAction(lock)}</RowActions>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    );
  } else {
    content = (
      <Flex direction="column" alignItems="stretch" gap={2} tag="ul" data-locks-list="">
        {locks.map((lock) => (
          <Box
            key={lock.id}
            tag="li"
            padding={4}
            hasRadius
            borderColor="neutral150"
            data-lock-row={lock.kind}
          >
            <Flex justifyContent="space-between" alignItems="flex-start" gap={3}>
              <Flex direction="column" alignItems="flex-start" gap={2} minWidth={0}>
                <LockTarget lock={lock} />
                <Flex gap={2} wrap="wrap">
                  <KindBadge kind={lock.kind} />
                  <Typography variant="pi" textColor="neutral600">
                    {t('settings.lockouts.summary', '{count} failed, until {time}', {
                      count: lock.failures,
                      time: formatDate(lock.until, { hour: '2-digit', minute: '2-digit' }),
                    })}
                  </Typography>
                </Flex>
              </Flex>
              <RowActions onKeyDown={keepActionKeys}>{unlockAction(lock)}</RowActions>
            </Flex>
          </Box>
        ))}
      </Flex>
    );
  }

  return (
    <SectionCard
      id="locked-now"
      title={t('settings.lockouts.title', 'Locked now')}
      subtitle={t(
        'settings.lockouts.intro',
        'IP addresses and accounts that are refused right now after failed sign-ins.'
      )}
      action={
        <Button
          ref={refreshRef}
          variant="tertiary"
          startIcon={<ArrowClockwise />}
          onClick={load}
          loading={refreshing && locks !== null}
        >
          {t('settings.lockouts.refresh', 'Refresh')}
        </Button>
      }
    >
      <div ref={widthRef} aria-live="polite">
        {error && locks !== null ? (
          <Box paddingBottom={3}>
            <Alert
              variant="warning"
              closeLabel={t('common.close', 'Close')}
              title={t('settings.lockouts.refreshErrorTitle', 'Not refreshed')}
            >
              {t(
                'settings.lockouts.refreshError',
                'The list could not be refreshed. It shows the last known locks.'
              )}
            </Alert>
          </Box>
        ) : null}
        {content}
        {locks && locks.length > 0 && !showActions && !permissionsLoading ? (
          <Box paddingTop={3}>
            <Flex gap={2} alignItems="center">
              <Lock aria-hidden fill="neutral600" />
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'settings.lockouts.noUnlock',
                  'Unlocking needs the "Unlock locked sign-ins" permission.'
                )}
              </Typography>
            </Flex>
          </Box>
        ) : null}
        <VisuallyHidden>
          {locks
            ? t(
                'settings.lockouts.count',
                '{count, plural, =0 {No locks} one {# lock} other {# locks}}',
                {
                  count: locks.length,
                }
              )
            : null}
        </VisuallyHidden>
      </div>
    </SectionCard>
  );
};

export default LockedNowCard;
