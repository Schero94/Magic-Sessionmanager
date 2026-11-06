import styled from 'styled-components';

/**
 * Full-width buttons stacked in a narrow side panel. The Content Manager
 * sidebar is only about 12rem wide on small desktops, so longer labels (and
 * most translations) wrap. The buttons then grow from the 3.2rem size S
 * height instead of squeezing two lines into it, and all rows share the
 * tallest button's height, so the buttons stay equal.
 */
const ActionStack = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: 1fr;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;

  & > button {
    height: auto;
    min-height: 3.2rem;
    padding-block: ${({ theme }) => theme.spaces[1]};
  }

  & > button > span {
    text-align: center;
  }
`;

export default ActionStack;
