import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        /** Semantic text (prefer over raw gray Tailwind for body copy) */
        ink: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
          accent: 'var(--text-accent)',
        },
        primary: {
          50: 'var(--primary-50)',
          100: 'var(--primary-100)',
          200: 'var(--primary-200)',
          300: 'var(--primary-300)',
          400: 'var(--primary-400)',
          500: 'var(--primary-500)',
          600: 'var(--primary-600)',
          700: 'var(--primary-700)',
          800: 'var(--primary-800)',
          900: 'var(--primary-900)',
        },
        tokengray: {
          50: 'var(--gray-50)',
          100: 'var(--gray-100)',
          200: 'var(--gray-200)',
          300: 'var(--gray-300)',
          400: 'var(--gray-400)',
          500: 'var(--gray-500)',
          600: 'var(--gray-600)',
          700: 'var(--gray-700)',
          800: 'var(--gray-800)',
          900: 'var(--gray-900)',
          950: 'var(--gray-950)',
        },
        accentDark: {
          50: 'var(--accent-dark-50)',
          100: 'var(--accent-dark-100)',
          200: 'var(--accent-dark-200)',
          300: 'var(--accent-dark-300)',
          400: 'var(--accent-dark-400)',
          500: 'var(--accent-dark-500)',
          600: 'var(--accent-dark-600)',
          700: 'var(--accent-dark-700)',
          800: 'var(--accent-dark-800)',
          900: 'var(--accent-dark-900)',
          950: 'var(--accent-dark-950)',
        },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
        },
        surface: {
          DEFAULT: 'rgb(var(--tw-surface-default) / <alpha-value>)',
          50: 'rgb(var(--tw-surface-50) / <alpha-value>)',
          100: 'rgb(var(--tw-surface-100) / <alpha-value>)',
          200: 'rgb(var(--tw-surface-200) / <alpha-value>)',
          300: 'rgb(var(--tw-surface-300) / <alpha-value>)',
          400: 'rgb(var(--tw-surface-400) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--tw-border-default) / <alpha-value>)',
          muted: 'rgb(var(--tw-border-muted) / <alpha-value>)',
          bright: 'rgb(var(--tw-border-bright) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--tw-accent) / <alpha-value>)',
          hover: 'rgb(var(--tw-accent-hover) / <alpha-value>)',
          glow: 'rgb(var(--tw-accent-glow) / <alpha-value>)',
        },
        theme: {
          bg: 'var(--color-bg-primary)',
          'bg-secondary': 'var(--color-bg-secondary)',
          card: 'var(--color-card-bg)',
          'card-border': 'var(--color-card-border)',
          'text-primary': 'var(--color-text-primary)',
          'text-secondary': 'var(--color-text-secondary)',
          'text-muted': 'var(--color-text-muted)',
          'text-accent': 'var(--color-text-accent)',
          border: 'var(--color-border)',
          accent: 'var(--color-accent)',
          'accent-hover': 'var(--color-accent-hover)',
          'header-bg': 'var(--color-header-bg)',
          'header-border': 'var(--color-header-border)',
          'btn-primary-fg': 'var(--color-btn-primary-fg)',
        },
        risk: {
          low: 'rgb(var(--color-risk-low) / <alpha-value>)',
          medium: 'rgb(var(--color-risk-medium) / <alpha-value>)',
          high: 'rgb(var(--color-risk-high) / <alpha-value>)',
          critical: 'rgb(var(--color-risk-critical) / <alpha-value>)',
        },
        profit: 'rgb(var(--color-profit) / <alpha-value>)',
        loss: 'rgb(var(--color-loss) / <alpha-value>)',
        neutral: 'rgb(var(--color-neutral) / <alpha-value>)',
        /** Solid primary CTA — was gradient via backgroundImage; keep name for existing classNames */
        'btn-primary': 'var(--color-accent)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-thai)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'app-gradient': 'var(--gradient-page)',
        'soft-blue-gradient': 'var(--accent-gradient)',
        /** Primary CTA — matches bg-gradient-to-r from-blue-500 to-blue-600 */
        'gradient-primary':
          'linear-gradient(to right, rgb(59 130 246), rgb(37 99 235))',
        'grid-pattern':
          'linear-gradient(rgb(var(--gray-rgb-900) / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--gray-rgb-900) / 0.06) 1px, transparent 1px)',
      },
      backgroundSize: {
        'grid-40': '40px 40px',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      boxShadow: {
        /** Tailwind-aligned soft stack (dashboard) */
        'dashboard-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'dashboard-md':
          '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
        card: 'var(--color-card-shadow)',
        'card-hover': 'var(--shadow-hover)',
        'glow-blue': 'var(--shadow-soft)',
        'glow-cyan': 'var(--shadow-soft)',
        'glow-purple': 'var(--shadow-soft)',
        'glow-red': 'var(--shadow-soft)',
        'glow-green': 'var(--shadow-soft)',
        'btn-primary': 'var(--shadow-btn-primary)',
        'btn-primary-hover': 'var(--shadow-btn-primary-hover)',
        'btn-danger': 'var(--shadow-btn-danger)',
        'btn-success': 'var(--shadow-btn-success)',
        'btn-success-hover': 'var(--shadow-btn-success-hover)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        xl: 'var(--radius-xl)',
        /** Prefer rounded-2xl (1rem) for cards; slight bump for hero surfaces */
        '3xl': '1.5rem',
      },
      transitionDuration: {
        theme: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
