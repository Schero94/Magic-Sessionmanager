/**
 * Design System 2 breakpoints (min-width). Used only as a fallback when the
 * theme is not available; the live values come from theme.breakpoints.
 */
export const DS_BREAKPOINTS = Object.freeze({
  small: '@media(min-width: 520px)',
  medium: '@media(min-width: 768px)',
  large: '@media(min-width: 1080px)',
});

export const BREAKPOINT_ORDER = Object.freeze(['initial', 'small', 'medium', 'large']);

/**
 * Converts a DS theme breakpoint ("@media(min-width: 768px)") into a
 * matchMedia query ("(min-width: 768px)").
 *
 * @param {unknown} breakpoint Theme breakpoint string.
 * @returns {string} Media query, or '' when it cannot be parsed.
 */
export function mediaQueryFromBreakpoint(breakpoint) {
  if (typeof breakpoint !== 'string') return '';
  const query = breakpoint.replace(/^\s*@media\s*/i, '').trim();
  return /^\(.*\)$/.test(query) ? query : '';
}

/**
 * Returns the media queries for small/medium/large from a DS theme.
 *
 * @param {{breakpoints?: Record<string, string>}|undefined} theme Styled-components theme.
 * @returns {{small: string, medium: string, large: string}} Media queries.
 */
export function getBreakpointQueries(theme) {
  const source = theme?.breakpoints || {};
  return {
    small: mediaQueryFromBreakpoint(source.small) || mediaQueryFromBreakpoint(DS_BREAKPOINTS.small),
    medium:
      mediaQueryFromBreakpoint(source.medium) || mediaQueryFromBreakpoint(DS_BREAKPOINTS.medium),
    large: mediaQueryFromBreakpoint(source.large) || mediaQueryFromBreakpoint(DS_BREAKPOINTS.large),
  };
}

/**
 * Resolves the active breakpoint name from matchMedia results.
 *
 * @param {{small?: boolean, medium?: boolean, large?: boolean}} matches Which min-width queries match.
 * @returns {'initial'|'small'|'medium'|'large'} Active breakpoint.
 */
export function resolveBreakpoint(matches = {}) {
  if (matches.large) return 'large';
  if (matches.medium) return 'medium';
  if (matches.small) return 'small';
  return 'initial';
}

/**
 * @param {'initial'|'small'|'medium'|'large'} current Active breakpoint.
 * @param {'small'|'medium'|'large'} target Breakpoint to compare with.
 * @returns {boolean} Whether the viewport is narrower than `target`.
 */
export function isBelowBreakpoint(current, target) {
  return BREAKPOINT_ORDER.indexOf(current) < BREAKPOINT_ORDER.indexOf(target);
}
