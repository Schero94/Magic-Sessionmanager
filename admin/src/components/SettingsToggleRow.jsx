import { Box, Switch, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { ReadableParagraphs } from './ReadableText';

/**
 * Copy on the left, switch on the right. The copy column may shrink so long
 * translations wrap instead of pushing the switch out of the card.
 */
const SettingsRowCard = styled(Box)`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: ${({ theme }) => theme.spaces[4]};
  width: 100%;
  min-width: 0;

  /* The DS Switch is 24 px tall, below the 32 px touch target on phones.
     Transparent top and bottom borders grow its hit area to 32 px; the track
     is painted only inside them (background-clip) with the same pill radius,
     and negative margins keep the row height and the switch position. */
  & [role='switch'] {
    height: ${({ theme }) => theme.spaces[7]};
    border-block: ${({ theme }) => theme.spaces[1]} solid transparent;
    border-radius: 1.2rem / 1.6rem;
    background-clip: padding-box;
    margin-block: -${({ theme }) => theme.spaces[1]};
  }
`;

const SettingsCopy = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${({ theme }) => theme.spaces[1]};
  width: 100%;
  min-width: 0;
  overflow-wrap: break-word;
`;

/**
 * Shows one setting with its explanation beside Strapi's horizontal Switch.
 * The title is a label, not a heading: the Switch takes its accessible name
 * from it, and section headings stay h2/h3 (SET-06). The DS Switch keeps its
 * own colours and focus ring (SET-17).
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   description?: string,
 *   checked: boolean,
 *   onChange: (checked: boolean) => void,
 *   disabled?: boolean,
 *   children?: import('react').ReactNode,
 * }} props Setting state, copy, switch callback, disabled state (a
 *   dependent setting whose requirement is off) and optional extra content
 *   (for example a privacy note or a "Requires …" link) rendered under the
 *   description.
 * @returns {import('react').ReactElement} An accessible responsive setting row.
 */
const SettingsToggleRow = ({
  id,
  title,
  description,
  checked,
  onChange,
  disabled = false,
  children,
}) => {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <SettingsRowCard
      padding={4}
      background="neutral0"
      borderColor="neutral150"
      hasRadius
      data-settings-toggle-row=""
    >
      <SettingsCopy>
        <Typography id={titleId} variant="omega" fontWeight="bold" textColor={disabled ? 'neutral600' : 'neutral800'} tag="p">
          {title}
        </Typography>
        {description ? (
          <ReadableParagraphs
            id={descriptionId}
            text={description}
            variant="pi"
            textColor="neutral600"
            tag="p"
          />
        ) : null}
        {children}
      </SettingsCopy>

      <Switch
        id={id}
        aria-label={title}
        aria-describedby={description ? descriptionId : undefined}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        visibleLabels={false}
      />
    </SettingsRowCard>
  );
};

export default SettingsToggleRow;
