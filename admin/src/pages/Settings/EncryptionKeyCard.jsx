import { useState } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { Duplicate, Key } from '@strapi/icons';
import styled from 'styled-components';
import { SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import Alert from '../../components/PersistentAlert';
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
 * Generates a SESSION_ENCRYPTION_KEY for the .env file. The key is never sent
 * to the server, stays masked after generation until the admin reveals it,
 * and the copied .env line is quoted so dotenv keeps every character (SET-01,
 * SET-10).
 *
 * @param {{ copyValue: (value: string, message: string, scope: string) => Promise<void>, notify: Function }} props Clipboard and notification helpers.
 * @returns {import('react').ReactElement} Encryption key section.
 */
const EncryptionKeyCard = ({ copyValue, notify }) => {
  const { t } = useSettingsTranslate();
  const [encryptionKey, setEncryptionKey] = useState('');
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);

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
    <SectionCard
      title={t('settings.security.encryption.title', 'JWT Encryption Key Generator')}
      subtitle={t(
        'settings.security.encryption.description',
        'Generate a random 256-bit key (64 hexadecimal characters). The server uses it to encrypt tokens before storing them in the database.'
      )}
    >
      <Alert variant="default" closeLabel={t('settings.common.close', 'Close')} title={t('settings.security.encryption.important', 'Important')}>
        <ReadableText variant="omega" tag="span">
          {t('settings.security.encryption.envHint', 'Add this key to your .env file as SESSION_ENCRYPTION_KEY for production.')}
        </ReadableText>
      </Alert>

      <FormField
        id="session-encryption-key"
        name="sessionEncryptionKey"
        label={t('settings.security.encryption.label', 'Generated Encryption Key')}
        description={t('settings.security.encryption.fieldHint', 'The key stays masked until you choose to show it.')}
      >
        <SecretTextInput
          name="sessionEncryptionKey"
          value={encryptionKey}
          readOnly
          placeholder={t('settings.security.encryption.placeholder', "Click 'Generate Key' to create a secure key")}
          revealed={showEncryptionKey}
          onRevealedChange={setShowEncryptionKey}
          showLabel={t('settings.security.encryption.showKey', 'Show key')}
          hideLabel={t('settings.security.encryption.hideKey', 'Hide key')}
        />
      </FormField>

      <Flex gap={2} wrap="wrap">
        <Button variant="default" startIcon={<Key aria-hidden focusable={false} />} onClick={handleGenerate}>
          {t('settings.security.encryption.generate', 'Generate Key')}
        </Button>
        <Button
          variant="secondary"
          startIcon={<Duplicate aria-hidden focusable={false} />}
          onClick={() => copyValue(
            encryptionKey,
            t('notifications.success.keyCopied', 'Encryption key copied to clipboard!'),
            'settings.copyEncryptionKey'
          )}
          disabled={!encryptionKey}
        >
          {t('settings.security.encryption.copy', 'Copy to Clipboard')}
        </Button>
        <Button
          variant="secondary"
          startIcon={<Duplicate aria-hidden focusable={false} />}
          onClick={() => copyValue(
            formatEnvLine(ENCRYPTION_KEY_ENV_NAME, encryptionKey),
            t('notifications.success.envCopied', 'Copied as .env format!'),
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
            <Typography variant="sigma" textColor="neutral600" tag="p">
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
    </SectionCard>
  );
};

export default EncryptionKeyCard;
