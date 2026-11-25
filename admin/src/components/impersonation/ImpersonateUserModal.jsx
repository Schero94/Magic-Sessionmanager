import { useEffect, useId, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Duplicate, ExternalLink } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import Alert from '../PersistentAlert';
import ReadableText from '../ReadableText';
import { copyText } from '../../utils/copyText.mjs';
import {
  DEFAULT_IMPERSONATION_MINUTES,
  REASON_MAX,
  USER_IMPERSONATION_DURATIONS,
  formatClock,
  secondsUntil,
  submitFrontendHandoff,
  validateReason,
} from '../../utils/impersonation.mjs';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';
import {
  getImpersonationDialog,
  saveImpersonationDraft,
} from '../../utils/impersonationDialogStore.mjs';

/** Server refusal reasons with their message. */
const REFUSALS = Object.freeze({
  disabled: ['impersonation.error.disabled', 'Impersonation is turned off in the settings.'],
  'already-active': [
    'impersonation.error.alreadyActive',
    'An impersonation of this user is already running. End it first.',
  ],
  blocked: ['impersonation.error.blocked', 'Blocked accounts cannot be impersonated.'],
  'api-token': ['impersonation.error.apiToken', 'API tokens cannot impersonate.'],
});

/**
 * Remaining time of an impersonation, updated every second.
 *
 * @param {string|null} expiresAt End time (ISO).
 * @returns {number} Seconds left.
 */
export function useSecondsLeft(expiresAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  return secondsUntil(expiresAt, now);
}

/**
 * A credential shown once, read-only, with a copy button.
 *
 * @param {{label: string, value: string, name: string}} props Field.
 * @returns {import('react').ReactElement} Field.
 */
const SecretField = ({ label, value, name }) => {
  const { t } = useSettingsTranslate();
  const { toggleNotification } = useNotification();
  const copy = async () => {
    try {
      await copyText(value);
      toggleNotification({
        type: 'success',
        message: t('impersonation.result.copied', 'Copied to the clipboard.'),
      });
    } catch {
      toggleNotification({
        type: 'warning',
        message: t(
          'impersonation.result.copyFailed',
          'Copying failed. Select the text and copy it yourself.'
        ),
      });
    }
  };
  return (
    <Field.Root name={name}>
      <Field.Label>{label}</Field.Label>
      <TextInput
        value={value}
        readOnly
        onFocus={(event) => event.target.select()}
        endAction={
          <Field.Action
            label={t('impersonation.result.copy', 'Copy {name}', { name: label })}
            onClick={copy}
          >
            <Duplicate />
          </Field.Action>
        }
      />
    </Field.Root>
  );
};

/**
 * "Impersonate…" dialog for one app user (4.20). Step one asks for the
 * reason, the duration and whether to email the user; step two hands the
 * short-lived credential over once: to the configured frontend with a
 * one-time code (HTTP POST, new tab), or as a token to copy. The dialog
 * stays open on errors; nothing is started until "Start impersonation".
 * The parent mounts it per opening and clears the kept state on close, so
 * every opening starts empty; a re-mount of the Content Manager panel while
 * it is open restores it.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 *   user: {documentId: string, label: string},
 *   status: {handoff: 'frontend'|'token', frontendOrigin: string|null, durations?: number[]},
 *   onChanged?: () => void,
 *   onCloseAutoFocus?: (event: Event) => void,
 * }} props Dialog state, target user and feature status.
 * @returns {import('react').ReactElement} Dialog.
 */
