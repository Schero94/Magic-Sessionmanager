import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUserAgent } from '../admin/src/utils/parseUserAgent.mjs';
import {
  DEVICE_TYPE_MESSAGES,
  getDevicePresentation,
  getDeviceTypeMessage,
  normalizeDeviceType,
} from '../admin/src/utils/devicePresentation.mjs';

const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

test('parseUserAgent recognises common devices, browsers and systems', () => {
  assert.deepEqual(parseUserAgent(SAFARI_MAC), {
    deviceType: 'desktop', device: 'Desktop', deviceIcon: 'desktop', browser: 'Safari', os: 'macOS',
  });
  assert.equal(parseUserAgent(CHROME_ANDROID).deviceType, 'mobile');
  assert.equal(parseUserAgent(CHROME_ANDROID).browser, 'Chrome');
  assert.equal(parseUserAgent(CHROME_ANDROID).os, 'Android');
  assert.equal(parseUserAgent(IPAD).deviceType, 'tablet');
  assert.equal(parseUserAgent(IPAD).os, 'iOS');
  assert.equal(parseUserAgent(EDGE_WINDOWS).browser, 'Edge');
  assert.equal(parseUserAgent('curl/8.4.0').deviceType, 'api');
  assert.equal(parseUserAgent('PostmanRuntime/7.36').browser, 'Postman');
});

test('parseUserAgent never infers Desktop for unknown user agents (DUX-05)', () => {
  for (const ua of ['MyCustomApp/1.0', 'Mozilla/5.0', 'unknown', '', null, undefined]) {
    const parsed = parseUserAgent(ua);
    assert.equal(parsed.deviceType, '', `${ua} must not be classified`);
    assert.equal(parsed.device, '', `${ua} must not get a legacy device label`);
    assert.notEqual(parsed.deviceIcon, 'desktop');
  }
});

test('parseUserAgent returns empty strings instead of English "Unknown" words', () => {
  const parsed = parseUserAgent('MyCustomApp/1.0');
  assert.equal(parsed.browser, '');
  assert.equal(parsed.os, '');
  assert.doesNotMatch(JSON.stringify(parseUserAgent(null)), /Unknown/);
});

test('device types are normalised case-insensitively (UX-03, F2)', () => {
  assert.equal(normalizeDeviceType('desktop'), 'desktop');
  assert.equal(normalizeDeviceType('Desktop'), 'desktop');
  assert.equal(normalizeDeviceType('Laptop'), 'desktop');
  assert.equal(normalizeDeviceType('MOBILE'), 'mobile');
  assert.equal(normalizeDeviceType('tablet'), 'tablet');
  assert.equal(normalizeDeviceType('API Client'), 'api');
  assert.equal(normalizeDeviceType('bot'), 'bot');
  assert.equal(normalizeDeviceType('toaster'), '');
  assert.equal(normalizeDeviceType(undefined), '');
});

test('device type labels are translation descriptors, unknown included', () => {
  for (const [key, descriptor] of Object.entries(DEVICE_TYPE_MESSAGES)) {
    assert.match(descriptor.messageId, /^common\.device\.type\./, key);
  }
  assert.equal(getDeviceTypeMessage('').messageId, 'common.device.type.unknown');
  assert.equal(getDeviceTypeMessage('mobile').messageId, 'common.device.type.mobile');
});

test('presentation uses the user agent first and returns a translatable summary', () => {
  const presentation = getDevicePresentation({ userAgent: SAFARI_MAC });
  assert.equal(presentation.deviceType, 'desktop');
  assert.equal(presentation.icon, 'desktop');
  assert.equal(presentation.browserLabel, 'Safari 17');
  assert.deepEqual(presentation.summary, {
    messageId: 'common.device.summary',
    defaultMessage: '{browser} · {os}',
    values: { browser: 'Safari 17', os: 'macOS' },
  });
});

test('native server rows with lowercase device types get translated labels and icons', () => {
  const presentation = getDevicePresentation({ deviceType: 'mobile', browserName: 'Chrome', osName: 'Android', browserVersion: '131.0.1' });
  assert.equal(presentation.deviceType, 'mobile');
  assert.equal(presentation.icon, 'mobile');
  assert.equal(presentation.deviceTypeMessage.messageId, 'common.device.type.mobile');
  assert.equal(presentation.summary.values.browser, 'Chrome 131');
});

test('missing data never renders "Unavailable on Unavailable" (DASH-06, F15)', () => {
  const nothing = getDevicePresentation({});
  assert.equal(nothing.hasDeviceType, false);
  assert.equal(nothing.icon, 'unknown');
  assert.equal(nothing.summary.messageId, 'common.device.summaryUnavailable');
  assert.equal(nothing.summary.values, undefined);

  const unknownStrings = getDevicePresentation({ userAgent: 'unknown', browserName: 'Unknown', osName: ' ' });
  assert.equal(unknownStrings.summary.messageId, 'common.device.summaryUnavailable');

  const browserOnly = getDevicePresentation({ browserName: 'Firefox' });
  assert.deepEqual(browserOnly.summary, { text: 'Firefox' });
  const osOnly = getDevicePresentation({ osName: 'Linux' });
  assert.deepEqual(osOnly.summary, { text: 'Linux' });
});
