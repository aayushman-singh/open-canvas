// Test if editorPageJsx renders without throwing — simulates what the editor route does.
import { editorPageJsx } from '../../src/editor/canvas-index.tsx';

try {
  const jsx = editorPageJsx({
    siteId: 'eb7939f1-8f1e-4931-b947-f4dbba7b1283',
    siteName: 'Apogee Showcase',
    subdomain: 'apogee',
    styleKit: 'charcoal',
    context: 'dashboard',
    clerkPublishableKey: 'pk_test_dummy',
    wsToken: 'header.body.sig',
  });
  // Try to render to HTML (Hono uses honox jsx, returns JSX node)
  const str = String(jsx);
  console.log('rendered, length:', str.length);
  console.log('first 200:', str.slice(0, 200));
} catch (e) {
  console.error('THROW:', e.message);
  console.error(e.stack?.split('\n').slice(0, 8).join('\n'));
}
