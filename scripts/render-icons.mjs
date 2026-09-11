import { chromium } from '@playwright/test';
import fs from 'node:fs';
const svg = fs.readFileSync('web/public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['icon-maskable-512.png', 512]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const maskable = name.includes('maskable');
  await page.setContent(`<html><body style="margin:0;background:${maskable ? '#171717' : 'transparent'}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><div style="width:${maskable ? size * 0.8 : size}px;height:${maskable ? size * 0.8 : size}px">${svg.replace('width="512" height="512"', 'width="100%" height="100%"')}</div></div></body></html>`);
  await page.screenshot({ path: `web/public/icons/${name}`, omitBackground: !maskable });
  await page.close();
}
await browser.close();
console.log(fs.readdirSync('web/public/icons'));
