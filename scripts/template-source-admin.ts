import { createTemplateSourceAdminApp } from '../src/templates/source-admin-dashboard.js';

const requestedPort = Number.parseInt(Bun.env.PORT ?? '8791', 10);
if (!Number.isFinite(requestedPort) || requestedPort <= 0) {
  throw new Error(`template-source-admin: PORT must be a positive integer, got ${Bun.env.PORT}`);
}

const hostname = Bun.env.HOST ?? '127.0.0.1';
const app = createTemplateSourceAdminApp({
  turnstileSiteKey: Bun.env.TEMPLATE_SOURCE_ADMIN_TURNSTILE_SITE_KEY,
});

let server: ReturnType<typeof Bun.serve> | null = null;
let port = requestedPort;
let lastError: unknown = null;
for (; port < requestedPort + 20; port += 1) {
  try {
    server = Bun.serve({
      hostname,
      port,
      fetch: app.fetch,
    });
    break;
  } catch (error) {
    lastError = error;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('address already in use')) {
      throw error;
    }
  }
}

if (!server) {
  throw new Error(
    `template-source-admin: could not bind ${hostname}:${String(requestedPort)}-${String(
      port - 1,
    )}`,
    { cause: lastError },
  );
}

console.log(`template-source-admin: listening on http://${server.hostname}:${String(server.port)}`);
console.log('template-source-admin: preview links are served by this admin process');
