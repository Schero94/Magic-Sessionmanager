import { useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Flex,
  LinkButton,
  Loader,
  Modal,
  Tabs,
  Typography,
} from '@strapi/design-system';
import { SignOut } from '@strapi/icons';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { PropertyList } from '../../components/ui';
import Alert from '../../components/PersistentAlert';
import { LastActive } from '../Dashboard/SessionTable';
import { AdminRoles, AdminStatus, HIGHLIGHT_BADGE } from './AdminList';
import { ContentActivityPanel, SignInHistoryPanel } from './AdminEventPanels';

/**
 * The dialog tabs stay on one row and scroll inside their own list, never the
 * dialog body: at 320 px "Sitzungen / Anmeldeverlauf / Aktivität" is wider
 * than the dialog. Same pattern and sentence-case labels as the Settings tabs.
 */
const DialogTabsList = styled(Tabs.List)`
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
`;

/** Tabs keep their text width and never wrap; the list scrolls instead. */
const DialogTabTrigger = styled(Tabs.Trigger)`
  && {
    flex: 0 0 auto;
    white-space: nowrap;
  }
`;

/** Own label element: resets the DS sigma uppercase without selecting into DS markup. */
const DialogTabLabel = styled.span`
  text-transform: none;
  letter-spacing: normal;
  font-size: ${({ theme }) => theme.fontSizes[2]};
`;

/** Tabs of the admin details when the caller may see admin activity. */
export const ADMIN_DIALOG_TABS = Object.freeze(['sessions', 'history', 'activity']);

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
 * Absolute date in the admin locale, as a machine-readable time element.
 *
 * @param {{value: string|null}} props ISO date.
 * @returns {import('react').ReactElement|null} Date, or null when missing.
 */
const DateValue = ({ value }) => {
  const { formatDate } = useSessionFormatters();
  if (!value) return null;
  return (
    <Typography tag="time" dateTime={value} variant="omega" textColor="neutral800">
      {formatDate(value)}
    </Typography>
  );
};

/**
 * One signed-in browser: device label (Strapi's own "Chrome on macOS"),
 * "This browser" and "Remember me" badges, sign-in, last activity and the
 * latest end, plus "Sign out".
 *
 * @param {object} props
 * @param {object} props.session Session row from the API.
 * @param {object} props.admin Admin of the dialog.
 * @param {boolean} props.canSignOut Button is shown.
 * @param {(session: object, trigger: HTMLElement|null) => void} props.onSignOut Asks for confirmation.
 * @returns {import('react').ReactElement} Session card.
 */
const SessionCard = ({ session, admin, canSignOut, onSignOut }) => {
  const t = useT();
  const device = session.device || t('adminPanel.session.unknownDevice', 'Unknown browser');
  return (
    <Box
      tag="li"
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      padding={4}
      data-admin-session=""
    >
      <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
        <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
          <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
            <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
              {device}
            </Typography>
            {session.current ? (
              <Badge {...HIGHLIGHT_BADGE}>{t('adminPanel.session.current', 'This browser')}</Badge>
            ) : null}
            {session.rememberMe ? (
              <Badge>{t('adminPanel.session.rememberMe', 'Remember me')}</Badge>
            ) : null}
          </Flex>
          {canSignOut ? (
            <Button
              size="S"
              variant="danger-light"
              startIcon={<SignOut />}
              onClick={(event) => onSignOut(session, event.currentTarget)}
              aria-label={t('adminPanel.session.signOutLabel', 'Sign {name} out of {device}', {
                name: admin.name,
                device,
              })}
            >
              {t('adminPanel.session.signOut', 'Sign out')}
            </Button>
          ) : null}
        </Flex>
        <PropertyList
          columns={2}
          items={[
            {
              id: 'signedIn',
              label: t('adminPanel.session.signedInAt', 'Signed in'),
              value: session.signedInAt,
              render: session.signedInAt ? <DateValue value={session.signedInAt} /> : undefined,
            },
            {
              id: 'lastActive',
              label: t('adminPanel.session.lastActiveAt', 'Last active'),
              value: session.lastActiveAt,
              render: session.lastActiveAt ? (
                <LastActive value={session.lastActiveAt} />
              ) : undefined,
            },
            {
              id: 'endsAt',
              label: t('adminPanel.session.endsAt', 'Ends at the latest'),
              value: session.endsAt,
              render: session.endsAt ? <DateValue value={session.endsAt} /> : undefined,
              fullWidth: true,
            },
          ]}
        />
      </Flex>
    </Box>
  );
};

