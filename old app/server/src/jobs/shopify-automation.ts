import { connectMongo, disconnectMongo } from "../config/mongo";
import { loadEnv } from "../config/env";
import { logger } from "../shared/logger";
import { runDueExecutions } from "../modules/shopify-automation/shopify-automation.service";

export function startShopifyAutomationScheduler(intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runDueExecutions();
      if (result.attempted) logger.info("Shopify automation scheduler processed executions", result);
    } catch (error) {
      logger.error("Shopify automation scheduler failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return timer;
}

async function main(): Promise<void> {
  const env = loadEnv();
  await connectMongo(env.MONGODB_URI);
  const result = await runDueExecutions();
  logger.info("Shopify automation job complete", result);
  await disconnectMongo();
}

if (process.argv[1]?.endsWith("shopify-automation.ts") || process.argv[1]?.endsWith("shopify-automation.js")) {
  main().catch((error) => {
    logger.error("Shopify automation job failed", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
