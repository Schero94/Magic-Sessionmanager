import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import {
  Box,
  Button,
  DesignSystemProvider,
  Flex,
  Loader,
  Typography,
  VisuallyHidden,
  darkTheme,
  lightTheme,
} from '@strapi/design-system';
import { useSettingsTranslate } from '../../pages/Settings/hooks/useSettingsTranslate';
import { formatClock, secondsUntil } from '../../utils/impersonation.mjs';
import { readTabState } from '../../utils/adminImpersonationTab.mjs';
import pluginId from '../../pluginId';
import { useBreakpoint } from '../../utils/useBreakpoint';

/** Height of the banner; the admin panel moves down by this much. */
export const BANNER_HEIGHT = '4.8rem';

/** How often the tab asks the server whether the impersonation still runs. */
const POLL_MS = 30 * 1000;

/**
 * Current tab state, updated on the plugin's change event and on storage
 * changes of this tab.
 *
 * @returns {ReturnType<typeof readTabState>}
 */
function useTabState() {
  const [state, setState] = useState(() => readTabState(window));
  useEffect(() => {
    const update = () => setState(readTabState(window));
    window.addEventListener('msm-impersonation-change', update);
    return () => window.removeEventListener('msm-impersonation-change', update);
  }, []);
  return state;
}

/**
 * Seconds left until an ISO time, ticking every second.
 *
 * @param {string|undefined} iso End time.
 * @returns {number}
 */
function useCountdown(iso) {
  const [seconds, setSeconds] = useState(() => secondsUntil(iso));
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(secondsUntil(iso)), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return seconds;
}

/**
 * The persistent bar of an active impersonation: who, read-only or not,
 * time left, End.
 *
 * @param {{state: any, actions: any}} props Tab state and actions.
 * @returns {import('react').ReactElement}
 */
