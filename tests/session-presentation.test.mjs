import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSessionDateTime,
  getBrowserVersionFromUserAgent,
} from '../admin/src/utils/sessionPresentation.mjs';

test('browser versions are extracted from common user-agent formats', () => {
  assert.equal(
    getBrowserVersionFromUserAgent('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36'),
    '131.0.0.0'
  );
  assert.equal(
    getBrowserVersionFromUserAgent('Mozilla/5.0 Chrome/131.0.0.0 Edg/131.0.0.0'),
    '131.0.0.0'
  );
  assert.equal(
    getBrowserVersionFromUserAgent('Mozilla/5.0 Firefox/132.0'),
    '132.0'
  );
  assert.equal(
    getBrowserVersionFromUserAgent('Mozilla/5.0 Version/18.1 Safari/605.1.15'),
    '18.1'
  );
  assert.equal(getBrowserVersionFromUserAgent('unknown'), '');
});

test('session dates use the selected locale rather than a hard-coded language', () => {
  const value = '2026-10-16T12:34:00.000Z';
  const locale = 'en-GB';
  const expected = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

  assert.equal(formatSessionDateTime(value, locale, 'Unavailable'), expected);
});

test('missing or invalid session dates return the supplied fallback', () => {
  assert.equal(formatSessionDateTime(null, 'de-DE', 'Nicht verfügbar'), 'Nicht verfügbar');
  assert.equal(formatSessionDateTime('not-a-date', 'de-DE', 'Nicht verfügbar'), 'Nicht verfügbar');
});
