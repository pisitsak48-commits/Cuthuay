/**
 * Typography for print preview, PNG export, and iframe PDF flow.
 * Matches app body: Inter (Latin / numbers) + IBM Plex Sans Thai + tabular nums.
 */

export const PRINT_GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';

/** CSS font-family value */
export const PRINT_FONT_FAMILY = `'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif`;

/** Root-level inline style for captured / iframe content wrappers */
export const PRINT_ROOT_INLINE_STYLE = [
  `font-family:${PRINT_FONT_FAMILY}`,
  'font-variant-numeric:tabular-nums',
  `font-feature-settings:'kern' 1,'liga' 1,'tnum' 1,'lnum' 1`,
].join(';');

/** Insert in <head> before embedded print CSS */
export const PRINT_FONT_HEAD_LINKS = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${PRINT_GOOGLE_FONTS_HREF}" rel="stylesheet" />
`.trim();

/** Returns font <link> tags for injection in iframe/srcdoc head */
export function printFontHeadMarkup(): string {
  return PRINT_FONT_HEAD_LINKS;
}

/**
 * Append Google Fonts link nodes under a host (used before html-to-image capture).
 */
export function appendPrintGoogleFontLinks(host: HTMLElement): void {
  const specs: Array<{ rel: string; href: string; crossOrigin?: 'anonymous' }> = [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    { rel: 'stylesheet', href: PRINT_GOOGLE_FONTS_HREF },
  ];
  for (const s of specs) {
    const link = document.createElement('link');
    link.rel = s.rel;
    link.href = s.href;
    if (s.crossOrigin) link.crossOrigin = s.crossOrigin;
    host.appendChild(link);
  }
}
