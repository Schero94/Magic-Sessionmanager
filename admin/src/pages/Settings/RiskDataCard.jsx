import { useRef } from 'react';
import { Badge, Box, Button, Flex, Typography } from '@strapi/design-system';
import { Download } from '@strapi/icons';
import { EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import { formatSessionDate } from '../../utils/sessionDates.mjs';
import { getRiskAvailability } from '../../utils/riskData.mjs';
import { refocusIfLost } from '../../utils/restoreDialogFocus.mjs';
import { RequiresNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const BUILD_DATE_OPTIONS = Object.freeze({ dateStyle: 'medium' });

/**
 * State of one risk database as a short label and badge colours. Text
 * badges use neutral800 on light backgrounds for contrast (DS skill).
 *
 * @param {object|undefined} entry `status.risk.anonymousIp` or `status.risk.asn`.
 * @returns {'ready'|'unusable'|'missing'} Database state.
 */
const databaseState = (entry) => {
  if (entry?.usable) return 'ready';
  if (entry?.exists) return 'unusable';
  return 'missing';
};

const BADGE_COLOURS = Object.freeze({
  ready: { backgroundColor: 'success100', textColor: 'success700' },
  unusable: { backgroundColor: 'warning200', textColor: 'neutral800' },
  missing: { backgroundColor: 'neutral150', textColor: 'neutral700' },
});

/**
 * One risk database: what it detects, its state and its download button.
 *
 * @param {{
 *   id: 'anonymous-ip'|'asn',
 *   title: string,
 *   shortName: string,
 *   description: string,
 *   entry: object|undefined,
 *   form: object,
 *   lookupOff: boolean,
 * }} props Database copy, status entry and the settings form.
 * @returns {import('react').ReactElement} Database cell.
 */
const RiskDatabase = ({ id, title, shortName, description, entry, form, lookupOff }) => {
  const { t, locale } = useSettingsTranslate();
  const buttonRef = useRef(null);
  const { geoIp } = form;
  const state = databaseState(entry);
  const stateLabels = {
    ready: t('settings.config.risk.database.ready', 'Ready'),
    unusable: t('settings.config.risk.database.unusable', 'Cannot be read'),
    missing: t('settings.config.risk.database.missing', 'Not downloaded'),
  };
  const built = formatSessionDate(entry?.metadata?.lastModified, locale, '', BUILD_DATE_OPTIONS);
  const pending = geoIp.riskUpdating === id;
  const disabled =
    lookupOff ||
    Boolean(geoIp.riskUpdating) ||
    geoIp.updating ||
    !geoIp.status?.hasCredentials ||
    entry?.fromEnvironment === true;

  // The button is disabled while its download runs, which drops keyboard
  // focus on <body>; afterwards it returns to the button.
  const download = async () => {
    await geoIp.updateDatabase(false, id);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => refocusIfLost(buttonRef.current, buttonRef.current))
    );
  };

  return (
    <Box
      padding={4}
      hasRadius
      borderColor="neutral200"
      background="neutral0"
      height="100%"
      data-risk-database={id}
    >
      <Flex direction="column" alignItems="stretch" gap={3} height="100%">
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2} wrap="wrap">
          <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
            {title}
          </Typography>
          <Badge {...BADGE_COLOURS[state]}>{stateLabels[state]}</Badge>
        </Flex>
        <ReadableText variant="pi" textColor="neutral600" tag="p">
          {description}
        </ReadableText>
        {state === 'unusable' ? (
          <ReadableText variant="pi" textColor="neutral800" tag="p">
            {t(
              'settings.config.risk.database.unusableHint',
              'The file exists but is not this MaxMind database. Download it again.'
            )}
          </ReadableText>
        ) : null}
        {built ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('settings.config.risk.database.built', 'Built {date}', { date: built })}
          </Typography>
        ) : null}
        {entry?.fromEnvironment ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t(
              'settings.config.risk.database.fromEnvironment',
              'Read from the path in an environment variable. Update that file outside Strapi.'
            )}
          </Typography>
        ) : null}
        <Box marginTop="auto">
          <Button
            ref={buttonRef}
            variant="secondary"
            startIcon={<Download />}
            loading={pending}
            disabled={disabled}
            onClick={download}
          >
            {state === 'missing'
              ? t('settings.config.risk.database.download', 'Download {name}', { name: shortName })
              : t('settings.config.risk.database.update', 'Update {name}', { name: shortName })}
          </Button>
        </Box>
      </Flex>
    </Box>
  );
};

