import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASON_MAX,
  USER_IMPERSONATION_DURATIONS,
  formatClock,
  secondsUntil,
  submitFrontendHandoff,
  validateReason,
} from '../admin/src/utils/impersonation.mjs';
import rules from '../server/src/utils/impersonation-rules.js';

test('client bounds mirror the server', () => {
  assert.deepEqual([...USER_IMPERSONATION_DURATIONS], [...rules.USER_DURATIONS]);
  assert.equal(REASON_MAX, rules.REASON_MAX);
  assert.equal(validateReason('ab')?.messageId, 'impersonation.reason.tooShort');
  assert.equal(validateReason('   a b  ')?.messageId, undefined);
  assert.equal(validateReason('x'.repeat(256))?.messageId, 'impersonation.reason.tooLong');
  assert.equal(validateReason('Ticket 4711'), null);
  assert.equal(validateReason(undefined)?.messageId, 'impersonation.reason.tooShort');
});

test('remaining time is never negative and reads as a clock', () => {
  const now = Date.parse('2026-11-25T10:00:00.000Z');
  assert.equal(secondsUntil('2026-11-25T10:15:00.000Z', now), 900);
  assert.equal(secondsUntil('2026-11-25T09:00:00.000Z', now), 0);
  assert.equal(secondsUntil('not a date', now), 0);
  assert.equal(formatClock(900), '15:00');
  assert.equal(formatClock(61), '1:01');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(-5), '0:00');
});

/**
 * A tiny document double recording the form that would be submitted.
 *
 * @returns {{doc: object, submitted: object[]}} Double and records.
 */
const fakeDocument = () => {
  const submitted = [];
  const make = (tag) => {
    const node = {
      tag,
      children: [],
      style: {},
      appendChild(child) {
        node.children.push(child);
      },
      remove() {
        node.removed = true;
      },
      submit() {
        submitted.push(node);
      },
    };
    return node;
  };
  const doc = { createElement: make, body: make('body') };
  return { doc, submitted };
};

test('the frontend hand-off sends the code by POST in a removed form', () => {
  const { doc, submitted } = fakeDocument();
  assert.equal(
    submitFrontendHandoff(doc, {
      url: 'https://app.example.test/impersonate',
      field: 'code',
      code: 'c'.repeat(43),
    }),
    true
  );
  assert.equal(submitted.length, 1);
  const form = submitted[0];
  assert.equal(form.method, 'POST');
  assert.equal(form.action, 'https://app.example.test/impersonate');
  assert.equal(form.target, '_blank');
  assert.equal(form.rel, 'noopener noreferrer');
  assert.equal(form.action.includes('c'.repeat(43)), false, 'the code is not in the URL');
  assert.deepEqual(
    form.children.map((input) => [input.type, input.name, input.value]),
    [['hidden', 'code', 'c'.repeat(43)]]
  );
  assert.equal(form.removed, true);
  assert.equal(submitFrontendHandoff(doc, { url: 'javascript:alert(1)', code: 'x' }), false);
  assert.equal(submitFrontendHandoff(doc, { url: 'not a url', code: 'x' }), false);
  assert.equal(submitFrontendHandoff(doc, null), false);
});
