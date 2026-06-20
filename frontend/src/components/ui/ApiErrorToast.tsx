'use client';
import { useEffect } from 'react';
import { useApiErrorToast } from '@/lib/apiErrorToast';

export function ApiErrorToast() {
  const message = useApiErrorToast((s) => s.message);
  const variant = useApiErrorToast((s) => s.variant);
  const dismiss = useApiErrorToast((s) => s.dismiss);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(dismiss, 7_000);
    return () => clearTimeout(timer);
  }, [message, dismiss]);

  if (!message) return null;

  const isSuccess = variant === 'success';

  return (
    <div
      role="alert"
      className={
        isSuccess
          ? 'fixed bottom-safe-4 right-4 z-[200] max-w-md rounded-xl border border-profit/40 bg-[var(--color-card-bg-solid)] px-4 py-3 text-sm text-profit shadow-[var(--shadow-lift-hover)]'
          : 'fixed bottom-safe-4 right-4 z-[200] max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-theme-text-primary shadow-[var(--shadow-lift-hover)]'
      }
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 leading-snug">{message}</p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-theme-text-muted hover:text-theme-text-primary text-lg leading-none"
          aria-label="ปิด"
        >
          ×
        </button>
      </div>
    </div>
  );
}
