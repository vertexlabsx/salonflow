const { chromium } = require('playwright');
const { mkdirSync } = require('fs');
const { join } = require('path');

const outDir = join(__dirname, '..', 'marketing-site', 'ui-audit-screenshots', 'clean');
mkdirSync(outDir, { recursive: true });

const url = 'http://127.0.0.1:3000';

async function prepare(page) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  const accept = page.getByRole('button', { name: /^accept$/i });
  if (await accept.count()) await accept.first().click();
  await page.waitForTimeout(500);

  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 700) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}

async function captureSet(browser, name, viewport, isMobile = false) {
  const context = await browser.newContext({ viewport, isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
  const page = await context.newPage();
  await prepare(page);

  await page.screenshot({ path: join(outDir, `${name}-full.png`), fullPage: true });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = viewport.height;
  let index = 1;
  for (let y = 0; y < height; y += step) {
    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(outDir, `${name}-${String(index).padStart(2, '0')}-y${y}.png`) });
    index++;
  }

  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > vw + 2 || r.right > vw + 2 || r.left < -2;
      })
      .slice(0, 20)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        className: String(el.className).slice(0, 120),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        rect: el.getBoundingClientRect().toJSON(),
      }));

    const headings = [...document.querySelectorAll('h1,h2,h3')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().replace(/\s+/g, ' '),
      rect: el.getBoundingClientRect().toJSON(),
      fontSize: getComputedStyle(el).fontSize,
      lineHeight: getComputedStyle(el).lineHeight,
    }));

    const sections = [...document.querySelectorAll('section')].map((el, i) => ({
      index: i + 1,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      rect: el.getBoundingClientRect().toJSON(),
    }));

    return { viewport: { vw, vh }, height: document.documentElement.scrollHeight, headings, sections, overflowing };
  });
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await captureSet(browser, 'desktop', { width: 1440, height: 900 });
  await captureSet(browser, 'mobile', { width: 390, height: 844 }, true);
  await browser.close();
  console.log(`\nScreenshots saved to ${outDir}`);
})();
