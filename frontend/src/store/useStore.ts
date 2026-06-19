import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, Round } from '@/types';
import { authApi, ensureCsrfToken, clearCsrfToken, persistAuthTokens, clearPersistedAuthTokens, isCookieAuthEnabled } from '@/lib/api';
import { wsClient } from '@/lib/websocket';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
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
      refreshToken: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      login: async (username, password) => {
        const res = await authApi.login(username, password);
        const { token: legacy, access_token, refresh_token, user: rawUser } = res.data;
        const token = access_token ?? legacy;
        const user: User = { ...rawUser, role: rawUser.role as User['role'] };
        persistAuthTokens(token, refresh_token);
        wsClient.connect(token);
        set({ user, token, refreshToken: refresh_token });
        await ensureCsrfToken().catch(() => undefined);
      },
      bootstrapFirstAdmin: async (username, password) => {
        const res = await authApi.bootstrap(username, password);
        const { token: legacy, access_token, refresh_token, user: rawUser } = res.data;
        const token = access_token ?? legacy;
        const user: User = { ...rawUser, role: rawUser.role as User['role'] };
        persistAuthTokens(token, refresh_token);
        wsClient.connect(token);
        set({ user, token, refreshToken: refresh_token });
        await ensureCsrfToken().catch(() => undefined);
      },
      logout: () => {
        void authApi.logout().catch(() => undefined);
        clearPersistedAuthTokens();
        clearCsrfToken();
        wsClient.disconnect();
        set({ user: null, token: null, refreshToken: null });
      },
    }),
    {
      name: 'cuthuay-auth',
      partialize: (state) =>
        isCookieAuthEnabled()
          ? { user: state.user }
          : { user: state.user, token: state.token, refreshToken: state.refreshToken },
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
  /** Mobile drawer open state — not persisted */
  sidebarMobileOpen: boolean;
  setSidebarMobileOpen: (v: boolean) => void;
  toggleSidebarMobile: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
      toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      sidebarMobileOpen: false,
      setSidebarMobileOpen: (v) => set({ sidebarMobileOpen: v }),
      toggleSidebarMobile: () => set((s) => ({ sidebarMobileOpen: !s.sidebarMobileOpen })),
    }),
    {
      name: 'cuthuay-sidebar',
      partialize: (state) => ({ sidebarExpanded: state.sidebarExpanded }),
    },
  ),
);

