import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { systemSettings } from "../../db/schema/index.js";
import { env } from "../../env.js";
import type { StorageConfig, UploadOptions, UploadResult, StorageProviderType } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_UPLOADS_DIR = path.resolve(__dirname, "../../../uploads");

// Ensure local uploads directory exists
if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
  fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
}

export const STORAGE_CONFIG_KEY = "object_storage_config";

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  isActive: false, // Default is local server storage
  provider: "r2",
  s3: {
    bucket: "",
    region: "ap-southeast-1",
    accessKeyId: "",
    secretAccessKey: "",
    endpoint: "",
    publicUrl: "",
    forcePathStyle: false,
  },
  r2: {
    accountId: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  },
  gcs: {
    bucket: "",
    authMode: "hmac",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  },
  generic: {
    name: "MinIO",
    endpoint: "http://localhost:9000",
    bucket: "",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
    forcePathStyle: true,
  },
  lastTestedAt: null,
  lastTestedStatus: null,
  lastTestedMessage: null,
};

function maskSecret(val?: string): string {
  if (!val || val.length === 0) return "";
  if (val.length <= 6) return "••••••";
  return val.slice(0, 3) + "••••••••" + val.slice(-3);
}

function isMasked(val?: string): boolean {
  return Boolean(val && val.includes("••••"));
}

/**
 * Get active storage configuration from database or defaults
 */
export async function getStorageConfig(): Promise<StorageConfig> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, STORAGE_CONFIG_KEY))
      .limit(1);

    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        ...DEFAULT_STORAGE_CONFIG,
        ...parsed,
        s3: { ...DEFAULT_STORAGE_CONFIG.s3, ...(parsed.s3 || {}) },
        r2: { ...DEFAULT_STORAGE_CONFIG.r2, ...(parsed.r2 || {}) },
        gcs: { ...DEFAULT_STORAGE_CONFIG.gcs, ...(parsed.gcs || {}) },
        generic: { ...DEFAULT_STORAGE_CONFIG.generic, ...(parsed.generic || {}) },
      };
    }
  } catch (err) {
    console.error("[Storage] Failed to read config from database:", err);
  }

  // Fallback to environment variables if provided
  return {
    ...DEFAULT_STORAGE_CONFIG,
    isActive: Boolean(process.env.STORAGE_ACTIVE === "true"),
    provider: (process.env.STORAGE_PROVIDER as any) || "r2",
  };
}

/**
 * Get sanitized storage config for UI (masking sensitive secret keys)
 */
export async function getSafeStorageConfig(): Promise<StorageConfig> {
  const cfg = await getStorageConfig();
  return {
    ...cfg,
    s3: {
      ...cfg.s3,
      secretAccessKey: maskSecret(cfg.s3.secretAccessKey),
    },
    r2: {
      ...cfg.r2,
      secretAccessKey: maskSecret(cfg.r2.secretAccessKey),
    },
    gcs: {
      ...cfg.gcs,
      secretAccessKey: maskSecret(cfg.gcs.secretAccessKey),
      privateKey: maskSecret(cfg.gcs.privateKey),
    },
    generic: {
      ...cfg.generic,
      secretAccessKey: maskSecret(cfg.generic.secretAccessKey),
    },
  };
}

/**
 * Save new storage configuration to database.
 * Preserves existing secrets if user didn't modify masked inputs.
 */
