import styled from 'styled-components';
import { Link } from '@strapi/design-system';

/**
 * DS text link with a 3.2rem hit area. The DS link is only as tall as its
 * text line (2rem), which is below the 2.4rem desktop and 3.2rem touch target
 * minimum; this keeps the look of a link and the height of a size S button.
 * In a stretching column it keeps its text width, so the focus ring hugs it.
 */
const TargetLink = styled(Link)`
  min-height: 3.2rem;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
`;

export default TargetLink;