const ImpersonateUserModal = ({
  open,
  onOpenChange,
  onCloseAutoFocus,
  user,
  status,
  onChanged,
}) => {
  const { t, tError } = useSettingsTranslate();
  const { post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const notifyHintId = useId();
  // Restored after the Content Manager re-mounts the panel (see the store).
  const [saved] = useState(() => getImpersonationDialog(user.documentId)?.draft || {});
  const [reason, setReason] = useState(saved.reason ?? '');
  const [minutes, setMinutes] = useState(saved.minutes ?? DEFAULT_IMPERSONATION_MINUTES);
  const [notifyUser, setNotifyUser] = useState(saved.notifyUser === true);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(null);
  const [failure, setFailure] = useState(null);
  const [result, setResult] = useState(saved.result ?? null);

  useEffect(() => {
    if (!open) return;
    saveImpersonationDraft(user.documentId, { reason, minutes, notifyUser, result });
  }, [open, user.documentId, reason, minutes, notifyUser, result]);
  const secondsLeft = useSecondsLeft(result?.impersonation?.expiresAt || null);

  const durations = Array.isArray(status?.durations)
    ? status.durations
    : USER_IMPERSONATION_DURATIONS;
  const reasonError = validateReason(reason);
  const showReasonError = touched && reasonError;

  /**
   * Starts the impersonation; keeps the dialog open with the reason on errors.
   *
   * @returns {Promise<void>}
   */
  const start = async () => {
    setTouched(true);
    if (reasonError) return;
    setPending('start');
    setFailure(null);
    try {
      const { data } = await post(
        `/${pluginId}/impersonation/users/${encodeURIComponent(user.documentId)}`,
        { reason: reason.trim(), durationMinutes: minutes, notifyUser }
      );
      setResult(data?.data || null);
      onChanged?.();
    } catch (err) {
      if (isCancelledRequest(err)) return;
      const response = err?.response;
      const reasonCode = response?.data?.error?.details?.reason;
      if (response?.status === 429) {
        setFailure(
          t(
            'impersonation.error.rateLimited',
            'Too many impersonations were started. Try again in a few minutes.'
          )
        );
      } else if (REFUSALS[reasonCode]) {
        setFailure(t(...REFUSALS[reasonCode]));
      } else {
        logSafeAdminError('impersonation.start', err);
        setFailure(t('impersonation.error.start', 'The impersonation could not be started.'));
      }
    } finally {
      setPending(null);
    }
  };

  /**
   * Ends the impersonation that was just started.
   *
   * @returns {Promise<void>}
   */
  const end = async () => {
    if (!result?.impersonation?.id) return;
    setPending('end');
    try {
      await post(`/${pluginId}/impersonation/${result.impersonation.id}/end`, {});
      toggleNotification({
        type: 'success',
        message: t('impersonation.ended', 'Impersonation ended.'),
      });
      onChanged?.();
      onOpenChange(false);
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

  /**
   * Posts the one-time code to the frontend. Strapi's default
   * Content-Security-Policy (`form-action 'self'`) blocks the post until the
   * frontend origin is added to `form-action`; the browser reports that as a
   * `securitypolicyviolation` event, which is shown here.
   *
   * @returns {void}
   */
  const openFrontend = () => {
    setFailure(null);
    const onViolation = (event) => {
      if (String(event?.violatedDirective || '').startsWith('form-action')) {
        setFailure(
          t(
            'impersonation.error.csp',
            'Your Strapi security settings block sending the sign-in to {origin}. Add this origin to form-action of the Content-Security-Policy (see the README), then start again.',
            { origin: status?.frontendOrigin || '' }
          )
        );
      }
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    window.setTimeout(
      () => document.removeEventListener('securitypolicyviolation', onViolation),
      3000
    );
    if (!submitFrontendHandoff(document, result?.handoff)) {
      setFailure(t('impersonation.error.frontend', 'The frontend could not be opened.'));
    }
  };

  const handoff = result?.handoff;
  const clock = formatClock(secondsLeft);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Modal.Title>
            {result
              ? t('impersonation.result.title', 'Impersonating {user}', { user: user.label })
              : t('impersonation.modal.title', 'Impersonate {user}', { user: user.label })}
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
                    'impersonation.modal.intro',
                    'You get a short-lived sign-in as this user to reproduce a problem. Password, email address, account and sessions cannot be changed with it. It is recorded in the security log.'
                  )}
                </ReadableText>
                <Field.Root
                  name="reason"
                  required
                  error={showReasonError ? tError(reasonError) : undefined}
                  hint={t(
                    'impersonation.reason.hint',
                    'Stored in the security log for admins. The user sees it only in the optional email; their data export says only that an administrator opened the account.'
                  )}
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
                    {durations.map((value) => (
                      <SingleSelectOption key={value} value={String(value)}>
                        {t(
                          'impersonation.duration.minutes',
                          '{count, plural, one {# minute} other {# minutes}}',
                          {
                            count: value,
                          }
                        )}
                      </SingleSelectOption>
                    ))}
                  </SingleSelect>
                </Field.Root>
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <Checkbox
                    checked={notifyUser}
                    aria-describedby={notifyHintId}
                    onCheckedChange={(checked) => setNotifyUser(checked === true)}
                  >
                    {t(
                      'impersonation.notify.label',
                      'Email the user that their account was opened'
                    )}
                  </Checkbox>
                  <Typography id={notifyHintId} variant="pi" textColor="neutral600">
                    {t(
                      'impersonation.notify.hint',
                      'Sent through Strapi’s email plugin, with the reason and the duration.'
                    )}
                  </Typography>
                </Flex>
              </>
            ) : null}

            {handoff?.type === 'frontend' ? (
              <>
                <Alert variant="default" closeLabel={t('common.close', 'Close')}>
                  {t(
                    'impersonation.result.frontendBody',
                    'Open {origin} within one minute. The sign-in link works once and is sent without appearing in the address bar.',
                    { origin: status?.frontendOrigin || '' }
                  )}
                </Alert>
                <Box>
                  <Button startIcon={<ExternalLink />} onClick={openFrontend}>
                    {t('impersonation.result.openFrontend', 'Open frontend')}
                  </Button>
                </Box>
              </>
            ) : null}

            {handoff?.type === 'token' ? (
              <>
                <Alert variant="warning" closeLabel={t('common.close', 'Close')}>
                  {t(
                    'impersonation.result.tokenBody',
                    'Shown only once. Anyone who has this token acts as {user} until it ends. Do not store or share it.',
                    { user: user.label }
                  )}
                </Alert>
                <SecretField
                  name="jwt"
                  label={t('impersonation.result.accessToken', 'Access token')}
                  value={handoff.jwt}
                />
                {handoff.refreshToken ? (
                  <SecretField
                    name="refreshToken"
                    label={t('impersonation.result.refreshToken', 'Refresh token')}
                    value={handoff.refreshToken}
                  />
                ) : null}
              </>
            ) : null}

            {result ? (
              <Typography variant="omega" textColor="neutral800" tag="p" aria-live="polite">
                {t('impersonation.result.endsIn', 'Ends in {time}.', { time: clock })}
              </Typography>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          {result ? (
            <>
              <Button variant="danger-light" onClick={end} loading={pending === 'end'}>
                {t('impersonation.end', 'End impersonation')}
              </Button>
              <Modal.Close>
                <Button variant="tertiary">{t('impersonation.result.done', 'Done')}</Button>
              </Modal.Close>
            </>
          ) : (
            <>
              <Modal.Close>
                <Button variant="tertiary">{t('common.cancel', 'Cancel')}</Button>
              </Modal.Close>
              <Button onClick={start} loading={pending === 'start'}>
                {t('impersonation.start', 'Start impersonation')}
              </Button>
            </>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ImpersonateUserModal;