export async function saveStorageConfig(newConfig: Partial<StorageConfig>): Promise<StorageConfig> {
  const current = await getStorageConfig();

  const merged: StorageConfig = {
    ...current,
    ...newConfig,
    s3: {
      ...current.s3,
      ...(newConfig.s3 || {}),
      secretAccessKey:
        newConfig.s3?.secretAccessKey && !isMasked(newConfig.s3.secretAccessKey)
          ? newConfig.s3.secretAccessKey
          : current.s3.secretAccessKey,
    },
    r2: {
      ...current.r2,
      ...(newConfig.r2 || {}),
      secretAccessKey:
        newConfig.r2?.secretAccessKey && !isMasked(newConfig.r2.secretAccessKey)
          ? newConfig.r2.secretAccessKey
          : current.r2.secretAccessKey,
    },
    gcs: {
      ...current.gcs,
      ...(newConfig.gcs || {}),
      secretAccessKey:
        newConfig.gcs?.secretAccessKey && !isMasked(newConfig.gcs.secretAccessKey)
          ? newConfig.gcs.secretAccessKey
          : current.gcs.secretAccessKey,
      privateKey:
        newConfig.gcs?.privateKey && !isMasked(newConfig.gcs.privateKey)
          ? newConfig.gcs.privateKey
          : current.gcs.privateKey,
    },
    generic: {
      ...current.generic,
      ...(newConfig.generic || {}),
      secretAccessKey:
        newConfig.generic?.secretAccessKey && !isMasked(newConfig.generic.secretAccessKey)
          ? newConfig.generic.secretAccessKey
          : current.generic.secretAccessKey,
    },
  };

  const jsonStr = JSON.stringify(merged);

  const [existing] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, STORAGE_CONFIG_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(systemSettings)
      .set({ value: jsonStr, updatedAt: new Date() })
      .where(eq(systemSettings.key, STORAGE_CONFIG_KEY));
  } else {
    await db.insert(systemSettings).values({
      key: STORAGE_CONFIG_KEY,
      value: jsonStr,
      updatedAt: new Date(),
    });
  }

  return merged;
}

/**
 * Creates S3 client instance according to configuration and provider
 */
function createS3Client(
  config: StorageConfig,
  provider = config.provider
): { client: S3Client; bucket: string; publicUrl?: string } {
  switch (provider) {
    case "s3": {
      const { bucket, region, accessKeyId, secretAccessKey, endpoint, forcePathStyle, publicUrl } = config.s3;
      if (!bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("Konfigurasi AWS S3 belum lengkap (Bucket, Access Key ID, dan Secret Access Key wajib diisi).");
      }
      const client = new S3Client({
        region: region || "ap-southeast-1",
        endpoint: endpoint && endpoint.trim().length > 0 ? endpoint.trim() : undefined,
        credentials: {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
        forcePathStyle: Boolean(forcePathStyle),
      });
      return { client, bucket, publicUrl };
    }

    case "r2": {
      const { accountId, bucket, accessKeyId, secretAccessKey, publicUrl } = config.r2;
      if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("Konfigurasi Cloudflare R2 belum lengkap (Account ID, Bucket, Access Key ID, dan Secret Access Key wajib diisi).");
      }
      const endpoint = `https://${accountId.trim()}.r2.cloudflarestorage.com`;
      const client = new S3Client({
        region: "auto",
        endpoint,
        credentials: {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
      });
      return { client, bucket, publicUrl };
    }

    case "gcs": {
      const { bucket, accessKeyId, secretAccessKey, publicUrl } = config.gcs;
      if (!bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("Konfigurasi Google Cloud Storage (HMAC) belum lengkap (Bucket, Access Key ID, dan Secret Access Key wajib diisi).");
      }
      const client = new S3Client({
        region: "auto",
        endpoint: "https://storage.googleapis.com",
        credentials: {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
      });
      return { client, bucket, publicUrl };
    }

    case "generic": {
      const { endpoint, bucket, region, accessKeyId, secretAccessKey, forcePathStyle, publicUrl } = config.generic;
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error("Konfigurasi S3-Compatible/Generic belum lengkap (Endpoint, Bucket, Access Key ID, dan Secret Access Key wajib diisi).");
      }
      const client = new S3Client({
        region: region || "us-east-1",
        endpoint: endpoint.trim(),
        credentials: {
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
        forcePathStyle: forcePathStyle !== false,
      });
      return { client, bucket, publicUrl };
    }

    default:
      throw new Error(`Provider storage '${provider}' tidak didukung.`);
  }
}

/**
 * Test storage connection by uploading and immediately deleting a probe object
 */
export async function testStorageConnection(
  config: StorageConfig,
  targetProvider = config.provider
): Promise<{ success: boolean; message: string }> {
  try {
    const { client, bucket } = createS3Client(config, targetProvider);
    const probeKey = `_simak_probe_${crypto.randomUUID()}.txt`;
    const probeContent = Buffer.from(`SIMAK Object Storage Connection Probe (${new Date().toISOString()})`);

    // 1. Put Probe Object
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: probeKey,
        Body: probeContent,
        ContentType: "text/plain",
      })
    );

    // 2. Delete Probe Object
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: probeKey,
      })
    );

    const message = `Koneksi ke Object Storage [${targetProvider.toUpperCase()}] berhasil terverifikasi! Bucket: "${bucket}".`;

    await saveStorageConfig({
      lastTestedAt: new Date().toISOString(),
      lastTestedStatus: "success",
      lastTestedMessage: message,
    });

    return { success: true, message };
  } catch (err: any) {
    const errorMsg = `Gagal terhubung ke [${targetProvider.toUpperCase()}]: ${err.message || String(err)}`;

    await saveStorageConfig({
      lastTestedAt: new Date().toISOString(),
      lastTestedStatus: "error",
      lastTestedMessage: errorMsg,
    });

    return { success: false, message: errorMsg };
  }
}

