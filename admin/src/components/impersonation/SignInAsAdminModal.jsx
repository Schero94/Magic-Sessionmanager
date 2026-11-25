import { useId, useState } from 'react';
import {
  Button,
  Checkbox,
  Field,
  Flex,
  LinkButton,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { ExternalLink } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import Alert from '../PersistentAlert';
import ReadableText from '../ReadableText';
import { validateReason, REASON_MAX } from '../../utils/impersonation.mjs';
import { landingUrl } from '../../utils/adminImpersonationTab.mjs';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';

/** Server refusal reasons with their message. */
const REFUSALS = Object.freeze({
  disabled: ['impersonation.error.disabled', 'Impersonation is turned off in the settings.'],
  unsupported: [
    'impersonation.signIn.error.unsupported',
    'Signing in as another admin is not available on this Strapi version.',
  ],
  self: ['impersonation.signIn.error.self', 'You cannot sign in as yourself.'],
  'super-admin': ['impersonation.signIn.error.superAdmin', 'You cannot sign in as a Super Admin.'],
  'not-subset': [
    'impersonation.signIn.error.notSubset',
    'This admin has permissions that you do not have, so you cannot sign in as them.',
  ],
  inactive: ['impersonation.signIn.error.inactive', 'This admin account is not active.'],
  'already-active': [
    'impersonation.signIn.error.alreadyActive',
    'Someone is already signed in as this admin. End that impersonation first.',
  ],
  nested: [
    'impersonation.signIn.error.nested',
    'You cannot start an impersonation while impersonating.',
  ],
  'api-token': ['impersonation.error.apiToken', 'API tokens cannot impersonate.'],
});

/**
 * The admin base path of the current page (`/admin` for
 * `/admin/plugins/magic-sessionmanager/...`).
 *
 * @returns {string}
 */
export const currentAdminBase = () => {
  const path = window.location.pathname;
  const index = path.indexOf(`/plugins/${pluginId}`);
  return index >= 0 ? path.slice(0, index) : '/admin';
};

/**
 * Text of an unsupported state, or null.
 *
 * @param {{supported?: boolean, reason?: string|null, version?: string|null}|undefined} support
 *   `adminSignIn` from the status route.
 * @param {(id: string, fallback: string, values?: object) => string} t Translate.
 * @returns {string|null}
 */
export const unsupportedText = (support, t) => {
  if (!support || support.supported) return null;
  if (support.reason === 'token-lifespan') {
    return t(
      'impersonation.signIn.unsupported.lifespan',
      'Not available: the admin access token lifespan is shorter than 15 minutes.'
    );
  }
  return t(
    'impersonation.signIn.unsupported.version',
    'Not available on Strapi {version}: this plugin release was tested with Strapi 5.50 to 5.64. Update the plugin to use it.',
    { version: support.version || '?' }
  );
};

/**
 * "Sign in as this admin" (4.23): asks for the reason, the duration and
 * whether changes are allowed, then offers a link that opens a new tab
 * signed in as the admin. The link carries a one-time code (60 seconds) in
 * the URL hash, which never reaches a server log; the new tab removes it at
 * once. The parent mounts it per opening.
 *
 * @param {{
 *   admin: {id: number, name: string},
 *   support: {supported: boolean, reason: string|null, version: string|null, durations: number[]},
 *   onClose: () => void,
 *   onCloseAutoFocus?: (event: Event) => void,
 *   onChanged?: () => void,
 * }} props Target admin, feature support and callbacks.
 * @returns {import('react').ReactElement} Dialog.
 */
const SignInAsAdminModal = ({ admin, support, onClose, onCloseAutoFocus, onChanged }) => {
  const { t, tError } = useSettingsTranslate();
  const { post } = useFetchClient();
  const durations = support?.durations?.length ? support.durations : [15];
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(durations[0]);
  const [allowChanges, setAllowChanges] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const allowHintId = useId();
  const reasonError = validateReason(reason);
  const unsupported = unsupportedText(support, t);
  const name = admin.name || `#${admin.id}`;

  const start = async () => {
    setTouched(true);
    if (reasonError || unsupported) return;
    setPending(true);
    setFailure(null);
    try {
      const { data } = await post(`/${pluginId}/impersonation/admins/${admin.id}/sign-in`, {
        reason: reason.trim(),
        durationMinutes: minutes,
        allowChanges,
      });
      setHandoff(data?.data?.handoff || null);
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
        logSafeAdminError('impersonation.signIn', err);
        setFailure(t('impersonation.signIn.error.start', 'The sign-in could not be started.'));
      }
    } finally {
      setPending(false);
    }
  };

  const href = handoff ? landingUrl(currentAdminBase(), handoff) : null;

  return (
    <Modal.Root open onOpenChange={(open) => (open ? null : onClose())}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Modal.Title>
            {t('impersonation.signIn.title', 'Sign in as {name}', { name })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            {failure ? (
              <Alert variant="danger" closeLabel={t('common.close', 'Close')}>
                {failure}
              </Alert>
            ) : null}
            {unsupported ? (
              <Alert variant="default" closeLabel={t('common.close', 'Close')}>
                {unsupported}
              </Alert>
            ) : null}

            {!handoff ? (
              <>
                <ReadableText variant="omega" textColor="neutral800" tag="p">
                  {t(
                    'impersonation.signIn.intro',
                    'Opens a new tab signed in as this admin, with their menu and permissions. Your other tabs stay signed in as you. The start, the end and every change are recorded in the security log.'
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
                    {durations.map((value) => (
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
                <Flex direction="column" alignItems="stretch" gap={1}>
                  <Checkbox
                    checked={allowChanges}
                    aria-describedby={allowHintId}
                    onCheckedChange={(checked) => setAllowChanges(checked === true)}
                  >
                    {t('impersonation.signIn.allowChanges', 'Allow changes')}
                  </Checkbox>
                  <Typography id={allowHintId} variant="pi" textColor="neutral600">
                    {t(
                      'impersonation.signIn.allowChanges.hint',
                      'Off: the tab is read-only. Their account, password, sessions, admin users, roles and API tokens can never be changed.'
                    )}
                  </Typography>
                </Flex>
                {allowChanges ? (
                  <Alert variant="warning" closeLabel={t('common.close', 'Close')}>
                    {t(
                      'impersonation.signIn.allowChanges.warning',
                      'Changes you make will appear in Strapi as made by {name} (for example "Last edited by"). The security log records you as the person who made them.',
                      { name }
                    )}
                  </Alert>
                ) : null}
              </>
            ) : (
              <Flex direction="column" alignItems="stretch" gap={3} data-sign-in-ready="">
                <ReadableText variant="omega" textColor="neutral800" tag="p">
                  {t(
                    'impersonation.signIn.ready',
                    'Ready. Open the tab within one minute; the link works once. End the impersonation from the bar at the top of that tab, or from this page.'
                  )}
                </ReadableText>
                <LinkButton
                  href={href}
                  isExternal
                  endIcon={<ExternalLink />}
                  size="L"
                  onClick={() => window.setTimeout(onClose, 0)}
                >
                  {t('impersonation.signIn.open', 'Open tab signed in as {name}', { name })}
                </LinkButton>
              </Flex>
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">
              {handoff ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
            </Button>
          </Modal.Close>
          {!handoff ? (
            <Button
              variant={allowChanges ? 'danger' : 'default'}
              onClick={start}
              loading={pending}
              disabled={Boolean(unsupported)}
            >
              {t('impersonation.signIn.start', 'Start sign-in')}
            </Button>
          ) : null}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SignInAsAdminModal;
