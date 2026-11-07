import { useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Button,
  Grid,
  IconButton,
  IconButtonGroup,
  MenuItem,
  SimpleMenu,
} from '@strapi/design-system';
import { Cross, Eye, More, Trash } from '@strapi/icons';
import { getTranslation } from '../../utils/getTranslation';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { ConfirmAction } from '../../components/ui';
import {
  getSessionUserLabels,
  shouldIsolateActionKey,
  shouldRedispatchEscape,
} from './dashboardModel.mjs';

/**
 * Stops keys that the Design System grid cell would swallow (Enter/Space on
 * the row buttons) and every key coming from the confirmation dialog or menu
 * portal; Escape from a portal is re-dispatched on the document.
 *
 * @param {import('react').KeyboardEvent<HTMLElement>} event Keydown inside the action group.
 * @returns {void}
 */
const isolateActionKeys = (event) => {
  const fromInsideGroup = event.currentTarget.contains(/** @type {Node} */ (event.target));
  if (!shouldIsolateActionKey(event.key, fromInsideGroup)) return;
  event.stopPropagation();
  if (shouldRedispatchEscape(event.key, fromInsideGroup)) {
    // Hand Escape back to Radix's document listener so the open confirmation
    // or More menu closes (see shouldRedispatchEscape).
    const { ownerDocument } = event.currentTarget;
    ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  }
};

/**
 * Builds the end-session and delete-record confirmations (IA E.1). Delete
 * record has two variants: an ended row only loses its record; an open row is
 * also signed out, so its title and button say so.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {{user: string, device: string, isOpen: boolean}} context Row facts.
 * @returns {{end: {title: string, body: string, confirmLabel: string}, remove: {title: string, body: string, confirmLabel: string}}} Copy.
 */
export const getConfirmationCopy = (t, { user, device, isOpen }) => ({
  end: {
    title: t('homepage.confirm.end.title', 'End this session?'),
    body: t(
      'homepage.confirm.end.body',
      '{user} will be signed out on {device}. Their other sessions stay open. The record stays in the history. This cannot be undone.',
      { user, device }
    ),
    confirmLabel: t('homepage.actions.end', 'End session'),
  },
  remove: isOpen
    ? {
        title: t('homepage.confirm.deleteOpen.title', 'Delete record and end session?'),
        body: t(
          'homepage.confirm.deleteOpen.body',
          'This session is still open. {user} will be signed out on {device}, and the record is removed from history, statistics and exports. This cannot be undone.',
          { user, device }
        ),
        confirmLabel: t('homepage.actions.deleteAndEnd', 'Delete and end'),
      }
    : {
        title: t('homepage.confirm.deleteEnded.title', 'Delete this session record?'),
        body: t(
          'homepage.confirm.deleteEnded.body',
          'The record is removed permanently from history, statistics and exports. This cannot be undone.'
        ),
        confirmLabel: t('homepage.actions.deleteRecord', 'Delete record'),
      },
});

/**
 * Row actions shared by the desktop table and the card list (IA D1.7):
 * View details, End session (disabled on ended rows) and More actions with
 * Delete record. Every label names the session's user so screen-reader
 * button lists stay distinguishable (DUX-06, DUX-07, DASH-09). Both
 * destructive actions confirm through ConfirmAction.
 *
 * @param {object} props
 * @param {object} props.session Session row.
 * @param {'table'|'card'} props.layout Icon group (table) or equal-width buttons (cards).
 * @param {(session: object, opener: HTMLElement) => void} props.onView Opens the detail dialog.
 * @param {(session: object) => Promise<void>} props.onEnd Ends the session; throws on failure.
 * @param {(session: object) => Promise<void>} props.onDelete Deletes the record; throws on failure.
 * @param {boolean} props.mutationPending Another mutation is running; destructive triggers are disabled.
 * @param {{current: HTMLElement|null}} props.focusFallback Focus target when a trigger disappears after a refresh.
 * @returns {import('react').ReactElement} Action controls.
 */
