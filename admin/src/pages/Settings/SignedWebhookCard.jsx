import { useState } from 'react';
import { Box, Button, Flex, TextInput, Typography } from '@strapi/design-system';
import { Check, Key, Pencil, Trash } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import pluginId from '../../pluginId';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { ProtectedNotice } from './SettingsBlocks';
import { describeWebhookTest, generateWebhookSecret } from '../../utils/signalsForm.mjs';
import { logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * One write-only value (URL or secret): "saved" state with Replace and
 * Remove, or an input while a new value is entered. The draft holds the key
 * only while something is typed (or '' to remove), so a Save without
 * changes never touches the stored value.
 *
 * @param {object} props
 * @param {string} props.field Settings key.
 * @param {boolean} props.saved Whether a value is stored.
 * @param {object} props.form Settings form.
 * @param {string} props.label Field label.
 * @param {string} props.hint Field hint.
 * @param {string} props.type Input type.
 * @param {string} [props.placeholder] Placeholder.
 * @param {string|null} [props.savedHint] What may be shown of the stored value (scheme and host).
 * @param {boolean} [props.disabled] Read-only (no Change protected settings).
 * @param {import('react').ReactNode} [props.extra] Extra actions while editing.
 * @returns {import('react').ReactElement} Field.
 */
const WriteOnlyField = ({
  field,
  saved,
  form,
  label,
  hint,
  type,
  placeholder,
  savedHint = null,
  disabled = false,
  extra,
}) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors } = form;
  const draft = settings[field];
  const [editing, setEditing] = useState(false);
  const removing = draft === '';
  const showInput = editing || !saved || (typeof draft === 'string' && draft !== '');

  if (!showInput) {
    return (
      <FormField id={`generic-${field}`} name={field} label={label} description={hint}>
        <Flex gap={2} wrap="wrap" alignItems="center">
          <Typography variant="omega" textColor={removing ? 'danger600' : 'neutral800'}>
            {removing
              ? t('settings.signedWebhook.removed', 'Removed when you save.')
              : t('settings.signedWebhook.saved', 'Saved. It is never shown again.')}
          </Typography>
          {savedHint && !removing ? (
            <Typography variant="pi" textColor="neutral600">
              {savedHint}
            </Typography>
          ) : null}
          {!removing ? (
            <>
              <Button
                variant="tertiary"
                startIcon={<Pencil />}
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                {t('settings.signedWebhook.replace', 'Replace')}
              </Button>
              <Button
                variant="danger-light"
                startIcon={<Trash />}
                disabled={disabled}
                onClick={() => handleChange(field, '')}
              >
                {t('settings.signedWebhook.remove', 'Remove')}
              </Button>
            </>
          ) : (
            <Button
              variant="tertiary"
              disabled={disabled}
              onClick={() => handleChange(field, undefined)}
            >
              {t('settings.signedWebhook.keep', 'Keep it')}
            </Button>
          )}
        </Flex>
      </FormField>
    );
  }

  return (
    <FormField
      id={`generic-${field}`}
      name={field}
      label={label}
      description={hint}
      error={tError(errors[field])}
    >
      <Flex direction="column" alignItems="stretch" gap={2}>
        <TextInput
          type={type}
          value={typeof draft === 'string' ? draft : ''}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => handleChange(field, event.target.value || undefined)}
        />
        {extra || saved ? (
          <Flex gap={2} wrap="wrap">
            {extra}
            {saved ? (
              <Button
                variant="tertiary"
                onClick={() => {
                  handleChange(field, undefined);
                  setEditing(false);
                }}
              >
                {t('settings.signedWebhook.keepSaved', 'Keep the saved value')}
              </Button>
            ) : null}
          </Flex>
        ) : null}
      </Flex>
    </FormField>
  );
};

/**
 * "Signed webhook" (Alerts tab): a URL and secret that are never shown again
 * after saving, the switch, and "Send test". Deliveries are signed with
 * HMAC-SHA256 (`X-Magic-Sessionmanager-Signature: t=…,v1=…`); the README
 * has the verification snippet. Protected settings: without Change protected
 * settings the card is read-only and Send test is unavailable.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Card.
 */
