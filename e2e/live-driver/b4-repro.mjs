#!/usr/bin/env node
// B4 diagnostic harness — does the on-site editor's autosave path actually
// reach Postgres?
//
// Reproduces the Pass-7 evidence beat (collaborator edit → blur → wait 30s
// → server unchanged) but captures the underlying signal the original
// drive missed: the WebSocket frames on both sides and the editor's own
// log of whether coEditSync() ran.
//
// Prereq: `node e2e/live-driver/driver.mjs start` is running (CDP on
// 9223), and the persistent profile is signed into Clerk as the Briar
// owner.
//
// Usage:
//   node e2e/live-driver/b4-repro.mjs \
//     --siteId <id> --subdomain <sub> --elementId <id> --newLabel "<text>"
//
// Optional:
//   --apex <origin>        Default: https://opencanvas.aayushman.dev
//   --waitMs <ms>          Time between edit + readback. Default 35000.
//   --out <file>           Write JSON report. Default: prints to stdout.
//   --keepOpen             Don't close the two repro tabs at the end.
//
// What it outputs (JSON to stdout or --out):
//   {
//     "before": { siteRev, hero CTA label, ... },
//     "after":  { siteRev, hero CTA label, ... },
//     "diff":   "preserved" | "reverted" | "applied",
//     "tabA":   { url, wsFrames: [...], consoleErrors: [...] },
//     "tabB":   { url, wsFrames: [...], consoleErrors: [...],
//                 coEditSyncLog: [...], statusLineHistory: [...] }
//   }

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const CDP_URL = 'http://127.0.0.1:9223';
const DEFAULT_APEX = 'https://opencanvas.aayushman.dev';
const DEFAULT_WAIT_MS = 35_000;

function parseArgs() {
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return flags;
}

function requireArg(flags, name) {
  if (!flags[name] || flags[name] === true) {
    process.stderr.write(`error: --${name} is required\n`);
    process.exit(1);
  }
  return flags[name];
}

const flags = parseArgs();
const SITE_ID = requireArg(flags, 'siteId');
const SUBDOMAIN = requireArg(flags, 'subdomain');
const ELEMENT_ID = requireArg(flags, 'elementId');
const NEW_LABEL = requireArg(flags, 'newLabel');
const APEX = flags.apex || DEFAULT_APEX;
const WAIT_MS = Number(flags.waitMs) || DEFAULT_WAIT_MS;
const OUT_FILE = flags.out && flags.out !== true ? flags.out : null;
const KEEP_OPEN = Boolean(flags.keepOpen);

// Published sites live at <subdomain>.<apexHost> — e.g. apex
// opencanvas.aayushman.dev → published briar.opencanvas.aayushman.dev.
const apexHost = new URL(APEX).host;
const PUBLISHED_ORIGIN = `https://${SUBDOMAIN}.${apexHost}`;
const DASHBOARD_URL = `${APEX}/dashboard/sites/${SITE_ID}/edit`;
const ON_SITE_EDIT_URL = `${PUBLISHED_ORIGIN}/?edit`;
const CANVAS_API_URL = `${APEX}/api/canvas/sites/${SITE_ID}`;

function nowMs() {
  return Number(new Date());
}

function attachTabSpy(page, label) {
  const wsFrames = [];
  const consoleErrors = [];
  page.on('websocket', (ws) => {
    const url = ws.url();
    wsFrames.push({ ts: nowMs(), kind: 'opened', label, url });
    ws.on('framesent', (frame) => {
      wsFrames.push({
        ts: nowMs(),
        kind: 'sent',
        label,
        url,
        bytes: frame.payload?.length ?? 0,
        preview: previewFrame(frame.payload),
      });
    });
    ws.on('framereceived', (frame) => {
      wsFrames.push({
        ts: nowMs(),
        kind: 'recv',
        label,
        url,
        bytes: frame.payload?.length ?? 0,
        preview: previewFrame(frame.payload),
      });
    });
    ws.on('close', () => {
      wsFrames.push({ ts: nowMs(), kind: 'closed', label, url });
    });
    ws.on('socketerror', (err) => {
      wsFrames.push({ ts: nowMs(), kind: 'error', label, url, err: String(err) });
    });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push({ ts: nowMs(), label, level: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ ts: nowMs(), label, level: 'pageerror', text: String(err) });
  });
  return { wsFrames, consoleErrors };
}

