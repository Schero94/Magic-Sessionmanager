import { Box, Switch, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { ReadableParagraphs } from './ReadableText';

const SettingsRowCard = styled(Box)`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
  width: 100%;
  min-width: 0;
  padding: 16px;
  background: ${(props) => props.theme.colors.neutral0};
  border: 1px solid ${(props) => props.theme.colors.neutral150};
  border-radius: 4px;

  @media (max-width: 519px) {
    gap: 8px;
    padding: 12px;
  }
`;

const SettingsCopy = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
`;

const SwitchControl = styled.div`
  flex: 0 0 auto;
  min-width: 0;
  padding-top: 2px;
`;

const SettingsSwitch = styled(Switch)`
  &[data-state='unchecked'] {
    background-color: ${(props) => props.theme.colors.neutral600};
  }

  &[data-state='checked'] {
    background-color: ${(props) => props.theme.colors.primary600};
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.colors.primary600};
    outline-offset: 3px;
  }
`;

/**
 * Shows one setting with its explanation beside Strapi's horizontal Switch.
 * The row keeps the switch accessible while allowing translated copy to wrap.
 *
 * @param {{ id: string, title: string, description: string, checked: boolean, onChange: (checked: boolean) => void }} props Setting state, copy, and switch callback.
 * @returns {import('react').ReactElement} An accessible responsive setting row.
 */
const SettingsToggleRow = ({
  id,
  title,
  description,
  checked,
  onChange,
}) => {
  const descriptionId = `${id}-description`;

  return (
    <SettingsRowCard data-settings-toggle-row="">
      <SettingsCopy>
        <Typography
          variant="delta"
          fontWeight="semiBold"
          textColor="neutral800"
          tag="h3"
        >
          {title}
        </Typography>
        <ReadableParagraphs
          id={descriptionId}
          text={description}
          variant="pi"
          textColor="neutral600"
          tag="p"
        />
      </SettingsCopy>

      <SwitchControl>
        <SettingsSwitch
          aria-label={title}
          aria-describedby={description ? descriptionId : undefined}
          checked={checked}
          onCheckedChange={onChange}
          visibleLabels={false}
        />
      </SwitchControl>
    </SettingsRowCard>
  );
};

export default SettingsToggleRow;
