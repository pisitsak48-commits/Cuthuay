'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  parseBetLine,
  expandNumberInput,
  describeNumberExpansion,
  type BetInputMode,
} from '@/lib/betParser';
import {
  speak,
  speakNumber,
  speakQueued,
  speakAppend,
  cancelSpeech,
} from '@/lib/sounds';

export type BetKeyInputActivity = { hasNum: boolean; hasAmt: boolean };

export type BetKeyInputHandle = {
  getNum: () => string;
  getAmt: () => string;
  resolveAmtForCommit: () => string;
  getIsKlap: () => boolean;
  setInputs: (num: string, amt: string, mode?: BetInputMode) => void;
  clearInputs: (opts?: { keepAmt?: boolean; nextAmt?: string; parseError?: string }) => void;
  setParseError: (msg: string) => void;
  focusNum: () => void;
  focusAmt: () => void;
  getNumElement: () => HTMLInputElement | null;
  getAmtElement: () => HTMLInputElement | null;
  notifyCommittedAmt: (stripped: string) => void;
};

export type BetKeyInputPanelProps = {
  numWidth: number;
  inputFs: number;
  setInputFs: React.Dispatch<React.SetStateAction<number>>;
  voiceAuditMode: boolean;
  selectedCustomerId: string;
  editInlineKey: string | null;
  soundOnRef: MutableRefObject<boolean>;
  speechRateRef: MutableRefObject<number>;
  inputActivityRef: MutableRefObject<BetKeyInputActivity>;
  onCommit: (
    num: string,
    amt: string,
    voice: string,
    keepAmt?: boolean,
    insertBeforeKey?: string,
  ) => void | Promise<void>;
  onSaveInlineEdit: () => void | Promise<void>;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  readOnly?: boolean;
};

function stripTrailingKlapHyphen(s: string) {
  return s.replace(/-+$/, '').trim();
}

function syncActivityRef(
  ref: MutableRefObject<BetKeyInputActivity>,
  num: string,
  amt: string,
  lastAmtTemplate: string,
) {
  ref.current = {
    hasNum: Boolean(num.trim()),
    hasAmt: Boolean((amt.trim() || lastAmtTemplate).trim()),
  };
}

