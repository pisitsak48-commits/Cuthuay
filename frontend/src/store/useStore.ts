import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Round } from '@/types';
import { authApi } from '@/lib/api';
import { wsClient } from '@/lib/websocket';

interface AuthState {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  login: (username: string, password: string) => Promise<void>;
  /** หลัง deploy ครั้งแรก — สร้าง admin คนแรกเมื่อยังไม่มี user */
  bootstrapFirstAdmin: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

interface AppState {
  selectedRound: Round | null;
  setSelectedRound: (r: Round | null) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      login: async (username, password) => {
        const res = await authApi.login(username, password);
        const { token, user: rawUser } = res.data;
        const user: User = { ...rawUser, role: rawUser.role as User['role'] };
        localStorage.setItem('token', token);
        wsClient.connect(token);
        set({ user, token });
      },
      bootstrapFirstAdmin: async (username, password) => {
        const res = await authApi.bootstrap(username, password);
        const { token, user: rawUser } = res.data;
        const user: User = { ...rawUser, role: rawUser.role as User['role'] };
        localStorage.setItem('token', token);
        wsClient.connect(token);
        set({ user, token });
      },
      logout: () => {
        localStorage.removeItem('token');
        wsClient.disconnect();
        set({ user: null, token: null });
      },
    }),
    {
      name: 'cuthuay-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

export const useAppStore = create<AppState>()((set) => ({
  selectedRound: null,
  setSelectedRound: (r) => set({ selectedRound: r }),
}));

interface SidebarState {
  sidebarExpanded: boolean;
  setSidebarExpanded: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
    }),
    { name: 'cuthuay-sidebar' },
  ),
);