/**
 * Extract safe file extension from filename or fallback to mimeType
 */
function resolveFileExtension(filename: string, mimeType: string): string {
  const extFromName = path.extname(filename || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (extFromName && extFromName.length > 1 && extFromName.length <= 10) {
    return extFromName;
  }

  const mimeMap: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
  };

  return mimeMap[mimeType.toLowerCase()] || ".bin";
}

function sanitizeFolderPath(folder: string): string {
  return folder
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean)
    .join("/");
}

/**
 * Upload file unified method.
 * Renames EVERY uploaded file using UUID (`{uuid}.{ext}`) inside its dedicated folder.
 * Automatically checks whether Object Storage is active or Local Server is used.
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const {
    buffer,
    filename,
    mimeType = "application/octet-stream",
    folder = "general",
    customUuid,
  } = options;
  const config = await getStorageConfig();

  const fileUuid = customUuid && /^[0-9a-fA-F-]{36}$/.test(customUuid) ? customUuid : crypto.randomUUID();
  const ext = resolveFileExtension(filename, mimeType);
  const storedName = `${fileUuid}${ext}`;
  const safeFolder = sanitizeFolderPath(folder) || "general";
  const key = `${safeFolder}/${storedName}`;

  // We expose `/api/uploads/${key}` so the browser can always preview/download the file
  // seamlessly (even when the Cloud Object Storage bucket is private), while also computing `cloudUrl`.
  const proxyUrl = `/api/uploads/${key}`;

  // ── 1. CLOUD OBJECT STORAGE MODE ──────────────────────────────────
  if (config.isActive) {
    try {
      const { client, bucket, publicUrl } = createS3Client(config);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        })
      );

      let cloudUrl = "";
      if (publicUrl && publicUrl.trim().length > 0) {
        const cleanBase = publicUrl.trim().replace(/\/$/, "");
        cloudUrl = `${cleanBase}/${key}`;
      } else {
        switch (config.provider) {
          case "s3":
            cloudUrl = `https://${bucket}.s3.${config.s3.region || "ap-southeast-1"}.amazonaws.com/${key}`;
            break;
          case "r2":
            cloudUrl = `https://${bucket}.${config.r2.accountId}.r2.cloudflarestorage.com/${key}`;
            break;
          case "gcs":
            cloudUrl = `https://storage.googleapis.com/${bucket}/${key}`;
            break;
          case "generic":
            cloudUrl = `${config.generic.endpoint.replace(/\/$/, "")}/${bucket}/${key}`;
            break;
        }
      }

      console.log(`[Storage] Uploaded to Cloud (${config.provider}): ${key} (orig: "${filename}")`);

      return {
        success: true,
        provider: config.provider,
        key,
        url: proxyUrl,
        cloudUrl,
        storedName,
        filename,
        mimeType,
        size: buffer.length,
      };
    } catch (err: any) {
      console.error(`[Storage] Cloud upload to ${config.provider} failed:`, err);
      throw new Error(`Gagal mengunggah file ke Object Storage (${config.provider}): ${err.message}`);
    }
  }

  // ── 2. LOCAL SERVER STORAGE MODE (FALLBACK) ───────────────────────
  const localSubdir = path.join(LOCAL_UPLOADS_DIR, safeFolder);
  if (!fs.existsSync(localSubdir)) {
    fs.mkdirSync(localSubdir, { recursive: true });
  }

  const localFilePath = path.join(LOCAL_UPLOADS_DIR, key);
  await fs.promises.writeFile(localFilePath, buffer);

  console.log(`[Storage] Saved locally: ${localFilePath} -> ${proxyUrl}`);

  return {
    success: true,
    provider: "local",
    key,
    url: proxyUrl,
    storedName,
    filename,
    mimeType,
    size: buffer.length,
  };
}

/**
 * Retrieve file buffer & contentType from Local Disk or Cloud Object Storage
 */
