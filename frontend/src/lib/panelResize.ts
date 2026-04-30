/** ความกว้างแผงขวา (หน้ารับแทง / ตัดส่ง) — เก็บใน localStorage */

export const STORAGE_CUT_RIGHT_PANEL_W = 'cuthuay-cut-right-panel-w';
export const STORAGE_CUT_RIGHT_PANEL_LOCK = 'cuthuay-cut-right-panel-lock';
export const STORAGE_BETS_RIGHT_PANEL_W = 'cuthuay-bets-right-panel-w';
export const STORAGE_BETS_RIGHT_PANEL_LOCK = 'cuthuay-bets-right-panel-lock';

const clampW = (w: number, min = 260, max = 580) => Math.min(max, Math.max(min, Math.round(w)));

export function readPanelWidth(storageKey: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = parseInt(localStorage.getItem(storageKey) ?? '', 10);
    if (Number.isFinite(v)) return clampW(v);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function writePanelWidth(storageKey: string, width: number): void {
  try {
    localStorage.setItem(storageKey, String(clampW(width)));
  } catch {
    /* ignore */
  }
}

export function readPanelLock(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

export function writePanelLock(storageKey: string, locked: boolean): void {
  try {
    localStorage.setItem(storageKey, locked ? '1' : '0');
  } catch {
    /* ignore */
  }
}
