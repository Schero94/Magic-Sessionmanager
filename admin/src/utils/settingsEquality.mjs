/**
 * Compares settings records recursively while ignoring object key order.
 * Settings are JSON-shaped data, so array order remains significant.
 *
 * @param {unknown} left First settings value.
 * @param {unknown} right Second settings value.
 * @returns {boolean} Whether the values have the same nested data.
 */
export function areSettingsEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areSettingsEqual(value, right[index]));
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && areSettingsEqual(left[key], right[key]));
}
