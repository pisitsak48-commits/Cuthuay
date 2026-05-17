import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { THEME_INIT_SCRIPT } from '@/lib/theme-script';

/** โหลดฟอนต์ผ่าน stylesheet (ไม่ใช้ next/font/google) — ให้ `next build` / Docker ไม่ต้อง fetch fonts.googleapis.com */
const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap';

export const metadata: Metadata = {
  title: 'AuraX — Lottery Risk Management',
  description: 'Professional lottery exposure management and cut hedging system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_HREF} rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-app-ambient font-sans text-theme-text-primary antialiased min-h-dvh">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
