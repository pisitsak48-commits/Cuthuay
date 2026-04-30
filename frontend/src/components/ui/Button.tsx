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
      'inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition-[transform,box-shadow,background-color,border-color,opacity] duration-[200ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-40 disabled:cursor-not-allowed select-none';
    const ease = '[transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]';

    const variants = {
      primary: cn(
        ease,
        'bg-btn-primary text-theme-btn-primary-fg shadow-btn-primary hover:shadow-btn-primary-hover hover:-translate-y-px active:translate-y-0',
      ),
      ghost: cn(
        ease,
        'bg-white border border-theme-card-border text-theme-text-primary hover:bg-[var(--bg-hover)] hover:border-[var(--color-border-strong)] hover:-translate-y-px active:translate-y-0',
      ),
      danger: cn(
        ease,
        'bg-[rgb(var(--color-loss)/1)] text-theme-btn-primary-fg shadow-btn-danger border border-[rgb(var(--color-validation-error-border)/0.35)] hover:shadow-[var(--shadow-hover)] hover:-translate-y-px active:translate-y-0',
      ),
      success: cn(
        ease,
        'bg-[rgb(var(--color-profit)/1)] text-theme-btn-primary-fg border border-profit/30 shadow-btn-primary hover:shadow-btn-primary-hover hover:-translate-y-px active:translate-y-0',
      ),
      outline: cn(
        ease,
        'bg-transparent border border-theme-card-border text-theme-text-primary hover:bg-[var(--bg-glass-subtle)] hover:border-[var(--color-border-strong)] hover:-translate-y-px active:translate-y-0',
      ),
    };

    const sizes = {
      sm: 'text-xs px-3 py-2 h-8',
      md: 'text-sm px-4 py-2.5 h-10',
      lg: 'text-base px-5 py-3 h-12',
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
