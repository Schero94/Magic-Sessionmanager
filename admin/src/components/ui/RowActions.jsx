import { Flex } from '@strapi/design-system';

/**
 * The action buttons at the end of a table row, spaced the way Strapi's own
 * list views space them: separate actions sit in a Flex with a 4 px gap
 * (`gap={1}`, as in Settings > Webhooks), right-aligned in the last cell.
 *
 * The Design System `IconButtonGroup` is not used here: it joins its buttons
 * into one segmented control with shared borders, which suits a toolbar of
 * related toggles, not independent actions such as "View" and "Sign out".
 *
 * Extra props (`onKeyDown`, `onClick`, data attributes) go to the Flex.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children The row's IconButtons.
 * @returns {import('react').ReactElement} Spaced, right-aligned action row.
 */
const RowActions = ({ children, ...props }) => (
  <Flex justifyContent="flex-end" alignItems="center" gap={1} data-row-actions="" {...props}>
    {children}
  </Flex>
);

export default RowActions;
