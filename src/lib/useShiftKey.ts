import { useEffect, useState } from 'react';

/**
 * Whether Shift is currently held. Drives tooltips that describe the
 * shift-click action (force re-fetch) on the real-path buttons. setState bails
 * on an unchanged value, so ordinary typing doesn't churn re-renders.
 */
export function useShiftKey(): boolean {
  const [shift, setShift] = useState(false);
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setShift(e.shiftKey);
    const clear = () => setShift(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return shift;
}