function previewFrame(payload) {
  // Yjs frames are binary (Uint8Array). JSON broadcast frames are text.
  // The diagnostic only needs a fingerprint — first byte + length is plenty
  // to correlate sent vs. received without dumping kilobytes.
  if (typeof payload === 'string') {
    return payload.slice(0, 80);
  }
  if (payload && payload.length !== undefined) {
    const first = payload[0];
    return `binary[${payload.length} bytes, b0=${first}]`;
  }
  return '?';
}

async function fetchEditableState(page) {
  // Use tab A's owner-session cookie to hit the canvas API. The fetch runs
  // inside the page context so credentials are included automatically.
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return {
      status: res.status,
      ok: res.ok,
      body: res.ok ? await res.json() : await res.text(),
    };
  }, CANVAS_API_URL);
}

function findElementLabel(editableState, elementId) {
  for (const page of editableState.pages || []) {
    for (const section of page.sections || []) {
      for (const element of section.elements || []) {
        if (element.id === elementId) {
          return element.label ?? element.text ?? null;
        }
      }
    }
  }
  return null;
}

async function main() {
  process.stderr.write(`[b4-repro] connecting to ${CDP_URL}…\n`);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    process.stderr.write(
      'error: no browser context — run `node e2e/live-driver/driver.mjs start` first\n',
    );
    process.exit(1);
  }

  process.stderr.write(`[b4-repro] opening tab A: ${DASHBOARD_URL}\n`);
  const tabA = await ctx.newPage();
  const spyA = attachTabSpy(tabA, 'A-dashboard');
  await tabA.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  process.stderr.write(`[b4-repro] opening tab B: ${ON_SITE_EDIT_URL}\n`);
  const tabB = await ctx.newPage();
  const spyB = attachTabSpy(tabB, 'B-on-site');
  await tabB.goto(ON_SITE_EDIT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  process.stderr.write(`[b4-repro] waiting for editor JS to attach on both tabs…\n`);
  await tabA.waitForFunction(
    () => typeof window.__rev01CoEdit !== 'undefined',
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  await tabB.waitForFunction(
    () => typeof window.__rev01CoEdit !== 'undefined',
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  // The IIFE attaches scheduleSave / coEditConnection on the page. Give it
  // a beat so the WS handshake completes before we sample state.
  await tabA.waitForTimeout(2_000);
  await tabB.waitForTimeout(2_000);

  process.stderr.write(`[b4-repro] reading editableState BEFORE edit…\n`);
  const before = await fetchEditableState(tabA);
  const beforeLabel =
    before.ok && before.body && before.body.editableState
      ? findElementLabel(before.body.editableState, ELEMENT_ID)
      : null;

  process.stderr.write(`[b4-repro] driving edit in tab B…\n`);
  const elementSelector = `[data-rev01-element="${ELEMENT_ID}"]`;
  await tabB.bringToFront();
  await tabB.locator(elementSelector).first().waitFor({ timeout: 10_000 });
  await tabB.locator(elementSelector).first().dblclick({ timeout: 10_000 });
  // Wait for contenteditable to be focused. The inspector + inline editing
  // toolbar appear; the element itself becomes the active element.
  await tabB.waitForTimeout(500);
  // Replace selection with new label.
  await tabB.keyboard.press('Control+A');
  await tabB.keyboard.type(NEW_LABEL, { delay: 20 });
  // Blur — the editor's blur handler fires coEditSync() → schedules autosave.
  await tabB.locator('body').click({ position: { x: 5, y: 5 } });

  // Capture tab B's status line history for ~the next 30s. The text reads
  // "Synced" on Yjs-projection success, "Saved" on HTTP-PUT success, or
  // "Co-edit disconnected; changes not saved" on the silent-failure path.
  const statusEvalScript = () => {
    const el = document.querySelector('[data-rev01-status]') ||
      document.getElementById('canvas-status');
    return el ? el.textContent : null;
  };
  const statusLineHistory = [];
  const sampleStart = nowMs();
  while (nowMs() - sampleStart < WAIT_MS) {
    const status = await tabB.evaluate(statusEvalScript).catch(() => null);
    if (status && (statusLineHistory.length === 0 ||
        statusLineHistory[statusLineHistory.length - 1].text !== status)) {
      statusLineHistory.push({ ts: nowMs() - sampleStart, text: status });
    }
    await tabB.waitForTimeout(500);
  }

  process.stderr.write(`[b4-repro] reading editableState AFTER edit…\n`);
  const after = await fetchEditableState(tabA);
  const afterLabel =
    after.ok && after.body && after.body.editableState
      ? findElementLabel(after.body.editableState, ELEMENT_ID)
      : null;

  let diff;
  if (afterLabel === NEW_LABEL) diff = 'applied';
  else if (afterLabel === beforeLabel) diff = 'reverted-or-never-saved';
  else diff = 'unexpected';

  const report = {
    config: {
      siteId: SITE_ID,
      subdomain: SUBDOMAIN,
      elementId: ELEMENT_ID,
      newLabel: NEW_LABEL,
      apex: APEX,
      waitMs: WAIT_MS,
      dashboardUrl: DASHBOARD_URL,
      onSiteUrl: ON_SITE_EDIT_URL,
    },
    before: { status: before.status, ok: before.ok, elementLabel: beforeLabel },
    after: { status: after.status, ok: after.ok, elementLabel: afterLabel },
    diff,
    tabA: {
      url: tabA.url(),
      wsFrames: spyA.wsFrames,
      consoleErrors: spyA.consoleErrors,
    },
    tabB: {
      url: tabB.url(),
      wsFrames: spyB.wsFrames,
      consoleErrors: spyB.consoleErrors,
      statusLineHistory,
    },
    // Quick aggregate read for the operator before scrolling raw frames.
    summary: {
      tabA_ws_sent: spyA.wsFrames.filter((f) => f.kind === 'sent').length,
      tabA_ws_recv: spyA.wsFrames.filter((f) => f.kind === 'recv').length,
      tabB_ws_sent: spyB.wsFrames.filter((f) => f.kind === 'sent').length,
      tabB_ws_recv: spyB.wsFrames.filter((f) => f.kind === 'recv').length,
      tabB_ws_opened: spyB.wsFrames.filter((f) => f.kind === 'opened').length,
      tabB_ws_closed: spyB.wsFrames.filter((f) => f.kind === 'closed').length,
    },
  };

  const json = JSON.stringify(report, null, 2);
  if (OUT_FILE) {
    writeFileSync(OUT_FILE, json);
    process.stderr.write(`[b4-repro] wrote ${OUT_FILE}\n`);
  } else {
    process.stdout.write(json + '\n');
  }

  // Print a one-line diagnosis to stderr regardless so the operator gets a
  // glance-level summary even if the JSON is piped elsewhere.
  process.stderr.write(
    `[b4-repro] diff=${diff}; before='${beforeLabel}' after='${afterLabel}'; ` +
      `tabB WS open=${report.summary.tabB_ws_opened} sent=${report.summary.tabB_ws_sent} ` +
      `recv=${report.summary.tabB_ws_recv} closed=${report.summary.tabB_ws_closed}\n`,
  );

  if (!KEEP_OPEN) {
    await tabA.close().catch(() => {});
    await tabB.close().catch(() => {});
  }
  // browser.close() would close the user's whole driver session — don't do that.
}

main().catch((err) => {
  process.stderr.write(`[b4-repro] error: ${err.message}\n${err.stack ?? ''}\n`);
  process.exit(1);
});
