'use client';
import { createContext, useCallback, useContext, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/useFocusTrap';

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true (default) = red confirm button; false = blue accent */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

/** Call anywhere inside <ConfirmDialogProvider> to show a modal confirmation. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

// ── Provider ───────────────────────────────────────────────────────────────────

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Keep last options stable so the dialog content doesn't flash during exit animation
  const [lastOptions, setLastOptions] = useState<ConfirmOptions>({ message: '' });

  const confirm: ConfirmFn = useCallback(
    (options) =>
      new Promise<boolean>((resolve) => {
        setLastOptions(options);
        setPending({ options, resolve });
      }),
    [],
  );

  const settle = useCallback((result: boolean) => {
    setPending((prev) => {
      prev?.resolve(result);
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => settle(false), [settle]);
  const handleConfirm = useCallback(() => settle(true), [settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialogPanel
        open={pending !== null}
        options={pending?.options ?? lastOptions}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

// ── Dialog Panel ───────────────────────────────────────────────────────────────

function ConfirmDialogPanel({
  open,
  options,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    message,
    title,
    confirmLabel = 'ตกลง',
    cancelLabel = 'ยกเลิก',
    danger = true,
  } = options;

  // Cancel first in the DOM → gets initial focus (safe default for destructive actions)
  const panelRef = useFocusTrap(open, onCancel);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-[var(--color-backdrop-overlay)]"
            onClick={onCancel}
          />
          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={title ? 'confirm-dlg-title' : undefined}
            aria-label={title ? undefined : 'ยืนยันการดำเนินการ'}
            aria-describedby="confirm-dlg-desc"
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-sm rounded-2xl bg-[var(--color-card-bg-solid)] shadow-lg p-5 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <p
                id="confirm-dlg-title"
                className="text-sm font-semibold text-theme-text-primary mb-1.5"
              >
                {title}
              </p>
            )}
            <p
              id="confirm-dlg-desc"
              className="text-sm text-theme-text-secondary whitespace-pre-line leading-relaxed"
            >
              {message}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              {/* Cancel gets initial focus — safest for destructive dialogs */}
              <button
                type="button"
                onClick={onCancel}
                className="h-8 px-4 rounded-lg text-sm font-medium bg-[var(--color-surface-muted)] text-theme-text-secondary hover:bg-[var(--gray-200)] transition-colors duration-[150ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={cn(
                  'h-8 px-4 rounded-lg text-sm font-semibold transition-colors duration-[150ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)]',
                  danger
                    ? 'bg-[rgb(var(--color-loss)/1)] text-[var(--text-inverse)] hover:brightness-90'
                    : 'bg-[var(--color-accent)] text-[var(--text-inverse)] hover:bg-[var(--color-accent-hover)]',
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
