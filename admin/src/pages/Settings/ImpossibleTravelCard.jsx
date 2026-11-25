import {
  Alert as DesignSystemAlert,
  Flex,
  NumberInput,
  Radio,
  Typography,
} from '@strapi/design-system';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { SIGNALS_RANGES } from '../../utils/signalsForm.mjs';
import { fieldHasError } from './settingsTabs.mjs';
import { AdvancedSection, ProtectedNotice, RequiresGeolocation } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * "Impossible travel" (Login protection tab, 4.17): flags a sign-in that is
 * farther from the user's previous sign-in than anyone could travel in the
 * time between. Off by default; alert only unless "Require a new sign-in"
 * is chosen. A protected setting: read-only without Change protected
 * settings.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Card.
 */
const ImpossibleTravelCard = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors } = form;
  const lookupOff = !settings.enableGeolocation;
  const enabled = settings.impossibleTravelEnabled === true;
  const locked = form.canChangeProtected === false;

  return (
    <SectionCard
      id="impossible-travel"
      title={t('settings.config.travel.title', 'Impossible travel')}
      subtitle={t(
        'settings.config.travel.intro',
        "Flags a sign-in that is farther from the user's previous sign-in than anyone could travel in the time between."
      )}
    >
      {lookupOff ? <RequiresGeolocation /> : null}
      {locked ? <ProtectedNotice /> : null}
      <SettingsToggleRow
        id="impossible-travel-enabled"
        title={t('settings.config.travel.enable.label', 'Detect impossible travel')}
        description={t(
          'settings.config.travel.enable.hint',
          'Needs a location database with cities (coordinates). While this is on, the location of each sign-in is stored rounded to about 11 km. VPNs and mobile networks can cause false alarms.'
        )}
        checked={enabled}
        disabled={locked || (lookupOff && !enabled)}
        onChange={(checked) => handleChange('impossibleTravelEnabled', checked)}
      />
      {enabled ? (
        <Flex direction="column" alignItems="stretch" gap={2} data-travel-action="">
          <Typography
            id="impossible-travel-action-label"
            variant="pi"
            fontWeight="bold"
            tag="div"
            textColor="neutral800"
          >
            {t('settings.config.travel.action.label', 'Then')}
          </Typography>
          <Radio.Group
            aria-labelledby="impossible-travel-action-label"
            value={settings.impossibleTravelAction || 'alert'}
            disabled={locked}
            onValueChange={(value) => handleChange('impossibleTravelAction', value)}
          >
            <Radio.Item value="alert">
              {t('settings.config.travel.action.alert', 'Record it and alert')}
            </Radio.Item>
            <Radio.Item value="reauthenticate">
              {t('settings.config.travel.action.reauthenticate', 'Require a new sign-in')}
            </Radio.Item>
          </Radio.Group>
          {settings.impossibleTravelAction === 'reauthenticate' ? (
            <DesignSystemAlert
              variant="warning"
              closeLabel={t('common.close', 'Close')}
              title={t('settings.config.travel.reauth.title', 'Every session of the user ends')}
            >
              {t(
                'settings.config.travel.reauth.body',
                'The flagged sign-in gets 401 with the code REAUTHENTICATION_REQUIRED and all sessions of the user end. Signing in again from the new place works.'
              )}
            </DesignSystemAlert>
          ) : null}
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t(
              'settings.config.travel.alerts',
              'The email to the user and the webhook event are chosen under Alerts.'
            )}
          </ReadableText>
        </Flex>
      ) : null}
      <AdvancedSection
        hasError={
          fieldHasError(errors, 'impossibleTravelSpeedKmh') ||
          fieldHasError(errors, 'impossibleTravelMinDistanceKm')
        }
        disabled={!enabled}
      >
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="impossible-travel-speed"
            name="impossibleTravelSpeedKmh"
            label={t('settings.config.travel.speed.label', 'Faster than')}
            description={t(
              'settings.config.travel.speed.hint',
              'From 100 to 5000. A plane flies at about 900 km/h.'
            )}
            suffix={t('settings.config.travel.speed.suffix', 'km/h')}
            error={tError(errors.impossibleTravelSpeedKmh)}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.impossibleTravelSpeedKmh}
              disabled={locked}
              onValueChange={(value) => handleChange('impossibleTravelSpeedKmh', value ?? '')}
              min={SIGNALS_RANGES.impossibleTravelSpeedKmh.min}
              max={SIGNALS_RANGES.impossibleTravelSpeedKmh.max}
              step={50}
            />
          </FormField>
          <FormField
            id="impossible-travel-distance"
            name="impossibleTravelMinDistanceKm"
            label={t('settings.config.travel.distance.label', 'Over at least')}
            description={t(
              'settings.config.travel.distance.hint',
              'Shorter distances are never flagged (location data is not precise).'
            )}
            suffix={t('settings.config.travel.distance.suffix', 'km')}
            error={tError(errors.impossibleTravelMinDistanceKm)}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.impossibleTravelMinDistanceKm}
              disabled={locked}
              onValueChange={(value) => handleChange('impossibleTravelMinDistanceKm', value ?? '')}
              min={SIGNALS_RANGES.impossibleTravelMinDistanceKm.min}
              max={SIGNALS_RANGES.impossibleTravelMinDistanceKm.max}
              step={50}
            />
          </FormField>
        </EqualGrid>
      </AdvancedSection>
    </SectionCard>
  );
};

export default ImpossibleTravelCard;
