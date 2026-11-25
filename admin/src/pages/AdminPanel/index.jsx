import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import {
  Pagination,
  useFetchClient,
  useNotification,
  useQueryParams,
  useRBAC,
} from '@strapi/strapi/admin';
import {
  Button,
  Dialog,
  EmptyStateLayout,
  Flex,
  IconButton,
  LinkButton,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, Check, Cog, Cross, User } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import styled from 'styled-components';
import pluginId from '../../pluginId';
import pluginPermissions from '../../permissions';
import { getTranslation } from '../../utils/getTranslation';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { restoreDialogFocus } from '../../utils/restoreDialogFocus.mjs';
import { useBreakpoint } from '../../utils/useBreakpoint';
import { ConfirmAction, Disclosure, PageShell, StatCard, StatGrid } from '../../components/ui';
import Alert from '../../components/PersistentAlert';
import ReadableText from '../../components/ReadableText';
import SessionViewNav from '../../components/SessionViewNav';
import SessionSearch from '../Dashboard/SessionSearch';
import {
  ADMIN_HOW_IT_WORKS_STORAGE_KEY,
  encodeSearchQuery,
  getErrorStatus,
} from '../Dashboard/dashboardModel.mjs';
import { AdminCardList, AdminTable } from './AdminList';
import AdminSessionsModal from './AdminSessionsModal';
import PreviewAdminModal from '../../components/impersonation/PreviewAdminModal';
import ActiveImpersonationsCard from '../../components/impersonation/ActiveImpersonationsCard';
import SignInAsAdminModal, {
  unsupportedText,
} from '../../components/impersonation/SignInAsAdminModal';
import { RecentSignInActivity } from './AdminEventPanels';
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_FILTER_OPTIONS,
  ADMIN_PAGE_SIZE_OPTIONS,
  buildAdminListParams,
  getSignOutErrorMessage,
  hasAdminFilters,
  parseAdminPanelQuery,
  splitDuration,
  withIdentityPlaceholders,
} from './adminPanelModel.mjs';

/** Strapi's own user management (deactivate, roles, password). */
const SETTINGS_USERS_PATH = '/settings/users';
/** Session Manager settings that hold the security log (sign-in history) options. */
const SETTINGS_PATH = `/settings/${pluginId}/general?tab=data-retention`;

/** Same 32 px touch target wrapper as the dashboard pagination. */
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

const EMPTY_STATS = { signedInAdmins: 0, activeSessions: 0, activeAccounts: 0, totalAdmins: 0 };

/**
 * Admin panel sessions (IA in docs/plans/2026-11-17-admin-panel-sessions-design.md):
 * who can use this Strapi admin panel, who is signed in right now, and how to
 * sign someone out. Separate from the app-user dashboard; its numbers never
 * mix with app-user numbers. Search, filter and pagination run on the server
 * and live in the URL. Signing out asks for confirmation, states the real
 * effect (next click, Strapi checks every request) and refreshes in place.
 *
 * @returns {import('react').ReactElement} Admin panel sessions page.
 */