/**
 * Sessions of one admin. The body explains states that have no action
 * (not signed in, deactivated, invited, Super Admin protected) instead of
 * showing disabled buttons. "Manage in Settings > Users" opens Strapi's own
 * user page, where an account can be deactivated.
 *
 * @param {object} props
 * @param {object} props.admin Admin row (the list row, refreshed from the dialog request).
 * @param {object[]} props.sessions Live sessions, newest first.
 * @param {boolean} props.loading First load of the sessions.
 * @param {boolean} props.error Loading failed.
 * @param {() => void} props.onRetry Loads again.
 * @param {boolean} props.canRevoke Caller may sign admins out.
 * @param {(session: object, trigger: HTMLElement|null) => void} props.onSignOut Asks to sign out one browser.
 * @param {(trigger: HTMLElement|null) => void} props.onSignOutEverywhere Asks to sign out everywhere.
 * @param {() => void} props.onClose Closes the dialog.
 * @param {(event: Event) => void} [props.onCloseAutoFocus] Focus handling after close.
 * @param {boolean} [props.canViewActivity] Caller holds "View admin activity": the dialog
 *   gets the tabs Sessions, Sign-in history and Activity.
 * @param {string} [props.initialTab] Tab to open first (one of ADMIN_DIALOG_TABS).
 * @returns {import('react').ReactElement} Modal.
 */
