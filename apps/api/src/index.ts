import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./env.js";
import { syncGds } from "./services/integrations/gds.js";
import { syncKehadiran } from "./services/integrations/kehadiran.js";

process.on("uncaughtException", (err) => {
  console.error("[Process Error] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Process Error] Unhandled Rejection:", reason);
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SINTESA API listening on http://localhost:${info.port}`);

  // Setup background synchronization for external integrations (GDS & Kehadiran)
  // Run on startup (with a slight delay to allow server initialization)
  setTimeout(() => {
    runBackgroundSync();
  }, 5000);

  // Run periodically (every 1 hour)
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runBackgroundSync();
  }, ONE_HOUR);
});

async function runBackgroundSync() {
  console.log("[Background Sync] Starting scheduled synchronization...");
  try {
    const gdsResult = await syncGds();
    console.log(`[Background Sync] GDS: ${gdsResult.message}`);
  } catch (err: any) {
    console.error(`[Background Sync] GDS failed:`, err.message);
  }

  try {
    const kehadiranResult = await syncKehadiran();
    console.log(`[Background Sync] Kehadiran: ${kehadiranResult.message}`);
  } catch (err: any) {
    console.error(`[Background Sync] Kehadiran failed:`, err.message);
  }
}
