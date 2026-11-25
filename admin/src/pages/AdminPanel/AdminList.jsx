import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Eye, SignOut } from '@strapi/icons';
import { getTranslation } from '../../utils/getTranslation';

/**
 * "You" and "This browser" badges. The DS primary variant measured 2.43:1 in
 * the dark theme, so the primary surface keeps neutral800 text (high contrast
 * in both themes, like the Idle badge).
 */
export const HIGHLIGHT_BADGE = { backgroundColor: 'primary100', textColor: 'neutral800' };
import { getBadgeColors } from '../../components/ui/StatusBadge';
import RowActions from '../../components/ui/RowActions';
import { LastActive } from '../Dashboard/SessionTable';
import { getAdminStatusPresentation } from './adminPanelModel.mjs';
import { shouldIsolateActionKey } from '../Dashboard/dashboardModel.mjs';

/**
 * Keeps Enter and Space on a row button: the Design System grid table
 * otherwise handles them for cell navigation and the button never fires
 * (the same fix as the App users table, SessionActions).
 *
 * @param {import('react').KeyboardEvent<HTMLElement>} event Keydown inside the row actions.
 * @returns {void}
 */
const keepActionKeys = (event) => {
  if (shouldIsolateActionKey(event.key, true)) event.stopPropagation();
};

/** Cells that share the remaining width and cut long values instead of scrolling. */
const SHRINKING_ADMIN_CELL = { maxWidth: 0, width: '34%' };
const SHRINKING_ROLES_CELL = { maxWidth: 0, width: '22%' };

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
 * Name, "You" badge and e-mail of an admin. Long values are cut with an
 * ellipsis; the full value is in the title attribute and in the sessions
 * dialog.
 *
 * @param {{admin: object}} props Admin row.
 * @returns {import('react').ReactElement} Identity block.
 */
export const AdminIdentity = ({ admin }) => {
  const t = useT();
  return (
    <Flex direction="column" alignItems="stretch" gap={1} minWidth={0}>
      <Flex gap={2} alignItems="center" minWidth={0}>
        <Typography
          variant="omega"
          fontWeight="semiBold"
          textColor="neutral800"
          ellipsis
          title={admin.name}
        >
          {admin.name}
        </Typography>
        {admin.self ? (
          <Badge {...HIGHLIGHT_BADGE} shrink={0}>
            {t('adminPanel.you', 'You')}
          </Badge>
        ) : null}
      </Flex>
      {admin.identityHidden ? (
        <Typography variant="pi" textColor="neutral600">
          {t('adminPanel.identity.emailHidden', 'Email hidden (needs “Read” on Users)')}
        </Typography>
      ) : (
        <Typography variant="pi" textColor="neutral600" ellipsis title={admin.email}>
          {admin.email}
        </Typography>
      )}
    </Flex>
  );
};

/**
 * Role names, comma separated. "Super Admin" is the role name Strapi stores.
 *
 * @param {{admin: object}} props Admin row.
 * @returns {import('react').ReactElement} Roles line.
 */
export const AdminRoles = ({ admin }) => {
  const t = useT();
  const names = (admin.roles || []).map((role) => role.name).filter(Boolean);
  const text = admin.rolesHidden
    ? t('adminPanel.roles.hidden', 'Hidden (needs “Read” on Roles)')
    : names.length
      ? names.join(', ')
      : t('adminPanel.roles.none', 'No role');
  return (
    <Typography variant="omega" textColor="neutral800" ellipsis title={text}>
      {text}
    </Typography>
  );
};

/**
 * State badge plus a neutral second line ("2 sessions", "No open session").
 *
 * @param {{admin: object}} props Admin row.
 * @returns {import('react').ReactElement} Status block.
 */
export const AdminStatus = ({ admin }) => {
  const t = useT();
  const status = getAdminStatusPresentation(admin);
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} data-admin-status={status.key}>
      <Badge {...getBadgeColors(status.tone)}>
        {t(status.label.messageId, status.label.defaultMessage)}
      </Badge>
      <Typography variant="pi" textColor="neutral600">
        {t(status.detail.messageId, status.detail.defaultMessage, status.detail.values)}
      </Typography>
    </Flex>
  );
};

/**
 * Admins as a table (from the DS medium breakpoint). Row actions are icon
 * buttons with contextual names; "Sign out everywhere" appears only when the
 * server says it is allowed and the admin has a session.
 *
 * @param {object} props
 * @param {object[]} props.admins Admin rows of the page.
 * @param {string} props.labelledBy Id of the caption.
 * @param {boolean} props.canRevoke Caller may sign admins out.
 * @param {(admin: object, trigger: HTMLElement|null) => void} props.onView Opens the sessions dialog.
 * @param {(admin: object, trigger: HTMLElement|null) => void} props.onSignOutEverywhere Asks to sign out everywhere.
 * @param {boolean} [props.busy] A refresh is running.
 * @returns {import('react').ReactElement} Table.
 */
