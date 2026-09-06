const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage();
  page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGEERROR', err.stack || err.message));
  const resp = await page.goto('http://127.0.0.1:4320/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('STATUS', resp && resp.status());
  console.log('URL', page.url());
  console.log('HTML', (await page.locator('body').innerHTML()).slice(0, 1000));
  console.log('TEXT', (await page.locator('body').innerText()).slice(0, 500));
  await browser.close();
})();
