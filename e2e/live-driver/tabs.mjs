import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
for (const p of pages) {
  console.log(`- ${p.url()}`);
}
