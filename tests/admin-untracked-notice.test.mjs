import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  UNTRACKED_END_PATH,
  UNTRACKED_SUMMARY_PATH,
  monthToDate,
  readEndResult,
  readUntrackedSummary,
  shareOf,
  untrackedTone,
} from '../admin/src/utils/untrackedSessions.mjs';
import { EMPTY_SESSION_STATS, readSessionStats } from '../admin/src/utils/sessionListApi.mjs';

const read = (file) => readFileSync(new URL(`../admin/src/${file}`, import.meta.url), 'utf8');

const summary = {
  available: true,
  total: 10,
  trackingSince: '2026-11-01T00:00:00.000Z',
  beforeTracking: 7,
  afterTracking: 3,
  byMonth: [
    { month: '2026-10', count: 7 },
    { month: '2026-11', count: 3 },
  ],
  earlier: 0,
  bySource: { signIn: 8, passwordChange: 1, tokenOnly: 1 },
  byDevice: { desktop: 5, mobile: 3, unknown: 2 },
  deviceSample: { scanned: 10, limit: 2000, complete: true },
  expiring: { within7Days: 4, within30Days: 10 },
  generatedAt: '2026-11-12T12:00:00.000Z',
};

test('tone is a warning only when sessions were created after tracking started', () => {
  assert.equal(untrackedTone({ nativeOnly: 5, nativeOnlyAfterTracking: 0 }), 'neutral');
  assert.equal(untrackedTone({ nativeOnly: 5, nativeOnlyAfterTracking: null }), 'neutral');
  assert.equal(untrackedTone({ nativeOnly: 5, nativeOnlyAfterTracking: 2 }), 'warning');
  assert.equal(untrackedTone(undefined), 'neutral');
});

test('reads the count-only summary and rejects anything else', () => {
  const parsed = readUntrackedSummary({ data: summary });
  assert.equal(parsed.total, 10);
  assert.equal(parsed.trackingSince.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(parsed.byMonth.length, 2);
  assert.equal(parsed.deviceSample.complete, true);

  assert.throws(() => readUntrackedSummary({ data: { ...summary, total: -1 } }));
  assert.throws(() => readUntrackedSummary({ data: { ...summary, bySource: {} } }));
  assert.throws(() => readUntrackedSummary({ data: { ...summary, byMonth: 'x' } }));
  assert.throws(() => readUntrackedSummary({}));
  const odd = readUntrackedSummary({
    data: { ...summary, trackingSince: 'garbage', byMonth: [{ month: 'x', count: 1 }] },
  });
  assert.equal(odd.trackingSince, null);
  assert.deepEqual(odd.byMonth, []);
});

test('share, month and end-result helpers', () => {
  assert.equal(shareOf(1, 4), 0.25);
  assert.equal(shareOf(1, 0), 0);
  assert.equal(shareOf(9, 4), 1);
  assert.equal(monthToDate('2026-02').toISOString(), '2026-02-01T00:00:00.000Z');
  assert.equal(monthToDate('nope'), null);
  assert.deepEqual(readEndResult({ data: { ended: 3, remaining: 0, limit: 5000 } }), {
    ended: 3,
    remaining: 0,
    limit: 5000,
  });
  assert.throws(() => readEndResult({ data: { ended: 3 } }));
  assert.equal(UNTRACKED_SUMMARY_PATH, '/magic-sessionmanager/sessions/native-only/summary');
  assert.equal(UNTRACKED_END_PATH, '/magic-sessionmanager/sessions/native-only/end');
});

test('stats keep the after-tracking split, or null when the server does not know it', () => {
  const counts = Object.fromEntries(
    Object.keys(EMPTY_SESSION_STATS).map((key) => [key, key === 'nativeOnly' ? 12 : 0])
  );
  assert.equal(
    readSessionStats({ data: { ...counts, nativeOnlyAfterTracking: 4 } }).nativeOnlyAfterTracking,
    4
  );
  assert.equal(
    readSessionStats({ data: { ...counts, nativeOnlyAfterTracking: null } })
      .nativeOnlyAfterTracking,
    null
  );
  const { nativeOnlyAfterTracking: _omitted, ...withoutSplit } = counts;
  assert.equal(readSessionStats({ data: withoutSplit }).nativeOnlyAfterTracking, null);
});

test('the notice is neutral or warning, never success-green, and has a "Why?" disclosure', () => {
  const source = read('pages/Dashboard/UntrackedSessionsNotice.jsx');
  assert.match(
    source,
    /<Alert variant=\{tone\} title=\{title\} titleAs="h2" stacked action=\{actions\}>/
  );
  assert.doesNotMatch(source, /variant="success"|variant="default"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=\{panelId\}/);
  assert.match(source, /hidden=\{!open\}/);
  // The wording separates these sign-ins from active and online sessions.
  assert.match(source, /not active or online sessions/);
  assert.match(source, /refresh tokens/);
});

test('ending untracked sessions goes through ConfirmDialog and reports the server counts', () => {
  const source = read('pages/Dashboard/UntrackedSessionsNotice.jsx');
  assert.match(source, /<ConfirmAction\s/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /post\(UNTRACKED_END_PATH, \{\}\)/);
  assert.match(source, /readEndResult\(response\.data\)/);
  assert.match(source, /homepage\.untracked\.end\.partial/);
  assert.match(source, /administrator sessions are not affected/);
  // The summary is loaded on first open, with loading, error/retry and data states.
  assert.match(source, /get\(UNTRACKED_SUMMARY_PATH\)/);
  assert.match(source, /summaryState === 'error'/);
  assert.match(source, /common\.tryAgain/);
});

test('the "How sessions work" legend explains untracked Strapi sign-ins', () => {
  const source = read('pages/Dashboard/HowSessionsWork.jsx');
  assert.match(source, /homepage\.howItWorks\.untracked/);
  const en = JSON.parse(read('translations/en.json'));
  assert.equal(en['homepage.nativeOnly.body'], undefined, 'the old banner text is retired');
  assert.match(en['homepage.howItWorks.untracked'], /never counted as active or online/);
});
