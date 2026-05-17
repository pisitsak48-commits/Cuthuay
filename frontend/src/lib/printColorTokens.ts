/**
 * Print preview iframe CSS variables + modal chrome.
 * Mirrors theme-tokens.css for documents without app stylesheet.
 */

/** Hex mirrors of theme-tokens.css — use in template literals / inline style strings only */
export const themeHex = {
  textPrimary: '#1a1a1a',
  textSecondary: '#7b8a9a',
  textMuted: '#94a3b8',
  accentDark: '#1f2937',
  primary500: '#4a90e2',
  primary600: '#357abd',
  gray50: '#f8fafc',
  gray100: '#f1f5f9',
  gray200: '#e2e8f0',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray600: '#64748b',
  gray700: '#475569',
  gray800: '#334155',
  slipHeaderBg: '#dbeafe',
  slipFooterBg: '#eff6ff',
  borderFormal: '#1e293b',
  danger: '#b91c1c',
  success: '#2e7d32',
  surface: '#ffffff',
  rowStripe: 'rgba(241, 245, 249, 0.85)',
  tableShadow: 'rgba(30, 41, 59, 0.06)',
} as const;

/** Injected at top of PREVIEW_STYLE — use var(--p-*) in print rules only */
export const PRINT_STYLE_ROOT = `
:root {
  --p-font-sans: 'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif;
  --p-text: #1a1a1a;
  --p-text-secondary: #7b8a9a;
  --p-text-muted: #94a3b8;
  --p-border: rgba(30, 41, 59, 0.12);
  --p-border-soft: rgba(30, 41, 59, 0.08);
  --p-surface: #ffffff;
  --p-surface-muted: rgba(255, 255, 255, 0.52);
  --p-stripe: rgba(241, 245, 249, 0.9);
  --p-accent: #4a90e2;
  --p-accent-soft: rgba(239, 246, 255, 0.96);
  --p-accent-mid: rgba(74, 144, 226, 0.35);
  --p-accent-dark: #1f2937;
  --p-header-shade: linear-gradient(180deg, rgba(239, 246, 255, 0.95), rgba(147, 197, 253, 0.45));
  --p-header-shade-strong: linear-gradient(180deg, rgba(239, 246, 255, 0.92), rgba(74, 144, 226, 0.38));
  --p-body-bg: linear-gradient(165deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.96) 45%, rgba(239, 246, 255, 0.4) 100%);
  --p-num: #475569;
  --p-section-border: #cbd5e1;
  --p-success: #2e7d32;
  --p-danger: #b91c1c;
  --p-shadow: rgba(30, 41, 59, 0.06);
  --p-brand: #1e3a5f;
  --p-brand-muted: #64748b;
  --p-banner: #dbeafe;
  --p-formal-border: #1e293b;
  --p-formal-header: #bfdbfe;
  --p-formal-sub: #eff6ff;
}
`.trim();

/** Preview modal shell (separate from print CSS) */
export const previewChrome = {
  overlayBg: 'rgba(15, 23, 42, 0.72)',
  cardBg: '#1e293b',
  toolbarBg: '#0f172a',
  toolbarBorder: 'rgba(255, 255, 255, 0.08)',
  titleColor: '#f1f5f9',
  printBtnBg: 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
  printBtnFg: '#ffffff',
  printBtnHover: '#2c64ad',
  closeBtnBg: 'rgb(100, 116, 139)',
  closeBtnFg: '#ffffff',
  closeBtnHover: 'rgb(71, 85, 105)',
  iframeBg: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
} as const;
