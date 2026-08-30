import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export function WelcomeToastModal() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!user) return;
    const seenKey = `sintesa_welcome_seen_${user.id}`;
    const alreadySeen = sessionStorage.getItem(seenKey);
    if (alreadySeen) return;

    sessionStorage.setItem(seenKey, "true");
    setOpen(true);
  }, [user]);

  useEffect(() => {
    if (!open) return;

    const duration = 5000;
    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev <= step) {
          clearInterval(timer);
          setOpen(false);
          return 0;
        }
        return prev - step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [open]);

  if (!open || !user) return null;

  // Determine Greeting Time
  const hour = new Date().getHours();
  let timeGreeting = "Selamat malam";
  if (hour >= 5 && hour < 11) {
    timeGreeting = "Selamat pagi";
  } else if (hour >= 11 && hour < 15) {
    timeGreeting = "Selamat siang";
  } else if (hour >= 15 && hour < 18) {
    timeGreeting = "Selamat sore";
  }

  // Determine Salutation
  const roles = user.roles.map((r) => r.toLowerCase());
  const isStudentOnly =
    roles.length > 0 && roles.every((r) => r === "siswa" || r === "alumni" || r === "ortu");

  const jk = (user.jenisKelamin || "").toUpperCase().trim();
  let salutation = "";
  if (!isStudentOnly) {
    if (jk === "L") salutation = "Bapak";
    else if (jk === "P") salutation = "Ibu";
    else salutation = "Bapak/Ibu";
  } else {
    if (jk === "L") salutation = "Mas";
    else if (jk === "P") salutation = "Mbak";
    else salutation = "Mas/Mbak";
  }

  const fullTitle = `${timeGreeting}, ${salutation} ${user.name}! ✨`;

  return (
    <div className="fixed top-5 right-5 z-50 w-full max-w-md animate-in fade-in slide-in-from-top-5 duration-300">
      <div className="app-card relative overflow-hidden p-5 shadow-[0_16px_40px_rgba(0,0,0,0.18)] border-2 border-primary/20 bg-card rounded-2xl">
        {/* Top bar header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-container/20 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-[24px]">waving_hand</span>
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-primary dark:text-primary-fixed leading-snug">
                {fullTitle}
              </h3>
              <p className="text-xs app-muted">Pesan hangat untuk produktivitas hari ini</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-outline hover:bg-hover hover:text-on-surface transition-colors shrink-0"
            aria-label="Tutup"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Message items list */}
        <ul className="space-y-2 text-xs text-on-surface-variant my-3 pl-1">
          <li className="flex items-start gap-2">
            <span className="text-base leading-none">🛌</span>
            <span>Jangan lupa untuk istirahat yang cukup ya.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-base leading-none">🧘‍♂️</span>
            <span>Lakukan peregangan (stretching) sejenak agar tubuh tetap segar.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-base leading-none">💧</span>
            <span>Minum air putih yang cukup hari ini.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-base leading-none">🍃</span>
            <span>Selalu jaga kesehatan Anda selama beraktivitas.</span>
          </li>
          <li className="flex items-start gap-2 font-medium text-primary dark:text-primary-fixed">
            <span className="text-base leading-none">✅</span>
            <span>Pastikan semua tanggung jawab pada aplikasi SIAKAD sudah terlaksana dengan benar!</span>
          </li>
        </ul>

        {/* Dismiss action */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-semibold transition-colors"
          >
            Siap, Mengerti! 👍
          </button>
        </div>

        {/* 5-second countdown progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary/15">
          <div
            className="h-full bg-primary transition-all ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
