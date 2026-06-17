import { renderBuiltInTemplatePreviewBodyHtml } from './templates.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[template-preview:smoke] ${message}`);
}

const html = renderBuiltInTemplatePreviewBodyHtml('velocity-athlete', {
  turnstileSiteKey: '1x00000000000000000000AA',
});

for (const marker of [
  'data-opencanvas-load-experience',
  'data-opencanvas-behaviour-payload',
  'data-opencanvas-interactive-runtime',
  'data-opencanvas-rich-motion',
]) {
  assert(html.includes(marker), `dashboard template preview must include ${marker}`);
}

const forbidden = ['lando', 'norris', 'mclaren', 'quadrant', 'gsap', 'ScrollTrigger'];
for (const token of forbidden) {
  assert(!html.toLowerCase().includes(token.toLowerCase()), `preview HTML must not leak forbidden token ${token}`);
}

console.log('[template-preview:smoke] OK');
