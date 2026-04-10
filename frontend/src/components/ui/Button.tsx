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
      'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:cursor-not-allowed select-none';

    const variants = {
      primary:
        'bg-accent hover:bg-accent-hover text-white shadow-sm hover:shadow-glow-blue active:scale-[0.98]',
      ghost:
        'text-slate-300 hover:text-white hover:bg-surface-200 active:scale-[0.98]',
      danger:
        'bg-rose-600/20 hover:bg-rose-600/40 text-rose-400 border border-rose-600/30 hover:border-rose-500 active:scale-[0.98]',
      success:
        'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-600/30 active:scale-[0.98]',
      outline:
        'border border-border hover:border-border-bright text-slate-300 hover:text-white active:scale-[0.98]',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 h-7',
      md: 'text-sm px-4 py-2 h-9',
      lg: 'text-base px-5 py-2.5 h-11',
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
            className="animate-spin h-3.5 w-3.5"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4"
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
