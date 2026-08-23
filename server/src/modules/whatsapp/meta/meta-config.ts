import { loadEnv } from "../../../config/env";

export function metaConfig() {
  const env = loadEnv();
  return {
    appId: env.META_APP_ID || "",
    appSecret: env.META_APP_SECRET || "",
    configId: env.META_CONFIG_ID || "",
    apiVersion: env.META_API_VERSION || env.META_GRAPH_API_VERSION,
    graphBaseUrl: env.META_GRAPH_API_BASE_URL.replace(/\/$/, ""),
    webhookVerifyToken: env.VERIFY_TOKEN || env.META_WEBHOOK_VERIFY_TOKEN || "",
    webhookAppSecret: env.META_WEBHOOK_APP_SECRET || env.META_APP_SECRET || ""
  };
}

export function embeddedSignupConfigured(): boolean {
  const config = metaConfig();
  return Boolean(config.appId && config.appSecret && config.configId && config.webhookVerifyToken);
}
