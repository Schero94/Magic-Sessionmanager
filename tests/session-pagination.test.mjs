import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateSessions } from '../admin/src/utils/sessionPagination.mjs';

test('pagination returns the first page and range', () => {
  const result = paginateSessions(['a', 'b', 'c', 'd', 'e'], 1, 2);

  assert.deepEqual(result, {
    items: ['a', 'b'],
    page: 1,
    pageCount: 3,
    startIndex: 1,
    endIndex: 2,
    total: 5,
  });
});

test('pagination returns middle and final partial pages', () => {
  assert.deepEqual(paginateSessions([1, 2, 3, 4, 5], 2, 2).items, [3, 4]);
  assert.deepEqual(paginateSessions([1, 2, 3, 4, 5], 3, 2), {
    items: [5],
    page: 3,
    pageCount: 3,
    startIndex: 5,
    endIndex: 5,
    total: 5,
  });
});

test('pagination clamps invalid pages and normalizes the page size', () => {
  assert.equal(paginateSessions([1, 2, 3], 0, 2).page, 1);
  assert.equal(paginateSessions([1, 2, 3], 99, 2).page, 2);
  assert.deepEqual(paginateSessions([1, 2, 3], 1, 0).items, [1]);
});

test('empty results have a stable page and an empty range', () => {
  assert.deepEqual(paginateSessions([], 5, 10), {
    items: [],
    page: 1,
    pageCount: 1,
    startIndex: 0,
    endIndex: 0,
    total: 0,
  });
});
