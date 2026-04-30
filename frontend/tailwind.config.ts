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
        sans: ['Inter', 'Prompt', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'grid-pattern':
          'linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)',
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
      },
      borderRadius: {
        card: 'var(--radius-card)',
        /* ให้ rounded-xl เท่ามุมปุ่มหลัก (กรอบแผง/การ์ดที่ใช้ xl ทั้งแอป) */
        xl: '1rem',
      },
      transitionDuration: {
        theme: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
