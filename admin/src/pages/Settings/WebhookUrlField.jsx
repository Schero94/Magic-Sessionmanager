import { useState } from 'react';
import { Badge, Button, Flex, Typography } from '@strapi/design-system';
import FormField from '../../components/FormField';
import SecretTextInput from './SecretTextInput';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * One team-notification webhook URL (4.17, security review F6). The server
 * never returns a stored URL: it says whether one is stored
 * (`hasDiscordWebhook`) and gives a hint without the secret part
 * (`https://discord.com/…`). The draft key stays absent (keep the stored URL)
 * until the admin types a new one (Replace) or removes it (Remove, sent as an
 * empty string).
 *
 * @param {{
 *   form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm>,
 *   id: string,
 *   field: 'discordWebhookUrl'|'slackWebhookUrl',
 *   hasKey: 'hasDiscordWebhook'|'hasSlackWebhook',
 *   hintKey: 'discordWebhookHint'|'slackWebhookHint',
 *   label: string,
 *   description: string,
 *   placeholder: string,
 *   error?: string,
 *   disabled?: boolean,
 * }} props Field settings.
 * @returns {import('react').ReactElement} Field.
 */
const WebhookUrlField = ({
  form,
  id,
  field,
  hasKey,
  hintKey,
  label,
  description,
  placeholder,
  error,
  disabled = false,
}) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange } = form;
  const stored = settings[hasKey] === true;
  const draft = settings[field];
  const [replacing, setReplacing] = useState(false);
  const removing = stored && draft === '';
  const showInput = !stored || replacing || (typeof draft === 'string' && draft !== '');

  /** An empty input keeps the stored URL; only typed text replaces it. */
  const onInput = (value) => handleChange(field, value ? value : undefined);
  const cancel = () => {
    handleChange(field, undefined);
    setReplacing(false);
  };

  if (!showInput) {
    return (
      <FormField id={id} name={field} label={label} description={description} error={error}>
        <Flex direction="column" alignItems="stretch" gap={2} data-webhook-saved={field}>
          <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
            <Badge
              backgroundColor={removing ? 'danger100' : 'success100'}
              textColor={removing ? 'danger700' : 'success700'}
            >
              {removing
                ? t('settings.webhooks.removing', 'Removed on save')
                : t('settings.webhooks.saved', 'Saved')}
            </Badge>
            {settings[hintKey] ? (
              <Typography variant="pi" textColor="neutral600">
                {settings[hintKey]}
              </Typography>
            ) : null}
          </Flex>
          <Flex gap={2} wrap="wrap">
            {removing ? (
              <Button variant="tertiary" size="S" disabled={disabled} onClick={cancel}>
                {t('settings.webhooks.undo', 'Keep URL')}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="S"
                  disabled={disabled}
                  onClick={() => setReplacing(true)}
                >
                  {t('settings.webhooks.replace', 'Replace')}
                </Button>
                <Button
                  variant="danger-light"
                  size="S"
                  disabled={disabled}
                  onClick={() => handleChange(field, '')}
                >
                  {t('settings.webhooks.remove', 'Remove')}
                </Button>
              </>
            )}
          </Flex>
        </Flex>
      </FormField>
    );
  }

  return (
    <FormField id={id} name={field} label={label} description={description} error={error}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <SecretTextInput
          name={field}
          revealedType="url"
          value={typeof draft === 'string' ? draft : ''}
          disabled={disabled && !error}
          onChange={onInput}
          placeholder={placeholder}
          showLabel={t('settings.webhooks.show', 'Show URL')}
          hideLabel={t('settings.webhooks.hide', 'Hide URL')}
        />
        {stored ? (
          <Flex gap={2} wrap="wrap">
            <Button variant="tertiary" size="S" onClick={cancel}>
              {t('settings.webhooks.cancelReplace', 'Keep the saved URL')}
            </Button>
          </Flex>
        ) : null}
      </Flex>
    </FormField>
  );
};

export default WebhookUrlField;
