import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { parseUserAgent } from '../admin/src/utils/parseUserAgent.mjs';
import {
  DEVICE_TYPE_MESSAGES,
  getDevicePresentation,
  getDeviceTypeMessage,
  normalizeDeviceType,
  splitNameAndVersion,
} from '../admin/src/utils/devicePresentation.mjs';

const require = createRequire(import.meta.url);
const { enhanceSession } = require('../server/src/utils/enhance-session.js');

const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

test('parseUserAgent recognises common devices, browsers and systems', () => {
  assert.deepEqual(parseUserAgent(SAFARI_MAC), {
    deviceType: 'desktop',
    device: 'Desktop',
    deviceIcon: 'desktop',
    browser: 'Safari',
    os: 'macOS',
  });
  assert.equal(parseUserAgent(CHROME_ANDROID).deviceType, 'mobile');
  assert.equal(parseUserAgent(CHROME_ANDROID).browser, 'Chrome');
  assert.equal(parseUserAgent(CHROME_ANDROID).os, 'Android');
  assert.equal(parseUserAgent(IPAD).deviceType, 'tablet');
  assert.equal(parseUserAgent(IPAD).os, 'iOS');
  assert.equal(parseUserAgent(EDGE_WINDOWS).browser, 'Edge');
  assert.equal(parseUserAgent('curl/8.4.0').deviceType, 'api');
  assert.equal(parseUserAgent('PostmanRuntime/7.36').browser, 'Postman');
  assert.deepEqual(
    [
      parseUserAgent('node').browser,
      parseUserAgent('undici').browser,
      parseUserAgent('node').deviceType,
    ],
    ['Node.js', 'undici', 'api'],
    'script clients are named instead of reported as unknown'
  );
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

test('stored names lose their trailing version', () => {
  assert.deepEqual(splitNameAndVersion('Chrome 124.0.0.0'), {
    name: 'Chrome',
    version: '124.0.0.0',
  });
  assert.deepEqual(splitNameAndVersion('Windows 10/11'), { name: 'Windows', version: '10/11' });
  assert.deepEqual(splitNameAndVersion('Internet Explorer 11.0'), {
    name: 'Internet Explorer',
    version: '11.0',
  });
  assert.deepEqual(splitNameAndVersion('Chrome OS'), { name: 'Chrome OS', version: '' });
  assert.deepEqual(splitNameAndVersion('unknown'), { name: '', version: '' });
});

test('summary is "{browser} · {os}" without a version (I.1 item 8)', () => {
  const presentation = getDevicePresentation({ userAgent: SAFARI_MAC });
  assert.equal(presentation.deviceType, 'desktop');
  assert.equal(presentation.icon, 'desktop');
  assert.equal(presentation.browserLabel, 'Safari');
  assert.equal(presentation.browserVersion, '17.4', 'the version stays available for exports');
  assert.deepEqual(presentation.summary, {
    messageId: 'common.device.summary',
    defaultMessage: '{browser} · {os}',
    values: { browser: 'Safari', os: 'macOS' },
  });
});

test('rows exactly as GET /sessions returns them never repeat the version (no "Safari 17.4 17")', async () => {
  const expected = {
    [SAFARI_MAC]: ['desktop', 'Safari', 'macOS'],
    [SAFARI_IPHONE]: ['mobile', 'Safari', 'iOS'],
    [CHROME_WINDOWS]: ['desktop', 'Chrome', 'Windows'],
    [FIREFOX_LINUX]: ['desktop', 'Firefox', 'Linux'],
    [CHROME_ANDROID]: ['mobile', 'Chrome', 'Android'],
  };
  for (const [userAgent, [deviceType, browser, os]] of Object.entries(expected)) {
    // The server appends versions to browserName/osName ("Safari 17.4", "macOS 10.15.7").
    const row = await enhanceSession({
      documentId: 'doc',
      userAgent,
      isActive: true,
      loginTime: new Date(),
    });
    const presentation = getDevicePresentation(row);
    assert.equal(presentation.deviceType, deviceType, userAgent);
    assert.deepEqual(presentation.summary.values, { browser, os }, userAgent);
    assert.equal(presentation.hasSummary, true, 'a parsed user agent never reads as unavailable');
  }
});

test('stored rows without a user agent use the stored names without versions', () => {
  const presentation = getDevicePresentation({
    deviceType: 'mobile',
    browserName: 'Chrome 131.0.1',
    osName: 'Android 14',
  });
  assert.equal(presentation.deviceType, 'mobile');
  assert.equal(presentation.icon, 'mobile');
  assert.equal(presentation.deviceTypeMessage.messageId, 'common.device.type.mobile');
  assert.deepEqual(presentation.summary.values, { browser: 'Chrome', os: 'Android' });
  assert.equal(presentation.browserVersion, '131.0.1');
});

test('a user agent the server could not parse is an unknown device, not "Desktop"', async () => {
  const row = await enhanceSession({
    documentId: 'doc',
    userAgent: 'MyCustomApp/1.0',
    isActive: true,
  });
  assert.equal(row.deviceType, 'desktop', 'the server parser falls back to desktop');
  const presentation = getDevicePresentation(row);
  assert.equal(presentation.deviceType, '');
  assert.equal(presentation.icon, 'unknown');
  assert.equal(presentation.hasSummary, false);
});

test('missing data never renders a sentence about missing data (DASH-06, F15)', () => {
  const nothing = getDevicePresentation({});
  assert.equal(nothing.hasDeviceType, false);
  assert.equal(nothing.icon, 'unknown');
  assert.equal(nothing.hasSummary, false);
  assert.deepEqual(nothing.summary, { text: '' });

  const unknownStrings = getDevicePresentation({
    userAgent: 'unknown',
    browserName: 'Unknown',
    osName: ' ',
  });
  assert.equal(unknownStrings.hasSummary, false);

  assert.deepEqual(getDevicePresentation({ browserName: 'Firefox' }).summary, { text: 'Firefox' });
  assert.deepEqual(getDevicePresentation({ osName: 'Linux' }).summary, { text: 'Linux' });
});
