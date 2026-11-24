import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Box, Flex, TextButton, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { getBadgeColors } from '../../components/ui/StatusBadge';
import { TargetLink } from '../../components/ui';
import { LastActive } from '../Dashboard/SessionTable';
import {
  ACTIVITY_ACTION_LABELS,
  getActivityTone,
  getEntryPath,
  getSessionStatePresentation,
  getSignInEventPresentation,
} from './adminActivityModel.mjs';

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
 * Text button with the 3.2rem hit area of a size S button (the DS text button
 * is only as tall as its text line), like TargetLink.
 */
const TargetTextButton = styled(TextButton)`
  min-height: 3.2rem;
`;

/**
 * Frame of one event in a list: a bordered surface with a 12 px rhythm.
 *
 * @param {{children: import('react').ReactNode, id: number, kind: string}} props
 * @returns {import('react').ReactElement} List item.
 */
const EventItem = ({ children, id, kind }) => (
  <Box
    tag="li"
    background="neutral0"
    borderColor="neutral150"
    hasRadius
    padding={3}
    data-event-row={kind}
    data-event-id={id}
  >
    <Flex direction="column" alignItems="stretch" gap={1} minWidth={0}>
      {children}
    </Flex>
  </Box>
);

/**
 * Name of the admin an event belongs to. In the cross-admin list it opens
 * that admin's details at the matching tab; an unknown account (a failed
 * sign-in with an email that is not an admin) has no button.
 *
 * @param {{admin: {id: number, name: string}|null, onOpenAdmin?: (admin: object, trigger: HTMLElement) => void}} props
 * @returns {import('react').ReactElement} Name.
 */
const AdminName = ({ admin, onOpenAdmin }) => {
  const t = useT();
  if (!admin) {
    return (
      <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
        {t('adminPanel.activity.unknownAccount', 'Unknown account')}
      </Typography>
    );
  }
  if (!onOpenAdmin) {
    return (
      <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
        {admin.name}
      </Typography>
    );
  }
  return (
    <TargetTextButton
      onClick={(event) => onOpenAdmin(admin, event.currentTarget)}
      aria-label={t('adminPanel.activity.openAdmin', 'Open the details of {name}', {
        name: admin.name,
      })}
    >
      {admin.name}
    </TargetTextButton>
  );
};

/**
 * One sign-in history event: badge, optional reason, time; then address,
 * location, browser and OS; for a sign-in the state of its session.
 *
 * @param {object} props
 * @param {object} props.row Sign-in row from the API.
 * @param {boolean} [props.showAdmin] Show whose event it is (cross-admin list).
 * @param {(admin: object, trigger: HTMLElement) => void} [props.onOpenAdmin] Opens an admin.
 * @returns {import('react').ReactElement} Event row.
 */
export const SignInEventRow = ({ row, showAdmin = false, onOpenAdmin }) => {
  const t = useT();
  const event = getSignInEventPresentation(row);
  const session = getSessionStatePresentation(row.session);
  const facts = [];
  if (row.ipAddress) {
    facts.push(
      row.ipAnonymized
        ? t('adminPanel.activity.ipAnonymized', '{ip} (anonymised)', { ip: row.ipAddress })
        : row.ipAddress
    );
  }
  const place = [row.location?.city, row.location?.country].filter(Boolean).join(', ');
  if (place) facts.push(place);
  if (row.browser && row.os) {
    facts.push(
      t('adminPanel.activity.browserOnOs', '{browser} on {os}', {
        browser: row.browser,
        os: row.os,
      })
    );
  } else if (row.browser || row.os) {
    facts.push(row.browser || row.os);
  }
  if (row.actor)
    facts.push(t('adminPanel.activity.byAdmin', 'by {name}', { name: row.actor.name }));

  return (
    <EventItem id={row.id} kind={event.key}>
      <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
          <Badge {...getBadgeColors(event.tone)}>
            {t(event.label.messageId, event.label.defaultMessage)}
          </Badge>
          {showAdmin ? <AdminName admin={row.admin} onOpenAdmin={onOpenAdmin} /> : null}
          {event.detail ? (
            <Typography variant="pi" textColor="neutral600">
              {t(event.detail.messageId, event.detail.defaultMessage)}
            </Typography>
          ) : null}
        </Flex>
        <LastActive value={row.at} />
      </Flex>
      {facts.length ? (
        <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
          {facts.join(' · ')}
        </Typography>
      ) : null}
      {session ? (
        <Flex gap={2} wrap="wrap" alignItems="center">
          <Badge {...getBadgeColors(session.tone)}>
            {t(session.label.messageId, session.label.defaultMessage)}
          </Badge>
          {row.session?.endedAt ? <LastActive value={row.session.endedAt} /> : null}
        </Flex>
      ) : null}
    </EventItem>
  );
};

/**
 * One Content Manager action: action badge, entry (a link into the Content
 * Manager while the entry exists), content type, locale and time.
 *
 * @param {object} props
 * @param {object} props.row Activity row from the API.
 * @param {boolean} [props.showAdmin] Show who did it (cross-admin list).
 * @param {(admin: object, trigger: HTMLElement) => void} [props.onOpenAdmin] Opens an admin.
 * @returns {import('react').ReactElement} Event row.
 */
export const ActivityEventRow = ({ row, showAdmin = false, onOpenAdmin }) => {
  const t = useT();
  const label = ACTIVITY_ACTION_LABELS[row.action] || ACTIVITY_ACTION_LABELS.view;
  const path = getEntryPath(row);
  const entryName =
    row.entry?.count !== null && row.entry?.count !== undefined
      ? t('adminPanel.activity.entries', '{count, plural, one {# entry} other {# entries}}', {
          count: row.entry.count,
        })
      : row.entry?.title || row.entry?.documentId || row.contentType?.name || '';
  const facts = [row.contentType?.name];
  if (row.entry?.locale) facts.push(row.entry.locale);

  return (
    <EventItem id={row.id} kind={row.action}>
      <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
          <Badge {...getBadgeColors(getActivityTone(row.action))}>
            {t(label.messageId, label.defaultMessage)}
          </Badge>
          {showAdmin ? <AdminName admin={row.admin} onOpenAdmin={onOpenAdmin} /> : null}
        </Flex>
        <LastActive value={row.at} />
      </Flex>
      <Box minWidth={0} style={{ overflowWrap: 'anywhere' }}>
        {path ? (
          <TargetLink
            tag={RouterLink}
            to={path}
            aria-label={t('adminPanel.activity.openEntry', 'Open {entry} in the Content Manager', {
              entry: entryName,
            })}
          >
            {entryName}
          </TargetLink>
        ) : (
          <Typography variant="omega" textColor="neutral800">
            {entryName}
          </Typography>
        )}
      </Box>
      <Typography variant="pi" textColor="neutral600">
        {facts.filter(Boolean).join(' · ')}
      </Typography>
    </EventItem>
  );
};
