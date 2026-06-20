'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
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
    <div className="min-h-dvh flex flex-col items-center justify-center relative overflow-hidden px-4 py-10 sm:py-14"
      style={{ background: 'var(--gradient-page)' }}
    >
      {/* ── Decorative background ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-grid-pattern bg-grid-40 opacity-[0.28]" />
      </div>

      {/* ── Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <h1 className="sr-only">{APP_BRAND_NAME} — เข้าสู่ระบบ</h1>

        <div className="rounded-2xl bg-[var(--color-card-bg-solid)] shadow-[0_8px_40px_rgba(30,41,59,0.12),0_1px_3px_rgba(30,41,59,0.06)] overflow-hidden">

          {/* ── Brand zone ── */}
          <div className="relative flex flex-col items-center text-center px-8 sm:px-10 pt-10 pb-8">
            {/* Top gradient sheen */}
            <div aria-hidden className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[var(--color-accent)]/[0.07] to-transparent pointer-events-none" />
            {/* Hairline top border glow */}
            <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--color-accent)]/50 to-transparent" />

            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div className="absolute -inset-2 rounded-2xl bg-gradient-to-b from-[var(--color-accent)]/10 to-transparent blur-lg pointer-events-none" />
              <div className="relative w-[13rem] sm:w-[14.5rem] rounded-2xl bg-[var(--color-card-bg-solid)] shadow-sm ring-1 ring-[var(--color-border)] px-5 py-4 sm:py-5">
                <Image
                  src={APP_LOGO_PUBLIC_PATH}
                  alt={APP_BRAND_NAME}
                  width={320}
                  height={180}
                  className="h-auto w-full max-h-[5.5rem] sm:max-h-[6rem] object-contain mx-auto"
                  priority
                />
              </div>
            </motion.div>

            {/* Tagline */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 space-y-1.5"
            >
              <p className="text-[10.5px] font-bold uppercase tracking-[0.26em] text-theme-text-primary/80 flex items-center justify-center gap-2.5">
                <span className="w-8 h-px bg-gradient-to-r from-transparent to-[var(--color-accent)]/70" />
                {APP_BRAND_TAGLINE}
                <span className="w-8 h-px bg-gradient-to-l from-transparent to-[var(--color-accent)]/70" />
              </p>
              <p className="text-[12.5px] text-theme-text-muted leading-snug">
                ระบบจัดการความเสี่ยงยอดหวย
                <span className="mx-1.5 opacity-40">·</span>
                <span className="opacity-70">Lottery risk suite</span>
              </p>
            </motion.div>
          </div>

          {/* ── Divider ── */}
          <div className="mx-6 h-px bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" />

          {/* ── Form zone ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.35 }}
            className="px-8 sm:px-10 pt-6 pb-8"
          >
            {needsFirstUser === null ? (
              <div className="py-10 flex flex-col items-center gap-3">
                <svg className="animate-spin h-5 w-5 text-[var(--color-accent)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-theme-text-muted">กำลังตรวจสอบระบบ…</span>
              </div>
            ) : needsFirstUser ? (
              <>
                <div className="mb-5 rounded-xl bg-[var(--color-badge-warning-bg)] border border-[var(--color-badge-warning-border)] px-4 py-3 text-sm text-[var(--color-badge-warning-text)] leading-relaxed">
                  ยังไม่มีบัญชีในระบบ — สร้าง <strong className="font-semibold">ผู้ดูแลระบบคนแรก</strong>{' '}
                  <span className="opacity-70">(ครั้งเดียวหลังติดตั้ง)</span>
                </div>
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
                  <AnimatePresence>
                    {error && <ErrorBox message={error} />}
                  </AnimatePresence>
                  <Button type="submit" loading={bootSubmitting} className="w-full mt-1" size="lg">
                    สร้างบัญชีและเข้าสู่ระบบ
                  </Button>
                </form>
              </>
            ) : (
              <>
                <p className="text-[13px] text-theme-text-muted mb-5 text-center font-medium">
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
                  <AnimatePresence>
                    {error && <ErrorBox message={error} />}
                  </AnimatePresence>
                  <Button type="submit" loading={isSubmitting} className="w-full mt-1 !shadow-[0_6px_24px_rgba(53,122,189,0.35)]" size="lg">
                    เข้าสู่ระบบ
                  </Button>
                </form>
              </>
            )}
          </motion.div>

        </div>

        {/* ── Footer ── */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.3 }}
          className="mt-6 text-center space-y-0.5 px-2"
        >
          <p className="text-[11px] text-theme-text-muted/70">
            <span className="tabular-nums tracking-tight text-theme-text-muted font-medium">{APP_BRAND_NAME}</span>
            {' '}เวอร์ชัน{' '}
            <span className="tabular-nums font-medium text-theme-text-secondary">{APP_SOFTWARE_VERSION}</span>
          </p>
          <p className="text-[11px] text-theme-text-muted/60">
            ออกแบบและพัฒนา ·{' '}
            <span className="text-theme-text-muted/80 font-medium">{APP_DEVELOPER_NAME}</span>
          </p>
        </motion.footer>
      </motion.div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] px-3.5 py-2.5 text-xs text-[var(--color-badge-danger-text)] leading-relaxed"
    >
      {message}
    </motion.div>
  );
}
