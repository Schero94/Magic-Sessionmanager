import { Alert } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * A condition-driven Strapi alert which remains until its underlying state changes.
 * Design System 2.2.4 renders a close button even without an onClose handler.
 */
const PersistentAlert = styled(Alert)`
  & > button:last-child {
    display: none;
  }
`;

export default PersistentAlert;
