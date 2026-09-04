import { Router } from "express";
import { randomBytes } from "node:crypto";
import { asyncHandler, ok } from "../../shared/http";
import { requireAuth } from "../../middleware/auth.middleware";
import { subscribeRealtime } from "./realtime.service";

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

realtimeRouter.post(
  "/ticket",
  asyncHandler(async (req, res) => {
    ok(res, {
      ticket: randomBytes(24).toString("base64url"),
      userId: req.context!.userId,
      tenantId: req.context!.salonId,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }, 201);
  })
);

realtimeRouter.get(
  "/events",
  asyncHandler(async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("ready", { userId: req.context!.userId, tenantId: req.context!.salonId, time: new Date().toISOString() });
    const unsubscribe = subscribeRealtime(req.context!.salonId, (event, data) => send(event, data));
    const heartbeat = setInterval(() => send("heartbeat", { time: new Date().toISOString() }), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  })
);
