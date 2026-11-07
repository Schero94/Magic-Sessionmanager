import { Field, Typography } from '@strapi/design-system';
import styled from 'styled-components';

const FieldFrame = styled.div`
  width: 100%;
  min-width: 0;

  & > div {
    width: 100%;
    min-width: 0;
  }
`;

const FieldControl = styled.div`
  width: 100%;
  min-width: 0;

  & > * {
    width: 100% !important;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  [role='combobox'] {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    justify-content: space-between;
  }

  input,
  textarea {
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  /* A placeholder longer than a phone-width input ends in an ellipsis
     instead of being cut mid-word. */
  input {
    text-overflow: ellipsis;
  }

  /* The DS Combobox input is only 24 px tall inside its 40 px frame. It
     grows to the 32 px touch target; negative margins keep the frame. */
  input[role='combobox'] {
    min-height: ${({ theme }) => theme.spaces[7]};
    margin-block: -${({ theme }) => theme.spaces[1]};
  }
`;

/** Control with a unit after it ("attempts", "failed sign-ins"); the unit never shrinks the input below its column. */
const SuffixRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: ${({ theme }) => theme.spaces[2]};
  width: 100%;
  min-width: 0;
`;

const FieldHint = styled.div`
  width: 100%;
  min-width: 0;
  max-width: 72ch;
  margin-top: ${({ theme }) => theme.spaces[2]};

  & > p {
    line-height: 1.6;
    text-wrap: pretty;
  }
`;

/**
 * Renders a Strapi Design System field with a visible label, an associated
 * control, concise helper text and an inline validation error. The control
 * is constrained to its grid column so long select values cannot widen the
 * page on small screens.
 *
 * Field.Root wires `aria-describedby` and `aria-invalid` for DS inputs: the
 * control points at `${id}-error` while an error is shown, else `${id}-hint`.
 * Field.Hint hides itself while an error is shown, so only one message is
 * announced (SET-03).
 *
 * @param {{
 *   id: string,
 *   name?: string,
 *   label: import('react').ReactNode,
 *   description?: import('react').ReactNode,
 *   error?: string,
 *   required?: boolean,
 *   suffix?: import('react').ReactNode,
 *   action?: import('react').ReactNode,
 *   children: import('react').ReactNode,
 * }} props Field identity, copy, validation state, optional unit suffix
 *   (IA F: units are input suffixes), optional button on the control's row
 *   (for example "Add") and control.
 * @returns {import('react').ReactElement} A responsive, accessible form field.
 */
const FormField = ({
  id,
  name = id,
  label,
  description,
  error,
  required = false,
  suffix,
  action,
  children,
}) => {
  const control = <FieldControl>{children}</FieldControl>;
  return (
    <FieldFrame>
      <Field.Root
        id={id}
        name={name}
        hint={description}
        error={error || undefined}
        required={required}
      >
        <Field.Label>{label}</Field.Label>
        {suffix || action ? (
          <SuffixRow>
            {control}
            {suffix ? (
              <Typography variant="omega" textColor="neutral600" id={`${id}-suffix`}>
                {suffix}
              </Typography>
            ) : (
              action
            )}
          </SuffixRow>
        ) : (
          control
        )}
        {description || error ? (
          <FieldHint>
            <Field.Hint />
            <Field.Error />
          </FieldHint>
        ) : null}
      </Field.Root>
    </FieldFrame>
  );
};

export default FormField;