const ActiveBar = ({ state, actions }) => {
  const { t } = useSettingsTranslate();
  const seconds = useCountdown(state.expiresAt);
  const [ending, setEnding] = useState(false);
  const { isBelowMedium } = useBreakpoint();
  const expiredOnce = useRef(false);
  const impersonation = state.impersonation || {};

  useEffect(() => {
    if (seconds > 0 || expiredOnce.current) return;
    expiredOnce.current = true;
    actions.end('expired');
  }, [seconds, actions]);

  useEffect(() => {
    const check = async () => {
      try {
        const response = await window.fetch(
          `${actions.backendURL()}/${pluginId}/admin-impersonation/self`,
          { headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/json' } }
        );
        if (response.status === 401) actions.markEnded('ended');
      } catch {
        // Offline: the countdown still ends the tab.
      }
    };
    const timer = window.setInterval(check, POLL_MS);
    return () => window.clearInterval(timer);
  }, [actions, state.token]);

  return (
    <Box
      background="neutral800"
      paddingLeft={4}
      paddingRight={4}
      paddingTop={2}
      paddingBottom={2}
      height={BANNER_HEIGHT}
      data-impersonation-banner=""
    >
      <Flex height="100%" gap={3} alignItems="center" justifyContent="space-between">
        <Flex gap={2} alignItems="center" minWidth={0} wrap="wrap">
          <Typography variant="omega" fontWeight="bold" textColor="neutral0" ellipsis>
            {isBelowMedium ? (
              <>
                <VisuallyHidden>
                  {t('impersonation.tab.banner.signedInAs', 'Signed in as {name}', { name: '' })}
                </VisuallyHidden>
                {impersonation.targetName || '—'}
              </>
            ) : (
              t('impersonation.tab.banner.signedInAs', 'Signed in as {name}', {
                name: impersonation.targetName || '—',
              })
            )}
          </Typography>
          <Box
            background={impersonation.allowChanges ? 'danger600' : 'neutral0'}
            hasRadius
            paddingLeft={2}
            paddingRight={2}
          >
            <Typography
              variant="sigma"
              textColor={impersonation.allowChanges ? 'neutral0' : 'neutral800'}
            >
              {impersonation.allowChanges
                ? t('impersonation.tab.banner.changes', 'Changes allowed')
                : t('impersonation.tab.banner.readOnly', 'Read-only')}
            </Typography>
          </Box>
          <Typography variant="pi" textColor="neutral0" aria-live="off">
            {t('impersonation.tab.banner.endsIn', 'Ends in {time}', {
              time: formatClock(seconds),
            })}
          </Typography>
        </Flex>
        <Button
          size="S"
          variant="danger"
          loading={ending}
          onClick={async () => {
            setEnding(true);
            await actions.end('ended');
          }}
        >
          {isBelowMedium
            ? t('impersonation.tab.banner.endShort', 'End')
            : t('impersonation.tab.banner.end', 'End impersonation')}
        </Button>
      </Flex>
    </Box>
  );
};

/**
 * Full-screen panel of a landing, an ended or a failed impersonation. It
 * covers Strapi's login page, which this tab must not use.
 *
 * @param {{state: any, actions: any}} props Tab state and actions.
 * @returns {import('react').ReactElement}
 */
const Overlay = ({ state, actions }) => {
  const { t } = useSettingsTranslate();
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, [state.phase]);
  const landing = state.phase === 'landing';
  const failed = state.phase === 'failed';
  let title;
  let body;
  if (landing) {
    title = t('impersonation.tab.landing.title', 'Signing in as another admin…');
    body = null;
  } else if (failed) {
    title = t('impersonation.tab.failed.title', 'The sign-in did not work');
    body = t(
      'impersonation.tab.failed.body',
      'The link was already used or is older than one minute. Start again from the Admin panel page of the Session Manager.'
    );
  } else {
    title =
      state.reason === 'expired'
        ? t('impersonation.tab.ended.expiredTitle', 'The impersonation timed out')
        : t('impersonation.tab.ended.title', 'The impersonation ended');
    body = t(
      'impersonation.tab.ended.body',
      'You are no longer signed in as {name}. Your other tabs were not affected. You can close this tab.',
      { name: state.impersonation?.targetName || '—' }
    );
  }
  return (
    <Box
      position="fixed"
      top={0}
      left={0}
      right={0}
      bottom={0}
      background="neutral100"
      zIndex={1000}
      padding={4}
      data-impersonation-overlay={state.phase}
    >
      <Flex height="100%" justifyContent="center" alignItems="center">
        <Box
          background="neutral0"
          hasRadius
          shadow="popupShadow"
          padding={6}
          maxWidth="48rem"
          width="100%"
          role="dialog"
          aria-modal="true"
          aria-labelledby="msm-impersonation-overlay-title"
        >
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Typography
              id="msm-impersonation-overlay-title"
              variant="beta"
              tag="h1"
              textColor="neutral800"
              tabIndex={-1}
              ref={heading}
              style={{ outline: 'none' }}
            >
              {title}
            </Typography>
            {landing ? <Loader small>{title}</Loader> : null}
            {body ? (
              <Typography variant="omega" textColor="neutral800" tag="p">
                {body}
              </Typography>
            ) : null}
            {!landing ? (
              <Flex gap={2} wrap="wrap" justifyContent="flex-end">
                <Button variant="tertiary" onClick={() => actions.leave()}>
                  {t('impersonation.tab.backToMyAdmin', 'Back to my admin panel')}
                </Button>
                <Button onClick={() => window.close()}>
                  {t('impersonation.tab.close', 'Close tab')}
                </Button>
              </Flex>
            ) : null}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
};

/**
 * Root of the tab UI.
 *
 * @param {{actions: any}} props Actions.
 * @returns {import('react').ReactElement|null}
 */
const ImpersonationTabUi = ({ actions }) => {
  const state = useTabState();
  useEffect(() => {
    const root = document.documentElement;
    if (state?.phase === 'active') root.setAttribute('data-msm-impersonating', '');
    else root.removeAttribute('data-msm-impersonating');
  }, [state?.phase]);
  if (!state) return null;
  if (state.phase === 'active') return <ActiveBar state={state} actions={actions} />;
  return <Overlay state={state} actions={actions} />;
};

/**
 * Theme the admin uses: the stored choice, or the system's.
 *
 * @returns {object}
 */
function currentTheme() {
  let stored;
  try {
    stored = window.localStorage.getItem('STRAPI_THEME') || 'system';
  } catch {
    stored = 'system';
  }
  const dark =
    stored === 'dark' ||
    (stored === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return dark ? darkTheme : lightTheme;
}

/** Plugin translations by admin locale. */
const LOADERS = {
  en: () => import('../../translations/en.json'),
  de: () => import('../../translations/de.json'),
  es: () => import('../../translations/es.json'),
  fr: () => import('../../translations/fr.json'),
  pt: () => import('../../translations/pt.json'),
};

/**
 * Mounts the banner and the end screens in their own React root, outside
 * Strapi's tree, so they show on every admin route (and over the login
 * page). The admin panel moves down by the banner height while active.
 *
 * @param {{end: Function, leave: Function, markEnded: Function, backendURL: Function}} actions
 *   Tab actions.
 * @returns {Promise<void>}
 * @sideeffect Adds a fixed element and one style element to the document.
 */
export async function mountImpersonationBanner(actions) {
  if (document.getElementById('msm-impersonation-root')) return;
  let locale;
  try {
    const stored = window.localStorage.getItem('strapi-admin-language') || 'en';
    locale = LOADERS[stored] ? stored : 'en';
  } catch {
    locale = 'en';
  }
  const raw = (await LOADERS[locale]()).default;
  const messages = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [`${pluginId}.${key}`, value])
  );

  const style = document.createElement('style');
  // The admin moves down by the banner height. Strapi's desktop main
  // navigation is as tall as the viewport (`100dvh`, measured in 5.64), so
  // it is shortened by the same amount and kept below the banner; otherwise
  // its last item (the profile menu) would sit under the bottom edge.
  style.textContent = `html[data-msm-impersonating] body { padding-top: ${BANNER_HEIGHT}; }
${lightTheme.breakpoints.large} {
  html[data-msm-impersonating] #strapi nav { top: ${BANNER_HEIGHT}; height: calc(100dvh - ${BANNER_HEIGHT}); }
}
#msm-impersonation-root { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; }`;
  document.head.appendChild(style);
  const container = document.createElement('div');
  container.id = 'msm-impersonation-root';
  document.body.prepend(container);
  createRoot(container).render(
    <IntlProvider locale={locale} messages={messages} defaultLocale="en">
      <DesignSystemProvider locale={locale} theme={currentTheme()}>
        <ImpersonationTabUi actions={actions} />
      </DesignSystemProvider>
    </IntlProvider>
  );
}
