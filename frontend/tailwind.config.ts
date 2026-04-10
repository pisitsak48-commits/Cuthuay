import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark canvas — Japanese industrial meets Apple precision
        surface: {
          DEFAULT: '#0a0f1e',
          50:  '#0d1428',
          100: '#111827',
          200: '#1a2236',
          300: '#1e2d3d',
          400: '#243447',
        },
        border: {
          DEFAULT: '#1e293b',
          muted: '#0f172a',
          bright: '#334155',
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#60a5fa',
          glow: 'rgba(59,130,246,0.15)',
        },
        risk: {
          low:    '#22c55e',
          medium: '#f59e0b',
          high:   '#ef4444',
          critical: '#dc2626',
        },
        profit: '#22c55e',
        loss:   '#ef4444',
        neutral: '#94a3b8',
      },
      fontFamily: {
        sans: ['Kanit', 'system-ui', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace'],
      },
      backgroundImage: {
        'grid-pattern':
          "linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)",
        'glow-radial':
          'radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.12) 0%, transparent 70%)',
      },
      backgroundSize: {
        'grid-40': '40px 40px',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 4px 0 rgba(59,130,246,0.3)' },
          '50%':      { boxShadow: '0 0 20px 4px rgba(59,130,246,0.6)' },
        },
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(0,0,0,0.4), 0 1px 2px -1px rgba(0,0,0,0.4)',
        'card-hover': '0 4px 20px -4px rgba(59,130,246,0.2), 0 1px 3px rgba(0,0,0,0.4)',
        'glow-blue': '0 0 15px 2px rgba(59,130,246,0.35)',
        'glow-red':  '0 0 15px 2px rgba(239,68,68,0.35)',
        'glow-green':'0 0 15px 2px rgba(34,197,94,0.35)',
      },
    },
  },
  plugins: [],
};

export default config;
