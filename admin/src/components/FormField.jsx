import { Field } from '@strapi/design-system';
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
`;

const FieldHint = styled.div`
  width: 100%;
  min-width: 0;
  max-width: 72ch;
  margin-top: 8px;

  & > p {
    line-height: 1.6;
    text-wrap: pretty;
  }
`;

/**
 * Renders a Strapi Design System field with a visible label, an associated
 * control, and concise helper text. The control is constrained to its grid
 * column so long select values cannot widen the page on small screens.
 *
 * @param {{ id: string, name?: string, label: import('react').ReactNode, description: import('react').ReactNode, children: import('react').ReactNode }} props Field identity, copy, and control.
 * @returns {import('react').ReactElement} A responsive, accessible form field.
 */
const FormField = ({ id, name = id, label, description, children }) => {
  return (
    <FieldFrame>
      <Field.Root id={id} name={name} hint={description}>
        <Field.Label>{label}</Field.Label>
        <FieldControl>{children}</FieldControl>
        {description ? <FieldHint><Field.Hint /></FieldHint> : null}
      </Field.Root>
    </FieldFrame>
  );
};

export default FormField;
