import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MISSING_VALUE_GLYPH,
  MISSING_VALUE_MESSAGE,
  isMissingValue,
  presentText,
} from '../admin/src/utils/missingValue.mjs';
import {
  DS_BREAKPOINTS,
  getBreakpointQueries,
  isBelowBreakpoint,
  mediaQueryFromBreakpoint,
  resolveBreakpoint,
} from '../admin/src/utils/breakpoints.mjs';
import { getGridItemSpans } from '../admin/src/utils/gridSpans.mjs';

test('missing values use one glyph with an accessible label', () => {
  assert.equal(MISSING_VALUE_GLYPH, '—');
  assert.equal(MISSING_VALUE_MESSAGE.messageId, 'common.value.missing');
  for (const value of [null, undefined, '', '   ', 'unknown', 'Unknown', Number.NaN, Infinity, new Date('x')]) {
    assert.equal(isMissingValue(value), true, `${String(value)} is missing`);
  }
  for (const value of [0, 'Safari', false, new Date(0)]) {
    assert.equal(isMissingValue(value), false, `${String(value)} is present`);
  }
  assert.equal(presentText('  x  '), 'x');
  assert.equal(presentText(null), '');
});

test('DS theme breakpoints become matchMedia queries (DUX-19)', () => {
  assert.equal(mediaQueryFromBreakpoint('@media(min-width: 768px)'), '(min-width: 768px)');
  assert.equal(mediaQueryFromBreakpoint('@media (min-width: 520px)'), '(min-width: 520px)');
  assert.equal(mediaQueryFromBreakpoint('nonsense'), '');
  assert.equal(mediaQueryFromBreakpoint(undefined), '');

  assert.deepEqual(getBreakpointQueries(undefined), {
    small: '(min-width: 520px)',
    medium: '(min-width: 768px)',
    large: '(min-width: 1080px)',
  });
  assert.equal(
    getBreakpointQueries({ breakpoints: { ...DS_BREAKPOINTS, medium: '@media(min-width: 800px)' } }).medium,
    '(min-width: 800px)',
    'the live theme wins over the fallback'
  );
});

test('the active breakpoint matches DS min-width semantics at 767 and 768', () => {
  // 767px: small matches, medium does not.
  assert.equal(resolveBreakpoint({ small: true, medium: false, large: false }), 'small');
  // 768px: medium matches, so the desktop/tablet layout applies like the DS header.
  assert.equal(resolveBreakpoint({ small: true, medium: true, large: false }), 'medium');
  assert.equal(resolveBreakpoint({}), 'initial');
  assert.equal(resolveBreakpoint({ small: true, medium: true, large: true }), 'large');
  assert.equal(isBelowBreakpoint('small', 'medium'), true);
  assert.equal(isBelowBreakpoint('medium', 'medium'), false);
  assert.equal(isBelowBreakpoint('initial', 'small'), true);
});

test('equal grids use 4/2/1 columns for KPIs and 2/1 for section cards', () => {
  assert.deepEqual(getGridItemSpans(4, 'small'), { xs: 12, s: 6, m: 6, col: 3 });
  assert.deepEqual(getGridItemSpans(2, 'medium'), { xs: 12, s: 12, m: 6, col: 6 });
  assert.deepEqual(getGridItemSpans(1, 'medium'), { xs: 12, s: 12, m: 12, col: 12 });
  assert.deepEqual(getGridItemSpans(5, 'small'), { xs: 12, s: 6, m: 6, col: 6 }, 'unsupported counts fall back to 2');
  for (const columns of [1, 2, 3, 4, 6]) {
    const spans = getGridItemSpans(columns, 'small');
    assert.equal(12 % spans.col, 0, `${columns} columns divide the 12-column grid evenly`);
  }
});
