import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

type ThemeState = {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
  init: () => void;
};

function resolve(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: "system",
  resolved: "light",
  setPreference: (preference) => {
    localStorage.setItem("sintesa-theme", preference);
    const resolved = resolve(preference);
    apply(resolved);
    set({ preference, resolved });
  },
  init: () => {
    const saved = (localStorage.getItem("sintesa-theme") as ThemePreference | null) ?? "system";
    const resolved = resolve(saved);
    apply(resolved);
    set({ preference: saved, resolved });

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().preference === "system") {
        const next = resolve("system");
        apply(next);
        set({ resolved: next });
      }
    };
    mq.addEventListener("change", onChange);
  },
}));