export const AdminTable = ({
  admins,
  labelledBy,
  canRevoke,
  onView,
  onSignOutEverywhere,
  busy,
}) => {
  const t = useT();
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" data-admin-table="">
      <Table
        colCount={5}
        rowCount={admins.length + 1}
        aria-labelledby={labelledBy}
        aria-busy={busy}
      >
        <Thead>
          <Tr>
            <Th style={SHRINKING_ADMIN_CELL}>
              <Typography variant="sigma" textColor="neutral600">
                {t('adminPanel.table.admin', 'Admin')}
              </Typography>
            </Th>
            <Th style={SHRINKING_ROLES_CELL}>
              <Typography variant="sigma" textColor="neutral600">
                {t('adminPanel.table.roles', 'Roles')}
              </Typography>
            </Th>
            <Th>
              <Typography variant="sigma" textColor="neutral600">
                {t('adminPanel.table.status', 'Status')}
              </Typography>
            </Th>
            <Th>
              <Typography variant="sigma" textColor="neutral600">
                {t('adminPanel.table.lastActive', 'Last active')}
              </Typography>
            </Th>
            <Th>
              <VisuallyHidden>{t('adminPanel.table.actions', 'Actions')}</VisuallyHidden>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {admins.map((admin) => (
            <Tr key={admin.id} data-admin-row={admin.id}>
              <Td style={SHRINKING_ADMIN_CELL}>
                <AdminIdentity admin={admin} />
              </Td>
              <Td style={SHRINKING_ROLES_CELL}>
                <AdminRoles admin={admin} />
              </Td>
              <Td>
                <AdminStatus admin={admin} />
              </Td>
              <Td>
                <LastActive value={admin.lastActiveAt} />
              </Td>
              <Td>
                <RowActions onKeyDown={keepActionKeys}>
                  <IconButton
                    label={t('adminPanel.actions.view', 'View sessions of {name}', {
                      name: admin.name,
                    })}
                    onClick={(event) => onView(admin, event.currentTarget)}
                  >
                    <Eye />
                  </IconButton>
                  {canRevoke && admin.canSignOut ? (
                    <IconButton
                      variant="danger-light"
                      label={t(
                        'adminPanel.actions.signOutEverywhere',
                        'Sign out {name} everywhere',
                        {
                          name: admin.name,
                        }
                      )}
                      onClick={(event) => onSignOutEverywhere(admin, event.currentTarget)}
                    >
                      <SignOut />
                    </IconButton>
                  ) : null}
                </RowActions>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
};

/**
 * Admins as cards (below the DS medium breakpoint): the same fields as the
 * table, with text buttons that fill the card width.
 *
 * @param {object} props Same as AdminTable.
 * @param {object[]} props.admins Admin rows.
 * @param {string} props.labelledBy Id of the caption.
 * @param {boolean} props.canRevoke Caller may sign admins out.
 * @param {(admin: object, trigger: HTMLElement|null) => void} props.onView Opens the sessions dialog.
 * @param {(admin: object, trigger: HTMLElement|null) => void} props.onSignOutEverywhere Asks to sign out everywhere.
 * @returns {import('react').ReactElement} Card list.
 */
export const AdminCardList = ({ admins, labelledBy, canRevoke, onView, onSignOutEverywhere }) => {
  const t = useT();
  return (
    <Flex
      tag="ul"
      direction="column"
      alignItems="stretch"
      gap={3}
      aria-labelledby={labelledBy}
      data-admin-cards=""
    >
      {admins.map((admin) => (
        <Box
          tag="li"
          key={admin.id}
          background="neutral0"
          hasRadius
          shadow="tableShadow"
          padding={4}
          data-admin-row={admin.id}
        >
          <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
            <AdminIdentity admin={admin} />
            <Flex gap={4} wrap="wrap" alignItems="flex-start" justifyContent="space-between">
              <AdminStatus admin={admin} />
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography variant="sigma" textColor="neutral600">
                  {t('adminPanel.table.lastActive', 'Last active')}
                </Typography>
                <LastActive value={admin.lastActiveAt} />
              </Flex>
            </Flex>
            <AdminRoles admin={admin} />
            <Flex gap={2} wrap="wrap">
              <Button
                variant="secondary"
                startIcon={<Eye />}
                onClick={(event) => onView(admin, event.currentTarget)}
                aria-label={t('adminPanel.actions.view', 'View sessions of {name}', {
                  name: admin.name,
                })}
                flex="1 1 auto"
              >
                {t('adminPanel.actions.viewShort', 'View sessions')}
              </Button>
              {canRevoke && admin.canSignOut ? (
                <Button
                  variant="danger-light"
                  startIcon={<SignOut />}
                  onClick={(event) => onSignOutEverywhere(admin, event.currentTarget)}
                  aria-label={t(
                    'adminPanel.actions.signOutEverywhere',
                    'Sign out {name} everywhere',
                    {
                      name: admin.name,
                    }
                  )}
                  flex="1 1 auto"
                >
                  {t('adminPanel.actions.signOutEverywhereShort', 'Sign out everywhere')}
                </Button>
              ) : null}
            </Flex>
          </Flex>
        </Box>
      ))}
    </Flex>
  );
};
