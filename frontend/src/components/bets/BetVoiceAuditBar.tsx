'use client';

import type { Dispatch, SetStateAction } from 'react';
import { cancelSpeech } from '@/lib/sounds';
import {
  writeVoiceAuditMode,
  writeVoiceAuditRate,
  type VoiceAuditCheckpointV1,
} from '@/lib/bets/voiceAuditPrefs';
import { cn } from '@/lib/utils';
import type { BetSheetGroup } from '@/lib/bets/betSheetGroups';

export type BetVoiceAuditBarProps = {
  soundOn: boolean;
  setSoundOn: Dispatch<SetStateAction<boolean>>;
  speechRate: number;
  setSpeechRate: Dispatch<SetStateAction<number>>;
  voiceAuditMode: boolean;
  setVoiceAuditMode: Dispatch<SetStateAction<boolean>>;
  voiceAuditRate: number;
  setVoiceAuditRate: Dispatch<SetStateAction<number>>;
  sheetGrouped: BetSheetGroup[];
  focusedIdx: number;
  voiceAuditDispIdx: number | null;
  voiceAuditCpMatches: boolean;
  voiceAuditBarCp: VoiceAuditCheckpointV1 | null;
  voiceAuditPaused: boolean;
  voiceAuditResetReading: () => void;
  voiceAuditGoPrev: () => void;
  voiceAuditHitPause: () => void;
  voiceAuditHitPlay: () => void;
  voiceAuditGoNext: () => void;
};

