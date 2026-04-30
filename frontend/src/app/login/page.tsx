'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/useStore';
import { authApi } from '@/lib/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import Image from 'next/image';
import {
  APP_BRAND_NAME,
  APP_BRAND_TAGLINE,
  APP_DEVELOPER_NAME,
  APP_LOGO_PUBLIC_PATH,
  APP_SOFTWARE_VERSION,
} from '@/lib/brand';

const schema = z.object({
  username: z.string().min(1, 'กรุณากรอก username'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});
type FormData = z.infer<typeof schema>;

const bootstrapSchema = z.object({
  username: z.string().min(1, 'กรุณากรอก username'),
  password: z.string().min(6, 'รหัสผ่านอย่างน้อย 6 ตัว'),
});
type BootstrapData = z.infer<typeof bootstrapSchema>;

export default function LoginPage() {
  const { login, bootstrapFirstAdmin } = useAuthStore();
  const router = useRouter();
  const [error, setError] = useState('');
  const [needsFirstUser, setNeedsFirstUser] = useState<boolean | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });
  const {
    register: regBoot,
    handleSubmit: submitBoot,
    formState: { errors: bootErrors, isSubmitting: bootSubmitting },
  } = useForm<BootstrapData>({
    resolver: zodResolver(bootstrapSchema),
  });

  useEffect(() => {
    authApi
      .setupStatus()
      .then((r) => setNeedsFirstUser(r.data.needs_first_user))
      .catch(() => setNeedsFirstUser(false));
  }, []);

  const onSubmit = async (data: FormData) => {
    setError('');
    try {
      await login(data.username, data.password);
      const u = useAuthStore.getState().user;
      router.push(u?.role === 'operator' ? '/bets' : '/');
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message;
      setError(
        msg === 'Network Error' || /load failed/i.test(String(msg))
          ? 'เรียกเซิร์ฟเวอร์ไม่ถึง — เปิดที่ http://IP:3000 และตรวจ docker compose / CORS_ORIGIN ให้ตรง URL หน้าเว็บ'
          : msg ?? 'เข้าสู่ระบบไม่สำเร็จ',
      );
    }
  };

  const onBootstrap = async (data: BootstrapData) => {
    setError('');
    try {
      await bootstrapFirstAdmin(data.username, data.password);
      router.push('/');
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e?.message;
      setError(
        msg === 'Network Error' || /load failed/i.test(String(msg))
          ? 'เรียกเซิร์ฟเวอร์ไม่ถึง — ตรวจว่าเข้าพอร์ต 3000 และ backend รันที่ 4000'
          : msg ?? 'สร้างบัญชีไม่สำเร็จ',
      );
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center relative overflow-hidden bg-theme-bg px-4 py-10 sm:py-12">
      {/* Ambient — depth without clutter */}
      <div className="absolute inset-0 bg-grid-pattern bg-grid-40 pointer-events-none opacity-[0.5]" />
      <div
        className="absolute inset-0 pointer-events-none opacity-100"
        style={{
          background:
            'radial-gradient(ellipse 85% 55% at 50% -8%, rgba(11, 28, 63, 0.11), transparent 55%), radial-gradient(ellipse 70% 45% at 100% 100%, rgba(212, 175, 55, 0.07), transparent 50%), radial-gradient(ellipse 60% 40% at 0% 80%, rgba(11, 28, 63, 0.06), transparent 45%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[434px]"
      >
        <h1 className="sr-only">{APP_BRAND_NAME} — เข้าสู่ระบบ</h1>

        <div
          className="rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[0_28px_72px_-16px_rgba(11,28,63,0.22),0_0_0_1px_rgba(255,255,255,0.04)_inset] overflow-hidden"
        >
          {/* Brand zone */}
          <div className="relative text-center px-8 sm:px-10 pt-10 pb-9">
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3.5rem] bg-gradient-to-b from-[#0b1c3f]/[0.07] to-transparent pointer-events-none"
            />
            <div
              aria-hidden
              className="absolute left-1/2 top-0 -translate-x-1/2 w-24 h-px bg-gradient-to-r from-transparent via-[#d4af37]/55 to-transparent"
            />

            <div className="relative mx-auto flex flex-col items-center">
              <div className="w-full max-w-[208px] sm:max-w-[228px] rounded-2xl bg-white/[0.06] dark:bg-white/[0.03] px-5 py-4 sm:py-5 ring-1 ring-[#0b1c3f]/[0.08] shadow-[0_8px_32px_-8px_rgba(11,28,63,0.15)]">
                <Image
                  src={APP_LOGO_PUBLIC_PATH}
                  alt=""
                  width={320}
                  height={180}
                  className="h-auto w-full max-h-[5.75rem] sm:max-h-[6.25rem] object-contain object-center mx-auto"
                  priority
                />
              </div>

              <p className="mt-6 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0b1c3f] leading-relaxed max-w-[19rem] mx-auto">
                <span className="text-[#c9a227] font-normal">—</span>
                <span className="px-2">{APP_BRAND_TAGLINE}</span>
                <span className="text-[#c9a227] font-normal">—</span>
              </p>
              <p className="mt-2.5 text-[13px] text-theme-text-muted leading-snug">
                ระบบจัดการความเสี่ยงยอดหวย
                <span className="text-theme-text-muted/70"> · </span>
                <span className="text-theme-text-muted/75">Lottery risk suite</span>
              </p>
            </div>
          </div>

          {/* Form zone */}
          <div className="relative px-8 sm:px-10 pb-9 pt-1 border-t border-[var(--color-border)] bg-[var(--bg-glass-subtle)]/40">
            <div
              aria-hidden
              className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/25 to-transparent"
            />

            {needsFirstUser === null ? (
              <div className="py-12 text-center text-sm text-theme-text-muted">กำลังตรวจสอบระบบ…</div>
            ) : needsFirstUser ? (
              <>
                <p className="text-sm text-theme-text-secondary mb-5 leading-relaxed">
                  ยังไม่มีบัญชีในระบบ — สร้าง <strong className="text-theme-text-primary font-semibold">ผู้ดูแลระบบคนแรก</strong>{' '}
                  <span className="text-theme-text-muted">(ครั้งเดียวหลังติดตั้ง)</span>
                </p>
                <form onSubmit={submitBoot(onBootstrap)} className="space-y-4">
                  <Input
                    label="Username"
                    id="boot-username"
                    placeholder="เช่น admin"
                    autoComplete="username"
                    {...regBoot('username')}
                    error={bootErrors.username?.message}
                  />
                  <Input
                    label="Password"
                    id="boot-password"
                    type="password"
                    placeholder="อย่างน้อย 6 ตัว"
                    autoComplete="new-password"
                    {...regBoot('password')}
                    error={bootErrors.password?.message}
                  />
                  {error && (
                    <div className="rounded-xl bg-[var(--color-badge-danger-bg)] border-[var(--color-badge-danger-border)] border px-3.5 py-2.5 text-xs text-[var(--color-badge-danger-text)] leading-relaxed">
                      {error}
                    </div>
                  )}
                  <Button type="submit" loading={bootSubmitting} className="w-full mt-1" size="lg">
                    สร้างบัญชีและเข้าสู่ระบบ
                  </Button>
                </form>
              </>
            ) : (
              <>
                <p className="text-[13px] text-theme-text-secondary mb-5 text-center sm:text-left">
                  เข้าสู่ระบบด้วยบัญชีของคุณ
                </p>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <Input
                    label="Username"
                    id="username"
                    placeholder="ชื่อผู้ใช้"
                    autoComplete="username"
                    {...register('username')}
                    error={errors.username?.message}
                  />
                  <Input
                    label="Password"
                    id="password"
                    type="password"
                    placeholder="รหัสผ่าน"
                    autoComplete="current-password"
                    {...register('password')}
                    error={errors.password?.message}
                  />

                  {error && (
                    <div className="rounded-xl bg-[var(--color-badge-danger-bg)] border-[var(--color-badge-danger-border)] border px-3.5 py-2.5 text-xs text-[var(--color-badge-danger-text)] leading-relaxed">
                      {error}
                    </div>
                  )}

                  <Button type="submit" loading={isSubmitting} className="w-full mt-1" size="lg">
                    เข้าสู่ระบบ
                  </Button>
                </form>

                <p className="mt-5 text-center text-[11px] text-theme-text-muted/90 leading-relaxed">
                  Please sign in with your username and password.
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="mt-8 text-center text-[11px] text-theme-text-muted/90 leading-relaxed space-y-1 px-2">
          <p>
            <span className="text-theme-text-muted">เวอร์ชัน</span>{' '}
            <span className="font-mono tabular-nums text-theme-text-secondary font-medium">{APP_SOFTWARE_VERSION}</span>
          </p>
          <p>
            ออกแบบและพัฒนา ·{' '}
            <span className="text-theme-text-secondary font-medium">{APP_DEVELOPER_NAME}</span>
          </p>
        </footer>
      </motion.div>
    </div>
  );
}
