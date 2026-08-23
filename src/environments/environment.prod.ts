// Single compile-time source of the production API origin — used by the web PWA,
// Vercel build, and the Capacitor Android APK (all build with this configuration).
// Update this ONE line to the deployed backend host after deploying the API,
// e.g. "https://aura-salon-api.fly.dev/api/v1".
export const environment = {
  production: true,
  apiBaseUrl: "https://aurashinesalonwellness.in/api/v1"
};
