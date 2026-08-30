import { create } from "zustand";
import { api } from "@/lib/api";

export type AuthUser = {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  avatarUrl?: string | null;
  jenisKelamin?: string | null;
  roles: string[];
};


type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  bootstrapped: boolean;
  setUser: (user: AuthUser | null) => void;
  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  primaryRole: () => string | null;
};

export function homeForRoles(roles: string[]): string {
  if (roles.includes("superadmin") || roles.includes("admin")) return "/admin";
  if (roles.includes("walikelas")) return "/walikelas";
  if (roles.includes("guru")) return "/guru";
  if (roles.includes("siswa") || roles.includes("ortu")) return "/siswa";
  return "/";
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  bootstrapped: false,
  setUser: (user) => set({ user }),
  primaryRole: () => {
    const roles = get().user?.roles ?? [];
    if (roles.includes("superadmin")) return "superadmin";
    if (roles.includes("admin")) return "admin";
    if (roles.includes("walikelas")) return "walikelas";
    if (roles.includes("guru")) return "guru";
    if (roles.includes("siswa")) return "siswa";
    if (roles.includes("ortu")) return "ortu";
    return null;
  },
  bootstrap: async () => {
    set({ loading: true });
    try {
      const res = await api<AuthUser>("/auth/me");
      set({ user: res.data ?? null, bootstrapped: true, loading: false });
    } catch {
      set({ user: null, bootstrapped: true, loading: false });
    }
  },
  login: async (identifier, password) => {
    set({ loading: true });
    try {
      const res = await api<AuthUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      set({ user: res.data ?? null, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },
  logout: async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      set({ user: null });
    }
  },
}));
