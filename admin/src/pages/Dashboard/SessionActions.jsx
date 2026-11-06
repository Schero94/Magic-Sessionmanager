import { useIntl } from 'react-intl';
import { Button, Grid, IconButton, IconButtonGroup } from '@strapi/design-system';
import { Eye, SignOut, Trash } from '@strapi/icons';
import { getTranslation } from '../../utils/getTranslation';
import { ConfirmAction } from '../../components/ui';
import { getSessionUserLabels, shouldIsolateActionKey } from './dashboardModel.mjs';

/**
 * Stops keys that the Design System grid cell would swallow (Enter/Space on
 * the row buttons) and every key coming from the confirmation dialog portal.
 *
 * @param {import('react').KeyboardEvent<HTMLElement>} event Keydown inside the action group.
 * @returns {void}
 */
const isolateActionKeys = (event) => {
  const fromInsideGroup = event.currentTarget.contains(/** @type {Node} */ (event.target));
  if (shouldIsolateActionKey(event.key, fromInsideGroup)) event.stopPropagation();
};

/**
 * Row actions shared by the desktop table and the card list: View details,
 * Log out session and Remove session details. Every label names the session's
 * user so screen-reader button lists stay distinguishable (DUX-06, DUX-07,
 * DASH-09). Both destructive actions confirm through ConfirmAction.
 *
 * @param {object} props
 * @param {object} props.session Session row.
 * @param {'table'|'card'} props.layout Icon group (table) or equal-width buttons (cards).
 * @param {(session: object, opener: HTMLElement) => void} props.onView Opens the detail modal.
 * @param {(sessionId: string) => Promise<void>} props.onLogOut Logs the session out; throws on failure.
 * @param {(sessionId: string) => Promise<void>} props.onRemove Removes the session details; throws on failure.
 * @param {boolean} props.mutationPending Another mutation is running; destructive triggers are disabled.
 * @param {{current: HTMLElement|null}} props.focusFallback Focus target when a trigger disappears after a refresh.
 * @returns {import('react').ReactElement} Action controls.
 */
const SessionActions = ({ session, layout, onView, onLogOut, onRemove, mutationPending, focusFallback }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const user = getSessionUserLabels(session).accessible;
  const canLogOut = session.isActive === true;

  const viewLabel = t('homepage.actions.viewFor', 'View details for {user}', { user });
  const logOutLabel = t('homepage.actions.logOutFor', 'Log out the session of {user}', { user });
  const endedLabel = t('homepage.actions.alreadyEndedFor', 'The session of {user} has already ended', { user });
  const removeLabel = t('homepage.actions.removeFor', 'Remove the session details of {user}', { user });

  const logOutConfirm = {
    title: t('modal.actions.terminate', 'Log out session'),
    body: t('modal.confirm.terminate', 'Log out this device session? Other sessions will stay active.'),
    confirmLabel: t('modal.actions.terminate', 'Log out session'),
    onConfirm: () => onLogOut(session.id),
  };
  const removeConfirm = {
    title: t('homepage.confirm.deleteTitle', 'Remove session details'),
    body: t(
      'homepage.confirm.delete',
      "Remove this session's details? Any unexpired access token remains blocked until it expires."
    ),
    confirmLabel: t('homepage.actions.remove', 'Remove'),
    onConfirm: () => onRemove(session.id),
  };

  // The key changes when the session ends, so the old trigger unmounts and
  // ConfirmAction moves focus to `focusFallback` instead of a now-disabled button.
  const logOutKey = `logout-${session.id}-${canLogOut ? 'active' : 'ended'}`;

  if (layout === 'table') {
    return (
      <IconButtonGroup onKeyDown={isolateActionKeys} onClick={(event) => event.stopPropagation()}>
        <IconButton
          label={viewLabel}
          data-session-view={session.id}
          onClick={(event) => onView(session, event.currentTarget)}
        >
          <Eye />
        </IconButton>
        <ConfirmAction
          key={logOutKey}
          {...logOutConfirm}
          disabled={!canLogOut || mutationPending}
          fallbackFocusRef={focusFallback}
          trigger={(
            <IconButton
              label={canLogOut ? logOutLabel : endedLabel}
              variant="danger-light"
              disabled={!canLogOut || mutationPending}
            >
              <SignOut />
            </IconButton>
          )}
        />
        <ConfirmAction
          {...removeConfirm}
          disabled={mutationPending}
          fallbackFocusRef={focusFallback}
          trigger={(
            <IconButton label={removeLabel} variant="danger-light" disabled={mutationPending}>
              <Trash />
            </IconButton>
          )}
        />
      </IconButtonGroup>
    );
  }

  return (
    <Grid.Root gap={2}>
      <Grid.Item col={4} m={4} s={4} xs={12} direction="column" alignItems="stretch">
        <Button
          fullWidth
          variant="secondary"
          startIcon={<Eye />}
          aria-label={viewLabel}
          data-session-view={session.id}
          onClick={(event) => onView(session, event.currentTarget)}
        >
          {t('homepage.actions.view', 'View details')}
        </Button>
      </Grid.Item>
      <Grid.Item col={4} m={4} s={4} xs={12} direction="column" alignItems="stretch">
        <ConfirmAction
          key={logOutKey}
          {...logOutConfirm}
          disabled={!canLogOut || mutationPending}
          fallbackFocusRef={focusFallback}
          trigger={(
            <Button
              fullWidth
              variant="danger-light"
              startIcon={<SignOut />}
              aria-label={logOutLabel}
              disabled={!canLogOut || mutationPending}
            >
              {t('homepage.actions.logOut', 'Log out')}
            </Button>
          )}
        />
      </Grid.Item>
      <Grid.Item col={4} m={4} s={4} xs={12} direction="column" alignItems="stretch">
        <ConfirmAction
          {...removeConfirm}
          disabled={mutationPending}
          fallbackFocusRef={focusFallback}
          trigger={(
            <Button
              fullWidth
              variant="danger-light"
              startIcon={<Trash />}
              aria-label={removeLabel}
              disabled={mutationPending}
            >
              {t('homepage.actions.remove', 'Remove')}
            </Button>
          )}
        />
      </Grid.Item>
    </Grid.Root>
  );
};

export default SessionActions;
