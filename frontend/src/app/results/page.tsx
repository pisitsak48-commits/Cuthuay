'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

/**
 * เดิมเป็นหน้าใส่ผลสลากแยก — รวมไว้ในหน้า «ทำรายการสรุป» แล้ว
 * เก็บ path นี้เพื่อ redirect ลิงก์เก่า /results?round=…
 */
function ResultsRedirectInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const round = searchParams.get('round');
    const q = round
      ? `?round=${encodeURIComponent(round)}&editResult=1`
      : '';
    router.replace(`/summary${q}`);
  }, [searchParams, router]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-theme-text-muted text-sm">
      กำลังไปหน้าสรุปผล…
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <ResultsRedirectInner />
    </Suspense>
  );
}
