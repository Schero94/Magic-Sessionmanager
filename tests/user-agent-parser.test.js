'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseUserAgent } = require('../server/src/utils/user-agent-parser');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPOD = 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

test('iPhone user agents are stored as iOS, not macOS', () => {
  const parsed = parseUserAgent(IPHONE);
  assert.equal(parsed.osName, 'iOS');
  assert.equal(parsed.osVersion, '17.4');
  assert.equal(parsed.deviceType, 'mobile');
  assert.equal(parsed.browserName, 'Safari');
});

test('iPad user agents are stored as an iOS tablet, not a macOS phone', () => {
  const parsed = parseUserAgent(IPAD);
  assert.equal(parsed.osName, 'iOS');
  assert.equal(parsed.osVersion, '17.4');
  assert.equal(parsed.deviceType, 'tablet');
});

test('iPod user agents are stored as iOS', () => {
  const parsed = parseUserAgent(IPOD);
  assert.equal(parsed.osName, 'iOS');
  assert.equal(parsed.osVersion, '15.8');
  assert.equal(parsed.deviceType, 'mobile');
});

test('desktop Safari on a Mac stays macOS', () => {
  const parsed = parseUserAgent(MAC);
  assert.equal(parsed.osName, 'macOS');
  assert.equal(parsed.osVersion, '10.15.7');
  assert.equal(parsed.deviceType, 'desktop');
});

test('Android phones and tablets keep their device types', () => {
  assert.equal(parseUserAgent(ANDROID_PHONE).deviceType, 'mobile');
  assert.equal(parseUserAgent(ANDROID_PHONE).osName, 'Android');
  assert.equal(parseUserAgent(ANDROID_TABLET).deviceType, 'tablet');
});

test('a missing user agent is unknown', () => {
  assert.equal(parseUserAgent('').osName, 'unknown');
  assert.equal(parseUserAgent(undefined).deviceType, 'unknown');
});
