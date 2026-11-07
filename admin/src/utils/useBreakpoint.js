import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'styled-components';
import { getBreakpointQueries, isBelowBreakpoint, resolveBreakpoint } from './breakpoints.mjs';

const readMatches = (queries) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { small: true, medium: true, large: true };
  }
  return {
    small: window.matchMedia(queries.small).matches,
    medium: window.matchMedia(queries.medium).matches,
    large: window.matchMedia(queries.large).matches,
  };
};

/**
 * Reads the Design System theme breakpoints (small 520, medium 768, large
 * 1080) through matchMedia. Replaces hand-written max-width media checks
 * so JS layout switches happen exactly where DS CSS switches.
 *
 * @returns {{
 *   breakpoint: 'initial'|'small'|'medium'|'large',
 *   isBelowSmall: boolean,
 *   isBelowMedium: boolean,
 *   isBelowLarge: boolean,
 * }} Current breakpoint flags.
 */
export function useBreakpoint() {
  const theme = useTheme();
  const queries = useMemo(() => getBreakpointQueries(theme), [theme]);
  const [matches, setMatches] = useState(() => readMatches(queries));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const lists = ['small', 'medium', 'large'].map((name) => window.matchMedia(queries[name]));
    const update = () => setMatches(readMatches(queries));
    update();
    lists.forEach((list) => list.addEventListener?.('change', update));
    return () => lists.forEach((list) => list.removeEventListener?.('change', update));
  }, [queries]);

  const breakpoint = resolveBreakpoint(matches);
  return {
    breakpoint,
    isBelowSmall: isBelowBreakpoint(breakpoint, 'small'),
    isBelowMedium: isBelowBreakpoint(breakpoint, 'medium'),
    isBelowLarge: isBelowBreakpoint(breakpoint, 'large'),
  };
}

export default useBreakpoint;
