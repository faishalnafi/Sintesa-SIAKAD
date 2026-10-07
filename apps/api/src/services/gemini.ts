import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { env } from "../env.js";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";

export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  base64?: string;
  textPreview?: string;
  storageKey?: string;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  files?: AttachedFile[];
}

interface GenerateOptions {
  systemInstruction?: string;
  messages: ChatMessage[];
  files?: AttachedFile[];
  temperature?: number;
  maxOutputTokens?: number;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Ekstrak seluruh lembar kerja (multi-sheet) dari buffer Excel/Spreadsheet (.xlsx, .xls, .csv, .ods)
 * secara bersih tanpa deretan koma kosong agar AI dapat membaca semua lembar sekaligus.
 */
export function extractSpreadsheetAllSheetsText(buffer: Buffer, fileName: string): string | null {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    if (!wb.SheetNames || wb.SheetNames.length === 0) return null;

    const visibleSheets = wb.SheetNames.filter(
      (n) => !n.startsWith("_SECURITY") && !n.startsWith("__")
    );
    const targetSheets = visibleSheets.length > 0 ? visibleSheets : wb.SheetNames;

    let summary = `[File Spreadsheet Multi-Lembar: "${fileName}" | Total Lembar Kerja: ${targetSheets.length} (${targetSheets.join(", ")})]\n\n`;

    for (let i = 0; i < targetSheets.length; i++) {
      const sheetName = targetSheets[i];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
      });

      const compactLines: string[] = [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
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
        const extraNote = rowCount > 60 ? `\n... (menampilkan 60 baris pertama dari total ${rowCount} baris untuk efisiensi token)` : "";
        summary += `=== LEMBAR KERJA (SHEET ${i + 1}/${targetSheets.length}): "${sheetName}" ===\n${limitedRows.join("\n").slice(0, 6000)}${extraNote}\n\n`;
      }
    }

    const trimmed = summary.trim();
    return trimmed ? trimmed.slice(0, 18000) : null;
  } catch (err) {
    console.warn(`[Excel Multi-Sheet Parser] Gagal membaca ${fileName}:`, err);
    return null;
  }
}

/**
 * Ekstrak teks dari dokumen Word (.docx, .doc, .odt, .rtf), Presentasi (.pptx, .ppt, .odp),
 * maupun file teks/kode (.txt, .json, .md, .sql, .html, .xml, .yaml, dll.)
 */
