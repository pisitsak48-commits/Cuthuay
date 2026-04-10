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

interface ThemeState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'cuthuay-theme' },
  ),
);
