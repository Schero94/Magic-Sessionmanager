/**
 * Rendered checks of the 4.17 security review UI (F1, F5, F6): a stored webhook URL is never
 * shown, only "Saved" with Replace and Remove; saving without touching it does not send the key;
 * Remove sends an empty string. Roles without "Change protected settings" see location lookup,
 * webhook and security log controls read-only, with the reason.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { network, permission, renderStrict, settle } from './harness/index.jsx';
import Settings from '../../admin/src/pages/Settings';

const PLUGIN = 'plugin::magic-sessionmanager';
const BASE = [permission(`${PLUGIN}.access`)];
const FULL = [
  ...BASE,
  permission(`${PLUGIN}.admin-activity.read`),
  permission(`${PLUGIN}.settings.update`),
];

const SAVED = {
  enableGeolocation: true,
  enableWebhooks: true,
  hasDiscordWebhook: true,
  discordWebhookHint: 'https://discord.com/…',
  hasSlackWebhook: false,
  slackWebhookHint: null,
  inactivityTimeout: 15,
};

/**
 * Renders the configuration page on one tab.
 *
 * @param {string} tab Tab id.
 * @param {object[]} permissions Admin permissions.
 * @returns {Promise<object>} Mounted handle.
 */
const renderTab = async (tab, permissions) => {
  network.on('GET', '/magic-sessionmanager/settings', { settings: SAVED, revision: 1 });
  network.on('GET', '/magic-sessionmanager/geoip/status', {
    status: { exists: true, hasCredentials: false, credentialSource: 'missing', risk: {} },
  });
  network.on('PUT', '/magic-sessionmanager/settings', (call) => ({
    settings: { ...SAVED, ...call.json(), discordWebhookUrl: undefined },
    revision: 2,
    success: true,
  }));
  const handle = await renderStrict(<Settings />, {
    path: `/settings/magic-sessionmanager/general?tab=${tab}`,
    permissions,
  });
  await settle(10, 10);
  return handle;
};

const button = (container, text) => {
  const found = [...container.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === text
  );
  assert.ok(found, `button "${text}"`);
  return found;
};

const click = async (node) => {
  await act(async () => {
    node.click();
  });
  await settle(4, 5);
};

test('F6: a stored webhook shows "Saved" with Replace and Remove, never the URL', async () => {
  const handle = await renderTab('alerts', FULL);
  try {
    const saved = handle.container.querySelector('[data-webhook-saved="discordWebhookUrl"]');
    assert.ok(saved, 'saved state is rendered');
    assert.match(saved.textContent, /Saved/);
    assert.match(saved.textContent, /https:\/\/discord\.com\/…/);
    assert.equal(handle.container.querySelector('input[name="discordWebhookUrl"]'), null);
    assert.ok(handle.container.querySelector('input[name="slackWebhookUrl"]'), 'empty slack input');

    await click(button(handle.container, 'Replace'));
    assert.ok(handle.container.querySelector('input[name="discordWebhookUrl"]'), 'replace input');
    await click(button(handle.container, 'Keep the saved URL'));

    await click(button(handle.container, 'Remove'));
    assert.match(handle.container.textContent, /Removed on save/);
    await click(button(handle.container, 'Save'));
    const put = network.calls.find((call) => call.method === 'PUT');
    assert.ok(put, 'the form was saved');
    const body = JSON.parse(put.body);
    assert.equal(body.discordWebhookUrl, '', 'Remove sends an empty string');
    assert.equal('slackWebhookUrl' in body, false, 'an untouched URL is not sent');
  } finally {
    await handle.unmount();
  }
});

test('F1/F5/F6: without "Change protected settings" the protected controls are read-only', async () => {
  const handle = await renderTab('alerts', BASE);
  try {
    const text = handle.container.textContent;
    assert.match(text, /Change protected settings/);
    const webhooks = handle.container.querySelector('#enable-webhooks');
    assert.ok(webhooks.hasAttribute('disabled') || webhooks.getAttribute('data-disabled') !== null);
    assert.ok(button(handle.container, 'Replace').hasAttribute('disabled'));
    assert.ok(button(handle.container, 'Remove').hasAttribute('disabled'));
  } finally {
    await handle.unmount();
  }
  const location = await renderTab('location-data', BASE);
  try {
    const lookup = location.container.querySelector('#enable-ip-geolocation');
    assert.ok(lookup.hasAttribute('disabled') || lookup.getAttribute('data-disabled') !== null);
  } finally {
    await location.unmount();
  }
});
