// src/routes/dashboard/chat-panel.tsx
//
// Editor sidebar UI for the AI chat command surface (wishlist #23, Wave 5).
//
// Mounted at GET /dashboard/sites/:siteId/chat by the main thread. Renders
// a single-page UI with:
//   - a thread of bubbles for past Owner / Agent turns,
//   - an input bar that POSTs to /api/sites/:siteId/chat and reads the SSE
//     response in-browser,
//   - inline op-preview cards with accept / reject buttons. Accept POSTs
//     the preview op to /api/canvas-agent/sites/:siteId/apply (the existing
//     Wave-0 Owner-side apply route), reject just dismisses the card.
//
// The route itself only renders the shell; the live chat lives entirely in
// the browser via fetch + ReadableStream. We keep state in the DOM (no
// build step, no client framework).

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { html, raw } from 'hono/html';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { db } from '../../db/client.js';
import { site } from '../../db/schema.js';

import { DashboardShell, buildSiteNav } from './shell.js';
import { Button, readThemeCookie } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const chatPanelRoute = new Hono<Env>();
chatPanelRoute.use('*', clerkAuth());
chatPanelRoute.use('*', requireAuth());

const pageStyles = `
  .chat-shell {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 16px;
    height: calc(100vh - 200px);
    min-height: 480px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    padding: 16px;
  }
  .chat-thread {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .bubble {
    max-width: 720px;
    padding: 10px 14px;
    border-radius: 12px;
    line-height: 1.5;
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--panel-strong);
    border: 1px solid var(--line);
  }
  .bubble.agent {
    align-self: flex-start;
    background: rgba(125, 211, 252, 0.06);
    border: 1px solid rgba(125, 211, 252, 0.2);
  }
  .bubble.tool {
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed var(--line);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12.5px;
    color: var(--muted);
  }
  .preview-card {
    align-self: flex-start;
    border: 1px solid var(--accent);
    border-radius: 10px;
    padding: 12px 14px;
    max-width: 720px;
    background: rgba(125, 211, 252, 0.08);
  }
  .preview-card h4 {
    margin: 0 0 8px;
    font-size: 14px;
    color: var(--accent);
  }
  .preview-card pre {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 220px;
    overflow-y: auto;
  }
  .preview-card .actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
  }
  .preview-card button {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }
  .preview-card button.accept { border-color: var(--accent); color: var(--accent); }
  .preview-card button:disabled { opacity: 0.4; cursor: not-allowed; }
  .chat-input {
    display: flex;
    gap: 8px;
  }
  .chat-input textarea {
    flex: 1;
    min-height: 64px;
    resize: vertical;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    font: inherit;
  }
  .chat-status { color: var(--muted); font-size: 13px; min-height: 18px; }
`;