const AdminPanelPage = () => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { isBelowMedium, isBelowSmall } = useBreakpoint();
  const [{ query }, setQuery] = useQueryParams();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const view = parseAdminPanelQuery(query);
  const {
    allowedActions: { canRevoke },
  } = useRBAC(pluginPermissions.adminSessionsRevoke);
  const {
    allowedActions: { canRead: canViewActivity },
  } = useRBAC(pluginPermissions.adminActivityRead);
  // "View as admin" (4.20): the read-only permission preview.
  const {
    allowedActions: { canAdmins: canPreviewAdmins },
  } = useRBAC(pluginPermissions.impersonateAdmins);
  // "Sign in as this admin" (4.23).
  const {
    allowedActions: { canSignIn: canSignInAsAdmin },
  } = useRBAC(pluginPermissions.signInAsAdmin);
  const [impersonationEnabled, setImpersonationEnabled] = useState(false);
  const [signInSupport, setSignInSupport] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [signInTarget, setSignInTarget] = useState(null);

  const [admins, setAdmins] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [dialogTab, setDialogTab] = useState('sessions');
  const [dialogSessions, setDialogSessions] = useState([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState(false);
  const [pending, setPending] = useState(null);
  const requestIdRef = useRef(0);
  const dialogRequestRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const openerRef = useRef(null);

  // Whether the Impersonation switch is on; "View as" is offered only then.
  useEffect(() => {
    if (!canPreviewAdmins && !canSignInAsAdmin) return undefined;
    let current = true;
    get(`/${pluginId}/impersonation/status`)
      .then(({ data }) => {
        if (!current) return;
        setImpersonationEnabled(data?.data?.enabled === true);
        setSignInSupport(data?.data?.adminSignIn || null);
      })
      .catch((err) => {
        if (!isCancelledRequest(err)) logSafeAdminError('impersonation.status', err);
      });
    return () => {
      current = false;
    };
  }, [canPreviewAdmins, canSignInAsAdmin, get]);
  const confirmReturnRef = useRef(null);
  const captionRef = useRef(null);
  const pageRef = useRef(null);
  const captionId = `admin-list-caption-${useId().replace(/:/g, '')}`;

  // `view` is rebuilt from the URL on every render; its four fields are the inputs.
  const listParams = useMemo(
    () =>
      buildAdminListParams({
        page: view.page,
        pageSize: view.pageSize,
        filter: view.filter,
        search: view.search,
      }),
    [view.page, view.pageSize, view.filter, view.search]
  );

  /**
   * Loads one page of admins with statistics. The first load shows the page
   * loader; later loads keep the list mounted (focus and scroll stay) and a
   * failed refresh keeps the last data under an error alert.
   *
   * @returns {Promise<void>}
   */
  const fetchAdmins = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await get(`/${pluginId}/admin-sessions/admins`, { params: listParams });
      if (requestId !== requestIdRef.current) return;
      const body = response?.data || {};
      const placeholder = (id) =>
        formatMessage(
          { id: getTranslation('adminPanel.identity.placeholder'), defaultMessage: 'Admin #{id}' },
          { id }
        );
      setAdmins(
        (Array.isArray(body.data) ? body.data : []).map((row) =>
          withIdentityPlaceholders(row, placeholder, body.meta?.identity)
        )
      );
      setMeta(body.meta || null);
      setLoadError(false);
      hasLoadedRef.current = true;
    } catch (err) {
      if (requestId !== requestIdRef.current || isCancelledRequest(err)) return;
      setLoadError(true);
      logSafeAdminError('adminPanel.load', err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [get, listParams, formatMessage]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
    fetchAdmins();
  }, [fetchAdmins]);

  /**
   * Loads the sessions of the admin in the dialog.
   *
   * @param {object} admin Admin row.
   * @returns {Promise<void>}
   */
  const fetchDialogSessions = useCallback(
    async (admin) => {
      const requestId = dialogRequestRef.current + 1;
      dialogRequestRef.current = requestId;
      setDialogLoading(true);
      try {
        const response = await get(`/${pluginId}/admin-sessions/admins/${admin.id}/sessions`);
        if (requestId !== dialogRequestRef.current) return;
        const body = response?.data || {};
        setDialogSessions(Array.isArray(body.data) ? body.data : []);
        if (body.meta?.admin) {
          const placeholder = (id) =>
            formatMessage(
              {
                id: getTranslation('adminPanel.identity.placeholder'),
                defaultMessage: 'Admin #{id}',
              },
              { id }
            );
          // The list row knows whether role names are visible; keep it.
          setSelected((current) =>
            current
              ? withIdentityPlaceholders(body.meta.admin, placeholder, {
                  roles: current.rolesHidden ? false : undefined,
                })
              : current
          );
        }
        setDialogError(false);
      } catch (err) {
        if (requestId !== dialogRequestRef.current || isCancelledRequest(err)) return;
        setDialogError(true);
        logSafeAdminError('adminPanel.sessions', err);
      } finally {
        if (requestId === dialogRequestRef.current) setDialogLoading(false);
      }
    },
    [get, formatMessage]
  );

  const openDialog = (admin, trigger, tab = 'sessions') => {
    openerRef.current = trigger;
    setDialogTab(tab);
    setSelected(admin);
    setDialogSessions([]);
    setDialogError(false);
    fetchDialogSessions(admin);
  };

  const closeDialog = () => {
    dialogRequestRef.current += 1;
    setSelected(null);
    setDialogSessions([]);
  };

  // Keep the URL page inside the result range after filtering or sign-outs.
  const pagination = meta?.pagination || { page: 1, pageCount: 1, total: 0 };
  useEffect(() => {
    if (!loading && !refreshing && view.page > pagination.pageCount) {
      setQuery({ page: String(pagination.pageCount) }, 'push', true);
    }
  }, [loading, refreshing, view.page, pagination.pageCount, setQuery]);

  const handleFilterChange = (value) => {
    const filter = String(value);
    setQuery({ filter: filter === 'all' ? undefined : filter, page: '1' });
  };

  const handleSearch = useCallback(
    (value) => setQuery({ search: encodeSearchQuery(value), page: '1' }, 'push', true),
    [setQuery]
  );

  const handleClearFilters = () => {
    setQuery({ search: undefined, filter: undefined, page: '1' });
    captionRef.current?.focus();
  };

  /**
   * Opens the confirmation for one browser or for every browser of an admin.
   *
   * @param {object} admin Admin row.
   * @param {object|null} session Session row, or null for "everywhere".
   * @param {HTMLElement|null} trigger Button that asked, for focus return.
   * @returns {void}
   */
  const askSignOut = (admin, session, trigger) => {
    confirmReturnRef.current = trigger;
    setPending({ admin, session });
  };

  /**
   * Signs out after confirmation and refreshes the list (and the dialog).
   * Errors are reported and rethrown so the confirmation stays open; a 404
   * means the session already ended, which only needs a refresh.
   *
   * @returns {Promise<void>}
   */
  const confirmSignOut = async () => {
    if (!pending) return;
    const { admin, session } = pending;
    const device = session?.device || t('adminPanel.session.unknownDevice', 'Unknown browser');
    const url = session
      ? `/${pluginId}/admin-sessions/admins/${admin.id}/sessions/${session.id}/sign-out`
      : `/${pluginId}/admin-sessions/admins/${admin.id}/sign-out-everywhere`;
    try {
      const response = await post(url);
      const result = response?.data?.data || {};
      if (result.signedOutSelf) {
        toggleNotification({
          type: 'warning',
          message: t(
            'adminPanel.signOut.success.self',
            'Your session in this browser ended. The login page opens next.'
          ),
        });
      } else {
        toggleNotification({
          type: 'success',
          message: session
            ? t('adminPanel.signOut.success.one', 'Session of {name} on {device} ended.', {
                name: admin.name,
                device,
              })
            : t('adminPanel.signOut.success.all', 'All sessions of {name} ended.', {
                name: admin.name,
              }),
        });
      }
      await Promise.all([fetchAdmins(), selected ? fetchDialogSessions(selected) : null]);
    } catch (err) {
      logSafeAdminError('adminPanel.signOut', err);
      const message = getSignOutErrorMessage(err);
      toggleNotification({
        type: getErrorStatus(err) === 404 ? 'warning' : 'danger',
        message: t(message.messageId, message.defaultMessage),
      });
      if (getErrorStatus(err) === 404) {
        // Already ended: refresh and let the confirmation close normally.
        await Promise.all([fetchAdmins(), selected ? fetchDialogSessions(selected) : null]);
        return;
      }
      throw err;
    }
  };

  const stats = meta?.stats || EMPTY_STATS;
  const supported = meta?.supported !== false;
  const showData = !loading && Boolean(meta) && supported;
  const filtersActive = hasAdminFilters(view);

  const durationText = (seconds) => {
    const parts = splitDuration(seconds);
    if (!parts) return '';
    if (parts.unit === 'days')
      return t('adminPanel.duration.days', '{count, plural, one {# day} other {# days}}', parts);
    if (parts.unit === 'hours')
      return t('adminPanel.duration.hours', '{count, plural, one {# hour} other {# hours}}', parts);
    return t(
      'adminPanel.duration.minutes',
      '{count, plural, one {# minute} other {# minutes}}',
      parts
    );
  };

  const statusCard = (filter) => ({
    onClick: () => handleFilterChange(filter),
    pressed: view.filter === filter,
  });

  // Confirmation copy (IA 3.3). The body always says when it takes effect and
  // that the admin can sign in again; self sign-out of this browser warns.
  let confirm = null;
  if (pending) {
    const { admin, session } = pending;
    const device = session?.device || t('adminPanel.session.unknownDevice', 'Unknown browser');
    const includesThisBrowser = admin.self && (session ? session.current : true);
    const body = session
      ? t(
          'adminPanel.confirm.one.body',
          'The session of {name} on {device} ends on their next click in the admin panel. They can sign in again with their password.',
          { name: admin.name, device }
        )
      : t(
          'adminPanel.confirm.all.body',
          'Every session of {name} ends on their next click in the admin panel. They can sign in again with their password. To stop them from signing in, deactivate the account in Settings › Users.',
          { name: admin.name }
        );
    confirm = {
      title: includesThisBrowser
        ? t('adminPanel.confirm.self.title', 'End your own session?')
        : session
          ? t('adminPanel.confirm.one.title', 'End this session of {name}?', {
              name: admin.name,
            })
          : t('adminPanel.confirm.all.title', 'End all sessions of {name}?', { name: admin.name }),
      body: (
        <Flex direction="column" alignItems="stretch" gap={3}>
          {/* A node body needs its own Dialog.Description (accessible description). */}
          <Dialog.Description>{body}</Dialog.Description>
          {includesThisBrowser ? (
            <Alert variant="warning">
              {t(
                'adminPanel.confirm.self.warning',
                'This includes the browser you are using now. You will be taken to the login page.'
              )}
            </Alert>
          ) : null}
        </Flex>
      ),
      label: session
        ? t('adminPanel.session.signOut', 'End session')
        : t('adminPanel.actions.signOutEverywhereShort', 'End all sessions'),
    };
  }

  const listProps = {
    admins,
    labelledBy: captionId,
    canRevoke: Boolean(canRevoke),
    onView: openDialog,
    onSignOutEverywhere: (admin, trigger) => askSignOut(admin, null, trigger),
    canPreview: Boolean(canPreviewAdmins) && impersonationEnabled,
    onPreview: (admin, trigger) => {
      openerRef.current = trigger;
      setPreviewTarget({ id: admin.id, name: admin.name });
    },
    canSignIn: Boolean(canSignInAsAdmin) && impersonationEnabled,
    signInUnavailable: unsupportedText(signInSupport, t),
    onSignIn: (admin, trigger) => {
      openerRef.current = trigger;
      setSignInTarget({ id: admin.id, name: admin.name });
    },
    busy: refreshing,
  };

  const policy = meta?.policy;
  const recording = meta?.recording;
  const range =
    pagination.total > 0
      ? {
          from: (pagination.page - 1) * pagination.pageSize + 1,
          to: Math.min(pagination.page * pagination.pageSize, pagination.total),
        }
      : null;

  return (
    <PageShell
      headingId="magic-sessionmanager-admin-panel-title"
      title={t('adminPanel.title', 'Admin panel sessions')}
      subtitle={t(
        'adminPanel.subtitle',
        'Who is signed in to this Strapi admin panel. Your app’s users are under App users.'
      )}
      primaryAction={
        // Same header pattern as the app-user view: tertiary links, as
        // labelled icon links below the DS small breakpoint (4.23.1).
        <Flex gap={2} wrap="wrap" justifyContent="flex-end">
          {isBelowSmall ? (
            <IconButton
              tag={Link}
              to={SETTINGS_PATH}
              label={t('homepage.links.settings', 'Settings')}
              variant="tertiary"
            >
              <Cog />
            </IconButton>
          ) : (
            <LinkButton
              tag={Link}
              to={SETTINGS_PATH}
              variant="tertiary"
              size="S"
              startIcon={<Cog />}
            >
              {t('homepage.links.settings', 'Settings')}
            </LinkButton>
          )}
          {isBelowSmall ? (
            <IconButton
              tag={Link}
              to={SETTINGS_USERS_PATH}
              label={t('adminPanel.manageUsers', 'Manage admins')}
              variant="tertiary"
            >
              <User />
            </IconButton>
          ) : (
            <LinkButton
              tag={Link}
              to={SETTINGS_USERS_PATH}
              variant="tertiary"
              size="S"
              startIcon={<User />}
            >
              {t('adminPanel.manageUsers', 'Manage admins')}
            </LinkButton>
          )}
        </Flex>
      }
    >
      <Flex
        ref={pageRef}
        tabIndex={-1}
        direction="column"
        alignItems="stretch"
        gap={6}
        minWidth={0}
      >
        <SessionViewNav current="admins" />

        {!loading && loadError ? (
          <Alert
            variant="danger"
            action={
              <Button size="S" variant="secondary" onClick={fetchAdmins}>
                {t('common.tryAgain', 'Try again')}
              </Button>
            }
          >
            <ReadableText variant="omega" textColor="neutral800" tag="span">
              {t('adminPanel.error.load', 'Admin sessions could not be loaded.')}
            </ReadableText>
          </Alert>
        ) : null}

        {loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t('adminPanel.loading', 'Loading admins')}</Loader>
          </Flex>
        ) : null}

        {!loading && meta && !supported ? (
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
            content={t(
              'adminPanel.unsupported',
              'Admin panel sessions are not available on this Strapi version. They need Strapi 5 with session management (tested with 5.62).'
            )}
          />
        ) : null}

        {showData ? (
          <Disclosure
            label={t('adminPanel.howItWorks.title', 'How ending sessions works')}
            storageKey={ADMIN_HOW_IT_WORKS_STORAGE_KEY}
            dataAttribute="admin-how-it-works"
          >
            <Flex direction="column" alignItems="stretch" gap={4}>
              <ReadableText variant="omega" textColor="neutral800" tag="p">
                {t(
                  'adminPanel.howItWorks.body',
                  'An ended session stops on the admin’s next click: Strapi checks the session on every admin request. They can sign in again with their password; to stop that, deactivate the account in Settings › Users. Admin API tokens are not affected.'
                )}
              </ReadableText>
              <ReadableText variant="omega" textColor="neutral800" tag="p">
                {recording?.ipAddresses
                  ? t(
                      'adminPanel.howItWorks.recorded',
                      'Session Manager records every sign-in with time, browser and IP address in the sign-in history.'
                    )
                  : recording?.signIns
                    ? t(
                        'adminPanel.howItWorks.recordedNoIp',
                        'Session Manager records every sign-in with time and browser in the sign-in history, without IP addresses.'
                      )
                    : t(
                        'adminPanel.howItWorks.notRecorded',
                        'Sign-in history is turned off, so no IP addresses of admins are recorded.'
                      )}
              </ReadableText>
              {policy ? (
                <Typography variant="pi" textColor="neutral600" tag="p">
                  {t(
                    'adminPanel.howItWorks.policy',
                    'Without activity a session ends after {idle}, or after {rememberIdle} when “Remember me” was ticked.',
                    {
                      idle: durationText(policy.idleSessionLifespan),
                      rememberIdle: durationText(policy.idleRefreshTokenLifespan),
                    }
                  )}
                </Typography>
              ) : null}
            </Flex>
          </Disclosure>
        ) : null}

        {showData ? (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <VisuallyHidden>
              <Typography tag="h2">{t('adminPanel.stats.label', 'Admin statistics')}</Typography>
            </VisuallyHidden>
            <StatGrid columns={3} label={t('adminPanel.stats.label', 'Admin statistics')}>
              <StatCard
                icon={Check}
                tone="success"
                label={t('adminPanel.stats.signedIn', 'Signed-in admins')}
                value={stats.signedInAdmins}
                description={t(
                  'adminPanel.stats.sessions',
                  '{count, plural, one {# session} other {# sessions}} in total',
                  { count: stats.activeSessions }
                )}
                {...statusCard('signed-in')}
              />
              <StatCard
                icon={Cross}
                tone="neutral"
                label={t('adminPanel.stats.notSignedIn', 'Not signed in')}
                value={Math.max(0, stats.totalAdmins - stats.signedInAdmins)}
                description={t(
                  'adminPanel.stats.notSignedIn.detail',
                  'Includes deactivated and invited accounts'
                )}
                {...statusCard('not-signed-in')}
              />
              <StatCard
                icon={User}
                tone="primary"
                label={t('adminPanel.stats.all', 'All admins')}
                value={stats.totalAdmins}
                description={t(
                  'adminPanel.stats.active',
                  '{count, plural, one {# active account} other {# active accounts}}',
                  { count: stats.activeAccounts }
                )}
                {...statusCard('all')}
              />
            </StatGrid>
          </Flex>
        ) : null}

        {showData ? (
          <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
            <VisuallyHidden>
              <Typography variant="delta" tag="h2">
                {t('adminPanel.list.heading', 'Admin list')}
              </Typography>
            </VisuallyHidden>
            <Flex
              direction={{ initial: 'column', medium: 'row' }}
              alignItems={{ initial: 'stretch', medium: 'center' }}
              gap={2}
              data-admin-toolbar=""
            >
              <Flex flex="1 1 auto" minWidth={0} direction="column" alignItems="stretch">
                <SessionSearch
                  value={view.search}
                  onSearch={handleSearch}
                  label={t('adminPanel.search.label', 'Search admins')}
                  placeholder={
                    meta?.identity?.names === false
                      ? t('adminPanel.search.placeholderId', 'Search by admin ID')
                      : t('adminPanel.search.placeholder', 'Search name or email')
                  }
                />
              </Flex>
              <Flex gap={2} alignItems="center" shrink={0}>
                <Flex
                  flex={isBelowMedium ? '1 1 auto' : undefined}
                  minWidth={0}
                  direction="column"
                  alignItems="stretch"
                >
                  <SingleSelect
                    size="S"
                    aria-label={t('adminPanel.filter.label', 'Sign-in status')}
                    value={view.filter}
                    onChange={handleFilterChange}
                  >
                    {ADMIN_FILTER_OPTIONS.map((option) => (
                      <SingleSelectOption key={option} value={option}>
                        {option === 'all' && t('adminPanel.filter.all', 'All admins')}
                        {option === 'signed-in' && t('adminPanel.filter.signedIn', 'Signed in')}
                        {option === 'not-signed-in' &&
                          t('adminPanel.filter.notSignedIn', 'Not signed in')}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Flex>
                <IconButton
                  label={t('adminPanel.actions.refresh', 'Refresh admins')}
                  onClick={() => fetchAdmins()}
                >
                  <ArrowClockwise />
                </IconButton>
              </Flex>
            </Flex>

            <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
              <Typography
                id={captionId}
                ref={captionRef}
                tabIndex={-1}
                variant="pi"
                textColor="neutral600"
                aria-live="polite"
                data-admin-caption=""
              >
                {range
                  ? t(
                      'adminPanel.caption',
                      '{from, number}–{to, number} of {total, plural, one {# admin} other {# admins}}',
                      { ...range, total: pagination.total }
                    )
                  : t('adminPanel.captionNone', '0 admins')}
              </Typography>
              {refreshing ? (
                <Loader small role="status" aria-live="polite">
                  {t('adminPanel.refreshing', 'Updating admins')}
                </Loader>
              ) : null}
            </Flex>

            {admins.length > 0 ? (
              <>
                {isBelowMedium ? <AdminCardList {...listProps} /> : <AdminTable {...listProps} />}
                <PaginationTargets>
                  <Pagination.Root
                    pageCount={pagination.pageCount}
                    total={pagination.total}
                    defaultPageSize={Number(ADMIN_DEFAULT_PAGE_SIZE)}
                  >
                    <Pagination.PageSize options={[...ADMIN_PAGE_SIZE_OPTIONS]} />
                    <Pagination.Links />
                  </Pagination.Root>
                </PaginationTargets>
              </>
            ) : (
              <EmptyStateLayout
                icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
                content={
                  filtersActive
                    ? t('adminPanel.noResults', 'No admins match your search or filter.')
                    : t('adminPanel.empty', 'No admin accounts yet.')
                }
                action={
                  filtersActive ? (
                    <Button variant="secondary" onClick={handleClearFilters}>
                      {t('adminPanel.noResults.reset', 'Clear filters')}
                    </Button>
                  ) : null
                }
              />
            )}
          </Flex>
        ) : null}

        {showData && impersonationEnabled && (canSignInAsAdmin || canPreviewAdmins) ? (
          <ActiveImpersonationsCard hideWhenEmpty />
        ) : null}

        {showData && canViewActivity ? (
          <RecentSignInActivity
            onOpenAdmin={(admin, trigger) => openDialog(admin, trigger, 'history')}
          />
        ) : null}

        {selected ? (
          <AdminSessionsModal
            key={`${selected.id}-${dialogTab}`}
            canViewActivity={Boolean(canViewActivity)}
            initialTab={dialogTab}
            admin={selected}
            sessions={dialogSessions}
            loading={dialogLoading && dialogSessions.length === 0}
            error={dialogError}
            onRetry={() => fetchDialogSessions(selected)}
            canRevoke={Boolean(canRevoke)}
            onSignOut={(session, trigger) => askSignOut(selected, session, trigger)}
            onSignOutEverywhere={(trigger) => askSignOut(selected, null, trigger)}
            onClose={closeDialog}
            onCloseAutoFocus={(event) =>
              restoreDialogFocus(event, openerRef.current, captionRef.current || pageRef.current)
            }
          />
        ) : null}

        {previewTarget ? (
          <PreviewAdminModal
            admin={previewTarget}
            onClose={() => setPreviewTarget(null)}
            onCloseAutoFocus={(event) =>
              restoreDialogFocus(event, openerRef.current, captionRef.current || pageRef.current)
            }
          />
        ) : null}

        {signInTarget ? (
          <SignInAsAdminModal
            admin={signInTarget}
            support={signInSupport}
            onClose={() => setSignInTarget(null)}
            onCloseAutoFocus={(event) =>
              restoreDialogFocus(event, openerRef.current, captionRef.current || pageRef.current)
            }
          />
        ) : null}

        {confirm ? (
          <ConfirmAction
            isOpen
            onOpenChange={(open) => {
              if (!open) setPending(null);
            }}
            title={confirm.title}
            body={confirm.body}
            confirmLabel={confirm.label}
            onConfirm={confirmSignOut}
            returnFocusRef={confirmReturnRef}
            fallbackFocusRef={captionRef}
          />
        ) : null}
      </Flex>
    </PageShell>
  );
};

export default AdminPanelPage;
