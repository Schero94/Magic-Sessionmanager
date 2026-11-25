import { useState } from 'react';
import { Badge, Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { restoreDialogFocus } from '../../utils/restoreDialogFocus.mjs';
import { getBadgeColors } from '../../components/ui/StatusBadge';
import { PropertyList } from '../../components/ui';
import {
  ACTIVITY_ACTION_LABELS,
  getActivityTone,
  getEventPlace,
  getEventPresentation,
  getSessionStatePresentation,
} from './adminActivityModel.mjs';
import { ActivityEntry, EventBadge, FULL_DATE, SHORT_DATE, useT } from './EventParts';
import { changedSettingsLines, doneByText, ipText, noAdminText, userText } from './eventText.mjs';
import { getUserEventDetail } from '../UserActivity/userActivityModel.mjs';

/**
 * Detail dialog of one event, like the log details of Strapi's Audit Logs:
 * a title, then the facts as label/value pairs on a neutral surface. Opened
 * from the Eye button or a row click; focus returns to that row's Eye button.
 *
 * @param {object} props
 * @param {string} props.title Dialog title.
 * @param {Array<object>} props.items PropertyList items.
 * @param {import('react').ReactNode} [props.footerAction] Extra footer action.
 * @param {() => void} props.onClose Closes the dialog.
 * @param {(event: Event) => void} props.onCloseAutoFocus Focus after closing.
 * @returns {import('react').ReactElement} Modal.
 */
export const EventDetailsModal = ({ title, items, footerAction, onClose, onCloseAutoFocus }) => {
  const t = useT();
  return (
    <Modal.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Box background="neutral100" hasRadius padding={{ initial: 4, medium: 6 }}>
            <PropertyList columns={2} items={items} />
          </Box>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('common.close', 'Close')}</Button>
          </Modal.Close>
          {footerAction || null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

/**
 * Keeps the details dialog of a list: which row is open and the Eye button
 * of that row, where focus returns after closing (also after a row click).
 * When that row is gone after a refresh, focus goes to the list container.
 *
 * @returns {{selected: object|null, open: (row: object, trigger?: HTMLElement|null) => void,
 *   close: () => void, onCloseAutoFocus: (event: Event) => void,
 *   setContainer: (node: HTMLElement|null) => void}}
 */
export const useEventDetails = () => {
  const [selected, setSelected] = useState(null);
  const [opener, setOpener] = useState(null);
  const [container, setContainer] = useState(null);
  return {
    selected,
    setContainer,
    open: (row, trigger) => {
      const button = trigger?.matches?.('[data-event-details]')
        ? trigger
        : trigger?.querySelector?.('[data-event-details]');
      setOpener(button || null);
      setSelected(row);
    },
    close: () => setSelected(null),
    onCloseAutoFocus: (event) => restoreDialogFocus(event, opener, container),
  };
};

/**
 * Facts of a sign-in event for the details dialog.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {(value: unknown, options?: object) => string} formatDate Date formatter.
 * @param {object} row Sign-in row.
 * @returns {{title: string, items: object[]}} Dialog content.
 */
export const signInDetails = (t, formatDate, row) => {
  const presentation = getEventPresentation(row);
  const label = t(presentation.label.messageId, presentation.label.defaultMessage);
  const state = getSessionStatePresentation(row.session);
  const revoked = presentation.key === 'revoked';
  const adminName = row.admin?.name || noAdminText(t, row);
  const items = [
    {
      id: 'event',
      label: t('adminPanel.activity.column.event', 'Event'),
      render: (
        <Flex direction="column" alignItems="flex-start" gap={1}>
          <EventBadge presentation={presentation} />
          {presentation.detail ? (
            <Typography variant="pi" textColor="neutral600">
              {t(presentation.detail.messageId, presentation.detail.defaultMessage)}
            </Typography>
          ) : null}
        </Flex>
      ),
    },
    {
      id: 'time',
      label: t('adminPanel.activity.details.exactTime', 'Exact time'),
      value: row.at ? formatDate(row.at, FULL_DATE) : null,
    },
    { id: 'admin', label: t('adminPanel.activity.column.admin', 'Admin'), value: adminName },
  ];
  if (revoked) {
    items.push(
      {
        id: 'actor',
        label: t('adminPanel.activity.column.doneBy', 'Done by'),
        value: row.actor?.name || null,
      },
      {
        id: 'scope',
        label: t('adminPanel.activity.details.signedOutOf', 'Signed out of'),
        value:
          Number.isInteger(row.sessionsEnded) && row.sessionsEnded >= 0
            ? t(
                'adminPanel.activity.details.scopeCount',
                '{scope} ({count, plural, =0 {no open session} one {# session ended} other {# sessions ended}})',
                {
                  scope: t(presentation.detail.messageId, presentation.detail.defaultMessage),
                  count: row.sessionsEnded,
                }
              )
            : t(presentation.detail.messageId, presentation.detail.defaultMessage),
      }
    );
  }
  if (state) {
    const endedAt = toValidDate(row.session?.endedAt);
    items.push({
      id: 'session',
      label: t('adminPanel.activity.column.session', 'Session'),
      value: [
        t(state.label.messageId, state.label.defaultMessage),
        endedAt ? formatDate(endedAt, SHORT_DATE) : '',
        row.session?.endedBy?.name
          ? t('adminPanel.activity.byAdmin', 'by {name}', { name: row.session.endedBy.name })
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  if (row.change) {
    const lines = changedSettingsLines(t, row.change.keys);
    items.push({
      id: 'settings',
      label: t('adminPanel.activity.details.changedSettings', 'Changed settings'),
      ...(lines.length
        ? {
            render: (
              <Flex direction="column" alignItems="flex-start" gap={1} data-changed-settings="">
                {lines.map((line) => (
                  <Typography key={line} variant="omega" textColor="neutral800">
                    {line}
                  </Typography>
                ))}
              </Flex>
            ),
          }
        : { value: null }),
      fullWidth: true,
    });
  }
  if (row.purge) {
    items.push(
      {
        id: 'purged',
        label: t('adminPanel.activity.details.deleted', 'Deleted events'),
        value: Number.isInteger(row.purge.count) ? row.purge.count : null,
      },
      {
        id: 'retention',
        label: t('adminPanel.activity.details.retention', 'Kept for'),
        value: Number.isInteger(row.purge.retentionDays)
          ? t('adminPanel.duration.days', '{count, plural, one {# day} other {# days}}', {
              count: row.purge.retentionDays,
            })
          : null,
      }
    );
  }
  if (Number.isInteger(row.attempts) && row.attempts > 1) {
    items.push({
      id: 'attempts',
      label: t('adminPanel.activity.details.attempts', 'Attempts'),
      value: row.attempts,
    });
  }
  items.push(
    {
      id: 'ip',
      label: t('adminPanel.activity.details.ip', 'IP address'),
      value: ipText(t, row) || null,
      kind: 'id',
    },
    {
      id: 'place',
      label: t('adminPanel.activity.details.location', 'Location'),
      value: getEventPlace(row) || null,
    },
    {
      id: 'browser',
      label: t('adminPanel.activity.details.browser', 'Browser'),
      value: row.browser || null,
    },
    {
      id: 'os',
      label: t('adminPanel.activity.details.os', 'Operating system'),
      value: row.os || null,
    },
    {
      id: 'userAgent',
      label: t('adminPanel.activity.details.userAgent', 'User agent'),
      value: row.userAgent || null,
      kind: 'id',
      fullWidth: true,
    },
    {
      id: 'eventId',
      label: t('adminPanel.activity.details.eventId', 'Event ID'),
      value: row.id,
      kind: 'id',
    }
  );
  const title = row.admin?.name
    ? t('adminPanel.activity.details.title', '{event}: {name}', { event: label, name: adminName })
    : label;
  // Settings changes, token reads and retention runs record no browser: their
  // empty device rows would only add dashes.
  const logEvent = ['settings', 'log-read', 'purged'].includes(presentation.key);
  const deviceFields = new Set(['ip', 'place', 'browser', 'os', 'userAgent']);
  return {
    title,
    items: logEvent
      ? items.filter(
          (item) => !deviceFields.has(item.id) || (item.value !== null && item.value !== '')
        )
      : items,
  };
};

/**
 * Facts of an activity event for the details dialog.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {(value: unknown, options?: object) => string} formatDate Date formatter.
 * @param {object} row Activity row.
 * @returns {{title: string, items: object[]}} Dialog content.
 */
export const activityDetails = (t, formatDate, row) => {
  const label = ACTIVITY_ACTION_LABELS[row.action] || ACTIVITY_ACTION_LABELS.view;
  const action = t(label.messageId, label.defaultMessage);
  return {
    title: row.entry?.title
      ? t('adminPanel.activity.details.title', '{event}: {name}', {
          event: action,
          name: row.entry.title,
        })
      : action,
    items: [
      {
        id: 'action',
        label: t('adminPanel.activity.column.action', 'Action'),
        render: <Badge {...getBadgeColors(getActivityTone(row.action))}>{action}</Badge>,
      },
      {
        id: 'time',
        label: t('adminPanel.activity.details.exactTime', 'Exact time'),
        value: row.at ? formatDate(row.at, FULL_DATE) : null,
      },
      {
        id: 'entry',
        label: t('adminPanel.activity.column.entry', 'Entry'),
        render: <ActivityEntry row={row} />,
      },
      {
        id: 'admin',
        label: t('adminPanel.activity.column.admin', 'Admin'),
        value: row.admin?.name || null,
      },
      {
        id: 'type',
        label: t('adminPanel.activity.column.contentType', 'Content type'),
        value: row.contentType?.name || null,
      },
      {
        id: 'uid',
        label: t('adminPanel.activity.details.uid', 'Content type UID'),
        value: row.contentType?.uid || null,
        kind: 'id',
      },
      {
        id: 'documentId',
        label: t('adminPanel.activity.details.documentId', 'Document ID'),
        value: row.entry?.documentId || null,
        kind: 'id',
      },
      {
        id: 'locale',
        label: t('adminPanel.activity.details.locale', 'Locale'),
        value: row.entry?.locale || null,
      },
      {
        id: 'eventId',
        label: t('adminPanel.activity.details.eventId', 'Event ID'),
        value: row.id,
        kind: 'id',
      },
    ],
  };
};

/**
 * Facts of an app-user event (4.22) for the details dialog: the event with
 * what happened in plain words (one line per fact), the exact time, the user,
 * who did it, the reason an admin gave for an impersonation (only returned
 * to readers who may impersonate), then address, place, browser, operating
 * system, user agent and event id like the admin events.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {(value: unknown, options?: object) => string} formatDate Date formatter.
 * @param {object} row App-user event row.
 * @returns {{title: string, items: object[]}} Dialog content.
 */
export const userEventDetails = (t, formatDate, row) => {
  const presentation = getEventPresentation(row);
  const label = t(presentation.label.messageId, presentation.label.defaultMessage);
  const lines = getUserEventDetail(row).map((part) =>
    t(part.messageId, part.defaultMessage, part.values)
  );
  const who = userText(t, row);
  const doneBy = doneByText(t, row);
  const items = [
    {
      id: 'event',
      label: t('adminPanel.activity.column.event', 'Event'),
      render: <EventBadge presentation={presentation} />,
    },
    {
      id: 'time',
      label: t('adminPanel.activity.details.exactTime', 'Exact time'),
      value: row.at ? formatDate(row.at, FULL_DATE) : null,
    },
    // Only events with facts get "What happened"; a dash there would say nothing.
    ...(lines.length
      ? [
          {
            id: 'what',
            label: t('userActivity.details.what', 'What happened'),
            render: (
              <Flex direction="column" alignItems="flex-start" gap={1} data-event-facts="">
                {lines.map((line) => (
                  <Typography key={line} variant="omega" textColor="neutral800">
                    {line}
                  </Typography>
                ))}
              </Flex>
            ),
            fullWidth: true,
          },
        ]
      : []),
    { id: 'user', label: t('userActivity.column.user', 'User'), value: who, kind: 'id' },
  ];
  if (doneBy) {
    items.push({
      id: 'doneBy',
      label: t('adminPanel.activity.column.doneBy', 'Done by'),
      value: doneBy,
    });
  }
  if (row.details?.reason && presentation.key.startsWith('impersonation')) {
    items.push({
      id: 'reasonGiven',
      label: t('userActivity.details.reasonGiven', 'Reason given'),
      value: row.details.reason,
      fullWidth: true,
    });
  }
  items.push(
    {
      id: 'ip',
      label: t('adminPanel.activity.details.ip', 'IP address'),
      value: ipText(t, row) || null,
      kind: 'id',
    },
    {
      id: 'place',
      label: t('adminPanel.activity.details.location', 'Location'),
      value: getEventPlace(row) || null,
    },
    {
      id: 'browser',
      label: t('adminPanel.activity.details.browser', 'Browser'),
      value: row.browser || null,
    },
    {
      id: 'os',
      label: t('adminPanel.activity.details.os', 'Operating system'),
      value: row.os || null,
    },
    {
      id: 'userAgent',
      label: t('adminPanel.activity.details.userAgent', 'User agent'),
      value: row.userAgent || null,
      kind: 'id',
      fullWidth: true,
    },
    {
      id: 'eventId',
      label: t('adminPanel.activity.details.eventId', 'Event ID'),
      value: row.id,
      kind: 'id',
    }
  );
  // Events an admin caused (lock lifted, impersonation) record no browser of the user:
  // their empty device rows would only add dashes.
  const deviceFields = new Set(['ip', 'place', 'browser', 'os', 'userAgent']);
  const byAdmin = row.actor?.type === 'admin' || row.actor?.type === 'system';
  return {
    title: t('adminPanel.activity.details.title', '{event}: {name}', { event: label, name: who }),
    items: byAdmin
      ? items.filter(
          (item) => !deviceFields.has(item.id) || (item.value !== null && item.value !== '')
        )
      : items,
  };
};