const AdminSessionsModal = ({
  admin,
  sessions,
  loading,
  error,
  onRetry,
  canRevoke,
  onSignOut,
  onSignOutEverywhere,
  onClose,
  onCloseAutoFocus,
  canViewActivity = false,
  initialTab = 'sessions',
}) => {
  const t = useT();
  const [tab, setTab] = useState(ADMIN_DIALOG_TABS.includes(initialTab) ? initialTab : 'sessions');
  const canSignOut = canRevoke && admin.account === 'active' && !admin.protectedReason;
  const settingsPath = `/settings/users/${admin.id}`;

  let notice = null;
  if (admin.account !== 'active') {
    notice = (
      <Alert variant="neutral" title={t('adminPanel.dialog.inactive.title', 'No usable session')}>
        {t(
          'adminPanel.dialog.inactive.body',
          'Strapi rejects every request of a deactivated or invited account, so there is nothing to sign out.'
        )}
      </Alert>
    );
  } else if (admin.protectedReason === 'super-admin-protected' && canRevoke) {
    notice = (
      <Alert variant="neutral" title={t('adminPanel.dialog.protected.title', 'Super Admin')}>
        {t(
          'adminPanel.dialog.protected.body',
          'Only a Super Admin can sign out a Super Admin. This keeps at least one Super Admin able to work at all times.'
        )}
      </Alert>
    );
  }

  const sessionsContent = (
    <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
      <PropertyList
        columns={2}
        items={[
          {
            id: 'email',
            label: t('adminPanel.dialog.email', 'Email'),
            value: admin.email,
            kind: 'email',
          },
          {
            id: 'roles',
            label: t('adminPanel.table.roles', 'Roles'),
            render: <AdminRoles admin={admin} />,
          },
          {
            id: 'status',
            label: t('adminPanel.table.status', 'Status'),
            render: <AdminStatus admin={{ ...admin, sessionCount: sessions.length }} />,
            fullWidth: true,
          },
        ]}
      />
      {notice}
      {loading ? (
        <Flex justifyContent="center" padding={4}>
          <Loader small>{t('adminPanel.dialog.loading', 'Loading sessions')}</Loader>
        </Flex>
      ) : null}
      {!loading && error ? (
        <Alert
          variant="danger"
          action={
            <Button size="S" variant="secondary" onClick={onRetry}>
              {t('common.tryAgain', 'Try again')}
            </Button>
          }
        >
          {t('adminPanel.dialog.error', 'The sessions could not be loaded.')}
        </Alert>
      ) : null}
      {!loading && !error && admin.account === 'active' && sessions.length === 0 ? (
        <Typography variant="omega" textColor="neutral600" data-admin-sessions-empty="">
          {t(
            'adminPanel.dialog.empty',
            '{name} is not signed in. Sessions appear here after the next sign-in.',
            { name: admin.name }
          )}
        </Typography>
      ) : null}
      {!loading && sessions.length > 0 ? (
        <Flex
          tag="ul"
          direction="column"
          alignItems="stretch"
          gap={3}
          aria-label={t('adminPanel.dialog.listLabel', 'Signed-in browsers')}
        >
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              admin={admin}
              canSignOut={canSignOut}
              onSignOut={onSignOut}
            />
          ))}
        </Flex>
      ) : null}
    </Flex>
  );

  return (
    <Modal.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Modal.Title>
            {canViewActivity
              ? admin.name
              : t('adminPanel.dialog.title', 'Sessions of {name}', { name: admin.name })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {canViewActivity ? (
            <Tabs.Root variant="simple" value={tab} onValueChange={setTab}>
              <DialogTabsList aria-label={t('adminPanel.dialog.tabs', 'Admin details')}>
                <DialogTabTrigger value="sessions">
                  <DialogTabLabel>{t('adminPanel.dialog.tab.sessions', 'Sessions')}</DialogTabLabel>
                </DialogTabTrigger>
                <DialogTabTrigger value="history">
                  <DialogTabLabel>
                    {t('adminPanel.dialog.tab.history', 'Sign-in history')}
                  </DialogTabLabel>
                </DialogTabTrigger>
                <DialogTabTrigger value="activity">
                  <DialogTabLabel>{t('adminPanel.dialog.tab.activity', 'Activity')}</DialogTabLabel>
                </DialogTabTrigger>
              </DialogTabsList>
              <Tabs.Content value="sessions">
                <Box paddingTop={4}>{sessionsContent}</Box>
              </Tabs.Content>
              <Tabs.Content value="history">
                <Box paddingTop={4}>
                  <SignInHistoryPanel admin={admin} />
                </Box>
              </Tabs.Content>
              <Tabs.Content value="activity">
                <Box paddingTop={4}>
                  <ContentActivityPanel admin={admin} />
                </Box>
              </Tabs.Content>
            </Tabs.Root>
          ) : (
            sessionsContent
          )}
        </Modal.Body>
        <Modal.Footer>
          <Flex gap={2} wrap="wrap" justifyContent="space-between" width="100%">
            <Modal.Close>
              <Button variant="tertiary">{t('common.close', 'Close')}</Button>
            </Modal.Close>
            <Flex gap={2} wrap="wrap" justifyContent="flex-end">
              <LinkButton tag={Link} to={settingsPath} variant="secondary">
                {t('adminPanel.dialog.manage', 'Manage in Settings')}
              </LinkButton>
              {canSignOut && sessions.length > 0 ? (
                <Button
                  variant="danger"
                  startIcon={<SignOut />}
                  onClick={(event) => onSignOutEverywhere(event.currentTarget)}
                >
                  {t('adminPanel.actions.signOutEverywhereShort', 'Sign out everywhere')}
                </Button>
              ) : null}
            </Flex>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default AdminSessionsModal;
