const ALLOWED_COLUMNS = new Set([1, 2, 3, 4, 6]);

/**
 * Maps a column count to DS Grid.Item spans (12-column grid).
 * DS Grid.Item: xs < 520 <= s < 768 <= m < 1080 <= col.
 *
 * - stackBelow 'small': one column on phones, two from 520px (or `columns`
 *   when it is smaller), `columns` from the large breakpoint.
 * - stackBelow 'medium': one column below 768px, two from 768px, `columns`
 *   from the large breakpoint.
 *
 * @param {number} columns Columns at the large breakpoint.
 * @param {'small'|'medium'} [stackBelow] Breakpoint below which items stack.
 * @returns {{xs: number, s: number, m: number, col: number}} Spans.
 */
export function getGridItemSpans(columns, stackBelow = 'medium') {
  const count = ALLOWED_COLUMNS.has(columns) ? columns : 2;
  const col = 12 / count;
  const twoUp = count >= 2 ? 6 : 12;

  if (stackBelow === 'small') {
    return { xs: 12, s: twoUp, m: twoUp, col };
  }
  return { xs: 12, s: 12, m: twoUp, col };
}
