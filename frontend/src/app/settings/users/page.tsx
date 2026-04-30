'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface UserRow {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  is_active: boolean;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  operator: 'ผู้ปฏิบัติงาน',
  viewer: 'ผู้ดูข้อมูล',
};

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  const base = typeof window !== 'undefined' ? '/api' : 'http://127.0.0.1:4000/api';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...opts,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (/load failed|failed to fetch|network/i.test(msg)) {
      throw new Error(
        'เรียก API ไม่ถึง — ตรวจว่าเปิดเว็บที่พอร์ต 3000 และ container frontend/backend รันอยู่',
      );
    }
    throw new Error(msg || 'เชื่อมต่อไม่สำเร็จ');
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(e.message ?? e.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export default function UsersPage() {
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<UserRow | null>(null);
  const [form, setForm]         = useState({ username: '', password: '', role: 'operator' as UserRow['role'] });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [listError, setListError] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    setListError('');
    try {
      const data = await apiFetch('/auth/users');
      setUsers(data.users ?? []);
    } catch (e: unknown) {
      setUsers([]);
      setListError((e as Error).message ?? 'โหลดรายชื่อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ username: '', password: '', role: 'operator' });
    setError('');
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({ username: u.username, password: '', role: u.role });
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.username.trim() || (!editing && !form.password.trim())) {
      setError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await apiFetch(`/auth/users/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role: form.role, ...(form.password ? { password: form.password } : {}) }),
        });
      } else {
        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      fetchUsers();
      setShowForm(false);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    try {
      await apiFetch(`/auth/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      fetchUsers();
    } catch { /* ignore */ }
  };

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`ลบผู้ใช้ "${u.username}" ถาวรจากระบบ?\nรายการโพยที่อ้างถึงผู้ใช้นี้จะไม่ถูกลบ แต่จะไม่แสดงผู้สร้าง`)) return;
    try {
      await apiFetch(`/auth/users/${u.id}`, { method: 'DELETE' });
      fetchUsers();
    } catch (e: unknown) {
      alert((e as Error).message ?? 'ลบไม่สำเร็จ');
    }
  };

  return (
    <AppShell>
      <Header title="ข้อมูลผู้ใช้งาน" subtitle="จัดการบัญชีผู้ใช้ในระบบ" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">

          <div className="flex gap-3 items-center flex-wrap">
            <Button onClick={openNew}>+ เพิ่มผู้ใช้</Button>
            <span className="text-xs text-theme-text-muted">{users.length} บัญชี</span>
          </div>

          {listError && (
            <div className="rounded-lg border border-[var(--color-badge-danger-border)] bg-[var(--color-badge-danger-bg)] px-4 py-2 text-sm text-[var(--color-badge-danger-text)]">
              {listError}
            </div>
          )}

          <Card>
            {loading ? (
              <div className="p-8 text-center text-theme-text-muted text-sm">กำลังโหลด...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-theme-text-muted text-sm">ไม่พบข้อมูลผู้ใช้</div>
            ) : (
              <div className="divide-y divide-border/50">
                {users.map(u => (
                  <div key={u.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-9 h-9 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-accent">{u.username[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-theme-text-primary">{u.username}</p>
                      <p className="text-xs text-theme-text-muted">{ROLE_LABEL[u.role] ?? u.role}</p>
                    </div>
                    <Badge variant={u.is_active ? 'success' : 'default'}>{u.is_active ? 'ใช้งาน' : 'ระงับ'}</Badge>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>แก้ไข</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>
                        {u.is_active ? 'ระงับ' : 'เปิดใช้'}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-loss hover:opacity-90" onClick={() => handleDelete(u)}>
                        ลบ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </main>

      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-50 bg-[var(--color-backdrop-overlay)] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-md p-5 space-y-4">
              <h3 className="font-semibold text-theme-text-primary">{editing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h3>

              {!editing && (
                <div>
                  <label className="text-xs text-theme-text-muted mb-1 block">ชื่อผู้ใช้</label>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
              )}
              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">{editing ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
              </div>
              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">บทบาท</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRow['role'] }))}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                  <option value="admin">ผู้ดูแลระบบ</option>
                  <option value="operator">ผู้ปฏิบัติงาน</option>
                  <option value="viewer">ผู้ดูข้อมูล</option>
                </select>
              </div>

              {error && <p className="text-xs text-loss">{error}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setShowForm(false)}>ยกเลิก</Button>
                <Button onClick={handleSave} loading={saving}>บันทึก</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
