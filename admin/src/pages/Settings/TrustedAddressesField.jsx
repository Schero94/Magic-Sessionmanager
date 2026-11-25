import { useState } from 'react';
import { Textarea } from '@strapi/design-system';
import FormField from '../../components/FormField';
import { formatTrustedAddressText, parseTrustedAddressText } from '../../utils/policyForm.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * A list of IP addresses or CIDR ranges, one per line: the trusted addresses
 * of the lockout (default) or, with `field="trustedProxies"`, the proxies
 * that may name the client address. The text the admin types is kept as
 * typed (blank lines, a trailing line break); the draft receives the parsed
 * list. It is re-read from the draft when the draft is replaced (Discard,
 * Save).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm>,
 *   disabled?: boolean, field?: 'lockoutTrustedAddresses'|'trustedProxies', id?: string,
 *   label?: string, description?: string, placeholder?: string }} props Settings form;
 *   disabled for roles without "Change protected settings"; the other props name another
 *   list field and its texts.
 * @returns {import('react').ReactElement} Field.
 */
const TrustedAddressesField = ({
  form,
  disabled = false,
  field = 'lockoutTrustedAddresses',
  id = 'lockout-trusted-addresses',
  label,
  description,
  placeholder = '192.0.2.0/24',
}) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors, draftVersion } = form;
  const [text, setText] = useState(() => formatTrustedAddressText(settings[field]));
  const [version, setVersion] = useState(draftVersion);

  // Adjusting state during render when the draft was replaced.
  if (version !== draftVersion) {
    setVersion(draftVersion);
    setText(formatTrustedAddressText(settings[field]));
  }

  return (
    <FormField
      id={id}
      name={field}
      label={label ?? t('settings.config.failed.trusted.label', 'Trusted addresses')}
      description={
        description ??
        t(
          'settings.config.failed.trusted.hint',
          'One IP address or CIDR range per line, for example 192.0.2.10 or 192.0.2.0/24. These addresses are never locked by IP; accounts can still be locked. Use it for an office network or a server that signs in for many users.'
        )
      }
      error={tError(errors[field])}
    >
      <Textarea
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          handleChange(field, parseTrustedAddressText(event.target.value));
        }}
      />
    </FormField>
  );
};

export default TrustedAddressesField;
