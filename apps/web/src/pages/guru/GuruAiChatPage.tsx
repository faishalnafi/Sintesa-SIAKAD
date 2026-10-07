import { useState, useRef, useEffect, useId, useMemo } from "react";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { marked } from "marked";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";

// Configure marked parser for AI responses
marked.setOptions({
  breaks: true,
  gfm: true,
});

marked.use({
  renderer: {
    link({ href, title, text }) {
      const isDownload = Boolean(href && (href.includes("/api/uploads/") || href.includes("filename=")));
      const titleAttr = title ? `title="${title}"` : "";
      const downloadAttr = isDownload ? "download" : "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" ${downloadAttr} ${titleAttr} class="text-[var(--accent)] underline font-semibold hover:opacity-80">${text}</a>`;
    },
  },
});

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES_PER_UPLOAD = 25;

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "code"
  | "file";

export interface ChatAttachment {
  id: string;
  name: string;
  storedName?: string; // UUID filename e.g. f47ac10b-58cc-4372-a567-0e02b2c3d479.png
  storageKey?: string; // Full storage key e.g. ai-chat/session-xxx/f47ac10b-....png
  storageProvider?: string; // "local" | "r2" | "s3" | "gcs" | "generic"
  storageUrl?: string; // Persistent URL (/api/uploads/ai-chat/...)
  cloudUrl?: string; // Direct Cloud Object Storage URL if active
  isUploading?: boolean;
  size: number;
  type: string;
  category: FileCategory;
  dataUrl?: string; // base64 DataURL
  previewUrl?: string; // Persistent storageUrl or Blob object URL
  textPreview?: string; // Extracted content for Excel / CSV / txt
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileCategory(name: string, mime?: string): FileCategory {
  const n = name.toLowerCase();
  const m = (mime || "").toLowerCase();

  if (m.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|heic|heif)$/.test(n)) return "image";
  if (m.startsWith("video/") || /\.(mp4|webm|mkv|mov|avi|wmv|flv|3gp)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/.test(n)) return "audio";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel") || /\.(xlsx|xls|csv)$/.test(n)) return "spreadsheet";
  if (m.includes("word") || m.includes("document") || /\.(docx|doc|rtf|odt)$/.test(n)) return "document";
  if (m.includes("presentation") || m.includes("powerpoint") || /\.(pptx|ppt)$/.test(n)) return "presentation";
  if (m.startsWith("text/") || /\.(txt|json|md|py|js|ts|tsx|jsx|html|css|sql|sh|xml|yaml|yml)$/.test(n)) return "code";
  return "file";
}

export const SUPPORTED_FILE_EXTENSIONS = [
  // Spreadsheets
  "xlsx", "xls", "csv", "ods",
  // Documents & Text
  "pdf", "doc", "docx", "txt", "rtf", "odt",
  // Images
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "svg", "ico", "heic", "heif",
  // Audio
  "mp3", "wav", "m4a", "ogg", "aac", "flac", "wma",
  // Video
  "mp4", "webm", "mov", "mkv", "avi", "wmv", "flv", "3gp",
  // Presentations
  "pptx", "ppt", "odp",
  // Code & Data
  "json", "md", "sql", "html", "css", "js", "ts", "tsx", "jsx", "py", "xml", "yaml", "yml",
];

export function isSupportedChatFile(name: string, mime?: string): boolean {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (SUPPORTED_FILE_EXTENSIONS.includes(ext)) return true;
  const m = (mime || "").toLowerCase();
  if (
    m.startsWith("image/") ||
    m.startsWith("video/") ||
    m.startsWith("audio/") ||
    m.startsWith("text/") ||
    m === "application/pdf" ||
    m.includes("spreadsheet") ||
    m.includes("excel") ||
    m.includes("word") ||
    m.includes("presentation")
  ) {
    return true;
  }
  return false;
}

export function getFileCategoryTheme(category: FileCategory): {
  icon: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
} {
  switch (category) {
    case "image":
      return { icon: "image", textClass: "text-blue-500", bgClass: "bg-blue-500/10", borderClass: "border-blue-500/20" };
    case "video":
      return { icon: "videocam", textClass: "text-purple-500", bgClass: "bg-purple-500/10", borderClass: "border-purple-500/20" };
    case "audio":
      return { icon: "audio_file", textClass: "text-amber-500", bgClass: "bg-amber-500/10", borderClass: "border-amber-500/20" };
    case "pdf":
      return { icon: "picture_as_pdf", textClass: "text-red-500", bgClass: "bg-red-500/10", borderClass: "border-red-500/20" };
    case "spreadsheet":
      return { icon: "table_chart", textClass: "text-emerald-500", bgClass: "bg-emerald-500/10", borderClass: "border-emerald-500/20" };
    case "document":
      return { icon: "description", textClass: "text-sky-500", bgClass: "bg-sky-500/10", borderClass: "border-sky-500/20" };
    case "presentation":
      return { icon: "slideshow", textClass: "text-orange-500", bgClass: "bg-orange-500/10", borderClass: "border-orange-500/20" };
    case "code":
      return { icon: "code", textClass: "text-indigo-500", bgClass: "bg-indigo-500/10", borderClass: "border-indigo-500/20" };
    default:
      return { icon: "attach_file", textClass: "text-slate-500", bgClass: "bg-slate-500/10", borderClass: "border-slate-500/20" };
  }
}

export function getHonorific(
  user?: { jenisKelamin?: string | null; name?: string | null; roles?: string[] } | null,
  options?: { formal?: boolean; short?: boolean }
): string {
  const jk = user?.jenisKelamin?.trim()?.toUpperCase();
  const roles = (user?.roles || []).map((r) => r.toLowerCase());
  const isStudent = roles.length > 0 && roles.every((r) => r === "siswa" || r === "alumni");

  if (jk === "L" || jk === "LAKI-LAKI" || jk === "M") {
    if (isStudent) return "Mas";
    return options?.formal ? "Bapak" : (options?.short ? "Pak" : "Bapak");
  }

  if (jk === "P" || jk === "PEREMPUAN" || jk === "F") {
    if (isStudent) return "Mbak";
    return options?.formal ? "Ibu" : (options?.short ? "Bu" : "Ibu");
  }

  // Sapaan general ramah jika JK tidak diketahui: Kakak / Kak
  return options?.formal ? "Kakak" : (options?.short ? "Kak" : "Kakak");
}

/**
 * Return formatted date time string e.g. "29 Sep 2026, 19:42"
 */
export function getFullDateTime(): string {
  return new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MarkdownContent({ content }: { content: string }) {
  const parsedHtml = useMemo(() => {
    try {
      return marked.parse(content || "");
    } catch {
      return content || "";
    }
  }, [content]);

  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none break-words text-xs md:text-[13px] leading-relaxed
        [&_p]:mb-2 [&_p:last-child]:mb-0
        [&_strong]:font-bold [&_strong]:text-[var(--fg)]
        [&_em]:italic [&_em]:opacity-95
        [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1
        [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1
        [&_li]:my-0.5
        [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-slate-200/70 [&_code]:dark:bg-slate-800/80 [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:text-pink-600 [&_code]:dark:text-pink-400
        [&_pre]:p-3 [&_pre]:my-2 [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:overflow-x-auto [&_pre]:text-xs
        [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--accent)] [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2
        [&_table]:w-full [&_table]:my-2 [&_table]:border-collapse [&_table]:border [&_table]:border-[var(--card-border)] [&_table]:text-xs
        [&_th]:border [&_th]:border-[var(--card-border)] [&_th]:p-2 [&_th]:bg-[var(--hover)] [&_th]:font-semibold
        [&_td]:border [&_td]:border-[var(--card-border)] [&_td]:p-2
        [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-2
        [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-1.5
        [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1
        [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:font-semibold hover:[&_a]:opacity-80"
      dangerouslySetInnerHTML={{ __html: parsedHtml as string }}
    />
  );
}

function ChatBubbleItem({
  message,
  isUser,
  user,
  onEdit,
  onRetry,
  onSendMessage,
  onImagePreview,
}: {
  message: Message;
  isUser: boolean;
  user: any;
  onEdit?: (text: string) => void;
  onRetry?: (msg: Message) => void;
  onSendMessage?: (text: string) => void;
  onImagePreview?: (url: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isUser) {
      setIsOverflowing(false);
      return;
    }
    const el = contentRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > 140);
    }
  }, [message.text, isUser]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group flex gap-3 md:gap-4 items-start relative transition-all",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      {isUser ? (
        user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name || "User"}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover shrink-0 shadow-sm border border-[var(--card-border)]"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-sm">
            {user?.name ? user.name[0].toUpperCase() : "G"}
          </div>
        )
      ) : (
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500 to-red-600 text-white flex items-center justify-center shrink-0 shadow-sm ring-2 ring-red-500/20">
          <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
        </div>
      )}

      {/* Content Bubble Container */}
      <div
        className={cn(
          "flex flex-col max-w-[85%] md:max-w-[75%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "px-4 py-3 rounded-2xl text-xs md:text-[13px] leading-relaxed relative transition-all duration-200",
            isUser
              ? "bg-[var(--accent)] text-white rounded-tr-xs shadow-sm font-medium"
              : "bg-[var(--card)] text-[var(--fg)] border rounded-tl-xs shadow-sm"
          )}
          style={!isUser ? { borderColor: "var(--card-border)" } : {}}
        >
          {/* Attachments rendering inside bubble */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {message.attachments.map((att) => {
                const theme = getFileCategoryTheme(att.category);
                const resolvedUrl = att.storageUrl || att.previewUrl || att.dataUrl || "";
                const isImg = att.category === "image" && Boolean(resolvedUrl);

                if (isImg) {
                  return (
                    <div
                      key={att.id}
                      onClick={() => onImagePreview?.(resolvedUrl)}
                      className="group/img relative rounded-xl overflow-hidden border border-black/15 dark:border-white/20 cursor-pointer shadow-xs hover:opacity-95 transition-all max-w-[200px]"
                      title={`Klik untuk memperbesar: ${att.name}${att.storedName ? ` (${att.storedName})` : ""}`}
                    >
                      <img
                        src={resolvedUrl}
                        alt={att.name}
                        className="max-h-36 w-auto object-cover rounded-xl"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white">
                        <span className="material-symbols-outlined text-[20px]">zoom_in</span>
                      </div>
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-[2px] px-1.5 py-0.5 text-[9px] text-white truncate">
                        {att.storedName || att.name}
                      </div>
                    </div>
                  );
                }

                return (
                  <a
                    key={att.id}
                    href={resolvedUrl || undefined}
                    target={resolvedUrl ? "_blank" : undefined}
                    rel="noreferrer"
                    download={att.name}
                    className={cn(
                      "flex items-center gap-2 p-1.5 pr-2.5 rounded-xl border text-xs shadow-2xs max-w-[250px] transition-opacity hover:opacity-90",
                      isUser
                        ? "bg-white/15 border-white/20 text-white"
                        : cn(theme.bgClass, theme.borderClass, "text-[var(--fg)]")
                    )}
                    title={`${att.name}${att.storedName ? ` • Tersimpan: ${att.storedName}` : ""}`}
                  >
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        isUser ? "bg-white/20 text-white" : theme.textClass
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px]">{theme.icon}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "font-semibold text-[11px] truncate",
                          isUser ? "text-white" : "text-[var(--fg)]"
                        )}
                      >
                        {att.name}
                      </div>
                      <div className={cn("text-[9px] truncate", isUser ? "text-white/80" : "app-muted")}>
                        {formatFileSize(att.size)}
                        {att.storedName ? ` • ${att.storedName.slice(0, 8)}…` : ""}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}

          {/* Text Content (with auto-collapse limit for user messages only) */}
          <div
            ref={contentRef}
            className={cn(
              "relative transition-all duration-300",
              isUser && isOverflowing && !isExpanded ? "max-h-[125px] overflow-hidden" : ""
            )}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap">{message.text}</div>
            ) : (
              <MarkdownContent content={message.text} />
            )}

            {/* Gradient Fade overlay when collapsed (user messages only) */}
            {isUser && isOverflowing && !isExpanded && (
              <div
                className="absolute inset-x-0 bottom-0 h-10 pointer-events-none bg-gradient-to-t from-[var(--accent)] to-transparent"
              />
            )}
          </div>

          {/* Interactive Action Cards */}
          {message.actionCard && (
            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 w-full">
              {/* Card: Schedule Draft */}
              {message.actionCard.type === "schedule_draft" && (
                <div className="rounded-xl p-3 bg-[var(--hover)] border border-[var(--input-border)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">event_available</span>
                      Draf Jurnal Pembelajaran
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold uppercase">
                      {message.actionCard.data.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-white dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-200/50 dark:border-slate-800">
                    <div>
                      <span className="app-muted block">Kelas & Mapel:</span>
                      <span className="font-semibold text-[var(--fg)]">
                        {message.actionCard.data.class} • {message.actionCard.data.subject}
                      </span>
                    </div>
                    <div>
                      <span className="app-muted block">Waktu:</span>
                      <span className="font-semibold text-[var(--fg)]">
                        {message.actionCard.data.hours}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="app-muted block">Materi Pokok:</span>
                      <span className="font-medium text-[var(--fg)]">
                        {message.actionCard.data.materi}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="app-muted block">Presensi:</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {message.actionCard.data.presence}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        Swal.fire({
                          title: "Tersimpan!",
                          text: "Draf jurnal pembelajaran berhasil disimpan di database.",
                          icon: "success",
                          timer: 1800,
                          showConfirmButton: false,
                        })
                      }
                      className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                    >
                      Simpan Draft
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        Swal.fire({
                          title: "Jurnal Terkirim!",
                          text: "Entri jurnal resmi berhasil dikirim ke sistem akademik.",
                          icon: "success",
                        })
                      }
                      className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                    >
                      Kirim Sekarang
                    </button>
                  </div>
                </div>
              )}

              {/* Card: Collision Alert */}
              {message.actionCard.type === "schedule_collision" && (
                <div className="rounded-xl p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-red-600 dark:text-red-400">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    Bentrokan Jadwal Terdeteksi!
                  </div>
                  <p className="text-[11px] text-red-700 dark:text-red-300 leading-relaxed">
                    Pada {message.actionCard.data.date}, <strong>{message.actionCard.data.hour}</strong> di kelas{" "}
                    <strong>{message.actionCard.data.class}</strong> telah dijadwalkan untuk{" "}
                    <strong>{message.actionCard.data.occupiedBy}</strong> ({message.actionCard.data.subject}).
                  </p>
                  <div className="pt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSendMessage?.(
                          `Pindahkan jadwal ke ${message.actionCard?.data.suggestedHour}`
                        )
                      }
                      className="py-1 px-3 rounded-lg text-[11px] font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      Pindahkan ke {message.actionCard.data.suggestedHour}
                    </button>
                  </div>
                </div>
              )}

              {/* Card: Excel Smart Import */}
              {message.actionCard.type === "excel_import_preview" && (
                <div className="rounded-xl p-3 bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px]">file_present</span>
                      {message.actionCard.data.fileName}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                      {message.actionCard.data.totalRows} Siswa
                    </span>
                  </div>

                  <div className="text-[11px] bg-white dark:bg-slate-900/50 p-2.5 rounded-lg border border-emerald-200/50 dark:border-emerald-800 space-y-1.5">
                    <div className="font-semibold text-slate-700 dark:text-slate-300 text-[10px] uppercase">
                      Pemetaan Kolom Otomatis (AI):
                    </div>
                    <div className="space-y-1">
                      {message.actionCard.data.matchedColumns.map((col: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-600 dark:text-slate-400 font-mono">
                            "{col.original}"
                          </span>
                          <span className="material-symbols-outlined text-[14px] text-slate-400">
                            arrow_forward
                          </span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded font-mono">
                            {col.mappedTo}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-1 border-t border-slate-100 dark:border-slate-800 flex justify-between text-[11px]">
                      <span className="app-muted">Nilai Rata-rata:</span>
                      <span className="font-bold text-[var(--fg)]">
                        {message.actionCard.data.avgScore}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        Swal.fire({
                          title: "Nilai Disimpan sebagai Draft!",
                          text: "Data nilai telah masuk ke sistem dan siap direview di menu Input Nilai.",
                          icon: "success",
                        })
                      }
                      className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
                    >
                      Simpan Draft
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        Swal.fire({
                          title: "Nilai Berhasil Dikirim!",
                          text: "Nilai resmi telah diajukan ke Wali Kelas.",
                          icon: "success",
                        })
                      }
                      className="flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    >
                      Kirim Nilai
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Expand / Collapse Button (User messages only) */}
          {isUser && isOverflowing && (
            <div className="flex justify-end mt-1.5 -mb-1 relative z-10">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shadow-xs bg-black/25 hover:bg-black/40 text-white"
                title={isExpanded ? "Ciutkan teks" : "Tampilkan selengkapnya"}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isExpanded ? "keyboard_arrow_up" : "keyboard_arrow_down"}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Hover Action Bar: Copy & Edit / Retry */}
        <div
          className={cn(
            "flex items-center gap-1 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-slate-400",
            isUser ? "justify-end" : "justify-start"
          )}
        >
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-md hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
            title={copied ? "Tersalin!" : "Salin teks"}
          >
            <span className="material-symbols-outlined text-[15px]">
              {copied ? "check" : "content_copy"}
            </span>
          </button>

          {isUser && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(message.text)}
              className="p-1 rounded-md hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
              title="Edit pesan"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
            </button>
          )}

          {!isUser && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(message)}
              className="p-1 rounded-md hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
              title="Kirim ulang prompt ini"
            >
              <span className="material-symbols-outlined text-[15px]">refresh</span>
            </button>
          )}

          <span className="text-[10px] ml-1.5 opacity-70 font-medium select-none">
            {message.time}
          </span>
        </div>
      </div>
    </div>
  );
}

export interface Message {
  id: string;
  sender: "user" | "assistant";
  text: string;
  time: string;
  attachments?: ChatAttachment[];
  actionCard?: {
    type: "schedule_draft" | "schedule_collision" | "excel_import_preview";
    data: any;
  };
}

export interface ChatSession {
  id: string;
  userId?: string;
  title: string;
  updatedAt: string;
  isPinned?: boolean;
  messages: Message[];
}

const INITIAL_SESSIONS: ChatSession[] = [];

function getUserStorageKey(userId?: string | null): string | null {
  return userId ? `simak_ai_sessions_v2_${userId}` : null;
}

function loadUserSessionsFromLocal(userId?: string | null): ChatSession[] {
  try {
    // Purge legacy un-scoped global key so sessions never leak across user accounts
    localStorage.removeItem("simak_ai_sessions");
    const key = getUserStorageKey(userId);
    if (!key || !userId) return INITIAL_SESSIONS;
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s: any) =>
            s?.userId === userId &&
            !["session-1", "session-2", "session-3"].includes(s?.id) &&
            s?.title !== "Percakapan Baru" &&
            Array.isArray(s?.messages) &&
            s.messages.some(
              (m: any) =>
                m?.sender === "assistant" && !String(m?.text || "").startsWith("⚠️")
            )
        );
      }
    }
  } catch (e) {
    console.error(e);
  }
  return INITIAL_SESSIONS;
}

export function GuruAiChatPage() {
  const { user } = useAuthStore();
  const fileInputId = useId();

  // Sessions state strictly scoped to the currently logged-in user.id
  const [sessions, setSessions] = useState<ChatSession[]>(() =>
    loadUserSessionsFromLocal(user?.id)
  );

  // Always open on a fresh "new" chat screen without creating a sidebar room yet
  const [activeSessionId, setActiveSessionId] = useState<string>("new");
  // Holds messages for a "new" chat before AI responds and officially creates the room
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [inputText, setInputText] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDraggingOverInput, setIsDraggingOverInput] = useState(false);
  const [previewImageModal, setPreviewImageModal] = useState<string | null>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    id: string;
    top: number;
    left: number;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef<number>(0);
  const draftSessionIdRef = useRef<string>(`session-${Date.now()}`);

  // Helper to persist a session to backend DB (strictly bound to current user)
  const syncSessionToServer = (session: ChatSession) => {
    if (!user?.id) return;
    if (session.userId && session.userId !== user.id) return;
    api("/teacher/ai/sessions", {
      method: "POST",
      body: JSON.stringify({
        id: session.id,
        userId: user.id,
        title: session.title,
        messages: session.messages,
      }),
    }).catch((err) => {
      console.warn("[GuruAiChat] Failed to sync session to server:", err);
    });
  };

  // Reload sessions whenever the logged-in user changes (prevents cross-user session leak)
  useEffect(() => {
    const currentUserId = user?.id;
    setActiveSessionId("new");
    setPendingMessages([]);
    setAttachedFiles([]);
    setInputText("");
    draftSessionIdRef.current = `session-${Date.now()}`;

    if (!currentUserId) {
      setSessions([]);
      return;
    }

    const localForUser = loadUserSessionsFromLocal(currentUserId);
    setSessions(localForUser);

    let cancelled = false;
    api<ChatSession[]>("/teacher/ai/sessions")
      .then((res) => {
        if (cancelled) return;
        if (Array.isArray(res.data)) {
          const serverSessions = res.data
            .filter((s) => !s.userId || s.userId === currentUserId)
            .map((s) => ({ ...s, userId: currentUserId }));

          const byId = new Map<string, ChatSession>();
          for (const s of serverSessions) {
            byId.set(s.id, s);
          }
          for (const localS of localForUser) {
            if (localS.userId === currentUserId && !byId.has(localS.id)) {
              byId.set(localS.id, localS);
              syncSessionToServer(localS);
            }
          }
          setSessions(Array.from(byId.values()));
        }
      })
      .catch(() => {
        // Ignore offline/initial fetch error
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (renamingSessionId) {
      const timer = setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [renamingSessionId]);

  // Prevent browser from opening dropped files in a new tab anywhere on the window
  useEffect(() => {
    const preventWindowDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", preventWindowDrop);
    window.addEventListener("drop", preventWindowDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowDrop);
      window.removeEventListener("drop", preventWindowDrop);
    };
  }, []);

  // Sync sessions to user-scoped localStorage safely (strip heavy base64 dataUrl to avoid QuotaExceededError)
  useEffect(() => {
    try {
      const storageKey = getUserStorageKey(user?.id);
      if (!storageKey || !user?.id) return;
      const lightSessions = sessions
        .filter((s) => !s.userId || s.userId === user.id)
        .map((s) => ({
          ...s,
          userId: user.id,
          messages: s.messages.map((m) => ({
            ...m,
            attachments: m.attachments?.map((att) => ({
              ...att,
              previewUrl: att.storageUrl || att.previewUrl,
              dataUrl:
                !att.storageUrl && att.dataUrl && att.dataUrl.length < 200_000
                  ? att.dataUrl
                  : undefined,
            })),
          })),
        }));
      localStorage.setItem(storageKey, JSON.stringify(lightSessions));
    } catch (e) {
      console.warn("Gagal menyimpan riwayat chat ke localStorage:", e);
    }
  }, [sessions, user?.id]);

  const activeSession =
    activeSessionId === "new"
      ? undefined
      : sessions.find((s) => s.id === activeSessionId);

  const displayedMessages = activeSession ? activeSession.messages : pendingMessages;

  // Auto-scroll chat to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [displayedMessages, isGenerating]);

  // Adjust textarea height automatically
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  // Process a single file into ChatAttachment
  const processSingleFile = async (file: File): Promise<ChatAttachment> => {
    const category = getFileCategory(file.name, file.type);
    const id = `att-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    let previewUrl: string | undefined = undefined;
    let dataUrl: string | undefined = undefined;
    let textPreview: string | undefined = undefined;

    // Fast Blob Object URL for instant UI preview before server upload finishes
    if (category === "image" || category === "video" || category === "audio") {
      try {
        previewUrl = URL.createObjectURL(file);
      } catch (e) {
        console.warn(e);
      }
    }

    // If Excel / Spreadsheet, extract ALL sheets cleanly via XLSX
    if (category === "spreadsheet") {
      try {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const visibleSheetNames = wb.SheetNames.filter(
          (name) => !name.startsWith("_SECURITY") && !name.startsWith("__")
        );
        const targetSheetNames = visibleSheetNames.length > 0 ? visibleSheetNames : wb.SheetNames;

        let sheetSummary = `[File Spreadsheet Multi-Lembar: "${file.name}" | Total Lembar Kerja: ${targetSheetNames.length} (${targetSheetNames.join(", ")})]\n\n`;

        for (let idx = 0; idx < targetSheetNames.length; idx++) {
          const sName = targetSheetNames[idx];
          const sheet = wb.Sheets[sName];
          if (!sheet) continue;
          const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
            header: 1,
            defval: "",
            blankrows: false,
          });

          const compactLines: string[] = [];
          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            // Trim trailing empty cells on each row to avoid dozens of empty commas
            let lastNonEmpty = row.length - 1;
            while (
              lastNonEmpty >= 0 &&
              (row[lastNonEmpty] === null ||
                row[lastNonEmpty] === undefined ||
                String(row[lastNonEmpty]).trim() === "")
            ) {
              lastNonEmpty--;
            }
            if (lastNonEmpty < 0) continue;
            const trimmedRow = row.slice(0, lastNonEmpty + 1).map((cell) => {
              const s = String(cell ?? "").trim().replace(/\r?\n/g, " ");
              return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
            });
            compactLines.push(trimmedRow.join(","));
          }

          if (compactLines.length > 0) {
            const rowCount = compactLines.length;
            const limitedRows = compactLines.slice(0, 60);
            const extraNote = rowCount > 60 ? `\n... (menampilkan 60 baris pertama dari total ${rowCount} baris untuk hemat token)` : "";
            sheetSummary += `=== LEMBAR KERJA (SHEET ${idx + 1}/${targetSheetNames.length}): "${sName}" ===\n${limitedRows.join("\n").slice(0, 6000)}${extraNote}\n\n`;
          }
        }
        textPreview = sheetSummary.slice(0, 18000);
      } catch (err) {
        console.warn("Gagal mengekstrak spreadsheet:", err);
      }
    } else if (category === "code" || file.type.startsWith("text/")) {
      try {
        textPreview = (await file.text()).slice(0, 8000);
      } catch (err) {
        console.warn("Gagal membaca file teks:", err);
      }
    }

    // Read as base64 dataUrl (needed for uploading to storage & sending to Gemini API)
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } catch (err) {
      console.warn("Gagal membaca base64 file:", err);
    }

    return {
      id,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      category,
      isUploading: true,
      previewUrl: previewUrl || dataUrl,
      dataUrl,
      textPreview,
    };
  };

  // Add multiple files with strict validation (max 10MB per file, max 25 files total)
  // Immediately uploads to dedicated folder `ai-chat/{sessionId}` (Object Storage if active, or Local) with UUID name
  const handleFilesAdded = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    // Check max 25 files limit
    const availableSlots = MAX_FILES_PER_UPLOAD - attachedFiles.length;
    if (availableSlots <= 0) {
      Swal.fire({
        title: "Batas Jumlah File Tercapai",
        text: `Maksimal ${MAX_FILES_PER_UPLOAD} file dalam 1x unggahan chat. Silakan kirim file yang ada saat ini terlebih dahulu.`,
        icon: "warning",
        confirmButtonColor: "#EA4335",
      });
      return;
    }

    const filesToProcess: File[] = [];
    const oversizedFiles: string[] = [];
    const unsupportedFiles: string[] = [];
    let excessCount = 0;

    for (let i = 0; i < incoming.length; i++) {
      const file = incoming[i];
      if (!isSupportedChatFile(file.name, file.type)) {
        unsupportedFiles.push(file.name);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(`${file.name} (${formatFileSize(file.size)})`);
        continue;
      }
      if (filesToProcess.length < availableSlots) {
        filesToProcess.push(file);
      } else {
        excessCount++;
      }
    }

    if (unsupportedFiles.length > 0) {
      Swal.fire({
        title: "Format Berkas Tidak Didukung",
        html: `NEBULA AI tidak dapat memproses berkas berikut karena formatnya belum didukung:<br/><br/>
        <div class="text-left text-xs bg-red-50 dark:bg-red-950/30 p-2.5 rounded-lg max-h-36 overflow-y-auto font-mono text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 mb-3">
          ${unsupportedFiles.map((f) => `• ${f}`).join("<br/>")}
        </div>
        <div class="text-xs text-slate-600 dark:text-slate-300 text-left space-y-1">
          <p class="font-semibold text-slate-700 dark:text-slate-200">Format berkas yang didukung NEBULA AI:</p>
          <ul class="list-disc pl-4 space-y-0.5">
            <li><strong>Spreadsheet:</strong> Excel (.xlsx, .xls), CSV (.csv)</li>
            <li><strong>Dokumen:</strong> PDF (.pdf), Word (.docx, .doc), Teks (.txt)</li>
            <li><strong>Gambar:</strong> JPG, PNG, WebP, GIF, SVG</li>
            <li><strong>Media:</strong> Audio (MP3, WAV), Video (MP4, WebM)</li>
          </ul>
        </div>`,
        icon: "warning",
        confirmButtonColor: "#EA4335",
      });
    }

    if (oversizedFiles.length > 0) {
      Swal.fire({
        title: "Ukuran File Melebihi 10 MB",
        html: `Setiap file dibatasi maksimal <strong>10 MB</strong>.<br/>File berikut dilewati karena melebihi batas:<br/><br/><div class="text-left text-xs bg-slate-100 dark:bg-slate-800 p-2.5 rounded-lg max-h-36 overflow-y-auto font-mono text-red-600">${oversizedFiles.map((f) => `• ${f}`).join("<br/>")}</div>`,
        icon: "warning",
        confirmButtonColor: "#EA4335",
      });
    }

    if (excessCount > 0) {
      Swal.fire({
        title: "Maksimal 25 File",
        text: `${excessCount} file tidak dapat ditambahkan karena melebihi batas total 25 file per unggahan chat.`,
        icon: "info",
        confirmButtonColor: "#EA4335",
      });
    }

    if (filesToProcess.length > 0) {
      const processed = await Promise.all(filesToProcess.map(processSingleFile));
      setAttachedFiles((prev) => [...prev, ...processed]);

      const currentTargetSessionId = activeSession?.id || draftSessionIdRef.current;

      // Immediately upload files to Object Storage (or dedicated local folder) with UUID naming
      api<
        Array<{
          clientId?: string;
          originalName: string;
          storedName: string;
          storageKey: string;
          storageUrl: string;
          cloudUrl?: string;
          provider: string;
          mimeType: string;
          size: number;
        }>
      >("/teacher/ai/upload", {
        method: "POST",
        body: JSON.stringify({
          sessionId: currentTargetSessionId,
          files: processed.map((f) => ({
            id: f.id,
            name: f.name,
            type: f.type,
            size: f.size,
            base64: f.dataUrl ? f.dataUrl.split(",")[1] : undefined,
          })),
        }),
      })
        .then((res) => {
          const uploadedList = res.data || [];
          if (uploadedList.length > 0) {
            setAttachedFiles((prev) =>
              prev.map((item) => {
                const match = uploadedList.find(
                  (u) => u.clientId === item.id || u.originalName === item.name
                );
                if (match) {
                  return {
                    ...item,
                    isUploading: false,
                    storedName: match.storedName,
                    storageKey: match.storageKey,
                    storageProvider: match.provider,
                    storageUrl: match.storageUrl,
                    cloudUrl: match.cloudUrl,
                    previewUrl: match.storageUrl || item.previewUrl,
                  };
                }
                return { ...item, isUploading: false };
              })
            );
          }
        })
        .catch((err) => {
          console.warn("[GuruAiChat] Immediate file upload warning:", err);
          setAttachedFiles((prev) =>
            prev.map((item) => ({ ...item, isUploading: false }))
          );
        });
    }
  };

  // Remove a single attached file chip and delete it from storage if already uploaded
  const handleRemoveAttachedFile = (fileId: string) => {
    const target = attachedFiles.find((f) => f.id === fileId);
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (target?.storageKey) {
      api("/teacher/ai/files", {
        method: "DELETE",
        body: JSON.stringify({
          storageKey: target.storageKey,
          provider: target.storageProvider,
        }),
      }).catch(() => {});
    }
  };

  // Clear all attached file chips and delete them from storage if already uploaded
  const handleClearAllAttachedFiles = () => {
    const toDelete = [...attachedFiles];
    setAttachedFiles([]);
    for (const f of toDelete) {
      if (f.storageKey) {
        api("/teacher/ai/files", {
          method: "DELETE",
          body: JSON.stringify({
            storageKey: f.storageKey,
            provider: f.storageProvider,
          }),
        }).catch(() => {});
      }
    }
  };

  // Extract files reliably from DataTransfer (files list or items list)
  const extractFilesFromDataTransfer = (dt: DataTransfer): File[] => {
    if (dt.files && dt.files.length > 0) {
      return Array.from(dt.files);
    }
    const extracted: File[] = [];
    if (dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) extracted.push(f);
        }
      }
    }
    return extracted;
  };

  // Clipboard Paste listener (e.g. screenshot or copied file pasting)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = extractFilesFromDataTransfer(e.clipboardData);
    if (pastedFiles.length > 0) {
      e.preventDefault();
      handleFilesAdded(pastedFiles);
    }
  };

  // Switch to a fresh New Chat screen (room is created only when first prompt is responded to)
  const handleNewChat = () => {
    // If there were unsent attached files in a "new" draft, clean them up
    if (activeSessionId === "new" && attachedFiles.length > 0) {
      handleClearAllAttachedFiles();
    } else {
      setAttachedFiles([]);
    }
    draftSessionIdRef.current = `session-${Date.now()}`;
    setActiveSessionId("new");
    setPendingMessages([]);
    setInputText("");
    setTimeout(() => textareaRef.current?.focus(), 20);
  };

  // Open 3-dot session menu
  const handleOpenSessionMenu = (
    session: ChatSession,
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.stopPropagation();
    if (sessionMenu?.id === session.id) {
      setSessionMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 148;
    const top =
      rect.bottom + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight)
        : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - 200);
    setSessionMenu({ id: session.id, top, left });
  };

  // Toggle pin / unpin chat session
  const handleTogglePinSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSessionMenu(null);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isPinned: !s.isPinned } : s))
    );
  };

  // Start renaming chat session inline
  const handleStartRenameSession = (session: ChatSession, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSessionMenu(null);
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
  };

  // Commit renamed chat session title
  const handleCommitRenameSession = (id: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === id) {
            const updated = { ...s, title: trimmed };
            syncSessionToServer(updated);
            return updated;
          }
          return s;
        })
      );
    }
    setRenamingSessionId(null);
  };

  // Delete chat session + MANDATORY deletion of all uploaded files in that roomchat
  const handleDeleteSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSessionMenu(null);
    const targetSession = sessions.find((s) => s.id === id);
    const sessionFiles =
      targetSession?.messages
        .flatMap((m) => m.attachments || [])
        .filter((att) => Boolean(att.storageKey))
        .map((att) => ({
          key: att.storageKey!,
          provider: att.storageProvider,
        })) || [];

    Swal.fire({
      title: "Hapus percakapan ini?",
      text: "Riwayat obrolan beserta seluruh file unggahan di dalam roomchat ini akan dihapus permanen dari penyimpanan.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#64748b",
      confirmButtonText: "Ya, Hapus Semua",
      cancelButtonText: "Batal",
    }).then((result) => {
      if (result.isConfirmed) {
        // Delete all files in this roomchat from Object Storage & Local Folder + DB
        api(`/teacher/ai/sessions/${encodeURIComponent(id)}`, {
          method: "DELETE",
          body: JSON.stringify({ files: sessionFiles }),
        }).catch((err) => {
          console.error("[GuruAiChat] Failed to delete session files from server:", err);
        });

        setSessions((prev) => {
          const filtered = prev.filter((s) => s.id !== id);
          if (activeSessionId === id) {
            draftSessionIdRef.current = `session-${Date.now()}`;
            setActiveSessionId("new");
            setPendingMessages([]);
          }
          return filtered;
        });
      }
    });
  };

  // Send message
  const handleSendMessage = (customText?: string) => {
    const textToSend = (customText || inputText).trim();
    const filesToSend = [...attachedFiles];

    if (!textToSend && filesToSend.length === 0) return;

    const userMessageId = `m-u-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      sender: "user",
      text: textToSend,
      attachments: filesToSend.length > 0 ? filesToSend : undefined,
      time: getFullDateTime(),
    };

    const newTitle = textToSend
      ? textToSend.slice(0, 32)
      : filesToSend.length > 0
      ? filesToSend[0].name.slice(0, 32)
      : "Percakapan AI";

    const existingSessionId = activeSession?.id || null;
    const targetSessionId = existingSessionId || draftSessionIdRef.current;

    const nextPending = !activeSession
      ? [...pendingMessages.filter((m) => !m.text.startsWith("⚠️")), userMessage]
      : [];

    if (!activeSession) {
      // Do NOT create a room in sidebar yet — wait until AI responds!
      setPendingMessages(nextPending);
    } else {
      const updatedSessionTitle =
        activeSession.messages.length === 0 && activeSession.title === "Percakapan Baru"
          ? newTitle
          : activeSession.title;

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSession.id) {
            return {
              ...s,
              title: updatedSessionTitle,
              updatedAt: "Baru saja",
              messages: [...s.messages, userMessage],
            };
          }
          return s;
        })
      );
    }

    setInputText("");
    setAttachedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Real Google Gemini AI API Call
    setIsGenerating(true);

    // Prepare previous conversation history (strip heavy base64 from history messages, but keep extracted textPreview & storageKey)
    const rawHistory = activeSession
      ? [...activeSession.messages, userMessage]
      : nextPending;
    const historyMessages = rawHistory.map((m, idx) => ({
      id: m.id,
      sender: m.sender,
      text: m.text,
      time: m.time,
      files:
        idx < rawHistory.length - 1 && m.attachments && m.attachments.length > 0
          ? m.attachments.map((att) => ({
              id: att.id,
              name: att.name,
              type: att.type,
              size: att.size,
              storageKey: att.storageKey,
              storageUrl: att.storageUrl,
              textPreview: att.textPreview ? `[Lampiran: ${att.name}]` : undefined,
            }))
          : undefined,
    }));

    // Payload files for backend AI (includes storage metadata if already uploaded via /ai/upload)
    const payloadFiles = filesToSend.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.size,
      storedName: f.storedName,
      storageKey: f.storageKey,
      storageProvider: f.storageProvider,
      storageUrl: f.storageUrl,
      cloudUrl: f.cloudUrl,
      base64: f.dataUrl ? f.dataUrl.split(",")[1] : undefined,
      textPreview: f.textPreview,
    }));

    api<{
      reply: string;
      honorific: string;
      teacherName: string;
      storedFiles?: Array<{
        clientId?: string;
        originalName: string;
        storedName: string;
        storageKey: string;
        storageUrl: string;
        cloudUrl?: string;
        provider: string;
      }>;
      generatedFiles?: Array<{
        id: string;
        name: string;
        size: number;
        type: string;
        category?: FileCategory;
        url: string;
        cloudUrl?: string;
        provider: string;
        key: string;
        storedName: string;
      }>;
    }>("/teacher/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: targetSessionId,
        messages: historyMessages,
        userPrompt: textToSend,
        files: payloadFiles,
      }),
    })
      .then((res) => {
        const replyText = res.data?.reply || "Tidak ada respon dari NEBULA AI.";
        const serverStoredFiles = res.data?.storedFiles || [];
        const serverGeneratedFiles = res.data?.generatedFiles || [];

        // Enrich userMessage attachments with persistent UUID storageUrl & storageKey
        const applyStoredFiles = (msg: Message): Message => {
          if (msg.id !== userMessageId || !msg.attachments) return msg;
          return {
            ...msg,
            attachments: msg.attachments.map((att) => {
              const matched = serverStoredFiles.find(
                (sf: any) => sf.clientId === att.id || sf.originalName === att.name
              );
              if (matched) {
                return {
                  ...att,
                  isUploading: false,
                  storedName: matched.storedName,
                  storageKey: matched.storageKey,
                  storageProvider: matched.provider,
                  storageUrl: matched.storageUrl,
                  cloudUrl: matched.cloudUrl,
                  previewUrl: matched.storageUrl || att.previewUrl,
                };
              }
              return { ...att, isUploading: false };
            }),
          };
        };

        const generatedAttachments: ChatAttachment[] = (serverGeneratedFiles || []).map((gf) => ({
          id: gf.id || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: gf.name,
          size: gf.size || 0,
          type: gf.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          category: (gf.category as FileCategory) || "spreadsheet",
          url: gf.url,
          cloudUrl: gf.cloudUrl,
          provider: gf.provider,
          storageUrl: gf.url,
          previewUrl: gf.url,
          storageKey: gf.key,
          storedName: gf.storedName || gf.name,
        }));

        const aiResponse: Message = {
          id: `m-ai-${Date.now()}`,
          sender: "assistant",
          text: replyText,
          time: getFullDateTime(),
          attachments: generatedAttachments.length > 0 ? generatedAttachments : undefined,
        };

        if (!existingSessionId) {
          // Prompt has been successfully responded to! Now create the room in sidebar with automatic title
          const createdSessionId = targetSessionId;
          const enrichedPending = nextPending.map(applyStoredFiles);
          const newSession: ChatSession = {
            id: createdSessionId,
            userId: user?.id,
            title: newTitle,
            updatedAt: "Baru saja",
            messages: [...enrichedPending, aiResponse],
          };
          setSessions((prevSessions) => [newSession, ...prevSessions]);
          setActiveSessionId(createdSessionId);
          setPendingMessages([]);
          draftSessionIdRef.current = `session-${Date.now()}`;
          syncSessionToServer(newSession);
        } else {
          setSessions((prevSessions) =>
            prevSessions.map((s) => {
              if (s.id === existingSessionId) {
                const updatedSession: ChatSession = {
                  ...s,
                  userId: user?.id,
                  updatedAt: "Baru saja",
                  messages: [...s.messages.map(applyStoredFiles), aiResponse],
                };
                syncSessionToServer(updatedSession);
                return updatedSession;
              }
              return s;
            })
          );
        }
      })
      .catch((err) => {
        console.error("[GuruAiChat] AI request failed:", err);
        const honorific = getHonorific(user, { short: true });
        const errMessage = err?.message || "Terjadi kesalahan saat berkomunikasi dengan server NEBULA AI.";
        const aiErrorResponse: Message = {
          id: `m-ai-${Date.now()}`,
          sender: "assistant",
          text: `⚠️ Maaf ${honorific} ${user?.name || ""}, terjadi kendala saat memproses jawaban:\n\n*${errMessage}*\n\nPastikan koneksi internet stabil dan layanan NEBULA AI aktif di server.`,
          time: getFullDateTime(),
        };

        if (!existingSessionId) {
          setPendingMessages((prev) => [...prev, aiErrorResponse]);
        } else {
          setSessions((prevSessions) =>
            prevSessions.map((s) => {
              if (s.id === existingSessionId) {
                return {
                  ...s,
                  messages: [...s.messages, aiErrorResponse],
                };
              }
              return s;
            })
          );
        }
      })
      .finally(() => {
        setIsGenerating(false);
      });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Edit message - load text into input and focus
  const handleEditMessage = (text: string) => {
    setInputText(text);
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  // Retry message
  const handleRetryMessage = (message: Message) => {
    if (message.sender === "assistant") {
      const msgIndex = displayedMessages.findIndex((m) => m.id === message.id);
      if (msgIndex > 0) {
        const prevUserMsg = displayedMessages[msgIndex - 1];
        if (prevUserMsg && prevUserMsg.sender === "user") {
          handleSendMessage(prevUserMsg.text);
          return;
        }
      }
    }
    handleSendMessage(message.text);
  };

  const filteredSessions = [...sessions]
    .filter((s) => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));

  const activeMenuSession = sessionMenu
    ? sessions.find((s) => s.id === sessionMenu.id) || null
    : null;

  const totalAttachedSize = attachedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0 || !e.currentTarget.contains(e.relatedTarget as Node)) {
          dragCounterRef.current = 0;
          setIsDragging(false);
          setIsDraggingOverInput(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);
        setIsDraggingOverInput(false);
        const dropped = extractFilesFromDataTransfer(e.dataTransfer);
        if (dropped.length > 0) {
          handleFilesAdded(dropped);
        }
      }}
      className="flex h-full w-full flex-1 min-h-0 overflow-hidden bg-[var(--bg)] text-[var(--fg)] relative"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-[var(--accent)]/10 backdrop-blur-[2px] border-4 border-dashed border-[var(--accent)] flex flex-col items-center justify-center pointer-events-none p-6 text-center animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)] text-white flex items-center justify-center shadow-lg mb-3">
            <span className="material-symbols-outlined text-[36px]">upload_file</span>
          </div>
          <div className="font-display font-bold text-lg text-[var(--accent)]">
            Lepaskan file di sini untuk melampirkan ke NEBULA AI
          </div>
          <div className="text-xs text-[var(--fg)] mt-1 opacity-80">
            Mendukung gambar, video, PDF, Excel, Word & semua format dokumen (Maks. 10 MB per file, hingga 25 file)
          </div>
        </div>
      )}

      {/* =========================================================
          SECONDARY SIDEBAR: RIWAYAT CHAT (NEBULA AI SIDEBAR)
          Tetap berada di sebelah kanan sidebar utama SIMAK
          ========================================================= */}
      <aside
        className={cn(
          "h-full flex flex-col border-r transition-all duration-300 ease-in-out shrink-0 z-10 min-h-0",
          isSidebarOpen ? "w-[280px]" : "w-0 overflow-hidden border-r-0"
        )}
        style={{
          background: "color-mix(in srgb, var(--card) 95%, transparent)",
          borderColor: "var(--divider)",
        }}
      >
        {/* Top Header of Chat History Sidebar */}
        <div className="p-4 border-b flex items-center justify-between gap-2 shrink-0" style={{ borderColor: "var(--divider)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold font-display tracking-tight truncate text-[var(--fg)]">
                Riwayat Obrolan
              </h2>
              <span className="text-[11px] app-muted block truncate">NEBULA AI</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center app-muted hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-colors"
            title="Sembunyikan sidebar riwayat"
          >
            <span className="material-symbols-outlined text-[20px]">dock_to_left</span>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3 shrink-0">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 shadow-sm bg-[var(--accent)] hover:opacity-95 text-white active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[20px]">edit_square</span>
            Percakapan Baru
          </button>
        </div>

        {/* Search Chat Box */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none select-none flex items-center justify-center">
              search
            </span>
            <input
              type="text"
              placeholder="Telusuri percakapan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-7 py-2 rounded-xl text-xs bg-[var(--input)] border text-[var(--fg)] placeholder:text-slate-400 focus:outline-none focus:border-[var(--accent)] transition-colors"
              style={{ borderColor: "var(--input-border)" }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[var(--fg)] p-0.5 rounded transition-colors"
                title="Hapus pencarian"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>
        </div>

        {/* Chat Sessions List (Scrollable) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 space-y-1 py-1">
          <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Terbaru
          </div>

          {filteredSessions.length === 0 ? (
            <div className="text-center py-8 px-4 text-xs app-muted">
              Tidak ada percakapan ditemukan.
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isMenuOpen = sessionMenu?.id === session.id;
              const isRenaming = renamingSessionId === session.id;

              return (
                <div
                  key={session.id}
                  onClick={() => {
                    if (!isRenaming) {
                      setActiveSessionId(session.id);
                      setPendingMessages([]);
                    }
                  }}
                  className={cn(
                    "group flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-xl text-xs cursor-pointer transition-all duration-150 select-none",
                    isActive
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-2xs"
                      : "text-[var(--fg)] hover:bg-[var(--hover)] font-medium"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={cn(
                        "material-symbols-outlined text-[18px] shrink-0",
                        isActive ? "text-[var(--accent)]" : "text-slate-400"
                      )}
                    >
                      chat_bubble
                    </span>

                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => handleCommitRenameSession(session.id)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCommitRenameSession(session.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingSessionId(null);
                          }
                        }}
                        className="w-full px-2 py-0.5 rounded-md text-xs bg-[var(--input)] border border-[var(--accent)] text-[var(--fg)] font-medium focus:outline-none"
                      />
                    ) : (
                      <span className="truncate">{session.title}</span>
                    )}
                  </div>

                  {isRenaming ? (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCommitRenameSession(session.id);
                        }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-500/15 transition-colors"
                        title="Simpan nama"
                      >
                        <span className="material-symbols-outlined text-[16px]">check</span>
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setRenamingSessionId(null);
                        }}
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-500/15 hover:text-[var(--fg)] transition-colors"
                        title="Batal"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center shrink-0">
                      {/* Pin indicator when session is pinned and not hovered / menu closed */}
                      {session.isPinned && !isMenuOpen && (
                        <span
                          className={cn(
                            "material-symbols-outlined text-[16px] px-1 group-hover:hidden",
                            isActive ? "text-[var(--accent)]" : "text-slate-400"
                          )}
                          title="Disematkan"
                        >
                          push_pin
                        </span>
                      )}

                      {/* 3-dot menu trigger button */}
                      <button
                        type="button"
                        onClick={(e) => handleOpenSessionMenu(session, e)}
                        className={cn(
                          "w-7 h-7 rounded-full items-center justify-center transition-colors",
                          isMenuOpen
                            ? "flex bg-black/10 dark:bg-white/10 text-[var(--fg)]"
                            : "hidden group-hover:flex hover:bg-black/10 dark:hover:bg-white/10",
                          isActive ? "text-[var(--accent)]" : "text-slate-500 dark:text-slate-400"
                        )}
                        title="Opsi percakapan"
                      >
                        <span className="material-symbols-outlined text-[18px]">more_vert</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Profile Info in History Sidebar */}
        <div className="p-3 border-t app-divider mt-auto shrink-0 flex items-center justify-between text-xs app-muted">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="truncate font-semibold">NEBULA AI</span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] font-mono">
            Multimodal 10MB
          </span>
        </div>
      </aside>

      {/* Floating 3-Dot Session Context Menu */}
      {sessionMenu && activeMenuSession && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setSessionMenu(null)}
          />
          <div
            className="fixed z-50 min-w-[185px] py-1.5 rounded-2xl border shadow-xl bg-[var(--card)] text-[var(--fg)] animate-fadeIn select-none"
            style={{
              top: sessionMenu.top,
              left: sessionMenu.left,
              borderColor: "var(--divider)",
            }}
          >
            <button
              type="button"
              onClick={(e) => handleTogglePinSession(activeMenuSession.id, e)}
              className="w-full px-3.5 py-2 text-xs font-medium flex items-center gap-3 hover:bg-[var(--hover)] transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">
                push_pin
              </span>
              <span>{activeMenuSession.isPinned ? "Lepas sematan" : "Sematkan"}</span>
            </button>

            <button
              type="button"
              onClick={(e) => handleStartRenameSession(activeMenuSession, e)}
              className="w-full px-3.5 py-2 text-xs font-medium flex items-center gap-3 hover:bg-[var(--hover)] transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">
                edit
              </span>
              <span>Ganti nama</span>
            </button>

            <div
              className="my-1 border-t"
              style={{ borderColor: "var(--divider)" }}
            />

            <button
              type="button"
              onClick={(e) => handleDeleteSession(activeMenuSession.id, e)}
              className="w-full px-3.5 py-2 text-xs font-medium flex items-center gap-3 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span>Hapus</span>
            </button>
          </div>
        </>
      )}

      {/* =========================================================
          MAIN ROOM CHAT CANVAS (NEBULA AI)
          ========================================================= */}
      <main className="flex-1 flex flex-col h-full min-w-0 min-h-0 overflow-hidden bg-[var(--bg)]">
        {/* Chat Room Top Navigation Bar */}
        <header
          className="h-14 px-4 lg:px-6 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: "var(--divider)", background: "color-mix(in srgb, var(--bg) 95%, transparent)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {/* Toggle button to reopen NEBULA AI History Sidebar if collapsed */}
            {!isSidebarOpen && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="w-9 h-9 rounded-xl flex items-center justify-center border app-muted hover:bg-[var(--hover)] hover:text-[var(--fg)] transition-all"
                style={{ borderColor: "var(--input-border)" }}
                title="Buka riwayat obrolan"
              >
                <span className="material-symbols-outlined text-[20px]">side_navigation</span>
              </button>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold truncate text-[var(--fg)]">
                  {activeSession?.title || "Percakapan Baru"}
                </h1>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                  <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
                  NEBULA AI
                </span>
              </div>
              <p className="text-[11px] app-muted truncate hidden sm:block">
                Konteks Pengguna: {user?.name} {user?.username ? `(${user.username})` : ""}
              </p>
            </div>
          </div>

        </header>

        {/* Chat Messages Stream Area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6 space-y-6">
          {displayedMessages.length === 0 ? (
            /* NEBULA AI Empty Welcome State */
            <div className="max-w-3xl mx-auto h-full flex flex-col justify-center items-center text-center py-10 px-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-rose-500 to-red-600 text-white flex items-center justify-center shadow-lg mb-6 ring-4 ring-red-500/20">
                <span className="material-symbols-outlined text-[36px]">auto_awesome</span>
              </div>

              <h2 className="text-2xl md:text-3xl font-display font-extrabold tracking-tight text-[var(--fg)] mb-2">
                Sebaiknya kita mulai dari mana{user?.name ? `, ${getHonorific(user, { formal: true })} ${user.name}` : ""}?
              </h2>
              <p className="text-sm app-muted max-w-lg mb-8">
                Unggah dokumen, Excel nilai, gambar, materi soal, atau video pembelajaran untuk dianalisis oleh <strong>NEBULA AI</strong>.
              </p>

              {/* Suggestion Prompt Chips Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl text-left">
                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      "Tolong jadwalkan kegiatan hari ini di kelas 10-A jam 1 sampai 3 materi Eksponen dan Logaritma, semua siswa hadir."
                    )
                  }
                  className="p-4 rounded-2xl border app-card hover:border-[var(--accent)] hover:shadow-md transition-all group cursor-pointer text-left"
                  style={{ borderColor: "var(--input-border)" }}
                >
                  <div className="flex items-center gap-2 mb-1.5 text-[var(--accent)] font-semibold text-xs">
                    <span className="material-symbols-outlined text-[18px]">calendar_add_on</span>
                    Jadwal & Jurnal Cepat
                  </div>
                  <div className="text-xs text-[var(--fg)] line-clamp-2 leading-relaxed opacity-90">
                    "Tolong jadwalkan hari ini di kelas 10-A jam 1 sampai 3 materi Eksponen, semua hadir."
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      "Saya ingin mengunggah file media (gambar soal / dokumen / Excel). Bagaimana NEBULA AI dapat membantu menganalisisnya?"
                    )
                  }
                  className="p-4 rounded-2xl border app-card hover:border-[var(--accent)] hover:shadow-md transition-all group cursor-pointer text-left"
                  style={{ borderColor: "var(--input-border)" }}
                >
                  <div className="flex items-center gap-2 mb-1.5 text-emerald-500 font-semibold text-xs">
                    <span className="material-symbols-outlined text-[18px]">upload_file</span>
                    Multimodal Media & File
                  </div>
                  <div className="text-xs text-[var(--fg)] line-clamp-2 leading-relaxed opacity-90">
                    "Unggah gambar soal, dokumen PDF, video, atau Excel nilai hingga 10 MB (maksimal 25 file)."
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      "Cek apakah ada bentrokan jam mengajar di kelas 10-B hari Senin jam ke-1 sampai 3."
                    )
                  }
                  className="p-4 rounded-2xl border app-card hover:border-[var(--accent)] hover:shadow-md transition-all group cursor-pointer text-left"
                  style={{ borderColor: "var(--input-border)" }}
                >
                  <div className="flex items-center gap-2 mb-1.5 text-amber-500 font-semibold text-xs">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    Deteksi Tabrakan Jam
                  </div>
                  <div className="text-xs text-[var(--fg)] line-clamp-2 leading-relaxed opacity-90">
                    "Cek apakah jam ke-1 sampai 3 di kelas 10-B hari Senin sudah terisi oleh guru lain."
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleSendMessage(
                      "Tampilkan daftar jurnal mengajar saya yang statusnya masih draft dan belum dikirim."
                    )
                  }
                  className="p-4 rounded-2xl border app-card hover:border-[var(--accent)] hover:shadow-md transition-all group cursor-pointer text-left"
                  style={{ borderColor: "var(--input-border)" }}
                >
                  <div className="flex items-center gap-2 mb-1.5 text-indigo-500 font-semibold text-xs">
                    <span className="material-symbols-outlined text-[18px]">drafts</span>
                    Status Jurnal Mengajar
                  </div>
                  <div className="text-xs text-[var(--fg)] line-clamp-2 leading-relaxed opacity-90">
                    "Tampilkan jurnal saya yang masih berstatus draft untuk segera dikirim resmi."
                  </div>
                </button>
              </div>
            </div>
          ) : (
            /* Message List Container */
            <div className="max-w-3xl mx-auto space-y-6">
              {displayedMessages.map((message) => (
                <ChatBubbleItem
                  key={message.id}
                  message={message}
                  isUser={message.sender === "user"}
                  user={user}
                  onEdit={handleEditMessage}
                  onRetry={handleRetryMessage}
                  onSendMessage={handleSendMessage}
                  onImagePreview={(url) => setPreviewImageModal(url)}
                />
              ))}

              {/* Generating Loading State */}
              {isGenerating && (
                <div className="flex gap-3 md:gap-4 items-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500 to-red-600 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                  </div>
                  <div className="bg-[var(--card)] border px-4 py-3 rounded-2xl rounded-tl-xs shadow-sm flex items-center gap-2 text-xs app-muted">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
                    <span className="ml-1 text-[11px]">Menghubungkan ke NEBULA AI...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* =========================================================
            BOTTOM FLOATING INPUT DOCK (GEMINI-STYLE CAPSULE)
            ========================================================= */}
        <div className="p-4 md:p-6 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)] to-transparent shrink-0">
          <div className="max-w-3xl mx-auto">
            {/* Attached file chips dock */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 p-2.5 rounded-2xl bg-[var(--card)] border border-[var(--input-border)] shadow-sm space-y-2">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-semibold flex items-center gap-1.5 text-[var(--fg)]">
                    <span className="material-symbols-outlined text-[18px] text-[var(--accent)]">
                      attach_file
                    </span>
                    {attachedFiles.length}/{MAX_FILES_PER_UPLOAD} File Terlampir
                    <span className="text-[11px] font-normal app-muted">
                      (Total: {formatFileSize(totalAttachedSize)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={handleClearAllAttachedFiles}
                    className="text-[11px] text-red-500 hover:text-red-700 font-medium transition-colors"
                  >
                    Hapus Semua
                  </button>
                </div>

                {/* Chips Grid / Horizontal Carousel */}
                <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-0.5">
                  {attachedFiles.map((file) => {
                    const theme = getFileCategoryTheme(file.category);
                    const imgSrc = file.storageUrl || file.previewUrl || file.dataUrl;
                    const isImg = file.category === "image" && Boolean(imgSrc);

                    return (
                      <div
                        key={file.id}
                        className={cn(
                          "flex items-center gap-2 p-1.5 pr-2 rounded-xl border text-xs max-w-[260px] shadow-2xs group relative transition-all",
                          theme.bgClass,
                          theme.borderClass
                        )}
                      >
                        {isImg ? (
                          <img
                            src={imgSrc}
                            alt={file.name}
                            className="w-8 h-8 rounded-lg object-cover shrink-0 border border-black/10"
                          />
                        ) : (
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", theme.textClass)}>
                            <span className="material-symbols-outlined text-[20px]">{theme.icon}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div
                            className="font-medium text-[var(--fg)] text-[11px] truncate"
                            title={`${file.name}${file.storedName ? ` • UUID: ${file.storedName}` : ""}`}
                          >
                            {file.name}
                          </div>
                          <div className="text-[10px] app-muted truncate">
                            {formatFileSize(file.size)}
                            {file.isUploading
                              ? " • Menyimpan..."
                              : file.storedName
                              ? ` • ${file.storedName.slice(0, 8)}…`
                              : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachedFile(file.id)}
                          className="w-5 h-5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                          title="Hapus file ini dari penyimpanan"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Main Input Capsule (Direct Drag & Drop Target) */}
            <div
              onDragEnter={(e) => {
                if (!e.dataTransfer?.types?.includes("Files")) return;
                e.preventDefault();
                setIsDraggingOverInput(true);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer?.types?.includes("Files")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (!isDraggingOverInput) setIsDraggingOverInput(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDraggingOverInput(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragCounterRef.current = 0;
                setIsDragging(false);
                setIsDraggingOverInput(false);
                const dropped = extractFilesFromDataTransfer(e.dataTransfer);
                if (dropped.length > 0) {
                  handleFilesAdded(dropped);
                }
              }}
              className={cn(
                "relative flex items-end gap-2 p-2 sm:p-2.5 rounded-2xl border bg-[var(--card)] shadow-[var(--shadow)] transition-all focus-within:ring-2 focus-within:ring-[var(--accent)]/30 focus-within:border-[var(--accent)]",
                isDraggingOverInput &&
                  "border-2 border-dashed border-[var(--accent)] ring-4 ring-[var(--accent)]/20 bg-[var(--accent-soft)]/20 scale-[1.01]"
              )}
              style={{ borderColor: isDraggingOverInput ? "var(--accent)" : "var(--input-border)" }}
            >
              {/* Attachment Picker */}
              <input
                id={fileInputId}
                type="file"
                multiple
                accept="*/*"
                onChange={(e) => {
                  if (e.target.files) {
                    handleFilesAdded(e.target.files);
                    e.target.value = ""; // Reset to allow re-uploading same file if desired
                  }
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => document.getElementById(fileInputId)?.click()}
                className="w-9 h-9 rounded-xl flex items-center justify-center app-muted hover:bg-[var(--hover)] hover:text-[var(--accent)] transition-colors shrink-0"
                title="Klik atau seret & lepaskan (drag & drop) file ke kolom ini (Maks. 10 MB/file, hingga 25 file)"
              >
                <span className="material-symbols-outlined text-[20px]">
                  {isDraggingOverInput ? "upload_file" : "add_circle"}
                </span>
              </button>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDrop={(e) => {
                  const dropped = extractFilesFromDataTransfer(e.dataTransfer);
                  if (dropped.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    dragCounterRef.current = 0;
                    setIsDragging(false);
                    setIsDraggingOverInput(false);
                    handleFilesAdded(dropped);
                  }
                }}
                rows={1}
                placeholder={
                  isDraggingOverInput
                    ? "Lepaskan file di sini..."
                    : "Tanyakan sesuatu atau lampirkan file..."
                }
                className="flex-1 max-h-[160px] py-1.5 px-2 bg-transparent text-xs sm:text-sm text-[var(--fg)] placeholder:text-slate-400 placeholder:truncate focus:outline-none resize-none leading-relaxed"
              />

              {/* Send Button */}
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={(!inputText.trim() && attachedFiles.length === 0) || isGenerating}
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0",
                  (inputText.trim() || attachedFiles.length > 0) && !isGenerating
                    ? "bg-[var(--accent)] text-white shadow-sm hover:opacity-90 active:scale-95 cursor-pointer"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                )}
                title="Kirim pesan"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
              </button>
            </div>

            {/* Disclaimer Footer */}
            <div className="mt-2 text-center text-[10px] app-muted">
              Mendukung <strong>Drag &amp; Drop</strong> atau <strong>Paste (Ctrl+V)</strong> file langsung ke kolom chat • Maksimal 10 MB/file (hingga 25 file).
            </div>
          </div>
        </div>
      </main>

      {/* Image Lightbox Modal */}
      {previewImageModal && (
        <div
          onClick={() => setPreviewImageModal(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setPreviewImageModal(null)}
              className="absolute -top-10 right-0 text-white hover:text-red-400 text-sm font-semibold flex items-center gap-1 transition-colors"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
              Tutup
            </button>
            <img
              src={previewImageModal}
              alt="Pratinjau gambar"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/20"
            />
          </div>
        </div>
      )}
    </div>
  );
}