export async function getFileFromStorage(
  key: string
): Promise<{ buffer: Buffer; contentType?: string } | null> {
  const safeKey = key.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");

  // 1. Check local disk first
  const localPath = path.join(LOCAL_UPLOADS_DIR, safeKey);
  if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
    const buffer = await fs.promises.readFile(localPath);
    return { buffer };
  }

  // 2. Check Cloud Object Storage if configured
  try {
    const config = await getStorageConfig();
    const providersToTry: Array<"s3" | "r2" | "gcs" | "generic"> = [config.provider];
    for (const p of ["r2", "s3", "gcs", "generic"] as const) {
      if (!providersToTry.includes(p)) providersToTry.push(p);
    }

    for (const prov of providersToTry) {
      try {
        const { client, bucket } = createS3Client(config, prov);
        const res = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: safeKey,
          })
        );
        if (res.Body) {
          const byteArray = await res.Body.transformToByteArray();
          return {
            buffer: Buffer.from(byteArray),
            contentType: res.ContentType,
          };
        }
      } catch {
        // Try next configured provider if not found
      }
    }
  } catch (err) {
    console.warn(`[Storage] Could not fetch ${safeKey} from Cloud Object Storage:`, err);
  }

  return null;
}

/**
 * Delete single file from both Local Disk and Cloud Object Storage
 */
export async function deleteFile(key: string, providerOverride?: StorageProviderType): Promise<boolean> {
  if (!key) return false;
  const safeKey = key.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
  let deletedAny = false;

  // 1. Always delete local copy if present
  try {
    const localPath = path.join(LOCAL_UPLOADS_DIR, safeKey);
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      await fs.promises.unlink(localPath);
      deletedAny = true;
      console.log(`[Storage] Deleted local file: ${localPath}`);
    }
  } catch (err) {
    console.warn(`[Storage] Error deleting local file ${safeKey}:`, err);
  }

  // 2. Delete from Cloud Object Storage if active or if providerOverride is a cloud provider
  const config = await getStorageConfig();
  const cloudProvider =
    providerOverride && providerOverride !== "local"
      ? providerOverride
      : config.isActive
      ? config.provider
      : null;

  if (cloudProvider) {
    try {
      const { client, bucket } = createS3Client(config, cloudProvider as any);
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: safeKey,
        })
      );
      deletedAny = true;
      console.log(`[Storage] Deleted cloud object (${cloudProvider}): ${safeKey}`);
    } catch (err) {
      console.error(`[Storage] Failed to delete ${safeKey} from ${cloudProvider}:`, err);
    }
  }

  return deletedAny;
}

/**
 * Delete an entire folder prefix (e.g., `ai-chat/session-123`) from both Local Disk and Cloud Object Storage
 */
export async function deleteFolderPrefix(folderPrefix: string): Promise<number> {
  const safePrefix = sanitizeFolderPath(folderPrefix);
  if (!safePrefix) return 0;
  let deletedCount = 0;

  // 1. Delete local folder and all files inside it
  try {
    const localFolder = path.join(LOCAL_UPLOADS_DIR, safePrefix);
    if (fs.existsSync(localFolder) && fs.statSync(localFolder).isDirectory()) {
      const files = await fs.promises.readdir(localFolder);
      deletedCount += files.length;
      await fs.promises.rm(localFolder, { recursive: true, force: true });
      console.log(`[Storage] Removed local directory: ${localFolder} (${files.length} files)`);
    }
  } catch (err) {
    console.warn(`[Storage] Failed to remove local folder ${safePrefix}:`, err);
  }

  // 2. Delete all matching objects in Cloud Object Storage
  try {
    const config = await getStorageConfig();
    if (config.isActive) {
      const { client, bucket } = createS3Client(config);
      const listRes = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${safePrefix}/`,
        })
      );
      const contents = listRes.Contents || [];
      for (const obj of contents) {
        if (obj.Key) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: obj.Key,
            })
          );
          deletedCount++;
          console.log(`[Storage] Deleted cloud object under prefix (${config.provider}): ${obj.Key}`);
        }
      }
    }
  } catch (err) {
    console.warn(`[Storage] Cloud prefix cleanup warning for ${safePrefix}:`, err);
  }

  return deletedCount;
}