export function BetVoiceAuditBar(props: BetVoiceAuditBarProps) {
  const {
    soundOn,
    setSoundOn,
    speechRate,
    setSpeechRate,
    voiceAuditMode,
    setVoiceAuditMode,
    voiceAuditRate,
    setVoiceAuditRate,
    sheetGrouped,
    focusedIdx,
    voiceAuditDispIdx,
    voiceAuditCpMatches,
    voiceAuditBarCp,
    voiceAuditPaused,
    voiceAuditResetReading,
    voiceAuditGoPrev,
    voiceAuditHitPause,
    voiceAuditHitPlay,
    voiceAuditGoNext,
  } = props;

  return (
    <>
    {/* เสียง + ตรวจด้วยเสียง — แผงพรีเมียมใต้ตารางสรุป */}
    <div
      className={cn(
        'shrink-0 border-t border-[color-mix(in_srgb,var(--chart-primary)_24%,var(--color-border))]',
        'bg-[var(--color-surface)]',
        'px-3 pb-3 pt-3',
      )}
    >
      <p className="mb-2.5 text-[11px] font-semibold text-theme-text-muted">ควบคุมเสียง</p>

      <div
        className={cn(
          'rounded-2xl border border-[color-mix(in_srgb,var(--chart-primary)_18%,var(--color-border))]',
          'bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)] backdrop-blur-[10px]',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]',
          'p-2.5 space-y-3',
        )}
      >
        {/* พูดตอนคีย์ */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[11px] font-bold text-theme-text-muted">เสียงคีย์</span>
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_3.5%,var(--color-surface))] px-1.5 py-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_10%,var(--color-border))] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
            <button type="button" title={soundOn ? 'ปิดเสียงพูด' : 'เปิดเสียงพูด'} onClick={() => setSoundOn(v => !v)}
              className={cn(
                'flex !h-8 !min-w-[2rem] !px-0 items-center justify-center rounded-lg text-base shadow-sm transition-[color,border-color,box-shadow] duration-150 shrink-0',
                soundOn
                  ? 'bg-gradient-to-b from-[color-mix(in_srgb,var(--chart-primary)_22%,white)] to-[color-mix(in_srgb,var(--primary-100)_55%,white)] text-[var(--primary-800)] ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_28%,transparent)]'
                  : 'bg-[var(--color-surface)] text-theme-text-muted ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
            <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--color-border-muted)]" />
            <button type="button" title="ช้าลง" disabled={!soundOn}
              onClick={() => setSpeechRate(r => Math.max(0.8, parseFloat((r - 0.2).toFixed(1))))}
              className="flex !h-8 !min-w-[2rem] items-center justify-center rounded-lg bg-[var(--color-surface)] text-sm font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)] disabled:opacity-35 shrink-0">
              −
            </button>
            <span className={`min-w-[2.25rem] flex-1 text-center text-[11px] font-bold tabular-nums tracking-tight ${soundOn ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
              {speechRate.toFixed(1)}
            </span>
            <button type="button" title="เร็วขึ้น" disabled={!soundOn}
              onClick={() => setSpeechRate(r => Math.min(3.0, parseFloat((r + 0.2).toFixed(1))))}
              className="flex !h-8 !min-w-[2rem] items-center justify-center rounded-lg bg-gradient-to-b from-[var(--primary-200)] to-[var(--primary-300)] text-sm font-bold text-[var(--primary-900)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_35%,transparent)] hover:brightness-[1.03] disabled:opacity-35 shrink-0">
              +
            </button>
          </div>
        </div>

        <button type="button"
          title={
            !soundOn
              ? 'เปิดเสียงพูดก่อน ถึงจะใช้ตรวจด้วยเสียงได้'
              : voiceAuditMode
                ? 'ปิดโหมดตรวจด้วยเสียง'
                : 'เปิดโหมดตรวจด้วยเสียง — พูดเลขและยอดตามแถวที่เลื่อนถึง'
          }
          disabled={!soundOn}
          onClick={() => {
            setVoiceAuditMode(v => {
              const next = !v;
              writeVoiceAuditMode(next);
              if (!next) cancelSpeech();
              return next;
            });
          }}
          className={cn(
            'relative w-full overflow-hidden rounded-xl !h-10 !px-3 text-[12px] font-extrabold tracking-wide shadow-md transition-[filter,border-color,box-shadow,opacity] duration-200 disabled:opacity-35',
            voiceAuditMode
              ? 'border border-transparent bg-gradient-to-r from-[var(--primary-600)] via-[var(--chart-primary)] to-[var(--primary-600)] text-white shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--chart-primary)_65%,transparent)] hover:brightness-[1.06]'
              : 'border border-[color-mix(in_srgb,var(--chart-primary)_22%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-surface)_96%,var(--primary-50))] text-[var(--primary-800)] hover:bg-[color-mix(in_srgb,var(--primary-50)_75%,var(--color-surface))]',
          )}
        >
          <span className="relative z-[1]">ตรวจด้วยเสียง{voiceAuditMode ? ' ✓' : ''}</span>
        </button>

        {voiceAuditMode && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-[11px] font-bold text-theme-text-muted">ความเร็วตรวจ</span>
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_3.5%,var(--color-surface))] px-1 py-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_10%,var(--color-border))] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
              <button type="button" title="ช้าลง" disabled={!soundOn}
                onClick={() => {
                  setVoiceAuditRate(r => {
                    const next = Math.max(0.5, parseFloat((r - 0.1).toFixed(2)));
                    writeVoiceAuditRate(next);
                    return next;
                  });
                }}
                className="flex !h-8 !min-w-[2rem] items-center justify-center rounded-lg bg-[var(--color-surface)] text-xs font-bold shadow-sm ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)] disabled:opacity-35">
                −
              </button>
              <span className={`flex-1 text-center text-[11px] font-bold tabular-nums ${soundOn ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>{voiceAuditRate.toFixed(1)}</span>
              <button type="button" title="เร็วขึ้น" disabled={!soundOn}
                onClick={() => {
                  setVoiceAuditRate(r => {
                    const next = Math.min(3, parseFloat((r + 0.1).toFixed(2)));
                    writeVoiceAuditRate(next);
                    return next;
                  });
                }}
                className="flex !h-8 !min-w-[2rem] items-center justify-center rounded-lg bg-gradient-to-b from-[var(--primary-200)] to-[var(--primary-300)] text-xs font-bold text-[var(--primary-900)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_35%,transparent)] hover:brightness-[1.03] disabled:opacity-35">
                +
              </button>
            </div>
          </div>
        )}

        {voiceAuditMode && sheetGrouped.length > 0 && (
          <div
            role="toolbar"
            aria-label="ควบคุมตรวจด้วยเสียง"
            className={cn(
              'rounded-xl border border-[color-mix(in_srgb,var(--chart-primary)_14%,var(--color-border))]',
              'bg-gradient-to-br from-[color-mix(in_srgb,var(--primary-50)_55%,var(--color-surface))] to-[var(--color-surface)]',
              'px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] space-y-2.5',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <div className="min-w-0 flex-1 text-center text-[11px] font-semibold tabular-nums leading-snug text-theme-text-secondary sm:text-left">
                <span className="font-bold text-[var(--chart-primary-dark)]">
                  {voiceAuditDispIdx != null ? `แถว ${voiceAuditDispIdx} / ${sheetGrouped.length}` : 'เลือกแถวในโพย'}
                </span>
                {voiceAuditCpMatches && voiceAuditBarCp ? (
                  <span className="block truncate font-medium normal-case text-theme-text-muted sm:inline sm:ml-1">
                    · จำจุด{' '}
                    {new Date(voiceAuditBarCp.updatedAt).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                title="ลบจุดจำและเริ่มอ่านจากแถวแรกใหม่"
                disabled={!voiceAuditMode || sheetGrouped.length === 0}
                onClick={voiceAuditResetReading}
                className="shrink-0 rounded-lg border border-[color-mix(in_srgb,var(--chart-primary)_25%,var(--color-border))] bg-[var(--color-surface)] px-2 py-1 text-[11px] font-bold text-[var(--chart-primary-dark)] shadow-sm transition-colors hover:bg-[color-mix(in_srgb,var(--primary-50)_80%,var(--color-surface))] disabled:opacity-35"
              >
                เริ่มใหม่
              </button>
            </div>
            <div className="flex items-center justify-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_4%,var(--color-surface))] p-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_12%,var(--color-border))]">
              <button
                type="button"
                title="แถวก่อนหน้า"
                disabled={!soundOn || sheetGrouped.length === 0 || focusedIdx === 0}
                onClick={voiceAuditGoPrev}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-base font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                aria-label="แถวก่อนหน้า"
              >
                ◀
              </button>
              <button
                type="button"
                title="หยุดชั่วคราว"
                disabled={!soundOn || focusedIdx < 0 || voiceAuditPaused}
                onClick={voiceAuditHitPause}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-base text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                aria-label="หยุดชั่วคราว"
              >
                ⏸
              </button>
              <button
                type="button"
                title="เล่นต่อหรือพูดแถวนี้ใหม่"
                disabled={!soundOn || focusedIdx < 0 || !voiceAuditPaused}
                onClick={voiceAuditHitPlay}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-[var(--primary-500)] to-[var(--chart-primary)] text-base text-white shadow-md ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_45%,transparent)] transition hover:brightness-[1.07] disabled:opacity-35"
                aria-label="เล่นต่อ"
              >
                ▶
              </button>
              <button
                type="button"
                title="แถวถัดไป"
                disabled={
                  !soundOn ||
                  sheetGrouped.length === 0 ||
                  (focusedIdx >= 0 && focusedIdx >= sheetGrouped.length - 1)
                }
                onClick={voiceAuditGoNext}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-base font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                aria-label="แถวถัดไป"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
