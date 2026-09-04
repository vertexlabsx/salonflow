const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
const { join } = require('path');

const outDir = join(__dirname, '..', 'marketing-site', 'ui-audit-screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  console.log('Capturing full page...');
  await page.screenshot({ path: join(outDir, '01-full-page.png'), fullPage: true });

  // Scroll through sections and capture viewport screenshots
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log('Page height:', pageHeight);

  const viewportHeight = 900;
  const steps = Math.ceil(pageHeight / viewportHeight);
  
  for (let i = 0; i < Math.min(steps, 12); i++) {
    const y = i * viewportHeight;
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `02-viewport-${String(i + 1).padStart(2, '0')}-y${y}.png`) });
  }

  await browser.close();

  // Mobile capture
  const mobileBrowser = await chromium.launch({ headless: true });
  const mobileContext = await mobileBrowser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(2000);
  await mobilePage.screenshot({ path: join(outDir, '03-mobile-full.png'), fullPage: true });
  await mobileBrowser.close();

  console.log('All screenshots saved to', outDir);
})();
