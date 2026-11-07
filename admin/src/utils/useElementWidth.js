import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks the content width of one element with a ResizeObserver. Returns a
 * callback ref and the width in px (0 until measured or when ResizeObserver
 * is unavailable, so callers fall back to breakpoint logic).
 *
 * @returns {[(node: HTMLElement|null) => void, number]} Ref callback and width.
 */
export function useElementWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef(null);

  const ref = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width || 0);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, width];
}

export default useElementWidth;
