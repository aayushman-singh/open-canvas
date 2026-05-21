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

const res = await app.request('/');
const html = await res.text();
const doctype = '<!DOCTYPE html>\n';
const out = html.startsWith('<!DOCTYPE') ? html : doctype + html;
const written = await Bun.write('src/landing/PREVIEW.html', out);
console.log(`wrote ${written} bytes to src/landing/PREVIEW.html`);
