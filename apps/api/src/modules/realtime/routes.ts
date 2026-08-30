import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { subscribeRealtimeEvents, type RealtimeEventPayload } from "../../services/realtime.js";

export const realtimeRoutes = new Hono<{ Variables: AuthVariables }>();

realtimeRoutes.get("/events", requireAuth, async (c) => {
  const user = c.get("user");

  return streamSSE(c, async (stream) => {
    // Send initial connected notification
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ userId: user.id, roles: user.roles }),
    });

    // Subscribe to backend event emitter
    const unsubscribe = subscribeRealtimeEvents(async (payload: RealtimeEventPayload) => {
      try {
        await stream.writeSSE({
          event: payload.type,
          data: JSON.stringify(payload),
        });
      } catch {
        // Handle stream write error if connection drops
      }
    });

    // Send heartbeat ping every 25 seconds to keep HTTP connection active
    const heartbeatInterval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: "ping",
          data: JSON.stringify({ timestamp: Date.now() }),
        });
      } catch {
        clearInterval(heartbeatInterval);
      }
    }, 25000);

    // Clean up when client disconnects
    stream.onAbort(() => {
      clearInterval(heartbeatInterval);
      unsubscribe();
    });

    // Keep stream active
    while (!stream.aborted) {
      await stream.sleep(10000);
    }
  });
});
