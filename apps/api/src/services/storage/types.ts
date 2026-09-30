export type StorageProviderType = "local" | "s3" | "r2" | "gcs" | "generic";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  publicUrl?: string;
  forcePathStyle?: boolean;
}

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl?: string;
}

export interface GcsConfig {
  bucket: string;
  authMode: "hmac" | "service_account";
  // HMAC mode (S3 compatible XML API):
  accessKeyId?: string;
  secretAccessKey?: string;
  // Service Account mode:
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  publicUrl?: string;
}

export interface GenericS3Config {
  name?: string; // e.g. MinIO, Wasabi, DigitalOcean Spaces, Backblaze B2
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl?: string;
  forcePathStyle?: boolean;
}

export interface StorageConfig {
  isActive: boolean; // Master toggle: true = Object Storage, false = Local Server
  provider: "s3" | "r2" | "gcs" | "generic";
  s3: S3Config;
  r2: R2Config;
  gcs: GcsConfig;
  generic: GenericS3Config;
  lastTestedAt?: string | null;
  lastTestedStatus?: "success" | "error" | null;
  lastTestedMessage?: string | null;
}

export interface UploadOptions {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  folder?: string;
}

export interface UploadResult {
  success: boolean;
  provider: StorageProviderType;
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}
