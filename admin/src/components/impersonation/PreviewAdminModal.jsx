import { useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import Alert from '../PersistentAlert';
import ReadableText from '../ReadableText';
import { formatClock, validateReason, REASON_MAX } from '../../utils/impersonation.mjs';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';
import { useSecondsLeft } from './ImpersonateUserModal';

/** Durations of an admin preview in minutes (server: ADMIN_DURATIONS). */
const ADMIN_PREVIEW_DURATIONS = Object.freeze([15, 30]);

/** Server refusal reasons with their message. */
const REFUSALS = Object.freeze({
  disabled: ['impersonation.error.disabled', 'Impersonation is turned off in the settings.'],
  self: ['impersonation.preview.error.self', 'You cannot view yourself as another admin.'],
  'super-admin': [
    'impersonation.preview.error.superAdmin',
    'Super Admins cannot be viewed as another admin.',
  ],
  'not-subset': [
    'impersonation.preview.error.notSubset',
    'This admin has permissions that you do not have, so you cannot view as them.',
  ],
  'api-token': ['impersonation.error.apiToken', 'API tokens cannot impersonate.'],
});

/** Content Manager actions with their label. */
const ACTION_LABELS = Object.freeze({
  create: ['impersonation.preview.action.create', 'Create'],
  read: ['impersonation.preview.action.read', 'Read'],
  update: ['impersonation.preview.action.update', 'Update'],
  delete: ['impersonation.preview.action.delete', 'Delete'],
  publish: ['impersonation.preview.action.publish', 'Publish'],
});

/** Strapi's built-in conditions with their label. */
const CONDITION_LABELS = Object.freeze({
  'admin::is-creator': ['impersonation.preview.condition.creator', 'entries they created'],
  'admin::has-same-role-as-creator': [
    'impersonation.preview.condition.sameRole',
    'entries created by someone with the same role',
  ],
});

/**
 * One content type of the preview: its name and the actions with their
 * restrictions.
 *
 * @param {{type: object}} props Content type from the preview.
 * @returns {import('react').ReactElement} Row.
 */
const ContentTypeRow = ({ type }) => {
  const { t } = useSettingsTranslate();
  return (
    <Box tag="li" padding={3} hasRadius borderColor="neutral150" data-preview-type={type.uid}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
          {type.name}
        </Typography>
        <Flex gap={2} wrap="wrap">
          {type.actions.map((action) => {
            const label = ACTION_LABELS[action.action]
              ? t(...ACTION_LABELS[action.action])
              : action.action;
            const restricted =
              action.fields !== null || action.locales !== null || action.conditions.length > 0;
            return (
              <Badge
                key={action.action}
                backgroundColor={restricted ? 'warning100' : 'success100'}
                textColor="neutral800"
              >
                {restricted
                  ? t('impersonation.preview.restricted', '{action} (restricted)', {
                      action: label,
                    })
                  : label}
              </Badge>
            );
          })}
        </Flex>
        {type.actions
          .filter((action) => action.fields !== null || action.conditions.length > 0)
          .map((action) => {
            const label = ACTION_LABELS[action.action]
              ? t(...ACTION_LABELS[action.action])
              : action.action;
            return (
              <Typography key={action.action} variant="pi" textColor="neutral600" tag="p">
                {action.fields !== null
                  ? t(
                      'impersonation.preview.fields',
                      '{action}: {count, plural, one {# field} other {# fields}}',
                      { action: label, count: action.fields }
                    )
                  : null}
                {action.fields !== null && action.conditions.length ? ' ' : null}
                {action.conditions.length
                  ? t('impersonation.preview.conditions', '{action}: only {conditions}', {
                      action: label,
                      conditions: action.conditions
                        .map((id) => (CONDITION_LABELS[id] ? t(...CONDITION_LABELS[id]) : id))
                        .join(', '),
                    })
                  : null}
              </Typography>
            );
          })}
      </Flex>
    </Box>
  );
};

/**
 * "View as admin" (4.20): a read-only permission preview of another admin.
 * Step one asks for the reason and the duration (at most 30 minutes); step
 * two shows, under a persistent "You are viewing as … · read-only · ends in
 * mm:ss · End" banner, which content types and actions the admin can use
 * and their other permissions, computed by the server from their roles. No
 * session is created and nothing can be changed. The preview hides itself
 * when it ends, and closing the dialog ends it. The parent mounts it per
 * opening.
 *
 * @param {{
 *   admin: {id: number, name: string},
 *   onClose: () => void,
 *   onCloseAutoFocus?: (event: Event) => void,
 *   onChanged?: () => void,
 * }} props Target admin and callbacks.
 * @returns {import('react').ReactElement} Dialog.
 */
const PreviewAdminModal = ({ admin, onClose, onCloseAutoFocus, onChanged }) => {
  const { t, tError } = useSettingsTranslate();
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [result, setResult] = useState(null);
  const secondsLeft = useSecondsLeft(result?.impersonation?.expiresAt || null);
  const ended = Boolean(result) && secondsLeft <= 0;
  const reasonError = validateReason(reason);
  const name = result?.preview?.admin?.name || admin.name;

  const start = async () => {
    setTouched(true);
    if (reasonError) return;
    setPending('start');
    setFailure(null);
    try {
      const { data } = await post(`/${pluginId}/impersonation/admins/${admin.id}/preview`, {
        reason: reason.trim(),
        durationMinutes: minutes,
      });
      setResult(data?.data || null);
      onChanged?.();
    } catch (err) {
      if (isCancelledRequest(err)) return;
      const response = err?.response;
      const code = response?.data?.error?.details?.reason;
      if (response?.status === 429) {
        setFailure(
          t(
            'impersonation.error.rateLimited',
            'Too many impersonations were started. Try again in a few minutes.'
          )
        );
      } else if (REFUSALS[code]) {
        setFailure(t(...REFUSALS[code]));
      } else {
        logSafeAdminError('impersonation.preview', err);
        setFailure(t('impersonation.preview.error.start', 'The preview could not be opened.'));
      }
    } finally {
      setPending(null);
    }
  };

  const end = async () => {
    if (!result?.impersonation?.id) return;
    setPending('end');
    try {
      await post(`/${pluginId}/impersonation/${result.impersonation.id}/end`, {});
      toggleNotification({
        type: 'success',
        message: t('impersonation.preview.ended', 'Preview ended.'),
      });
      onChanged?.();
      onClose();
    } catch (err) {
      logSafeAdminError('impersonation.end', err);
      toggleNotification({
        type: 'danger',
        message: t('impersonation.error.end', 'The impersonation could not be ended.'),
      });
    } finally {
      setPending(null);
    }
  };

  const preview = result?.preview;

  /**
   * Closing the dialog ends a running preview: it lives only while shown.
   *
   * @returns {void}
   */
  const close = () => {
    if (result?.impersonation?.id && !ended) {
      post(`/${pluginId}/impersonation/${result.impersonation.id}/end`, {})
        .then(() => onChanged?.())
        .catch((err) => logSafeAdminError('impersonation.end', err));
    }
    onClose();
  };

  return (
    <Modal.Root open onOpenChange={(open) => (open ? null : close())}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Modal.Title>
            {t('impersonation.preview.title', 'View as {name}', { name: name || `#${admin.id}` })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {failure ? (
              <Alert variant="danger" closeLabel={t('common.close', 'Close')}>
                {failure}
              </Alert>
            ) : null}

            {!result ? (
              <>
                <ReadableText variant="omega" textColor="neutral800" tag="p">
                  {t(
                    'impersonation.preview.intro',
                    'See which content types and actions this admin can use, worked out from their roles. Read-only: nobody is signed in and nothing can be changed. It is recorded in the security log.'
                  )}
                </ReadableText>
                <Field.Root
                  name="reason"
                  required
                  error={touched && reasonError ? tError(reasonError) : undefined}
                  hint={t('impersonation.preview.reason.hint', 'Stored in the security log.')}
                >
                  <Field.Label>{t('impersonation.reason.label', 'Reason')}</Field.Label>
                  <Textarea
                    value={reason}
                    maxLength={REASON_MAX}
                    placeholder={t('impersonation.reason.placeholder', 'For example: ticket 4711')}
                    onChange={(event) => setReason(event.target.value)}
                    onBlur={() => setTouched(true)}
                  />
                  <Field.Hint />
                  <Field.Error />
                </Field.Root>
                <Field.Root name="durationMinutes">
                  <Field.Label>{t('impersonation.duration.label', 'Duration')}</Field.Label>
                  <SingleSelect
                    value={String(minutes)}
                    onChange={(value) => setMinutes(Number(value))}
                  >
                    {ADMIN_PREVIEW_DURATIONS.map((value) => (
                      <SingleSelectOption key={value} value={String(value)}>
                        {t(
                          'impersonation.duration.minutes',
                          '{count, plural, one {# minute} other {# minutes}}',
                          { count: value }
                        )}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
              </>
            ) : null}

            {result ? (
              <Box
                padding={3}
                hasRadius
                background={ended ? 'neutral150' : 'primary100'}
                borderColor={ended ? 'neutral200' : 'primary200'}
                data-preview-banner=""
              >
                <Flex gap={3} wrap="wrap" justifyContent="space-between" alignItems="center">
                  <Typography variant="omega" textColor="neutral800" aria-live="polite">
                    {ended
                      ? t('impersonation.preview.banner.ended', 'The preview ended.')
                      : t(
                          'impersonation.preview.banner',
                          'You are viewing as {name} · read-only · ends in {time}',
                          { name: name || `#${admin.id}`, time: formatClock(secondsLeft) }
                        )}
                  </Typography>
                  {!ended ? (
                    <Button
                      size="S"
                      variant="danger-light"
                      onClick={end}
                      loading={pending === 'end'}
                    >
                      {t('impersonation.preview.end', 'End')}
                    </Button>
                  ) : null}
                </Flex>
              </Box>
            ) : null}

            {preview && !ended ? (
              <Flex direction="column" alignItems="stretch" gap={4} data-preview-body="">
                <Typography variant="pi" textColor="neutral600" tag="p">
                  {t('impersonation.preview.roles', 'Roles: {roles}', {
                    roles: preview.admin.roles.map((role) => role.name).join(', ') || '—',
                  })}
                </Typography>
                <Flex direction="column" alignItems="stretch" gap={2}>
                  <Typography variant="delta" tag="h3" textColor="neutral800">
                    {t('impersonation.preview.contentTypes', 'Content types')}
                  </Typography>
                  {preview.contentTypes.length ? (
                    <Flex
                      tag="ul"
                      direction="column"
                      alignItems="stretch"
                      gap={2}
                      margin={0}
                      padding={0}
                      style={{ listStyle: 'none' }}
                    >
                      {preview.contentTypes.map((type) => (
                        <ContentTypeRow key={type.uid} type={type} />
                      ))}
                    </Flex>
                  ) : (
                    <Typography variant="omega" textColor="neutral800" tag="p">
                      {t(
                        'impersonation.preview.noContentTypes',
                        'This admin cannot open any content type in the Content Manager.'
                      )}
                    </Typography>
                  )}
                </Flex>
                {preview.otherPermissions.length ? (
                  <Flex direction="column" alignItems="stretch" gap={2}>
                    <Typography variant="delta" tag="h3" textColor="neutral800">
                      {t('impersonation.preview.other', 'Other permissions')}
                    </Typography>
                    <Flex
                      tag="ul"
                      direction="column"
                      alignItems="stretch"
                      gap={1}
                      margin={0}
                      paddingLeft={5}
                    >
                      {preview.otherPermissions.map((permission) => (
                        <Typography
                          key={permission.action}
                          tag="li"
                          variant="pi"
                          textColor="neutral800"
                        >
                          {permission.name}
                        </Typography>
                      ))}
                    </Flex>
                  </Flex>
                ) : null}
              </Flex>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          {result ? (
            <Modal.Close>
              <Button variant="tertiary">
                {ended
                  ? t('impersonation.result.done', 'Done')
                  : t('impersonation.preview.close', 'End and close')}
              </Button>
            </Modal.Close>
          ) : (
            <>
              <Modal.Close>
                <Button variant="tertiary">{t('common.cancel', 'Cancel')}</Button>
              </Modal.Close>
              <Button onClick={start} loading={pending === 'start'}>
                {t('impersonation.preview.start', 'View permissions')}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default PreviewAdminModal;
