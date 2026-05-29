// Build-time only — runs in Bun, never in the Worker. We avoid pulling @types/node
// or @types/bun in as devDependencies just for one file by using the Bun global
// (typed locally) to write the preview output.
import { Hono } from 'hono';
import landing from './index';

declare const Bun: {
  write(path: string, data: string): Promise<number>;
};

const app = new Hono();
app.route('/', landing);

// The landing route reads `APP_DOMAIN` from env to compose canonical / og:url.
// Hono lets us pass a synthetic env on the `request()` call; we hand it the
// production apex so the preview output matches what the live page emits.
const PREVIEW_ENV = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'noreply@opencanvas.aayushman.dev',
};
const res = await app.request('/', {}, PREVIEW_ENV);
const html = await res.text();
const doctype = '<!DOCTYPE html>\n';
const out = html.startsWith('<!DOCTYPE') ? html : doctype + html;
const written = await Bun.write('src/landing/PREVIEW.html', out);
console.log(`wrote ${written} bytes to src/landing/PREVIEW.html`);