export function extractDocumentTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): string | null {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  try {
    // 1. Spreadsheet (.xlsx, .xls, .csv, .ods)
    if (
      ["xlsx", "xls", "csv", "ods"].includes(ext) ||
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      mime === "text/csv"
    ) {
      return extractSpreadsheetAllSheetsText(buffer, fileName);
    }

    // 2. Word (.docx)
    if (ext === "docx" || mime.includes("wordprocessingml")) {
      const zip = new AdmZip(buffer);
      const docXml = zip.readAsText("word/document.xml");
      if (docXml) {
        const text = decodeXmlEntities(
          docXml
            .replace(/<\/w:p>/g, "\n")
            .replace(/<\/w:tr>/g, "\n")
            .replace(/<\/w:tc>/g, "\t")
            .replace(/<w:tab\/>/g, "\t")
            .replace(/<w:br[^/>]*\/>/g, "\n")
            .replace(/<[^>]+>/g, "")
        )
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (text) return `[Dokumen Word (.docx): "${fileName}"]\n\n${text.slice(0, 10000)}`;
      }
    }

    // 3. PowerPoint (.pptx) - multi-slide
    if (ext === "pptx" || mime.includes("presentationml")) {
      const zip = new AdmZip(buffer);
      const slideEntries = zip
        .getEntries()
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => {
          const na = parseInt(a.entryName.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
          const nb = parseInt(b.entryName.match(/slide(\d+)\.xml/i)?.[1] || "0", 10);
          return na - nb;
        });

      const slidesText: string[] = [];
      for (let i = 0; i < slideEntries.length; i++) {
        const xml = zip.readAsText(slideEntries[i]);
        const slideContent = decodeXmlEntities(
          xml
            .replace(/<\/a:p>/g, "\n")
            .replace(/<[^>]+>/g, "")
        )
          .replace(/\n{3,}/g, "\n")
          .trim();
        if (slideContent) {
          slidesText.push(`--- Slide ${i + 1} ---\n${slideContent}`);
        }
      }
      if (slidesText.length > 0) {
        return `[Presentasi PowerPoint (.pptx): "${fileName}" | Total Slide: ${slideEntries.length}]\n\n${slidesText.join("\n\n").slice(0, 10000)}`;
      }
    }

    // 4. OpenDocument Text / Presentation (.odt, .odp)
    if (ext === "odt" || ext === "odp" || mime.includes("opendocument")) {
      const zip = new AdmZip(buffer);
      const contentXml = zip.readAsText("content.xml");
      if (contentXml) {
        const text = decodeXmlEntities(
          contentXml
            .replace(/<\/text:p>/g, "\n")
            .replace(/<\/text:h>/g, "\n")
            .replace(/<[^>]+>/g, "")
        )
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (text) return `[Dokumen OpenDocument (.${ext}): "${fileName}"]\n\n${text.slice(0, 10000)}`;
      }
    }

    // 5. Rich Text Format (.rtf)
    if (ext === "rtf" || mime.includes("rtf")) {
      const rawRtf = buffer.toString("utf-8");
      const cleaned = rawRtf
        .replace(/\\par[d]?/g, "\n")
        .replace(/\\tab/g, "\t")
        .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
        .replace(/[{}]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (cleaned) return `[Dokumen RTF: "${fileName}"]\n\n${cleaned.slice(0, 10000)}`;
    }

    // 6. Plain Text & Code files (.txt, .json, .md, .sql, .html, .css, .js, .ts, .tsx, .jsx, .py, .xml, .yaml, .yml)
    const textExtensions = new Set([
      "txt", "json", "md", "sql", "html", "css", "js", "ts", "tsx", "jsx", "py", "xml", "yaml", "yml", "sh",
    ]);
    if (textExtensions.has(ext) || mime.startsWith("text/") || mime === "application/json") {
      const text = buffer.toString("utf-8").trim();
      if (text) return `[Berkas Teks/Kode (.${ext}): "${fileName}"]\n\n${text.slice(0, 8000)}`;
    }

    // 7. Legacy binary Word/PowerPoint (.doc, .ppt) — ekstrak string teks yang dapat dibaca
    if (ext === "doc" || ext === "ppt" || mime === "application/msword" || mime === "application/vnd.ms-powerpoint") {
      const latin = buffer.toString("latin1");
      const utf16 = buffer.toString("utf16le");
      const chunks = [
        ...(latin.match(/[A-Za-z0-9.,:;!?()\-+/%'"\s]{8,}/g) || []),
        ...(utf16.match(/[A-Za-z0-9.,:;!?()\-+/%'"\s]{8,}/g) || []),
      ]
        .map((s) => s.trim())
        .filter((s) => s.length >= 8 && !/^[0-9\s]+$/.test(s));
      if (chunks.length > 0) {
        return `[Dokumen Legacy (.${ext}): "${fileName}"]\n\n${chunks.join("\n").slice(0, 8000)}`;
      }
    }
  } catch (err) {
    console.warn(`[Document Extractor] Gagal mengekstrak teks dari ${fileName}:`, err);
  }

  return null;
}

// Cache model tercepat yang berhasil merespon agar request berikutnya langsung instan tanpa coba-coba
let cachedFast9RouterModel: string | null = null;

export async function askGemini({
  systemInstruction,
  messages,
  files,
  temperature = 0.4,
  maxOutputTokens = 4096,
}: GenerateOptions): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY belum dikonfigurasi di file environment server. Silakan tambahkan GEMINI_API_KEY di .env."
    );
  }

  // SEMUA RUTE REQUEST WAJIB LEWAT 9ROUTER (https://llm.faishalnafi.com)
  const is9RouterKey = true;
  const rawBaseUrl = (
    env.GEMINI_BASE_URL || "https://llm.faishalnafi.com/v1"
  ).replace(/\/$/, "");
  const gatewayRootUrl = rawBaseUrl.replace(/\/v1(?:beta)?$/i, "");

  // Normalize file attachments for each message turn (extracting multi-sheet Excel & Office documents into clean text)
  const normalizedTurns: Array<{
    role: "user" | "model";
    textParts: string[];
    inlineParts: Array<{ mimeType: string; data: string }>;
    fileUriParts: Array<{ mimeType: string; fileUri: string }>;
  }> = [];

  let hasNativeBinaryMedia = false;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isLastMessage = i === messages.length - 1;
    const textParts: string[] = [];
    const inlineParts: Array<{ mimeType: string; data: string }> = [];
    const fileUriParts: Array<{ mimeType: string; fileUri: string }> = [];

    if (m.text) {
      textParts.push(m.text);
    }

    const messageFiles = [...(m.files || []), ...(isLastMessage && files ? files : [])];

    for (const file of messageFiles) {
      // Untuk riwayat giliran sebelumnya (!isLastMessage):
      // Hemat token secara drastis! Jangan kirim ulang binary base64 atau ribuan baris teks lama.
      if (!isLastMessage) {
        if (file.textPreview) {
          const compact = file.textPreview.slice(0, 1000);
          textParts.push(`\n[Lampiran Riwayat: ${file.name}]\n${compact}\n`);
        } else {
          textParts.push(`\n[Lampiran Riwayat: ${file.name} (${file.type || "file"})]\n`);
        }
        continue;
      }

      // 1. Jika sudah memiliki textPreview lengkap (misal sudah diekstrak di frontend atau routes.ts), langsung gunakan tanpa parse ulang!
      if (file.textPreview) {
        textParts.push(
          `\n--- Lampiran Dokumen: ${file.name} ---\n${file.textPreview}\n--- Akhir Dokumen ---\n`
        );
        continue;
      }

      // 2. Jika belum ada textPreview tapi ada base64 dari dokumen yang bisa diekstrak menjadi teks
      if (file.base64) {
        const cleanB64 = file.base64.includes(",") ? file.base64.split(",")[1] : file.base64;
        const extractedDocText = extractDocumentTextFromBuffer(
          Buffer.from(cleanB64, "base64"),
          file.name,
          file.type
        );
        if (extractedDocText) {
          textParts.push(
            `\n--- Lampiran Dokumen: ${file.name} ---\n${extractedDocText}\n--- Akhir Dokumen ---\n`
          );
          continue;
        }
      }

      // 3. Jika file biner multimodal (Gambar, PDF, Audio, Video)
      if (file.base64) {
        const cleanBase64 = file.base64.includes(",")
          ? file.base64.split(",")[1]
          : file.base64;
        const mimeType = file.type || "application/octet-stream";

        const isSupportedMultimodal =
          mimeType.startsWith("image/") ||
          mimeType.startsWith("audio/") ||
          mimeType.startsWith("video/") ||
          mimeType === "application/pdf" ||
          mimeType.startsWith("text/");

        if (
          mimeType === "application/pdf" ||
          mimeType.startsWith("audio/") ||
          mimeType.startsWith("video/")
        ) {
          hasNativeBinaryMedia = true;
        }

        if (isSupportedMultimodal) {
          if (cleanBase64.length <= 25 * 1024 * 1024) {
            inlineParts.push({ mimeType, data: cleanBase64 });
          } else {
            textParts.push(
              `\n[File media terlampir: ${file.name} (${mimeType}, ${(file.size / (1024 * 1024)).toFixed(1)} MB)]\n`
            );
          }
        } else {
          textParts.push(
            `\n[File terlampir: ${file.name} (${mimeType}, ukuran ${(file.size / 1024).toFixed(1)} KB)]\n`
          );
        }
      }
    }

    if (textParts.length > 0 || inlineParts.length > 0 || fileUriParts.length > 0) {
      normalizedTurns.push({
        role: m.role,
        textParts,
        inlineParts,
        fileUriParts,
      });
    }
  }

  let lastError: Error | null = null;

  // ============================================================================
  // MODE 1: 9ROUTER GATEWAY (OpenAI-Compatible `/v1/chat/completions`)
  // Digunakan untuk Teks, Gambar, Excel Multi-Sheet, Word (.docx), PowerPoint (.pptx), Kode, dll.
  // Jika pengguna melampirkan PDF / Audio / Video, lompati langsung ke MODE 2 (`/v1beta`)
  // karena `/v1beta` di 9Router mendukung `inlineData` native untuk PDF, Audio, dan Video!
  // ============================================================================
  if (is9RouterKey && gatewayRootUrl && !hasNativeBinaryMedia) {
    const openAiV1Base = `${gatewayRootUrl}/v1`;

    const configuredModel = env.GEMINI_MODEL || "gemini/gemini-3.5-flash-lite";
    const normalizedConfigured = configuredModel.includes("/")
      ? configuredModel
      : `gemini/${configuredModel}`;

    // Prioritaskan model tercepat (gemini/gemini-3.5-flash-lite ~1.2s) tanpa hit /v1/models setiap request
    const routerCandidates = Array.from(
      new Set(
        [
          cachedFast9RouterModel,
          "gemini/gemini-3.5-flash-lite",
          normalizedConfigured,
          configuredModel,
          "gemini/gemini-3.1-flash-lite-preview",
          "gemini/gemini-3.6-flash",
          "gemini/gemini-3.7-flash",
          "gc/gemini-2.5-flash-lite",
          "gc/gemini-2.5-flash",
        ].filter((m): m is string => Boolean(m))
      )
    );

    const openAiMessages: any[] = [];
    if (systemInstruction) {
      openAiMessages.push({
        role: "system",
        content: systemInstruction,
      });
    }

    for (const turn of normalizedTurns) {
      const role = turn.role === "model" ? "assistant" : "user";
      const combinedText = turn.textParts.join("\n").trim();

      if (turn.inlineParts.length === 0) {
        openAiMessages.push({
          role,
          content: combinedText || " ",
        });
      } else {
        const contentArray: any[] = [];
        if (combinedText) {
          contentArray.push({ type: "text", text: combinedText });
        }
        for (const inline of turn.inlineParts) {
          if (inline.mimeType.startsWith("image/")) {
            contentArray.push({
              type: "image_url",
              image_url: {
                url: `data:${inline.mimeType};base64,${inline.data}`,
              },
            });
          } else if (inline.mimeType.startsWith("text/")) {
            try {
              const decoded = Buffer.from(inline.data, "base64").toString("utf-8");
              contentArray.push({ type: "text", text: decoded });
            } catch {
              // ignore
            }
          } else {
            contentArray.push({
              type: "image_url",
              image_url: {
                url: `data:${inline.mimeType};base64,${inline.data}`,
              },
            });
          }
        }
        openAiMessages.push({
          role,
          content: contentArray,
        });
      }
    }

    for (const model of routerCandidates) {
      try {
        const res = await fetch(`${openAiV1Base}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            stream: false,
            reasoning_effort: "none",
            messages: openAiMessages,
            temperature,
            max_tokens: maxOutputTokens,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`9Router API Error [${model}] (${res.status}): ${errText}`);
        }

        const rawText = await res.text();

        // Handle SSE stream format if the gateway ever returns `data: {...}`
        if (rawText.trim().startsWith("data:")) {
          let sseReply = "";
          for (const line of rawText.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payloadStr = trimmed.slice(5).trim();
            if (payloadStr === "[DONE]") break;
            try {
              const chunk = JSON.parse(payloadStr);
              const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
              if (typeof delta === "string") sseReply += delta;
            } catch {
              // ignore malformed chunk
            }
          }
          if (sseReply.trim()) {
            cachedFast9RouterModel = model;
            return sseReply.trim();
          }
        }

        const data = JSON.parse(rawText) as any;
        const choiceContent = data.choices?.[0]?.message?.content;
        if (typeof choiceContent === "string" && choiceContent.trim()) {
          cachedFast9RouterModel = model;
          return choiceContent.trim();
        }
        if (Array.isArray(choiceContent)) {
          const joined = choiceContent
            .map((c: any) => c?.text || "")
            .join("\n")
            .trim();
          if (joined) {
            cachedFast9RouterModel = model;
            return joined;
          }
        }
        // Fallback if 9Router returns Gemini-style candidates on this route
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          cachedFast9RouterModel = model;
          return data.candidates[0].content.parts
            .map((p: any) => p.text || "")
            .join("\n")
            .trim();
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[9Router OpenAI API] Model '${model}' failed:`, err.message);
      }
    }
  }

  // ============================================================================
  // MODE 2: GOOGLE GEMINI NATIVE `/v1beta/models/{model}:generateContent`
  // (Digunakan untuk Google AI Studio langsung atau fallback `/v1beta` pada 9Router)
  // ============================================================================
  const stripProviderPrefix = (m: string) => m.replace(/^[a-z0-9_-]+\//i, "");
  const candidateModels = Array.from(
    new Set([
      stripProviderPrefix(env.GEMINI_MODEL || "gemini-3.5-flash-lite"),
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-3.6-flash",
    ])
  );

  const contents = normalizedTurns.map((t) => {
    const parts: any[] = [];
    for (const txt of t.textParts) {
      if (txt) parts.push({ text: txt });
    }
    for (const inl of t.inlineParts) {
      parts.push({ inlineData: { mimeType: inl.mimeType, data: inl.data } });
    }
    for (const fUri of t.fileUriParts) {
      parts.push({ fileData: { mimeType: fUri.mimeType, fileUri: fUri.fileUri } });
    }
    return { role: t.role, parts };
  });

  const payload: any = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const v1BetaBase = `${gatewayRootUrl}/v1beta`;

  for (const model of candidateModels) {
    const endpointUrl = `${v1BetaBase}/models/${model}:generateContent?key=${apiKey}`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (is9RouterKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API Error [${model}] (${res.status}): ${errText}`);
      }

      const data = (await res.json()) as any;
      const candidates = data.candidates || [];
      if (candidates.length === 0 || !candidates[0]?.content?.parts?.[0]?.text) {
        if (data.promptFeedback?.blockReason) {
          throw new Error(`Respon diblokir oleh filter keamanan: ${data.promptFeedback.blockReason}`);
        }
        return "Maaf, saya tidak dapat menghasilkan jawaban untuk permintaan tersebut.";
      }

      return candidates[0].content.parts.map((p: any) => p.text || "").join("\n").trim();
    } catch (err: any) {
      lastError = err;
      console.warn(`[Gemini v1beta API] Model '${model}' failed:`, err.message);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  console.error("[NEBULA AI API] All candidate models failed:", lastError?.message);
  throw new Error(
    `Gagal menghubungi layanan NEBULA AI: ${lastError?.message || "Semua model sedang sibuk"}`
  );
}

