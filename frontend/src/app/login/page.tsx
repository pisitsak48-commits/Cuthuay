'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/useStore';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

const schema = z.object({
  username: z.string().min(1, 'กรุณากรอก username'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});
type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuthStore();
  const router = useRouter();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError('');
    try {
      await login(data.username, data.password);
      router.push('/');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'เข้าสู่ระบบไม่สำเร็จ');
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-glow-radial pointer-events-none" />
      <div className="absolute inset-0 bg-grid-pattern bg-grid-40 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 mb-4 shadow-glow-blue">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">CutHuay</h1>
          <p className="text-sm text-slate-500 mt-1">Lottery Risk Management System</p>
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-border bg-surface-100/80 backdrop-blur-sm p-7 shadow-card">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Username"
              id="username"
              placeholder="admin"
              autoComplete="username"
              {...register('username')}
              error={errors.username?.message}
            />
            <Input
              label="Password"
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              {...register('password')}
              error={errors.password?.message}
            />

            {error && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-400">
                {error}
              </div>
            )}

            <Button type="submit" loading={isSubmitting} className="w-full mt-2" size="lg">
              เข้าสู่ระบบ
            </Button>
          </form>

          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-xs text-slate-600 text-center">
              Demo: admin / admin1234
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
