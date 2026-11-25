/**
 * Rendered checks of the 4.17 signals UI: the event checklist and the signed
 * webhook card (write-only URL and secret, Send test result). Synthetic data
 * only; the network is the harness fake.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { network, permission, renderStrict, settle } from './harness/index.jsx';
import WebhookEventsCard from '../../admin/src/pages/Settings/WebhookEventsCard';
import SignedWebhookCard from '../../admin/src/pages/Settings/SignedWebhookCard';

const ACCESS = permission('plugin::magic-sessionmanager.access');

/**
 * A minimal settings form.
 *
 * @param {object} settings Initial draft.
 * @returns {{form: object, changes: Array<[string, unknown]>}} Form and changes.
 */
const fakeForm = (settings) => {
  const changes = [];
  const form = {
    settings: { ...settings },
    errors: {},
    copyValue: async () => {},
    handleChange(key, value) {
      changes.push([key, value]);
      form.settings = { ...form.settings, [key]: value };
    },
  };
  return { form, changes };
};

test('event checklist: every event has a checkbox; toggling keeps the display order', async () => {
  const { form, changes } = fakeForm({ webhookEvents: ['lockout'] });
  const handle = await renderStrict(<WebhookEventsCard form={form} />, { permissions: [ACCESS] });
  try {
    const boxes = document.querySelectorAll('[data-webhook-event]');
    assert.equal(boxes.length, 12);
    const success = document.querySelector('[data-webhook-event="login.success"]');
    assert.equal(success.getAttribute('aria-checked') ?? String(success.checked), 'false');
    await act(async () => success.click());
    assert.deepEqual(changes.at(-1), ['webhookEvents', ['login.success', 'lockout']]);
  } finally {
    await handle.unmount();
  }
});

test('signed webhook: a saved URL and secret are never shown; Replace and Remove change only the draft', async () => {
  const { form, changes } = fakeForm({
    genericWebhookEnabled: true,
    hasGenericWebhook: true,
    hasGenericWebhookSecret: true,
  });
  const handle = await renderStrict(<SignedWebhookCard form={form} />, { permissions: [ACCESS] });
  try {
    const text = handle.container.textContent;
    assert.equal((text.match(/Saved\. It is never shown again\./g) || []).length, 2);
    assert.equal(handle.container.querySelectorAll('input[type="url"]').length, 0);
    const remove = [...handle.container.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Remove'
    );
    await act(async () => remove.click());
    assert.deepEqual(changes.at(-1), ['genericWebhookUrl', '']);
  } finally {
    await handle.unmount();
  }
});

test('signed webhook: Generate fills a 64-character secret; Send test reports a refused address', async () => {
  const { form, changes } = fakeForm({
    genericWebhookEnabled: true,
    hasGenericWebhook: true,
    hasGenericWebhookSecret: false,
  });
  const handle = await renderStrict(<SignedWebhookCard form={form} />, { permissions: [ACCESS] });
  try {
    const generate = [...handle.container.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Generate'
    );
    await act(async () => generate.click());
    const [key, value] = changes.at(-1);
    assert.equal(key, 'genericWebhookSecret');
    assert.match(value, /^[A-Za-z0-9_-]{64}$/);
  } finally {
    await handle.unmount();
  }
  // Routes are reset per render; register the answer for this one.
  network.on('POST', '/magic-sessionmanager/webhook/test', {
    data: { ok: false, status: null, code: 'address_not_allowed' },
  });
  const saved = fakeForm({ hasGenericWebhook: true, hasGenericWebhookSecret: true });
  const second = await renderStrict(<SignedWebhookCard form={saved.form} />, {
    permissions: [ACCESS],
  });
  try {
    const send = [...second.container.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Send test'
    );
    await act(async () => send.click());
    await settle(10, 10);
    assert.match(
      second.container.querySelector('[data-webhook-test-result]').textContent,
      /private, local or reserved address/
    );
  } finally {
    await second.unmount();
  }
});

test('signed webhook, events and travel are read-only without Change protected settings', async () => {
  const { form, changes } = fakeForm({
    genericWebhookEnabled: true,
    hasGenericWebhook: true,
    genericWebhookHint: 'https://hooks.example.test/…',
    hasGenericWebhookSecret: true,
    webhookEvents: ['lockout'],
  });
  form.canChangeProtected = false;
  const handle = await renderStrict(
    <>
      <SignedWebhookCard form={form} />
      <WebhookEventsCard form={form} />
    </>,
    { permissions: [ACCESS] }
  );
  try {
    const text = handle.container.textContent;
    assert.match(text, /Read-only for your role/);
    // The hint shows scheme and host only.
    assert.match(text, /https:\/\/hooks\.example\.test\/…/);
    const isDisabled = (element) =>
      element.disabled === true || element.getAttribute('aria-disabled') === 'true';
    const buttons = [...handle.container.querySelectorAll('button')];
    for (const label of ['Replace', 'Remove', 'Send test']) {
      const matching = buttons.filter((button) => button.textContent.trim() === label);
      assert.ok(matching.length > 0, `${label} is rendered`);
      for (const button of matching) assert.ok(isDisabled(button), `${label} is disabled`);
    }
    assert.ok(isDisabled(handle.container.querySelector('#generic-webhook-enabled')));
    for (const box of handle.container.querySelectorAll('[data-webhook-event]')) {
      assert.ok(isDisabled(box), 'event checkbox is disabled');
    }
    assert.deepEqual(changes, []);
  } finally {
    await handle.unmount();
  }
});
