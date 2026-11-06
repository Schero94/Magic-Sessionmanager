import { Alert } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * A condition-driven Strapi alert which remains until its underlying state changes.
 * Design System 2.2.4 renders a close button even without an onClose handler.
 *
 * The DS Alert already wraps its body in an omega paragraph next to the title.
 * Readable-text helpers passed as the body must therefore render inline with
 * the alert's own size, colour and leading, so the body lines up with the
 * title instead of starting lower and smaller (F7).
 */
const PersistentAlert = styled(Alert)`
  & > button:last-child {
    display: none;
  }

  & [role='status'] > p,
  & [role='alert'] > p {
    min-width: 0;
  }

  & [role='status'] > p > *,
  & [role='alert'] > p > * {
    display: inline;
    max-width: none;
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
    line-height: inherit;
    color: inherit;
  }
`;

export default PersistentAlert;
