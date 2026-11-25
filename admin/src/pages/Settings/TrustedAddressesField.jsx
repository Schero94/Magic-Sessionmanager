import { useState } from 'react';
import { Textarea } from '@strapi/design-system';
import FormField from '../../components/FormField';
import { formatTrustedAddressText, parseTrustedAddressText } from '../../utils/policyForm.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Trusted addresses of the lockout: one IP address or CIDR range per line.
 * The text the admin types is kept as typed (blank lines, a trailing line
 * break); the draft receives the parsed list. It is re-read from the draft
 * when the draft is replaced (Discard, Save).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm>,
 *   disabled?: boolean }} props Settings form; disabled for roles without "Change protected settings".
 * @returns {import('react').ReactElement} Field.
 */
const TrustedAddressesField = ({ form, disabled = false }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors, draftVersion } = form;
  const [text, setText] = useState(() =>
    formatTrustedAddressText(settings.lockoutTrustedAddresses)
  );
  const [version, setVersion] = useState(draftVersion);

  // Adjusting state during render when the draft was replaced.
  if (version !== draftVersion) {
    setVersion(draftVersion);
    setText(formatTrustedAddressText(settings.lockoutTrustedAddresses));
  }

  return (
    <FormField
      id="lockout-trusted-addresses"
      name="lockoutTrustedAddresses"
      label={t('settings.config.failed.trusted.label', 'Trusted addresses')}
      description={t(
        'settings.config.failed.trusted.hint',
        'One IP address or CIDR range per line, for example 192.0.2.10 or 192.0.2.0/24. These addresses are never locked by IP; accounts can still be locked. Use it for an office network or a server that signs in for many users.'
      )}
      error={tError(errors.lockoutTrustedAddresses)}
    >
      <Textarea
        value={text}
        placeholder="192.0.2.0/24"
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          handleChange('lockoutTrustedAddresses', parseTrustedAddressText(event.target.value));
        }}
      />
    </FormField>
  );
};

export default TrustedAddressesField;
