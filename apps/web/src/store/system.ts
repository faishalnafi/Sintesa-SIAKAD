import { create } from "zustand";
import { api } from "@/lib/api";

export type VersionInfo = {
  currentVersion: string;
  currentVersionCode: number;
  latestJsonVersion: string;
  latestJsonVersionCode: number;
  isUpdateAvailable: boolean;
  isUpdating: boolean;
  updateMessage?: string;
  title: string;
  changelog: string[];
  releaseDate: string;
  forceUpdate: boolean;
};

type SystemState = {
  versionInfo: VersionInfo | null;
  loading: boolean;
  isUpdating: boolean;
  updateMessage: string;
  showNoticeModal: boolean;
  acknowledgedCode: number;
  /** True when we were in updating state and server just came back online */
  justFinishedUpdate: boolean;
  /** Version code seen on this tab's first successful check — baseline to detect a newer deploy */
  baselineVersionCode: number | null;
  setIsUpdating: (updating: boolean, message?: string) => void;
  setShowNoticeModal: (show: boolean) => void;
  fetchVersionInfo: () => Promise<void>;
  acknowledgeUpdate: () => void;
};

const ACKNOWLEDGED_KEY = "sintesa_acknowledged_version_code";

function getStoredAcknowledgedCode(): number {
  try {
    const val = localStorage.getItem(ACKNOWLEDGED_KEY);
    return val ? Number(val) : 0;
  } catch {
    return 0;
  }
}

export const useSystemStore = create<SystemState>((set, get) => ({
  versionInfo: null,
  loading: false,
  isUpdating: false,
  justFinishedUpdate: false,
  baselineVersionCode: null,
  updateMessage: "Sistem sedang dalam proses pembaruan oleh Superadmin. Harap tunggu beberapa saat...",
  showNoticeModal: false,
  acknowledgedCode: getStoredAcknowledgedCode(),

  setIsUpdating: (updating, message) =>
    set({
      isUpdating: updating,
      ...(message ? { updateMessage: message } : {}),
    }),

  setShowNoticeModal: (show) => set({ showNoticeModal: show }),

  fetchVersionInfo: async () => {
    set({ loading: true });
    try {
      const res = await api<VersionInfo>("/system/version");
      if (res.data) {
        const info = res.data;
        const storedCode = getStoredAcknowledgedCode();
        const prevIsUpdating = get().isUpdating;
        const baseline = get().baselineVersionCode;

        // Detect transition: was updating -> no longer updating => server restarted with new code
        const justFinishedUpdatingFlow = prevIsUpdating && !info.isUpdating;

        // Detect a deploy that happened without this tab ever observing isUpdating=true
        // (PM2 restart is near-instant, so most open tabs miss that window entirely)
        const deployedWhileTabOpen = baseline !== null && info.currentVersionCode > baseline;

        const justFinished = justFinishedUpdatingFlow || deployedWhileTabOpen;

        // Show notice modal only if current version is newer than what user has acknowledged
        const shouldShowNotice = info.currentVersionCode > storedCode;

        set({
          versionInfo: info,
          isUpdating: info.isUpdating,
          updateMessage: info.updateMessage || get().updateMessage,
          showNoticeModal: shouldShowNotice,
          loading: false,
          justFinishedUpdate: justFinished,
          baselineVersionCode: baseline ?? info.currentVersionCode,
        });

        // If server just finished updating (PM2 restarted), do a hard reload
        // so the browser picks up the freshly extracted dist files
        if (justFinished) {
          setTimeout(() => {
            // Clear service worker caches then reload
            if ("caches" in window) {
              caches.keys().then((names) => {
                for (const name of names) caches.delete(name);
              });
            }
            // Hard reload bypassing cache
            window.location.reload();
          }, 1500);
        }
      }
    } catch {
      // Swallow errors silently during polling (server may be restarting)
      set({ loading: false });
    }
  },

  acknowledgeUpdate: () => {
    const currentCode = get().versionInfo?.currentVersionCode || 100;
    try {
      localStorage.setItem(ACKNOWLEDGED_KEY, String(currentCode));
      // Clear all browser caches & session storage
      sessionStorage.clear();
      if ("caches" in window) {
        caches.keys().then((names) => {
          for (const name of names) caches.delete(name);
        });
      }
    } catch {
      /* ignore */
    }
    set({ acknowledgedCode: currentCode, showNoticeModal: false });
    // Hard refresh to reload updated bundle & reset session completely
    window.location.href = "/";
  },
}));
