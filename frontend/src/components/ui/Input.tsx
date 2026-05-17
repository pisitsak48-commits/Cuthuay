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
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.24em] text-theme-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'h-11 w-full rounded-full px-4 py-2 border-0 bg-gray-100 text-gray-900 placeholder:text-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-0',
            'transition-all duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'ring-2 ring-red-400 focus:ring-red-400',
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
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.24em] text-theme-text-secondary">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={cn(
            'h-11 w-full rounded-full px-4 py-2 border-0 text-sm bg-gray-100 text-gray-900',
            'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-0',
            'transition-all duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'ring-2 ring-red-400',
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
          <label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.24em] text-theme-text-secondary">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-2xl px-4 py-3 border-0 text-sm resize-y min-h-[80px] bg-gray-100 text-gray-900 placeholder:text-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-0',
            'transition-all duration-theme [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
            error && 'ring-2 ring-red-400',
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
