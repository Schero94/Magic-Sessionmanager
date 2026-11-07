import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRelative,
  formatSessionDate,
  getRelativeTimeParts,
  toValidDate,
} from '../admin/src/utils/sessionDates.mjs';
import { formatSessionDateTime } from '../admin/src/utils/sessionPresentation.mjs';

const VALUE = '2026-10-16T12:34:00.000Z';

test('formatSessionDate uses the admin locale, not the browser default (DASH-05, I18N-10)', () => {
  const options = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' };
  const english = formatSessionDate(VALUE, 'en', '—', options);
  const german = formatSessionDate(VALUE, 'de', '—', options);
  assert.equal(english, new Intl.DateTimeFormat('en', options).format(new Date(VALUE)));
  assert.equal(german, new Intl.DateTimeFormat('de', options).format(new Date(VALUE)));
  assert.notEqual(english, german);
});

test('formatSessionDate returns the fallback for missing and invalid values', () => {
  for (const value of [null, undefined, '', 'not-a-date', Number.NaN]) {
    assert.equal(formatSessionDate(value, 'de', '—'), '—');
  }
  assert.equal(toValidDate('nope'), null);
  assert.ok(toValidDate(VALUE) instanceof Date);
});

test('an invalid locale tag falls back to English instead of throwing', () => {
  assert.doesNotThrow(() => formatSessionDate(VALUE, 'not a locale!!', '—'));
});

test('the legacy formatSessionDateTime delegates to the shared helper', () => {
  assert.equal(formatSessionDateTime(VALUE, 'en-GB', 'x'), formatSessionDate(VALUE, 'en-GB', 'x'));
  assert.equal(formatSessionDateTime(null, 'en-GB', 'x'), 'x');
});

test('relative time picks the largest sensible unit', () => {
  const now = Date.parse(VALUE);
  assert.deepEqual(getRelativeTimeParts(now - 10_000, now), { value: 0, unit: 'second' });
  assert.deepEqual(getRelativeTimeParts(now - 5 * 60_000, now), { value: -5, unit: 'minute' });
  assert.deepEqual(getRelativeTimeParts(now - 3 * 3_600_000, now), { value: -3, unit: 'hour' });
  assert.deepEqual(getRelativeTimeParts(now - 2 * 86_400_000, now), { value: -2, unit: 'day' });
  assert.deepEqual(getRelativeTimeParts(now + 2 * 86_400_000, now), { value: 2, unit: 'day' });
  assert.equal(getRelativeTimeParts(undefined, now), null);
});

test('formatRelative is localized and never interpolates missing values (DUX-15)', () => {
  const now = Date.parse(VALUE);
  const fiveMinutesAgo = now - 5 * 60_000;
  assert.equal(
    formatRelative(fiveMinutesAgo, 'en', { now }),
    new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-5, 'minute')
  );
  assert.equal(
    formatRelative(fiveMinutesAgo, 'de', { now }),
    new Intl.RelativeTimeFormat('de', { numeric: 'auto' }).format(-5, 'minute')
  );
  assert.equal(formatRelative(undefined, 'de', { now, fallback: '—' }), '—');
  assert.equal(formatRelative('garbage', 'en', { now, fallback: '—' }), '—');
  assert.doesNotMatch(
    formatRelative(undefined, 'en', { now, fallback: '—' }),
    /undefined|Unavailable/
  );
});
