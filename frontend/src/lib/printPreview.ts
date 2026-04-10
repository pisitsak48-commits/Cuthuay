/**
 * PDF print preview helper
 *
 * Opens a full-screen in-page modal overlay with a print button.
 * No auto-print. Uses an iframe srcdoc for clear rendering.
 */

const PREVIEW_STYLE = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Sarabun', 'TH Sarabun New', Arial, sans-serif;
    margin: 20px;
    font-size: 13px;
    color: #222;
    background: #fff;
  }
  h2  { font-size: 17px; margin: 0 0 4px; color: #111; }
  .sub { font-size: 13px; color: #444; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead tr { background: #f0e68c; }
  th { border: 1px solid #aaa; padding: 6px 10px; font-weight: bold; text-align: center; color: #111; }
  td { border: 1px solid #ccc; padding: 5px 10px; color: #222; }
  tfoot tr td { background: #fffde7; font-weight: bold; }
  .num  { text-align: right; font-family: monospace; color: #003580; }
  .l    { text-align: left; }
  .section-title {
    font-size: 14px; font-weight: bold;
    margin: 16px 0 6px;
    border-bottom: 2px solid #bbb;
    padding-bottom: 3px;
    color: #111;
  }
  .kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px; }
  .kpi-box  { padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: #fafaf0; }
  .kpi-label { font-size: 11px; color: #555; }
  .kpi-value { font-size: 16px; font-weight: bold; color: #003580; }
  .stripe-even { background: #f8f8f0; }
  .total-row td { background: #fffde7; font-weight: bold; }
  .neg { color: #a50000 !important; font-weight: bold; }
  .pos { color: #1a6f27 !important; font-weight: bold; }
  .result-box { margin-bottom: 10px; padding: 8px; background: #fffde7; border: 1px solid #ccc; border-radius: 3px; }
  .print-ts  { margin-top: 12px; font-size: 11px; color: #999; }
  @media print {
    body { margin: 10mm; }
    .no-print { display: none !important; }
  }
`;

/** Build a complete HTML document string (no auto-print) */
export function buildHtmlDoc(bodyHtml: string, title: string): string {
  const ts = new Date().toLocaleString('th-TH');
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>${PREVIEW_STYLE}</style>
</head>
<body>
${bodyHtml}
<div class="print-ts">พิมพ์เมื่อ ${ts}</div>
</body>
</html>`;
}

/**
 * Open an in-page full-screen preview overlay.
 * Renders the document in an iframe for perfect fidelity.
 * Print button uses iframe.contentWindow.print().
 * Escape key and backdrop click close the overlay.
 */
export function openPrintPreview(bodyHtml: string, title: string, filename: string): void {
  const fullHtml = buildHtmlDoc(bodyHtml, title);

  // ── Build overlay DOM ────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__print-preview-overlay__';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: 'rgba(0,0,0,0.72)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    animation: 'ppFadeIn 0.18s ease',
  });

  // Inject keyframe once
  if (!document.getElementById('__pp-keyframes__')) {
    const style = document.createElement('style');
    style.id = '__pp-keyframes__';
    style.textContent = `
      @keyframes ppFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes ppSlideUp { from { transform:translateY(24px) scale(0.98); opacity:0; } to { transform:none; opacity:1; } }
    `;
    document.head.appendChild(style);
  }

  // ── Modal card ───────────────────────────────────────────────────────────
  const card = document.createElement('div');
  Object.assign(card.style, {
    width: '92vw',
    height: '92vh',
    maxWidth: '1100px',
    background: '#1e2535',
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    animation: 'ppSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    background: '#151c2c',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: '0',
    fontFamily: "'Sarabun', Arial, sans-serif",
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    flex: '1',
    fontSize: '13px',
    fontWeight: '600',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  titleEl.textContent = `📄 ${title}`;

  const makeBtn = (label: string, bg: string, color: string, hoverBg: string) => {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      padding: '6px 18px',
      background: bg,
      color,
      border: 'none',
      borderRadius: '7px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: "'Sarabun', Arial, sans-serif",
      transition: 'background 0.15s',
      whiteSpace: 'nowrap',
    });
    btn.textContent = label;
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseleave', () => { btn.style.background = bg; });
    return btn;
  };

  const printBtn = makeBtn('🖨 พิมพ์ / บันทึก PDF', '#f0e68c', '#111', '#e2d43a');
  const closeBtn = makeBtn('✕ ปิด', '#374151', '#e2e8f0', '#4b5563');

  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 160);
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // ── iframe ───────────────────────────────────────────────────────────────
  const iframe = document.createElement('iframe') as HTMLIFrameElement;
  Object.assign(iframe.style, {
    flex: '1',
    border: 'none',
    background: '#f8fafc',
    borderRadius: '0 0 14px 14px',
  });

  printBtn.addEventListener('click', () => {
    (iframe as HTMLIFrameElement).contentWindow?.print();
  });

  toolbar.appendChild(titleEl);
  toolbar.appendChild(printBtn);
  toolbar.appendChild(closeBtn);
  card.appendChild(toolbar);
  card.appendChild(iframe);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Write content after iframe is in DOM
  iframe.srcdoc = fullHtml;
}
