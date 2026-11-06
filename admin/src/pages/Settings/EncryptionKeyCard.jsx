import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { Duplicate, Key } from '@strapi/icons';
import styled from 'styled-components';
import FormField from '../../components/FormField';
import { maskSensitiveValue } from '../../utils/maskSensitiveValue.mjs';
import { ENCRYPTION_KEY_ENV_NAME, formatEnvLine, generateEncryptionKey } from '../../utils/encryptionKey.mjs';
import { logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import SecretTextInput from './SecretTextInput';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const EnvPreview = styled(Box)`
  overflow-wrap: anywhere;

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: ${({ theme }) => theme.colors.neutral800};
  }
`;

/**
 * Generated key and its reveal state. Kept by the parent tab, so the key
 * survives collapsing the Advanced accordion that hosts the generator.
 *
 * @returns {{
 *   encryptionKey: string,
 *   setEncryptionKey: (value: string) => void,
 *   showEncryptionKey: boolean,
 *   setShowEncryptionKey: (value: boolean) => void,
 * }} Draft state.
 */
export const useEncryptionKeyDraft = () => {
  const [encryptionKey, setEncryptionKey] = useState('');
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  return { encryptionKey, setEncryptionKey, showEncryptionKey, setShowEncryptionKey };
};

/**
 * Token encryption key generator (IA F 1.2 #3, E.2). Client-side only:
 * nothing is saved, the key stays masked until the admin reveals it, and the
 * copied .env line is quoted so dotenv keeps every character (SET-01, SET-10).
 *
 * @param {{
 *   draft: ReturnType<typeof useEncryptionKeyDraft>,
 *   copyValue: (value: string, message: string, scope: string) => Promise<void>,
 *   notify: Function,
 * }} props Key state, clipboard and notification helpers.
 * @returns {import('react').ReactElement} Generator field and actions.
 */
const EncryptionKeyCard = ({ draft, copyValue, notify }) => {
  const { t } = useSettingsTranslate();
  const { encryptionKey, setEncryptionKey, showEncryptionKey, setShowEncryptionKey } = draft;

  const handleGenerate = () => {
    try {
      setEncryptionKey(generateEncryptionKey());
      setShowEncryptionKey(false);
      notify({
        type: 'success',
        message: t('notifications.success.keyGenerated', 'Encryption key generated. It stays hidden until you show it.'),
      });
    } catch (error) {
      logSafeAdminError('settings.generateEncryptionKey', error);
      notify({
        type: 'danger',
        message: t('notifications.error.keyGenerate', 'This browser cannot generate a secure key.'),
      });
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4} data-encryption-key-tool="">
      <FormField
        id="session-encryption-key"
        name="sessionEncryptionKey"
        label={t('settings.config.token.key.label', 'Token encryption key')}
        description={t(
          'settings.config.token.key.hint',
          "Session Manager encrypts stored tokens with this environment variable. Not needed in Strapi's refresh-token mode. Nothing is saved here."
        )}
      >
        <SecretTextInput
          name="sessionEncryptionKey"
          value={encryptionKey}
          readOnly
          placeholder={t('settings.config.token.key.placeholder', 'Select Generate key to create a key.')}
          revealed={showEncryptionKey}
          onRevealedChange={setShowEncryptionKey}
          showLabel={t('settings.security.encryption.showKey', 'Show key')}
          hideLabel={t('settings.security.encryption.hideKey', 'Hide key')}
        />
      </FormField>

      <Flex gap={2} wrap="wrap">
        <Button variant="secondary" startIcon={<Key aria-hidden focusable={false} />} onClick={handleGenerate}>
          {t('settings.config.token.key.generate', 'Generate key')}
        </Button>
        <Button
          variant="secondary"
          startIcon={<Duplicate aria-hidden focusable={false} />}
          onClick={() => copyValue(
            formatEnvLine(ENCRYPTION_KEY_ENV_NAME, encryptionKey),
            t('settings.config.token.key.copied', 'Copied. Add it to your server environment and restart Strapi.'),
            'settings.copyEncryptionKeyEnv'
          )}
          disabled={!encryptionKey}
        >
          {t('settings.security.encryption.copyEnv', 'Copy for .env')}
        </Button>
      </Flex>

      {encryptionKey ? (
        <EnvPreview padding={4} background="neutral100" borderColor="neutral200" hasRadius>
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="sigma" textColor="neutral600" tag="div">
              {t('settings.security.encryption.envLabel', 'Add to .env file:')}
            </Typography>
            <Typography variant="omega" tag="p">
              <code data-env-preview="">
                {formatEnvLine(ENCRYPTION_KEY_ENV_NAME, showEncryptionKey ? encryptionKey : maskSensitiveValue(encryptionKey))}
              </code>
            </Typography>
          </Flex>
        </EnvPreview>
      ) : null}
    </Flex>
  );
};

export default EncryptionKeyCard;
