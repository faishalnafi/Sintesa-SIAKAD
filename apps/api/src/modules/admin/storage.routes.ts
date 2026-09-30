import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import {
  getSafeStorageConfig,
  saveStorageConfig,
  testStorageConnection,
  uploadFile,
  deleteFile,
  getStorageConfig,
} from "../../services/storage/storage.service.js";

export const adminStorageRoutes = new Hono<{ Variables: AuthVariables }>();

// Protect admin storage config routes
adminStorageRoutes.use(
  "*",
  requireAuth,
  requireRoles("admin", "superadmin")
);

/**
 * GET /api/admin/storage/config
 * Get current storage settings (masked secret keys)
 */
adminStorageRoutes.get("/config", async (c) => {
  try {
    const config = await getSafeStorageConfig();
    return c.json({ success: true, data: config });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

/**
 * POST /api/admin/storage/config
 * Save storage settings and toggle master switch
 */
adminStorageRoutes.post("/config", async (c) => {
  try {
    const body = await c.req.json();
    const updated = await saveStorageConfig(body);
    const safe = await getSafeStorageConfig();
    return c.json({
      success: true,
      message: `Konfigurasi Object Storage berhasil disimpan. Status: ${
        safe.isActive ? "AKTIF (Cloud Storage)" : "NONAKTIF (Penyimpanan Lokal Server)"
      }`,
      data: safe,
    });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

/**
 * POST /api/admin/storage/test
 * Test connection to specific provider
 */
adminStorageRoutes.post("/test", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const currentConfig = await getStorageConfig();

    // Allow overriding config in test payload if user hasn't saved yet
    const configToTest = {
      ...currentConfig,
      ...(body.config || {}),
      provider: body.provider || currentConfig.provider,
    };

    const result = await testStorageConnection(configToTest, body.provider);
    return c.json(result, result.success ? 200 : 400);
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

/**
 * Public/Authorized file upload endpoint
 * POST /api/storage/upload
 */
export const publicStorageRoutes = new Hono<{ Variables: AuthVariables }>();

publicStorageRoutes.post("/upload", requireAuth, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    const folder = (body["folder"] as string) || "documents";

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "File wajib disertakan dalam request ('file')." }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await uploadFile({
      buffer,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      folder,
    });

    return c.json({
      success: true,
      data: result,
      message: `File berhasil diunggah (${result.provider === "local" ? "Lokal" : "Cloud: " + result.provider.toUpperCase()}).`,
    });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});