/**
 * Card "Risk data" on Location data: the source of VPN, proxy, Tor and
 * hosting signals. Location providers have none, so "Reject suspicious
 * sign-ins", security scoring and the risk alerts depend on this card.
 * Downloads use the MaxMind credentials of the card above; the license key
 * never reaches the browser. Lookups stay on this server.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Risk data card.
 */
const RiskDataCard = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, geoIp } = form;
  const lookupOff = !settings.enableGeolocation;
  const risk = getRiskAvailability(geoIp.status);
  const sourceLabels = {
    'anonymous-ip': t('settings.config.risk.source.anonymousIp', 'Anonymous IP database'),
    'asn-heuristic': t('settings.config.risk.source.asn', 'ASN heuristic'),
  };

  return (
    <SectionCard
      id="risk-data"
      title={t('settings.config.risk.title', 'Risk data (VPN, proxy, Tor)')}
      subtitle={t(
        'settings.config.risk.intro',
        'Location data cannot tell VPNs, proxies or Tor apart. A local MaxMind database can; lookups stay on this server.'
      )}
      action={
        risk.state === 'unknown' ? null : (
          <Badge
            backgroundColor={risk.state === 'available' ? 'success100' : 'neutral150'}
            textColor={risk.state === 'available' ? 'success700' : 'neutral700'}
          >
            {risk.state === 'available'
              ? sourceLabels[risk.source]
              : t('settings.config.risk.source.none', 'Not set up')}
          </Badge>
        )
      }
    >
      {lookupOff ? (
        <RequiresNotice>
          {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
        </RequiresNotice>
      ) : null}

      <EqualGrid columns={2} stackBelow="medium" gap={4}>
        <RiskDatabase
          id="anonymous-ip"
          title={t('settings.config.risk.anonymousIp.title', 'GeoIP2 Anonymous IP')}
          shortName={t('settings.config.risk.anonymousIp.short', 'Anonymous IP')}
          description={t(
            'settings.config.risk.anonymousIp.hint',
            'Paid MaxMind database. Detects VPNs, public and residential proxies, Tor exit nodes and hosting providers. The download fails if your MaxMind account does not include it.'
          )}
          entry={geoIp.status?.risk?.anonymousIp}
          form={form}
          lookupOff={lookupOff}
        />
        <RiskDatabase
          id="asn"
          title={t('settings.config.risk.asn.title', 'GeoLite2 ASN (heuristic)')}
          shortName={t('settings.config.risk.asn.short', 'ASN')}
          description={t(
            'settings.config.risk.asn.hint',
            'Free MaxMind database. Flags sign-ins from large hosting and cloud networks such as AWS, Azure or Hetzner for alerts. A heuristic: it does not detect VPNs, proxies or Tor and never refuses a sign-in. Used only without the Anonymous IP database.'
          )}
          entry={geoIp.status?.risk?.asn}
          form={form}
          lookupOff={lookupOff}
        />
      </EqualGrid>

      {geoIp.status && !geoIp.status.hasCredentials ? (
        <RequiresNotice>
          {t(
            'settings.config.risk.credentials',
            'Downloads use the MaxMind credentials under Provider and database. Add them first.'
          )}
        </RequiresNotice>
      ) : null}
    </SectionCard>
  );
};

export default RiskDataCard;
