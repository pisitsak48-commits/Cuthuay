'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatBaht } from '@/lib/utils';

interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

const COLORS = ['#1e293b', '#0f172a', '#1e3a5f', '#1a3a2a', '#2a1a1a', '#2a2a1a'];
const COLOR_LABELS = ['ปกติ', 'เข้ม', 'น้ำเงิน', 'เขียว', 'แดง', 'เหลือง'];

const STORAGE_KEY = 'cuthuay_notebook';

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}
function saveNotes(notes: Note[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

export default function NotebookPage() {
  const [notes, setNotes]       = useState<Note[]>([]);
  const [editing, setEditing]   = useState<Note | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle]       = useState('');
  const [content, setContent]   = useState('');
  const [color, setColor]       = useState(COLORS[0]);

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
    const now = new Date().toISOString();
    let updated: Note[];
    if (editing) {
      updated = notes.map(n => n.id === editing.id
        ? { ...n, title, content, color, updatedAt: now }
        : n);
    } else {
      updated = [...notes, { id: crypto.randomUUID(), title: title || 'บันทึก', content, color, createdAt: now, updatedAt: now }];
    }
    setNotes(updated);
    saveNotes(updated);
    setShowForm(false);
  };

  const handleDelete = (id: string) => {
    const updated = notes.filter(n => n.id !== id);
    setNotes(updated);
    saveNotes(updated);
  };

  return (
    <AppShell>
      <Header title="สมุดบันทึก" subtitle="จดบันทึกข้อมูลสำคัญ" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-5xl mx-auto">

          {/* Toolbar */}
          <div className="flex gap-3 mb-5">
            <Button onClick={openNew}>+ เพิ่มบันทึก</Button>
            <span className="text-xs text-slate-500 self-center">{notes.length} รายการ</span>
          </div>

          {/* Notes grid */}
          {notes.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <div className="text-5xl mb-4">📓</div>
              <p className="text-sm">ยังไม่มีบันทึก</p>
              <p className="text-xs mt-1 text-slate-600">กด "+ เพิ่มบันทึก" เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {notes.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(note => (
                <motion.div key={note.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                  className="rounded-xl border border-border overflow-hidden flex flex-col shadow-md"
                  style={{ backgroundColor: note.color }}>
                  <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-slate-100 text-sm leading-tight line-clamp-2 flex-1">{note.title}</h3>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(note)} className="text-slate-500 hover:text-slate-300 p-0.5 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(note.id)} className="text-slate-600 hover:text-rose-400 p-0.5 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="px-4 pb-3 flex-1">
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-5 whitespace-pre-wrap">{note.content}</p>
                  </div>
                  <div className="px-4 pb-3 text-[10px] text-slate-600">
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-surface-100 border border-border rounded-xl shadow-2xl w-full max-w-lg p-5 space-y-4">
            <h3 className="font-semibold text-slate-100">{editing ? 'แก้ไขบันทึก' : 'บันทึกใหม่'}</h3>

            <div>
              <label className="text-xs text-slate-500 mb-1 block">หัวข้อ</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="หัวข้อบันทึก..."
                className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>

            <div>
              <label className="text-xs text-slate-500 mb-1 block">รายละเอียด</label>
              <textarea value={content} onChange={e => setContent(e.target.value)}
                rows={8}
                placeholder="จดบันทึกที่นี่..."
                className="w-full rounded-xl bg-surface-200 border border-border px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent resize-none" />
            </div>

            <div>
              <label className="text-xs text-slate-500 mb-2 block">สีพื้นหลัง</label>
              <div className="flex gap-2">
                {COLORS.map((c, i) => (
                  <button key={c} onClick={() => setColor(c)} title={COLOR_LABELS[i]}
                    className={`w-7 h-7 rounded-full transition-all border-2 ${color === c ? 'border-accent scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setShowForm(false)}>ยกเลิก</Button>
              <Button onClick={handleSave}>บันทึก</Button>
            </div>
          </motion.div>
        </div>
      )}
    </AppShell>
  );
}
