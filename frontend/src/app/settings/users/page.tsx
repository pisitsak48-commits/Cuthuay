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

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : '';
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    ...opts,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message ?? 'Error'); }
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

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/users');
      setUsers(data.users ?? []);
    } catch { /* ignore — route may not exist yet */ }
    finally { setLoading(false); }
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

  return (
    <AppShell>
      <Header title="ข้อมูลผู้ใช้งาน" subtitle="จัดการบัญชีผู้ใช้ในระบบ" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">

          <div className="flex gap-3 items-center">
            <Button onClick={openNew}>+ เพิ่มผู้ใช้</Button>
            <span className="text-xs text-slate-500">{users.length} บัญชี</span>
          </div>

          <Card>
            {loading ? (
              <div className="p-8 text-center text-slate-500 text-sm">กำลังโหลด...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">ไม่พบข้อมูลผู้ใช้</div>
            ) : (
              <div className="divide-y divide-border/50">
                {users.map(u => (
                  <div key={u.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-9 h-9 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-accent">{u.username[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200">{u.username}</p>
                      <p className="text-xs text-slate-500">{ROLE_LABEL[u.role] ?? u.role}</p>
                    </div>
                    <Badge variant={u.is_active ? 'success' : 'default'}>{u.is_active ? 'ใช้งาน' : 'ระงับ'}</Badge>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>แก้ไข</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>
                        {u.is_active ? 'ระงับ' : 'เปิดใช้'}
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
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-surface-100 border border-border rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
              <h3 className="font-semibold text-slate-100">{editing ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้ใหม่'}</h3>

              {!editing && (
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">ชื่อผู้ใช้</label>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
              )}
              <div>
                <label className="text-xs text-slate-500 mb-1 block">{editing ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน'}</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">บทบาท</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRow['role'] }))}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
                  <option value="admin">ผู้ดูแลระบบ</option>
                  <option value="operator">ผู้ปฏิบัติงาน</option>
                  <option value="viewer">ผู้ดูข้อมูล</option>
                </select>
              </div>

              {error && <p className="text-xs text-rose-400">{error}</p>}
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
