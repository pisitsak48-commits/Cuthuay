'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

const COLORS = [
  'var(--notebook-swatches-1)',
  'var(--notebook-swatches-2)',
  'var(--notebook-swatches-3)',
  'var(--notebook-swatches-4)',
  'var(--notebook-swatches-5)',
  'var(--notebook-swatches-6)',
];
const COLOR_LABELS = ['ปกติ', 'เข้ม', 'น้ำเงิน', 'เขียว', 'แดง', 'เหลือง'];

const STORAGE_KEY = 'cuthuay_notebook';

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
/** localhost เป็น secure context แต่ http://IP (เช่น 192.168.*) มักไม่ใช่ — randomUUID() ใช้ไม่ได้ */
function newNoteId(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* ignore */
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
function saveNotes(notes: Note[]): string | null {
  if (typeof window === 'undefined') return 'ไม่รองรับการบันทึกในสภาพแวดล้อมนี้';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'บันทึกในเครื่องไม่สำเร็จ (เต็ม / ถูกบล็อก)';
  }
}

export default function NotebookPage() {
  const [notes, setNotes]       = useState<Note[]>([]);
  const [editing, setEditing]   = useState<Note | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle]       = useState('');
  const [content, setContent]   = useState('');
  const [color, setColor]       = useState(COLORS[0]);
  const [storageError, setStorageError] = useState('');

  useEffect(() => { setNotes(loadNotes()); }, []);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setContent('');
    setColor(COLORS[0]);
    setShowForm(true);
  };

  const openEdit = (note: Note) => {
    setEditing(note);
    setTitle(note.title);
    setContent(note.content);
    setColor(note.color);
    setShowForm(true);
  };

  const handleSave = () => {
    setStorageError('');
    const now = new Date().toISOString();
    let updated: Note[];
    if (editing) {
      updated = notes.map(n => n.id === editing.id
        ? { ...n, title, content, color, updatedAt: now }
        : n);
    } else {
      updated = [...notes, { id: newNoteId(), title: title || 'บันทึก', content, color, createdAt: now, updatedAt: now }];
    }
    const err = saveNotes(updated);
    if (err) {
      setStorageError(err);
      return;
    }
    setNotes(updated);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    setStorageError('');
    const updated = notes.filter(n => n.id !== id);
    const err = saveNotes(updated);
    if (err) {
      setStorageError(err);
      return;
    }
    setNotes(updated);
  };

  return (
    <AppShell>
      <Header title="สมุดบันทึก" subtitle="จดบันทึกข้อมูลสำคัญ" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-5xl mx-auto">

          {/* Toolbar */}
          <div className="flex gap-3 mb-5">
            <Button onClick={openNew}>+ เพิ่มบันทึก</Button>
            <span className="text-xs text-theme-text-muted self-center">{notes.length} รายการ</span>
          </div>

          {/* Notes grid */}
          {notes.length === 0 ? (
            <div className="text-center py-16 text-theme-text-muted">
              <div className="text-5xl mb-4">📓</div>
              <p className="text-sm">ยังไม่มีบันทึก</p>
              <p className="text-xs mt-1 text-theme-text-muted">กด "+ เพิ่มบันทึก" เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {notes.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(note => (
                <motion.div key={note.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                  className="rounded-xl border border-border overflow-hidden flex flex-col shadow-md"
                  style={{ backgroundColor: note.color }}>
                  <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-theme-text-primary text-sm leading-tight line-clamp-2 flex-1">{note.title}</h3>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(note)} className="text-theme-text-muted hover:text-theme-text-secondary p-0.5 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(note.id)} className="text-theme-text-muted hover:text-loss p-0.5 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="px-4 pb-3 flex-1">
                    <p className="text-xs text-theme-text-secondary leading-relaxed line-clamp-5 whitespace-pre-wrap">{note.content}</p>
                  </div>
                  <div className="px-4 pb-3 text-[10px] text-theme-text-muted">
                    {new Date(note.updatedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Edit form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-[var(--color-backdrop-overlay)] flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-lg p-5 space-y-4">
            <h3 className="font-semibold text-theme-text-primary">{editing ? 'แก้ไขบันทึก' : 'บันทึกใหม่'}</h3>

            <div>
              <label className="text-xs text-theme-text-muted mb-1 block">หัวข้อ</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="หัวข้อบันทึก..."
                className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
            </div>

            <div>
              <label className="text-xs text-theme-text-muted mb-1 block">รายละเอียด</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                rows={8}
                placeholder="จดบันทึกที่นี่..."
                className="w-full rounded-xl bg-surface-200 border border-border px-3 py-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] resize-none" />
            </div>

            <div>
              <label className="text-xs text-theme-text-muted mb-2 block">สีพื้นหลัง</label>
              <div className="flex gap-2">
                {COLORS.map((c, i) => (
                  <button key={c} onClick={() => setColor(c)} title={COLOR_LABELS[i]}
                    className={`w-7 h-7 rounded-full transition-all border-2 ${color === c ? 'border-accent scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            {storageError && (
              <p className="text-xs text-loss">{storageError}</p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => { setStorageError(''); setShowForm(false); }}>ยกเลิก</Button>
              <Button onClick={handleSave}>บันทึก</Button>
            </div>
          </motion.div>
        </div>
      )}
    </AppShell>
  );
}
