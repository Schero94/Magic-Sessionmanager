import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const geoSection = readme.slice(readme.indexOf('### IP Geolocation'), readme.indexOf('### Threat Detection'));
const text = geoSection.replace(/\s+/g, ' ');

test('README explains the GeoIP default, remote fallback and local-only alternatives', () => {
  assert.match(text, /geolocation is enabled by default/i);
  assert.match(text, /default provider is `auto`/i);
  assert.match(text, /no local database (?:is )?available/i);
  assert.match(text, /local lookup fails/i);
  assert.match(text, /IP address[^.]*ipapi\.co/i);
  assert.match(text, /`geoLookupFailureMode: 'block'`[^.]*failed local lookup does not fall back/i);
  assert.match(text, /`local-mmdb`[^.]*does not fall back to ipapi\.co/i);
  assert.match(text, /`disabled`[^.]*no GeoIP lookup/i);
  assert.match(text, /`enableGeolocation: false`[^.]*no GeoIP lookup/i);
});

test('README distinguishes local lookups from the separate MaxMind download', () => {
  assert.match(text, /MaxMind database download[^.]*separate[^.]*authenticated[^.]*request/i);
  assert.match(text, /MaxMind database download[^.]*does not send[^.]*session IP addresses/i);
});