const browserScript = `
(() => {
  const shell = document.querySelector('[data-site-id]');
  const siteId = shell ? shell.getAttribute('data-site-id') : '';
  const thread = document.getElementById('chat-thread');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const statusEl = document.getElementById('chat-status');
  let sessionId = null;
  let pendingAgentBubble = null;

  function appendBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  function appendToolMarker(name, args) {
    const div = document.createElement('div');
    div.className = 'bubble tool';
    div.textContent = 'tool: ' + name + ' ' + JSON.stringify(args);
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
  }

  function appendPreviewCard(callId, toolName, op) {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.dataset.callId = callId;
    const heading = document.createElement('h4');
    heading.textContent = 'Proposed ' + toolName;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(op, null, 2);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const accept = document.createElement('button');
    accept.className = 'accept';
    accept.textContent = 'Accept';
    const reject = document.createElement('button');
    reject.textContent = 'Reject';
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      reject.disabled = true;
      try {
        const res = await fetch('/api/canvas-agent/sites/' + siteId + '/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops: [op] }),
        });
        if (!res.ok) {
          const body = await res.text();
          heading.textContent = 'Apply failed: ' + body.slice(0, 200);
          accept.disabled = false;
          reject.disabled = false;
        } else {
          heading.textContent = 'Applied ' + toolName;
        }
      } catch (err) {
        heading.textContent = 'Apply error: ' + String(err);
        accept.disabled = false;
        reject.disabled = false;
      }
    });
    reject.addEventListener('click', () => {
      card.remove();
    });
    actions.appendChild(accept);
    actions.appendChild(reject);
    card.appendChild(heading);
    card.appendChild(pre);
    card.appendChild(actions);
    thread.appendChild(card);
    thread.scrollTop = thread.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (text.length === 0) return;
    appendBubble('user', text);
    input.value = '';
    sendBtn.disabled = true;
    statusEl.textContent = 'Agent thinking…';
    pendingAgentBubble = appendBubble('agent', '');

    try {
      const res = await fetch('/api/sites/' + siteId + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });
      if (!res.ok) {
        const body = await res.text();
        statusEl.textContent = 'Send failed: ' + body.slice(0, 200);
        sendBtn.disabled = false;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\\n\\n')) >= 0) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const line = frame.startsWith('data:') ? frame.slice(5).trim() : frame.trim();
          if (line.length === 0) continue;
          try {
            const event = JSON.parse(line);
            handleEvent(event);
          } catch (err) {
            console.warn('chat-panel: bad SSE frame', frame);
          }
        }
      }
    } catch (err) {
      statusEl.textContent = 'Stream error: ' + String(err);
    } finally {
      sendBtn.disabled = false;
      statusEl.textContent = '';
    }
  }

  function handleEvent(event) {
    if (event.kind === 'session') {
      sessionId = event.sessionId;
      return;
    }
    if (event.kind === 'token') {
      if (pendingAgentBubble) pendingAgentBubble.textContent += event.text;
      return;
    }
    if (event.kind === 'tool-call') {
      appendToolMarker(event.name, event.args);
      pendingAgentBubble = appendBubble('agent', '');
      return;
    }
    if (event.kind === 'tool-result') {
      return; // tool results are read by the agent; we don't need to render
    }
    if (event.kind === 'op-preview') {
      appendPreviewCard(event.id, event.toolName, event.op);
      pendingAgentBubble = appendBubble('agent', '');
      return;
    }
    if (event.kind === 'error') {
      statusEl.textContent = event.error;
      return;
    }
    if (event.kind === 'done') {
      pendingAgentBubble = null;
      return;
    }
  }

  sendBtn.addEventListener('click', () => { void send(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      void send();
    }
  });
})();
`;

chatPanelRoute.get('/sites/:siteId/chat', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('chat-panel reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const database = db(c.env);
  // clerkAuth() middleware already loaded the customer row.
  const customerId = c.get('customer')?.id;
  if (!customerId) return c.text('not found', 404);
  const siteRow = await database
    .select({ id: site.id, name: site.name })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) return c.text('not found', 404);

  return c.html(
    <DashboardShell
      title={`Chat — ${row.name}`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${row.id}`, label: row.name },
        { label: 'Chat' },
      ]}
      siteNav={buildSiteNav(row.id, row.name, `/dashboard/sites/${row.id}/chat`)}
      pageStyles={pageStyles}
      theme={readThemeCookie(c)}
    >
      <div data-site-id={row.id}>
        <h1>Chat</h1>
        <p>Ask the Agent to edit the Editable Site. Each suggestion previews here for accept or reject.</p>
        <div class="chat-shell">
          <div class="chat-thread" id="chat-thread"></div>
          <div>
            <div class="chat-status" id="chat-status"></div>
            <div class="chat-input">
              <textarea id="chat-input" placeholder="Make the hero section more dramatic…" />
              <Button variant="primary" id="chat-send">Send</Button>
            </div>
          </div>
        </div>
        {html`<script>${raw(browserScript)}</script>`}
      </div>
    </DashboardShell>,
  );
});

export default chatPanelRoute;