const SessionActions = ({
  session,
  layout,
  onView,
  onEnd,
  onDelete,
  mutationPending,
  focusFallback,
}) => {
  const { formatMessage } = useIntl();
  const { deviceSummary, deviceTypeLabel } = useSessionFormatters();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const moreRef = useRef(null);
  const user = getSessionUserLabels(session).accessible;
  const canEnd = session.isActive === true;
  const device = deviceSummary(session) || deviceTypeLabel(session);
  const copy = getConfirmationCopy(t, { user, device, isOpen: canEnd });

  const viewLabel = t('homepage.actions.viewFor', 'View details for {user}', { user });
  const endLabel = t('homepage.actions.endFor', 'End session of {user}', { user });
  const endedLabel = t(
    'homepage.actions.alreadyEndedFor',
    'The session of {user} has already ended',
    { user }
  );
  const moreLabel = t('homepage.actions.moreFor', 'More actions for {user}', { user });
  const deleteLabel = t('homepage.actions.deleteRecord', 'Delete record');

  const endConfirm = { ...copy.end, onConfirm: () => onEnd(session) };
  const deleteConfirm = (
    <ConfirmAction
      {...copy.remove}
      onConfirm={() => onDelete(session)}
      isOpen={deleteOpen}
      onOpenChange={setDeleteOpen}
      returnFocusRef={moreRef}
      fallbackFocusRef={focusFallback}
    />
  );

  // The key changes when the session ends, so the old trigger unmounts and
  // ConfirmAction moves focus to `focusFallback` instead of a now-disabled button.
  const endKey = `end-${session.id}-${canEnd ? 'open' : 'ended'}`;

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
          key={endKey}
          {...endConfirm}
          disabled={!canEnd || mutationPending}
          fallbackFocusRef={focusFallback}
          trigger={
            <IconButton
              label={canEnd ? endLabel : endedLabel}
              variant="danger-light"
              disabled={!canEnd || mutationPending}
            >
              <Cross />
            </IconButton>
          }
        />
        <SimpleMenu
          ref={moreRef}
          tag={IconButton}
          icon={<More />}
          label={moreLabel}
          disabled={mutationPending}
        >
          <MenuItem startIcon={<Trash />} variant="danger" onSelect={() => setDeleteOpen(true)}>
            {deleteLabel}
          </MenuItem>
        </SimpleMenu>
        {deleteConfirm}
      </IconButtonGroup>
    );
  }

  // Equal-width buttons: three on open rows, two on ended rows.
  const span = canEnd ? 4 : 6;

  return (
    <Grid.Root gap={2}>
      <Grid.Item col={span} m={span} s={span} xs={12} direction="column" alignItems="stretch">
        <Button
          fullWidth
          variant="secondary"
          startIcon={<Eye />}
          aria-label={viewLabel}
          data-session-view={session.id}
          onClick={(event) => onView(session, event.currentTarget)}
        >
          {t('homepage.actions.details', 'Details')}
        </Button>
      </Grid.Item>
      {canEnd ? (
        <Grid.Item col={span} m={span} s={span} xs={12} direction="column" alignItems="stretch">
          <ConfirmAction
            key={endKey}
            {...endConfirm}
            disabled={!canEnd || mutationPending}
            fallbackFocusRef={focusFallback}
            trigger={
              <Button
                fullWidth
                variant="danger-light"
                startIcon={<Cross />}
                aria-label={endLabel}
                disabled={!canEnd || mutationPending}
              >
                {t('homepage.actions.end', 'End session')}
              </Button>
            }
          />
        </Grid.Item>
      ) : null}
      <Grid.Item col={span} m={span} s={span} xs={12} direction="column" alignItems="stretch">
        <SimpleMenu
          ref={moreRef}
          label={t('homepage.actions.more', 'More')}
          aria-label={moreLabel}
          variant="tertiary"
          fullWidth
          endIcon={<More />}
          disabled={mutationPending}
        >
          <MenuItem startIcon={<Trash />} variant="danger" onSelect={() => setDeleteOpen(true)}>
            {deleteLabel}
          </MenuItem>
        </SimpleMenu>
        {deleteConfirm}
      </Grid.Item>
    </Grid.Root>
  );
};

export default SessionActions;