export const BetKeyInputPanel = forwardRef<BetKeyInputHandle, BetKeyInputPanelProps>(
  function BetKeyInputPanel(props, ref) {
    const {
      numWidth,
      inputFs,
      setInputFs,
      voiceAuditMode,
      selectedCustomerId,
      editInlineKey,
      soundOnRef,
      speechRateRef,
      inputActivityRef,
      onCommit,
      onSaveInlineEdit,
      onDividerMouseDown,
      readOnly = false,
    } = props;

    const [numInput, setNumInput] = useState('');
    const [amtInput, setAmtInput] = useState('');
    const [parseError, setParseError] = useState('');
    const [numHint, setNumHint] = useState('');
    const [inputMode, setInputMode] = useState<BetInputMode>('2digit');
    const [isKlap, setIsKlap] = useState(false);
    const [activeField, setActiveField] = useState<'num' | 'amt'>('num');

    const numRef = useRef<HTMLInputElement>(null);
    const amtRef = useRef<HTMLInputElement>(null);
    const lastCommittedAmtTemplateRef = useRef('');
    const numSpeakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const amtSpeakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const tts = (text: string) => {
      if (soundOnRef.current) speak(text, speechRateRef.current);
    };
    const ttsNumber = (num: string) => {
      if (soundOnRef.current) speakNumber(num, speechRateRef.current);
    };

    useEffect(() => {
      syncActivityRef(inputActivityRef, numInput, amtInput, lastCommittedAmtTemplateRef.current);
    }, [numInput, amtInput, inputActivityRef]);

    useImperativeHandle(ref, () => ({
      getNum: () => numInput,
      getAmt: () => amtInput,
      resolveAmtForCommit: () =>
        (amtInput.trim() || lastCommittedAmtTemplateRef.current).trim(),
      getIsKlap: () => isKlap,
      setInputs: (num, amt, mode) => {
        setNumInput(num);
        setAmtInput(amt);
        if (mode) setInputMode(mode);
        const expanded = expandNumberInput(num);
        if (expanded) {
          setInputMode(expanded.mode);
          setIsKlap(!!expanded.isKlap || amt.trim().endsWith('-'));
        }
        setParseError('');
        setNumHint(describeNumberExpansion(num));
        syncActivityRef(inputActivityRef, num, amt, lastCommittedAmtTemplateRef.current);
      },
      clearInputs: (opts) => {
        if (numSpeakTimer.current) {
          clearTimeout(numSpeakTimer.current);
          numSpeakTimer.current = null;
        }
        if (amtSpeakTimer.current) {
          clearTimeout(amtSpeakTimer.current);
          amtSpeakTimer.current = null;
        }
        const nextAmt = opts?.keepAmt
          ? (opts.nextAmt ?? lastCommittedAmtTemplateRef.current)
          : '';
        setNumInput('');
        setAmtInput(nextAmt);
        setParseError(opts?.parseError ?? '');
        setNumHint('');
        setActiveField('num');
        if (!opts?.keepAmt) {
          setInputMode('2digit');
          setIsKlap(false);
        }
        syncActivityRef(inputActivityRef, '', nextAmt, lastCommittedAmtTemplateRef.current);
      },
      setParseError: (msg) => setParseError(msg),
      focusNum: () => {
        setTimeout(() => numRef.current?.focus(), 0);
      },
      focusAmt: () => {
        setTimeout(() => {
          amtRef.current?.focus();
          amtRef.current?.select();
        }, 0);
      },
      getNumElement: () => numRef.current,
      getAmtElement: () => amtRef.current,
      notifyCommittedAmt: (stripped) => {
        if (stripped) lastCommittedAmtTemplateRef.current = stripped;
      },
    }));

    const onNumChange = (v: string) => {
      const filtered = v.replace(/[^0-9*\-]/g, '').slice(0, 3);
      const prevFiltered = numInput;
      setNumInput(filtered);
      setParseError('');
      if (numSpeakTimer.current) {
        clearTimeout(numSpeakTimer.current);
        numSpeakTimer.current = null;
      }
      if (!filtered.trim()) {
        setNumHint('');
        setInputMode('2digit');
        setIsKlap(false);
        return;
      }
      if (filtered.length > prevFiltered.length) {
        const newChars = filtered.slice(prevFiltered.length).replace(/\D/g, '');
        if (newChars) numSpeakTimer.current = setTimeout(() => ttsNumber(newChars), 150);
      }
      setNumHint(describeNumberExpansion(filtered));
      const expanded = expandNumberInput(filtered);
      if (expanded) {
        setInputMode(expanded.mode);
        setIsKlap(!!expanded.isKlap);
      }
    };

    const onAmtChange = (v: string) => {
      const filtered = v.replace(/[^0-9*+\-]/g, '');
      const klapAmt = filtered.trim().endsWith('-');
      setAmtInput(filtered);
      const klapNum = !!expandNumberInput(numInput)?.isKlap;
      setIsKlap(klapAmt || klapNum);
      if (!selectedCustomerId) {
        setParseError('กรุณาเลือกลูกค้าก่อนคีย์');
        return;
      }
      if (!filtered.trim() || !numInput.trim()) {
        setParseError('');
        return;
      }
      if (klapAmt) {
        const core = stripTrailingKlapHyphen(filtered);
        const payload = core
          ? filtered
          : lastCommittedAmtTemplateRef.current
            ? `${lastCommittedAmtTemplateRef.current}-`
            : '';
        if (!payload || !stripTrailingKlapHyphen(payload)) {
          setParseError('ไม่มีราคาสำหรับกลับ — คีย์ยอดก่อน');
          return;
        }
        setTimeout(() => {
          void onCommit(numInput, payload, 'กลับ', true);
        }, 0);
        return;
      }
      const hadPendingAmtTts = amtSpeakTimer.current != null;
      if (amtSpeakTimer.current) {
        clearTimeout(amtSpeakTimer.current);
        amtSpeakTimer.current = null;
      }
      const newChar = filtered.length > amtInput.length ? filtered.slice(amtInput.length) : '';
      if (newChar === '*') {
        if (soundOnRef.current) {
          const before = filtered.slice(0, -1).replace(/-$/, '');
          const parts = before.split('*');
          const seg = parts[parts.length - 1]?.trim() ?? '';
          if (seg && /\d/.test(seg)) {
            if (hadPendingAmtTts) speakQueued(seg, 'คูณ', speechRateRef.current);
            else if (typeof window !== 'undefined' && window.speechSynthesis.speaking) {
              speakAppend('คูณ', speechRateRef.current);
            } else {
              tts('คูณ');
            }
          } else {
            tts('คูณ');
          }
        }
      } else if (filtered.length > amtInput.length) {
        const segments = filtered.replace(/-$/, '').split('*');
        const currentSeg = segments[segments.length - 1];
        if (currentSeg) {
          amtSpeakTimer.current = setTimeout(() => {
            tts(currentSeg);
            amtSpeakTimer.current = null;
          }, 400);
        }
      }
      const result = parseBetLine(numInput, filtered);
      setParseError(result.error ?? '');
    };

    const resolveAmtForCommit = () =>
      (amtInput.trim() || lastCommittedAmtTemplateRef.current).trim();

    const commitLine = () => {
      const amtSrc = resolveAmtForCommit();
      if (!numInput.trim() || !amtSrc) return;
      const voice = isKlap || amtSrc.endsWith('-') ? 'กลับ' : 'บันทึก';
      void onCommit(numInput, amtSrc, voice, true);
    };

    const onNumKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!selectedCustomerId) {
          setParseError('กรุณาเลือกลูกค้าก่อนคีย์');
          return;
        }
        if (!expandNumberInput(numInput)) {
          setParseError('รูปแบบเลขไม่ถูกต้อง');
          return;
        }
        if (numSpeakTimer.current) {
          clearTimeout(numSpeakTimer.current);
          numSpeakTimer.current = null;
        }
        tts('ยอด');
        setActiveField('amt');
        if (!amtInput.trim() && lastCommittedAmtTemplateRef.current) {
          const fill = lastCommittedAmtTemplateRef.current;
          setAmtInput(fill);
          const pv = parseBetLine(numInput, fill);
          setParseError(pv.error ?? '');
        }
        setTimeout(() => {
          amtRef.current?.focus();
          amtRef.current?.select();
        }, 0);
      }
    };

    const onAmtKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (editInlineKey) {
          void onSaveInlineEdit();
        } else {
          commitLine();
        }
      }
      if (e.key === '-') {
        const el = e.currentTarget;
        if (el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length) {
          e.preventDefault();
          void onCommit(numInput, el.value + '-', 'กลับ', true);
          return;
        }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setActiveField('num');
        setTimeout(() => numRef.current?.focus(), 0);
      }
    };

    const handleClearInputs = () => {
      lastCommittedAmtTemplateRef.current = '';
      setNumInput('');
      setAmtInput('');
      setParseError('');
      setNumHint('');
      setInputMode('2digit');
      setIsKlap(false);
      setActiveField('num');
      syncActivityRef(inputActivityRef, '', '', '');
      setTimeout(() => numRef.current?.focus(), 0);
    };

    if (readOnly) {
      return (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--gray-100)] px-4 py-2.5 text-center text-xs text-theme-text-secondary select-none">
          โหมดดูอย่างเดียว — ไม่สามารถคีย์หรือแก้ไขโพยได้
        </div>
      );
    }

    return (
      <div className="flex min-w-0 max-w-full items-stretch gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 shrink-0 select-none z-[1] overflow-x-auto">
        <div
          style={{ width: numWidth, minWidth: 100, maxWidth: 400 }}
          className={[
            'relative flex flex-col items-center justify-center rounded-2xl px-4 py-2.5 shrink-0 overflow-hidden',
            'transition-[border-color,box-shadow] duration-150 ease-out',
            activeField === 'num'
              ? 'bg-[var(--color-card-bg-solid)] shadow-[0_0_0_2px_var(--color-accent),0_4px_16px_rgba(74,144,226,0.18)] border border-[var(--color-accent)]'
              : 'bg-[var(--color-card-bg-solid)] shadow-[0_2px_8px_rgba(15,23,42,0.07)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50',
          ].join(' ')}
        >
          <div
            className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl transition-colors duration-150 ${activeField === 'num' ? 'bg-gradient-to-r from-[var(--primary-400)] via-[var(--color-accent)] to-[var(--primary-400)]' : 'bg-transparent'}`}
          />
          <span
            className={`text-[11px] font-bold mb-1.5 tracking-[0.22em] uppercase transition-colors duration-150 ${activeField === 'num' ? 'text-[var(--color-accent)]' : 'text-theme-text-muted'}`}
          >
            เลข
          </span>
          <input
            ref={numRef}
            value={numInput}
            onChange={(e) => onNumChange(e.target.value)}
            onKeyDown={onNumKeyDown}
            onFocus={() => {
              setActiveField('num');
              if (voiceAuditMode) cancelSpeech();
            }}
            autoFocus
            placeholder="123"
            title="Enter → ไปช่องราคา (ถ้าว่างจะใส่ราคาจากครั้งล่าสุดให้เห็น)"
            style={{ fontSize: inputFs, lineHeight: 1.1 }}
            className="w-full text-center font-bold tracking-tight bg-transparent text-theme-text-primary placeholder:text-[var(--gray-300)] placeholder:text-xl focus:outline-none caret-accent"
          />
          <span
            className={`text-xs mt-1.5 h-4 leading-4 block text-center ${numHint ? 'text-theme-text-muted' : 'invisible'}`}
          >
            {numHint || '·'}
          </span>
        </div>
        <div
          onMouseDown={onDividerMouseDown}
          className="w-1 shrink-0 cursor-col-resize self-stretch rounded-full bg-[var(--color-border)]/60 hover:bg-[var(--color-accent)]/50 active:bg-[var(--color-accent)]/70 transition-colors my-2"
        />
        <div
          className={[
            'relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl px-3 py-2.5 sm:px-6',
            'transition-[border-color,box-shadow] duration-150 ease-out',
            activeField === 'amt'
              ? 'bg-[var(--color-card-bg-solid)] shadow-[0_0_0_2px_var(--color-accent),0_4px_16px_rgba(74,144,226,0.18)] border border-[var(--color-accent)]'
              : 'bg-[var(--color-card-bg-solid)] shadow-[0_2px_8px_rgba(15,23,42,0.07)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50',
          ].join(' ')}
        >
          <div
            className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl transition-colors duration-150 ${activeField === 'amt' ? 'bg-gradient-to-r from-[var(--primary-400)] via-[var(--color-accent)] to-[var(--primary-400)]' : 'bg-transparent'}`}
          />
          <span
            className={`text-[11px] font-bold mb-1.5 tracking-[0.22em] uppercase transition-colors duration-150 ${activeField === 'amt' ? 'text-[var(--color-accent)]' : 'text-theme-text-muted'}`}
          >
            ราคา
          </span>
          <input
            ref={amtRef}
            value={amtInput}
            onChange={(e) => onAmtChange(e.target.value)}
            onKeyDown={onAmtKeyDown}
            onFocus={() => {
              setActiveField('amt');
              if (voiceAuditMode) cancelSpeech();
            }}
            placeholder={
              inputMode === 'run'
                ? 'วิ่งบน*ล่าง'
                : inputMode === '2digit'
                  ? 'บน*ล่าง หรือ 100-'
                  : '3บน*โต็ด*3ล่าง'
            }
            style={{ fontSize: inputFs, lineHeight: 1.1 }}
            className="w-full text-center font-bold tracking-tight bg-transparent text-theme-text-primary placeholder:font-semibold placeholder:text-[color-mix(in_srgb,var(--primary-700)_70%,var(--gray-400)_30%)] placeholder:opacity-75 focus:outline-none caret-accent"
          />
          <div className="h-4 mt-1.5 flex items-center justify-center">
            {parseError ? (
              <span className="text-xs text-loss leading-4">{parseError}</span>
            ) : !parseError && isKlap ? (
              (() => {
                const v = amtInput.trim();
                const isKlapTote =
                  inputMode === '3digit' &&
                  v.startsWith('*') &&
                  v.endsWith('-') &&
                  !v.slice(1).includes('*');
                const isKlapBoth =
                  inputMode === '3digit' &&
                  v.endsWith('-') &&
                  !isKlapTote &&
                  !!v.slice(0, -1).match(/^\d+\*\d+$/);
                const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับเลข';
                const cls = isKlapBoth ? 'text-accent-glow' : isKlapTote ? 'text-accent-glow' : 'text-risk-medium';
                return <span className={`text-xs leading-4 ${cls}`}>{label}</span>;
              })()
            ) : (
              <span className="invisible text-xs leading-4">·</span>
            )}
          </div>
          <div className="absolute top-2.5 right-3 flex gap-1.5 items-center">
            {inputMode === 'run' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold">
                วิ่ง
              </span>
            )}
            {inputMode === '2digit' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold">
                2 ตัว
              </span>
            )}
            {inputMode === '3digit' && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] border border-[var(--color-badge-success-border)] font-semibold">
                3 ตัว
              </span>
            )}
            {isKlap &&
              (() => {
                const v = amtInput.trim();
                const isKlapTote =
                  inputMode === '3digit' &&
                  v.startsWith('*') &&
                  v.endsWith('-') &&
                  !v.slice(1).includes('*');
                const isKlapBoth =
                  inputMode === '3digit' &&
                  v.endsWith('-') &&
                  !isKlapTote &&
                  !!v.slice(0, -1).match(/^\d+\*\d+$/);
                const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับ';
                return (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border bg-[var(--color-badge-warning-bg)] text-[var(--color-badge-warning-text)] border-[var(--color-badge-warning-border)] font-semibold">
                    {label}
                  </span>
                );
              })()}
          </div>
        </div>
        <div className="flex shrink-0 flex-col justify-center gap-2 border-l border-[var(--color-border)]/60 py-0.5 pl-2.5">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] px-1.5 py-1.5 shadow-[0_1px_4px_rgba(15,23,42,0.06)]">
            <button
              type="button"
              title="ลดขนาดตัวเลขในช่องคีย์เลข–ราคา"
              className="btn-toolbar-glow btn-toolbar-muted !h-9 !min-w-[1.75rem] !px-0 !text-[11px] rounded-lg font-bold"
              onClick={() => setInputFs((s) => Math.max(24, s - 8))}
            >
              A−
            </button>
            <button
              type="button"
              title="ขยายขนาดตัวเลขในช่องคีย์เลข–ราคา"
              className="btn-toolbar-glow btn-fintech-search !h-9 !min-w-[1.75rem] !px-0 !text-[11px] rounded-lg font-bold"
              onClick={() => setInputFs((s) => Math.min(80, s + 8))}
            >
              A+
            </button>
            <div className="w-px h-4 bg-[var(--color-border-muted)] mx-0.5 shrink-0" />
            <button
              type="button"
              title="ล้างช่องเลข/ราคา"
              className="!h-9 !min-w-[1.75rem] !px-0 rounded-lg bg-gradient-to-b from-[var(--primary-100)] to-[var(--primary-200)] text-[11px] font-extrabold text-[var(--primary-700)] shadow-sm border border-[var(--primary-300)]/60 hover:from-[var(--primary-200)] hover:to-[var(--primary-300)] active:scale-[0.95] transition-[transform,box-shadow] duration-100"
              onClick={handleClearInputs}
            >
              C
            </button>
          </div>
        </div>
      </div>
    );
  },
);

BetKeyInputPanel.displayName = 'BetKeyInputPanel';
