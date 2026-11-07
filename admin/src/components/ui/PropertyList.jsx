import { Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { isMissingValue } from '../../utils/missingValue.mjs';
import { MissingValue } from './MissingValue';

const List = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[4]};
  column-gap: ${({ theme, $columnGap }) => theme.spaces[$columnGap ?? 4]};
  margin: 0;
  min-width: 0;

  ${({ theme }) => theme.breakpoints.small} {
    grid-template-columns: repeat(${({ $columns }) => $columns}, minmax(0, 1fr));
  }

  & > div {
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spaces[1]};
    min-width: 0;
  }

  & > div[data-span='full'] {
    grid-column: 1 / -1;
  }

  dt,
  dd {
    margin: 0;
    min-width: 0;
  }

  dd {
    overflow-wrap: break-word;
  }

  dd[data-wrap='anywhere'] {
    overflow-wrap: anywhere;
  }
`;

/**
 * Label/value pairs as a description list. Two equal columns from the DS
 * small breakpoint, one column below it. Only identifiers and e-mail
 * addresses may break anywhere; prose wraps at word boundaries.
 *
 * @param {object} props
 * @param {Array<{
 *   id: string,
 *   label: import('react').ReactNode,
 *   value?: unknown,
 *   render?: import('react').ReactNode,
 *   kind?: 'text'|'id'|'email',
 *   fullWidth?: boolean,
 * }>} props.items Properties. `render` replaces the plain value; missing values show "—".
 * @param {1|2} [props.columns] Columns from the small breakpoint.
 * @param {string} [props.label] Accessible name for the list.
 * @param {number} [props.columnGap] DS spacing token between the columns
 *   (4 by default); 6 lines the columns up with a form grid below.
 * @returns {import('react').ReactElement} Description list.
 */
const PropertyList = ({ items = [], columns = 2, label, columnGap }) => (
  <List
    $columns={columns === 1 ? 1 : 2}
    $columnGap={columnGap}
    aria-label={label}
    data-property-list=""
  >
    {items.filter(Boolean).map((item) => {
      const wrapsAnywhere = item.kind === 'id' || item.kind === 'email';
      const missing = item.render === undefined && isMissingValue(item.value);
      return (
        <div key={item.id} data-span={item.fullWidth ? 'full' : undefined}>
          <dt>
            <Typography variant="sigma" textColor="neutral600">
              {item.label}
            </Typography>
          </dt>
          <dd data-wrap={wrapsAnywhere ? 'anywhere' : undefined}>
            {missing ? (
              <MissingValue variant="omega" />
            ) : (
              (item.render ?? (
                <Typography variant="omega" textColor="neutral800">
                  {String(item.value)}
                </Typography>
              ))
            )}
          </dd>
        </div>
      );
    })}
  </List>
);

export default PropertyList;
