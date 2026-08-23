import http from "node:http";
import { loadEnv } from "./config/env";
import { connectMongo, disconnectMongo } from "./config/mongo";
import { createApp } from "./app";
import { logger } from "./shared/logger";

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  logger.info("MongoDB connected", { uri: env.MONGODB_URI.replace(/\/\/[^@]*@/, "//***@") });

  const app = createApp();
  const server = http.createServer(app);
  server.headersTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  server.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`Aura Staff server listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(() => {
      disconnectMongo()
        .catch((error) => logger.error("MongoDB disconnect failed", { error: String(error) }))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("Fatal startup error", { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  process.exit(1);
});
