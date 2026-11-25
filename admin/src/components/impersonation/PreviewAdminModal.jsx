import { useState } from 'react';
import {
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
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import styled from 'styled-components';
import pluginId from '../../pluginId';
import Alert from '../PersistentAlert';
import ReadableText from '../ReadableText';
import { formatClock, validateReason, REASON_MAX } from '../../utils/impersonation.mjs';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';
import { useSecondsLeft } from './ImpersonateUserModal';
import AdminPreviewDetails from './AdminPreviewDetails';

/**
 * The "You are viewing as …" banner stays at the top of the scrolling dialog
 * body, so the read-only state, the timer and End are always in view.
 */
const StickyBanner = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 1;
`;

/** Admin permissions that decide whether the preview links to roles and users. */
const READ_ROLES = Object.freeze([{ action: 'admin::roles.read', subject: null }]);
const READ_USERS = Object.freeze([{ action: 'admin::users.read', subject: null }]);

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

/**
 * "View as admin" (4.20): a read-only permission preview of another admin.
 * Step one asks for the reason and the duration (at most 30 minutes); step
 * two shows, under a persistent "You are viewing as … · read-only · ends in
 * mm:ss · End" banner, a summary, the roles (linked), a Content Manager
 * matrix like Strapi's role editor and the plugin and settings permissions,
 * computed by the server from their roles (4.23: `AdminPreviewDetails`). No
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
  const {
    allowedActions: { canRead: canReadRoles },
  } = useRBAC(READ_ROLES);
  const {
    allowedActions: { canRead: canReadUsers },
  } = useRBAC(READ_USERS);
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
            {t('impersonation.preview.title', 'Permissions of {name}', {
              name: name || `#${admin.id}`,
            })}
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
              <StickyBanner
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
              </StickyBanner>
            ) : null}

            {preview && !ended ? (
              <AdminPreviewDetails
                preview={preview}
                adminId={admin.id}
                canReadRoles={Boolean(canReadRoles)}
                canReadUsers={Boolean(canReadUsers)}
                onLeave={close}
              />
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