const SignedWebhookCard = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { post } = useFetchClient();
  const { settings, handleChange } = form;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const locked = form.canChangeProtected === false;
  const pendingWriteOnly =
    settings.genericWebhookUrl !== undefined || settings.genericWebhookSecret !== undefined;

  const sendTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const { data } = await post(`/${pluginId}/webhook/test`, {});
      setResult(describeWebhookTest(data?.data));
    } catch (err) {
      logSafeAdminError('webhook-test', err);
      setResult({
        messageId: 'settings.signedWebhook.test.failed',
        defaultMessage: 'The test could not be started.',
        tone: 'danger',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SectionCard
      id="signed-webhook"
      title={t('settings.signedWebhook.title', 'Signed webhook')}
      subtitle={t(
        'settings.signedWebhook.intro',
        'Sends the selected events as signed JSON to your own endpoint, for example a SIEM. Only https; private and local addresses are refused, redirects are not followed.'
      )}
    >
      <SettingsToggleRow
        id="generic-webhook-enabled"
        title={t('settings.signedWebhook.enable.label', 'Send to the signed webhook')}
        description={t(
          'settings.signedWebhook.enable.hint',
          'Failed deliveries are retried twice (after 2 and 10 seconds). Data sent: user documentId, IP as the security log stores it, browser, country and city, and the event details. No email addresses.'
        )}
        checked={settings.genericWebhookEnabled === true}
        disabled={locked}
        onChange={(checked) => handleChange('genericWebhookEnabled', checked)}
      />
      {locked ? <ProtectedNotice /> : null}
      <EqualGrid columns={2} stackBelow="medium" gap={6}>
        <WriteOnlyField
          field="genericWebhookUrl"
          saved={settings.hasGenericWebhook === true}
          savedHint={settings.genericWebhookHint}
          disabled={locked}
          form={form}
          type="url"
          label={t('settings.signedWebhook.url.label', 'Webhook URL')}
          hint={t(
            'settings.signedWebhook.url.hint',
            'https only. Treat it like a password: it may contain a token.'
          )}
          placeholder="https://hooks.example.com/sessions"
        />
        <WriteOnlyField
          field="genericWebhookSecret"
          saved={settings.hasGenericWebhookSecret === true}
          disabled={locked}
          form={form}
          type="text"
          label={t('settings.signedWebhook.secret.label', 'Signing secret')}
          hint={t(
            'settings.signedWebhook.secret.hint',
            'Your endpoint uses it to verify the signature. Copy it before you save: it is never shown again.'
          )}
          extra={
            <>
              <Button
                variant="secondary"
                startIcon={<Key />}
                disabled={locked}
                onClick={() => handleChange('genericWebhookSecret', generateWebhookSecret())}
              >
                {t('settings.signedWebhook.generate', 'Generate')}
              </Button>
              {typeof settings.genericWebhookSecret === 'string' &&
              settings.genericWebhookSecret ? (
                <Button
                  variant="tertiary"
                  onClick={() =>
                    form.copyValue(
                      settings.genericWebhookSecret,
                      t('settings.signedWebhook.copied', 'Secret copied.'),
                      'webhook-secret'
                    )
                  }
                >
                  {t('settings.signedWebhook.copy', 'Copy')}
                </Button>
              ) : null}
            </>
          }
        />
      </EqualGrid>
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Button
          variant="secondary"
          startIcon={<Check />}
          loading={testing}
          disabled={locked || pendingWriteOnly || !settings.hasGenericWebhook}
          onClick={sendTest}
        >
          {t('settings.signedWebhook.test.action', 'Send test')}
        </Button>
        {pendingWriteOnly ? (
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t(
              'settings.signedWebhook.test.saveFirst',
              'Save first: the test uses the saved URL and secret.'
            )}
          </ReadableText>
        ) : null}
        <Box aria-live="polite" data-webhook-test-result="">
          {result ? (
            <Typography
              variant="pi"
              textColor={result.tone === 'success' ? 'success600' : 'danger600'}
            >
              {t(result.messageId, result.defaultMessage, result.values)}
            </Typography>
          ) : null}
        </Box>
      </Flex>
    </SectionCard>
  );
};

export default SignedWebhookCard;
