'use client';
import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[var(--tracking-label-caps)] text-theme-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'h-11 w-full rounded-xl px-4 py-2 border-0 bg-[var(--color-surface-muted)] text-theme-text-primary placeholder:text-theme-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-0',
            'transition-[box-shadow] duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'ring-2 ring-[var(--color-semantic-danger)] focus:ring-[var(--color-semantic-danger)]',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-[rgb(var(--color-validation-error)/1)]">{error}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className, id, children, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[var(--tracking-label-caps)] text-theme-text-secondary">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={cn(
            'h-11 w-full rounded-xl px-4 py-2 border-0 text-sm bg-[var(--color-surface-muted)] text-theme-text-primary',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-0',
            'transition-[box-shadow] duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'ring-2 ring-[var(--color-semantic-danger)]',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {error && <span className="text-xs text-[rgb(var(--color-validation-error)/1)]">{error}</span>}
      </div>
    );
  },
);
Select.displayName = 'Select';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[var(--tracking-label-caps)] text-theme-text-secondary">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-2xl px-4 py-3 border-0 text-sm resize-y min-h-[80px] bg-[var(--color-surface-muted)] text-theme-text-primary placeholder:text-theme-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-0',
            'transition-[box-shadow] duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            error && 'ring-2 ring-[var(--color-semantic-danger)]',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-[rgb(var(--color-validation-error)/1)]">{error}</span>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
