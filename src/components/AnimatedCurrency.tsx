import { useEffect, useRef, useState } from 'react';
import { fmtCOP } from '../../shared/format';

// Número animado con count-up (easeOutCubic). Respeta prefers-reduced-motion.
export default function AnimatedCurrency({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(to);
      prevRef.current = to;
      return;
    }
    const duration = 650;
    let startTime: number | null = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startTime === null) startTime = t;
      const p = Math.min((t - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      prevRef.current = to;
    };
  }, [value]);

  return <span className={className}>{fmtCOP(display)}</span>;
}
