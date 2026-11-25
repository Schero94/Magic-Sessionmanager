import { Checkbox, Flex } from '@strapi/design-system';
import styled from 'styled-components';
import { SectionCard } from '../../components/ui';
import { WEBHOOK_EVENT_OPTIONS } from '../../utils/signalsForm.mjs';
import { ProtectedNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/** Two columns from 520 px card width, one below. */
const EventGrid = styled.div`
  container-type: inline-size;
  min-width: 0;

  & > ul {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: ${({ theme }) => theme.spaces[3]};
    align-items: center;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* Every item starts on the row line (an inherited li + li margin
     offset the second column). */
  & > ul > li {
    margin: 0;
  }

  @container (min-width: 520px) {
    & > ul {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;

/**
 * "Events to send" (Alerts tab): one selection for Discord, Slack and the
 * signed webhook (4.17). "Every successful sign-in" is off for new
 * installations; installations upgraded from 4.16 keep it on. A protected
 * setting: read-only without Change protected settings.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Card.
 */
const WebhookEventsCard = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange } = form;
  const locked = form.canChangeProtected === false;
  const selected = Array.isArray(settings.webhookEvents) ? settings.webhookEvents : [];

  const toggle = (event, checked) => {
    const next = checked
      ? [...new Set([...selected, event])]
      : selected.filter((value) => value !== event);
    handleChange(
      'webhookEvents',
      WEBHOOK_EVENT_OPTIONS.map(([value]) => value).filter((value) => next.includes(value))
    );
  };

  return (
    <SectionCard
      id="webhook-events"
      title={t('settings.webhookEvents.title', 'Events to send')}
      subtitle={t(
        'settings.webhookEvents.intro',
        'Applies to Discord, Slack and the signed webhook. Every successful sign-in is usually too much; choose the events your team acts on.'
      )}
    >
      {locked ? <ProtectedNotice /> : null}
      <EventGrid>
        <ul aria-label={t('settings.webhookEvents.title', 'Events to send')}>
          {WEBHOOK_EVENT_OPTIONS.map(([event, id, label]) => (
            <li key={event}>
              <Flex alignItems="center" minWidth={0}>
                <Checkbox
                  checked={selected.includes(event)}
                  disabled={locked}
                  onCheckedChange={(checked) => toggle(event, checked === true)}
                  data-webhook-event={event}
                >
                  {t(id, label)}
                </Checkbox>
              </Flex>
            </li>
          ))}
        </ul>
      </EventGrid>
    </SectionCard>
  );
};

export default WebhookEventsCard;
