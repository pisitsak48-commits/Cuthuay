import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Round } from '@/types';

const TH_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;

/** ป้ายแกนกราฟ: วัน + เดือนย่อ — อ่านง่ายกว่าชื่องวดเต็ม */
export function roundChartAxisLabel(r: Pick<Round, 'draw_date' | 'name'>): string {
  const raw = r.draw_date.includes('T') ? r.draw_date : `${r.draw_date}T12:00:00`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return r.name.length > 14 ? `${r.name.slice(0, 14)}…` : r.name;
  }
  return `${d.getDate()} ${TH_MONTH_SHORT[d.getMonth()]}`;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBaht(value: number, decimals = 0): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
