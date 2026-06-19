'use client';
import { MotionConfig } from 'framer-motion';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // reducedMotion="user" makes every motion component in the tree respect
  // the OS prefers-reduced-motion setting automatically.
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  );
}
