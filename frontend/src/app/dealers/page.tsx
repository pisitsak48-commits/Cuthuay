'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DealersPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/customers?tab=dealer'); }, [router]);
  return null;
}

