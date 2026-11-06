import { useState } from 'react';
import { Field, TextInput } from '@strapi/design-system';
import { Eye, EyeStriked } from '@strapi/icons';
import styled from 'styled-components';

/**
 * The DS end action is a bare 16 px icon button. The hit area grows to
 * 32 px (spacing token 7 is 32 px) while negative margins keep the icon and
 * the input height where the DS puts them, so the toggle meets the 24 px
 * desktop and 32 px touch target minimum. The icon uses the theme's
 * neutral text colour, so it stays visible in dark mode.
 */
const RevealToggle = styled(Field.Action)`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: ${({ theme }) => theme.spaces[7]};
  min-height: ${({ theme }) => theme.spaces[7]};
  margin: -${({ theme }) => theme.spaces[2]};
  border-radius: ${({ theme }) => theme.borderRadius};
  /* The DS action inherits black; the icon follows the theme instead. */
  color: ${({ theme }) => theme.colors.neutral600};

  &:hover {
    color: ${({ theme }) => theme.colors.neutral800};
  }
`;

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
        <RevealToggle
          label={revealed ? hideLabel : showLabel}
          aria-pressed={revealed}
          onClick={toggle}
        >
          {revealed ? <EyeStriked aria-hidden focusable={false} /> : <Eye aria-hidden focusable={false} />}
        </RevealToggle>
      }
    />
  );
};

export default SecretTextInput;
