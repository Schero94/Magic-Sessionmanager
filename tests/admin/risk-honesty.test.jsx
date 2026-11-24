/**
 * Rendered checks of the risk-data honesty rules: without a risk data source the settings that
 * depend on it are shown off and disabled with the reason, saved values stay untouched, and the
 * session details show "Not available" instead of a score. With a source the controls are live.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network, permission, renderStrict, settle } from './harness/index.jsx';
import Settings from '../../admin/src/pages/Settings';
import SessionDetailModal from '../../admin/src/components/SessionDetailModal';

const PLUGIN = 'plugin::magic-sessionmanager';
const ALL = [
  permission(`${PLUGIN}.access`),
  permission(`${PLUGIN}.admin-sessions.read`),
  permission(`${PLUGIN}.admin-sessions.revoke`),
];

/** Saved settings of an install that turned every risk feature on before the fix. */
const SAVED = {
  enableGeolocation: true,
  enableSecurityScoring: true,
  blockSuspiciousSessions: true,
  geoLookupFailureMode: 'auto',
  enableEmailAlerts: true,
  alertOnSuspiciousLogin: true,
  alertOnNewLocation: true,
  alertOnVpnProxy: true,
  enableWebhooks: true,
};

const status = (risk) => ({
  status: { exists: true, hasCredentials: false, credentialSource: 'missing', risk },
});

/**
 * Renders the configuration page on one tab.
 * @param {string} tab - Tab id.
 * @param {object} risk - `status.risk` of the GeoIP status response.
 * @returns {Promise<object>} Mounted handle.
 */
const renderTab = async (tab, risk) => {
  network.on('GET', '/magic-sessionmanager/settings', { settings: SAVED, revision: 1 });
  network.on('GET', '/magic-sessionmanager/geoip/status', status(risk));
  const handle = await renderStrict(<Settings />, {
    path: `/settings/magic-sessionmanager/general?tab=${tab}`,
    permissions: ALL,
  });
  await settle(10, 10);
  return handle;
};

const switchState = (container, id) => {
  const element = container.querySelector(`#${id}`);
  assert.ok(element, `#${id} is rendered`);
  return {
    checked: element.getAttribute('aria-checked') === 'true',
    disabled: element.hasAttribute('disabled') || element.getAttribute('data-disabled') !== null,
  };
};

const checkboxFor = (container, label) => {
  const labelNode = [...container.querySelectorAll('label')].find(
    (node) => node.textContent.trim() === label
  );
  assert.ok(labelNode, `checkbox "${label}" is rendered`);
  const box = labelNode.querySelector('[role="checkbox"]') || labelNode.previousElementSibling;
  const control =
    box?.getAttribute('role') === 'checkbox'
      ? box
      : labelNode.parentElement.querySelector('[role="checkbox"]');
  assert.ok(control, `checkbox control for "${label}"`);
  return {
    checked: control.getAttribute('aria-checked') === 'true',
    disabled: control.hasAttribute('disabled'),
  };
};

test('no risk source: reject switch is off, disabled and explains why; saved value is kept', async () => {
  const handle = await renderTab('login-protection', { available: false, source: null });
  try {
    const text = handle.container.textContent;
    assert.match(text, /No risk data source/);
    assert.match(text, /no sign-in is refused as suspicious/);
    assert.deepEqual(switchState(handle.container, 'block-suspicious-sessions'), {
      checked: false,
      disabled: true,
    });
    assert.match(text, /Needs a risk data source/);
    assert.match(text, /Saved as on\. It takes effect once a risk data source is set up\./);
    assert.equal(
      network.calls.filter((call) => call.method !== 'GET').length,
      0,
      'nothing is saved'
    );
  } finally {
    await handle.unmount();
  }
});

test('no risk source: scoring switch on Location data is disabled with the reason', async () => {
  const handle = await renderTab('location-data', { available: false, source: null });
  try {
    assert.deepEqual(switchState(handle.container, 'enable-security-scoring'), {
      checked: false,
      disabled: true,
    });
    assert.match(handle.container.textContent, /Needs a risk data source/);
  } finally {
    await handle.unmount();
  }
});

test('no risk source: VPN and suspicious emails are disabled, new-country email stays', async () => {
  const handle = await renderTab('alerts', { available: false, source: null });
  try {
    assert.deepEqual(checkboxFor(handle.container, 'Suspicious sign-in'), {
      checked: false,
      disabled: true,
    });
    assert.deepEqual(checkboxFor(handle.container, 'VPN or proxy'), {
      checked: false,
      disabled: true,
    });
    assert.deepEqual(checkboxFor(handle.container, 'Sign-in from a new country'), {
      checked: true,
      disabled: false,
    });
    assert.match(handle.container.textContent, /Without a risk data source, login\.suspicious/);
  } finally {
    await handle.unmount();
  }
});

test('risk source available: the same controls are live and show the saved values', async () => {
  const handle = await renderTab('login-protection', {
    available: true,
    source: 'anonymous-ip',
  });
  try {
    assert.deepEqual(switchState(handle.container, 'block-suspicious-sessions'), {
      checked: true,
      disabled: false,
    });
    assert.doesNotMatch(handle.container.textContent, /No risk data source/);
    assert.doesNotMatch(handle.container.textContent, /Needs a risk data source/);
  } finally {
    await handle.unmount();
  }
});

test('session details: a stored score without its risk source is "Not available"', async () => {
  const handle = await renderStrict(
    <SessionDetailModal
      session={{
        id: 'session-1',
        isActive: false,
        loginTime: '2026-11-24T09:00:00.000Z',
        logoutTime: '2026-11-24T10:00:00.000Z',
        terminationReason: 'logout',
        ipAddress: '198.51.100.7',
        // Written before the fix: a meaningless 100 and no source.
        securityScore: 100,
        geoLocation: { country: 'Germany', city: 'Berlin', timezone: 'Europe/Berlin' },
        user: { documentId: 'user-1', username: 'ada', email: 'ada@example.com' },
      }}
      now={Date.parse('2026-11-24T11:00:00.000Z')}
      onClose={() => {}}
      onEndSession={async () => {}}
    />,
    { permissions: ALL }
  );
  try {
    const text = document.body.textContent;
    assert.match(text, /VPN, proxy and security score/);
    assert.match(text, /Not available/);
    assert.match(text, /Needs a risk data source/);
    assert.doesNotMatch(text, /100\/100/);
  } finally {
    await handle.unmount();
  }
});

test('session details: a stored score with its risk source is shown', async () => {
  const handle = await renderStrict(
    <SessionDetailModal
      session={{
        id: 'session-2',
        isActive: false,
        loginTime: '2026-11-24T09:00:00.000Z',
        logoutTime: '2026-11-24T10:00:00.000Z',
        terminationReason: 'logout',
        ipAddress: '198.51.100.8',
        securityScore: 70,
        geoLocation: { country: 'Germany', riskSource: 'anonymous-ip' },
        user: { documentId: 'user-2', username: 'grace', email: 'grace@example.com' },
      }}
      now={Date.parse('2026-11-24T11:00:00.000Z')}
      onClose={() => {}}
      onEndSession={async () => {}}
    />,
    { permissions: ALL }
  );
  try {
    const text = document.body.textContent;
    assert.match(text, /70\/100/);
    assert.doesNotMatch(text, /Needs a risk data source/);
  } finally {
    await handle.unmount();
  }
});
