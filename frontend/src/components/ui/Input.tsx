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
          <label htmlFor={id} className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'h-9 w-full rounded-lg bg-surface-200 border border-border px-3 py-2',
            'text-sm text-slate-100 placeholder:text-slate-600',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
            'transition-colors duration-150',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'border-rose-500 focus:ring-rose-500',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-rose-400">{error}</span>}
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
          <label htmlFor={id} className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={cn(
            'h-9 w-full rounded-lg bg-surface-200 border border-border px-3 py-2',
            'text-sm text-slate-100',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
            'transition-colors duration-150',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            error && 'border-rose-500',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {error && <span className="text-xs text-rose-400">{error}</span>}
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
          <label htmlFor={id} className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full rounded-lg bg-surface-200 border border-border px-3 py-2',
            'text-sm text-slate-100 placeholder:text-slate-600',
            'focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent',
            'transition-colors duration-150 resize-y min-h-[80px]',
            error && 'border-rose-500',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-rose-400">{error}</span>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
