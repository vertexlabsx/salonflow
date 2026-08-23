# Staff app deployment

- Build with `npm run build` and publish `www/browser`.
- The SPA is online-dependent. No service worker or offline cache is configured.
- The manifest uses the existing SVG brand icon. No raster icons were generated because the repository has no existing standard raster-generation command; install presentation therefore varies by browser.
- Production API URLs must be relative or HTTPS. `npm test` enforces this contract.
