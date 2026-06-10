#!/usr/bin/env node
// Live Playwright driver — runs a persistent chromium with CDP so individual
// command invocations can attach without restarting. Designed for iterative
// "drive the editor" sessions, not test runs.
//
// Usage:
//   node driver.mjs start                      # launches headed chromium (run in bg)
//   node driver.mjs nav <url>
//   node driver.mjs snap                       # accessibility tree
//   node driver.mjs click "<selector>"
//   node driver.mjs type "<selector>" "<text>"
//   node driver.mjs screenshot <name>
//   node driver.mjs eval "<js>"
//   node driver.mjs press <key>
//   node driver.mjs wait <text>
//   node driver.mjs console                    # recent console messages
//   node driver.mjs cookie set <name> <value> [domain]
//   node driver.mjs close

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CDP_PORT = 9223;
const PROFILE_DIR = join(process.cwd(), 'e2e', 'live-driver', '.profile');
const SCREENSHOT_DIR = join(process.cwd(), 'e2e', 'live-driver', 'screenshots');
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.length ? pages[pages.length - 1] : await ctx.newPage();
  return { browser, ctx, page };
}

async function cmdStart() {
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [`--remote-debugging-port=${CDP_PORT}`, '--no-first-run'],
  });
  // Keep alive — close via cmdClose
  process.stdout.write(`browser started on CDP port ${CDP_PORT}\n`);
  await new Promise(() => {});
}

async function cmdNav(url) {
  const { page } = await connect();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  process.stdout.write(`navigated to ${page.url()}\n`);
}

async function cmdSnap() {
  const { page } = await connect();
  const snap = await page.accessibility.snapshot({ interestingOnly: true });
  process.stdout.write(JSON.stringify(snap, null, 2).slice(0, 12000));
}

async function cmdClick(selector) {
  const { page } = await connect();
  await page.locator(selector).first().click({ timeout: 10000 });
  process.stdout.write(`clicked ${selector}\n`);
}

async function cmdType(selector, text) {
  const { page } = await connect();
  await page.locator(selector).first().fill(text);
  process.stdout.write(`typed into ${selector}\n`);
}

async function cmdScreenshot(name) {
  const { page } = await connect();
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  process.stdout.write(`saved ${path}\n`);
}

async function cmdEval(js) {
  const { page } = await connect();
  const result = await page.evaluate(`(() => { return (${js}); })()`);
  process.stdout.write(JSON.stringify(result, null, 2).slice(0, 8000));
}

async function cmdPress(key) {
  const { page } = await connect();
  await page.keyboard.press(key);
  process.stdout.write(`pressed ${key}\n`);
}

async function cmdWait(text) {
  const { page } = await connect();
  await page.getByText(text).first().waitFor({ timeout: 15000 });
  process.stdout.write(`saw "${text}"\n`);
}

async function cmdConsole() {
  const { page } = await connect();
  // Console messages aren't retained across reconnects; capture going forward.
  const messages = [];
  page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
  await page.waitForTimeout(500);
  process.stdout.write(messages.join('\n') + '\n');
}

async function cmdCookieSet(name, value, domain) {
  const { ctx } = await connect();
  const url = new URL(domain?.startsWith('http') ? domain : `https://${domain ?? 'opencanvas.aayushman.dev'}`);
  await ctx.addCookies([
    {
      name,
      value,
      domain: domain ?? '.opencanvas.aayushman.dev',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  process.stdout.write(`set cookie ${name}\n`);
}

async function cmdCookies() {
  const { ctx } = await connect();
  const cookies = await ctx.cookies();
  process.stdout.write(JSON.stringify(cookies.map((c) => ({ name: c.name, domain: c.domain })), null, 2));
}

async function cmdUrl() {
  const { page } = await connect();
  process.stdout.write(page.url() + '\n');
}

async function cmdClose() {
  const { browser } = await connect();
  await browser.close();
  process.stdout.write('closed\n');
}

const [cmd, ...args] = process.argv.slice(2);
const handlers = {
  start: () => cmdStart(),
  nav: () => cmdNav(args[0]),
  snap: () => cmdSnap(),
  click: () => cmdClick(args[0]),
  type: () => cmdType(args[0], args[1]),
  screenshot: () => cmdScreenshot(args[0] || 'shot'),
  eval: () => cmdEval(args[0]),
  press: () => cmdPress(args[0]),
  wait: () => cmdWait(args[0]),
  console: () => cmdConsole(),
  'cookie-set': () => cmdCookieSet(args[0], args[1], args[2]),
  cookies: () => cmdCookies(),
  url: () => cmdUrl(),
  close: () => cmdClose(),
};

const handler = handlers[cmd];
if (!handler) {
  process.stderr.write(`unknown command: ${cmd}\navailable: ${Object.keys(handlers).join(', ')}\n`);
  process.exit(1);
}

handler().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
