import { useState } from 'react';
import { Field, TextInput } from '@strapi/design-system';
import { Eye, EyeStriked } from '@strapi/icons';

/**
 * Single-line DS TextInput for secrets (webhook URLs, keys). The value is
 * masked until the admin reveals it with the end action, which reports its
 * state through aria-pressed (SET-10, SET-15). Use inside FormField so the
 * Field context provides id, label, hint and error.
 *
 * @param {{
 *   value: string,
 *   onChange?: (value: string) => void,
 *   showLabel: string,
 *   hideLabel: string,
 *   revealedType?: 'text'|'url',
 *   readOnly?: boolean,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   name?: string,
 *   revealed?: boolean,
 *   onRevealedChange?: (revealed: boolean) => void,
 * }} props Value, translated toggle labels and input options. Pass
 *   `revealed`/`onRevealedChange` to control the reveal state from outside.
 * @returns {import('react').ReactElement} Masked input with a reveal toggle.
 */
const SecretTextInput = ({
  value,
  onChange,
  showLabel,
  hideLabel,
  revealedType = 'text',
  readOnly = false,
  disabled = false,
  placeholder,
  name,
  revealed: controlledRevealed,
  onRevealedChange,
}) => {
  const [localRevealed, setLocalRevealed] = useState(false);
  const revealed = controlledRevealed ?? localRevealed;
  const toggle = () => {
    const next = !revealed;
    if (controlledRevealed === undefined) setLocalRevealed(next);
    onRevealedChange?.(next);
  };

  return (
    <TextInput
      name={name}
      type={revealed ? revealedType : 'password'}
      value={value}
      readOnly={readOnly}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange?.(event.target.value)}
      endAction={
        <Field.Action
          label={revealed ? hideLabel : showLabel}
          aria-pressed={revealed}
          onClick={toggle}
        >
          {revealed ? <EyeStriked aria-hidden focusable={false} /> : <Eye aria-hidden focusable={false} />}
        </Field.Action>
      }
    />
  );
};

export default SecretTextInput;
