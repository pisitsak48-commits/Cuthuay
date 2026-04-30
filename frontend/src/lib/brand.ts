/** ชื่อแสดงในแอป / หัวรายงาน PDF */
export const APP_BRAND_NAME = 'AuraX';
export const APP_BRAND_TAGLINE = 'SMART NUMBERS, BIG WINS';

/** เวอร์ชันซอฟต์แวร์ (ให้ตรงกับ `frontend/package.json` → version) */
export const APP_SOFTWARE_VERSION = '1.0.0';
/** ผู้ออกแบบและพัฒนา — แสดงหน้า login */
export const APP_DEVELOPER_NAME = 'Pisitsak Kruepet';
/** ไฟล์ใน `public/` สำหรับ Next.js */
export const APP_LOGO_PUBLIC_PATH = '/aurax-logo.png';

/** URL สำหรับ `<img>` ในหน้าต่างพิมพ์ (iframe `srcdoc` ต้องใช้ absolute URL) */
export function getBrandLogoAbsoluteUrl(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${APP_LOGO_PUBLIC_PATH}`;
}
