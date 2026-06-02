'use client';
import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, disabled, className, children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed select-none';

    const variants = {
      primary:
        'bg-[var(--color-accent)] text-white border border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)]',
      ghost:
        'bg-white text-gray-900 border border-[var(--color-border)] hover:bg-[var(--bg-hover)]',
      danger:
        'bg-[rgb(var(--color-loss)/1)] text-[var(--text-inverse)] border border-[rgb(var(--color-validation-error-border)/0.35)] hover:brightness-95',
      success:
        'bg-[rgb(var(--color-profit)/1)] text-[var(--text-inverse)] border border-profit/30 hover:brightness-95',
      outline:
        'bg-gray-100 text-gray-900 border border-[var(--color-border)] hover:bg-gray-200/90',
    };

    const sizes = {
      sm: 'text-sm px-3 h-9 min-h-9',
      md: 'text-sm px-4 h-10 min-h-10',
      lg: 'text-base px-5 h-11 min-h-11',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
