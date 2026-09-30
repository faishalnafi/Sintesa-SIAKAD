import { env } from "../env.js";

export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  base64?: string;
  textPreview?: string;
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

/**
 * Uploads large media files (> 15MB up to 50MB) to Google Gemini File API
 */
async function uploadToGeminiFileApi(
  apiKey: string,
  fileName: string,
  mimeType: string,
  base64Data: string
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`;

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Command": "start, upload, finalize",
        "X-Goog-Upload-Header-Content-Length": buffer.length.toString(),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": mimeType,
      },
      body: buffer,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Gemini File API] Error ${res.status}: ${errText}`);
      return null;
    }

    const data = (await res.json()) as any;
    return data.file?.uri || null;
  } catch (err) {
    console.warn(`[Gemini File API] Exception during upload:`, err);
    return null;
  }
}

export async function askGemini({
  systemInstruction,
  messages,
  files,
  temperature = 0.7,
  maxOutputTokens = 2048,
}: GenerateOptions): Promise<string> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY belum dikonfigurasi di file environment server. Silakan tambahkan GEMINI_API_KEY di .env."
    );
  }

  const candidateModels = Array.from(
    new Set([
      env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-3-flash-preview",
      "gemini-2.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
    ])
  );

  // Build contents array formatted for Gemini API with multimodal support
  const contents: any[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isLastMessage = i === messages.length - 1;
    const parts: any[] = [];

    if (m.text) {
      parts.push({ text: m.text });
    }

    // Merge message-specific files with top-level files on the last user turn
    const messageFiles = [...(m.files || []), ...(isLastMessage && files ? files : [])];

    for (const file of messageFiles) {
      if (file.textPreview) {
        parts.push({
          text: `\n--- Lampiran Dokumen: ${file.name} ---\n${file.textPreview}\n--- Akhir Dokumen ---\n`,
        });
      } else if (file.base64) {
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

        if (isSupportedMultimodal) {
          // If <= 15MB base64 (~11MB binary), use inlineData directly
          if (cleanBase64.length <= 15 * 1024 * 1024) {
            parts.push({
              inlineData: {
                mimeType,
                data: cleanBase64,
              },
            });
          } else {
            // For larger files (>15MB up to 50MB), try Gemini File API
            const fileUri = await uploadToGeminiFileApi(apiKey, file.name, mimeType, cleanBase64);
            if (fileUri) {
              parts.push({
                fileData: {
                  mimeType,
                  fileUri,
                },
              });
            } else {
              parts.push({
                text: `\n[File media terlampir: ${file.name} (${mimeType}, ${(file.size / (1024 * 1024)).toFixed(1)} MB)]\n`,
              });
            }
          }
        } else {
          parts.push({
            text: `\n[File terlampir: ${file.name} (${mimeType}, ukuran ${(file.size / 1024).toFixed(1)} KB)]\n`,
          });
        }
      }
    }

    if (parts.length > 0) {
      contents.push({
        role: m.role,
        parts,
      });
    }
  }

  const payload: any = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  let lastError: Error | null = null;

  for (const model of candidateModels) {
    const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
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
      console.warn(`[Gemini API] Model '${model}' failed:`, err.message);
      // Wait a tiny moment before trying next candidate
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.error("[NEBULA AI API] All candidate models failed:", lastError?.message);
  throw new Error(
    `Gagal menghubungi layanan NEBULA AI: ${lastError?.message || "Semua model sedang sibuk"}`
  );
}
