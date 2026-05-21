// Browser-side editor bootstrap, served as an inline ES module string.
//
// No local browser bundler — modules resolve via an importmap that points to
// esm.sh with pinned versions. The Worker only needs to interpolate per-request
// values (pageId, user info, doc id of the Yjs xmlFragment) into the script
// body before emitting it inside the HTML page.

export interface ClientScriptParams {
  pageId: string;
  wsUrl: string;
  userId: string;
  userName: string;
  userInitial: string;
  userColor: string;
  yFragmentName: string;
}

// Versions pinned for cache stability across deploys. Bumping these is a
// deliberate act — see SUBSYSTEM.md.
export const ESM_PINS = {
  yjs: '13.6.30',
  'y-protocols': '1.0.7',
  'y-websocket': '3.0.0',
  '@tiptap/core': '3.7.4',
  '@tiptap/starter-kit': '3.7.4',
  '@tiptap/extension-collaboration': '3.7.4',
  '@tiptap/extension-collaboration-caret': '3.7.4',
  '@tiptap/pm': '3.7.4',
  lib0: '0.2.116',
} as const;

export function buildImportMap(): string {
  const map = {
    imports: {
      yjs: `https://esm.sh/yjs@${ESM_PINS.yjs}`,
      'y-protocols/sync': `https://esm.sh/y-protocols@${ESM_PINS['y-protocols']}/sync`,
      'y-protocols/awareness': `https://esm.sh/y-protocols@${ESM_PINS['y-protocols']}/awareness`,
      'y-websocket': `https://esm.sh/y-websocket@${ESM_PINS['y-websocket']}?bundle-deps`,
      '@tiptap/core': `https://esm.sh/@tiptap/core@${ESM_PINS['@tiptap/core']}`,
      '@tiptap/starter-kit': `https://esm.sh/@tiptap/starter-kit@${ESM_PINS['@tiptap/starter-kit']}?bundle-deps`,
      '@tiptap/extension-collaboration': `https://esm.sh/@tiptap/extension-collaboration@${ESM_PINS['@tiptap/extension-collaboration']}?bundle-deps`,
      '@tiptap/extension-collaboration-caret': `https://esm.sh/@tiptap/extension-collaboration-caret@${ESM_PINS['@tiptap/extension-collaboration-caret']}?bundle-deps`,
      '@tiptap/pm/model': `https://esm.sh/@tiptap/pm@${ESM_PINS['@tiptap/pm']}/model`,
      '@tiptap/pm/state': `https://esm.sh/@tiptap/pm@${ESM_PINS['@tiptap/pm']}/state`,
      'lib0/encoding': `https://esm.sh/lib0@${ESM_PINS.lib0}/encoding`,
      'lib0/decoding': `https://esm.sh/lib0@${ESM_PINS.lib0}/decoding`,
    },
  };
  return JSON.stringify(map, null, 2);
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

export function editorClientScript(params: ClientScriptParams): string {
  return `
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';

const params = {
  pageId: ${jsString(params.pageId)},
  wsUrl: ${jsString(params.wsUrl)},
  userId: ${jsString(params.userId)},
  userName: ${jsString(params.userName)},
  userInitial: ${jsString(params.userInitial)},
  userColor: ${jsString(params.userColor)},
  yFragmentName: ${jsString(params.yFragmentName)},
};

const ydoc = new Y.Doc();

const provider = new WebsocketProvider(params.wsUrl, params.pageId, ydoc, {
  connect: true,
  WebSocketPolyfill: WebSocket,
});

provider.awareness.setLocalStateField('user', {
  id: params.userId,
  name: params.userName,
  initial: params.userInitial,
  color: params.userColor,
});

const statusEl = document.querySelector('[data-status]');
provider.on('status', ({ status }) => {
  if (!statusEl) return;
  statusEl.className = 'status ' + status;
  const label = statusEl.querySelector('[data-status-label]');
  if (label) label.textContent = status;
});

const avatarsEl = document.getElementById('avatars');
function renderAvatars() {
  if (!avatarsEl) return;
  const states = provider.awareness.getStates();
  const localClientID = ydoc.clientID;
  const seen = new Map();
  for (const [clientID, state] of states) {
    const user = state && state.user;
    if (!user) continue;
    seen.set(clientID, user);
  }
  avatarsEl.innerHTML = '';
  for (const [clientID, user] of seen) {
    const a = document.createElement('span');
    a.className = 'avatar' + (clientID === localClientID ? ' me' : '');
    a.style.background = user.color || 'oklch(0.78 0.15 200)';
    a.textContent = (user.initial || '?').slice(0, 1);
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = user.name + (clientID === localClientID ? ' (you)' : '');
    a.appendChild(tip);
    avatarsEl.appendChild(a);
  }
}
provider.awareness.on('change', renderAvatars);
renderAvatars();

const opsEl = document.querySelector('[data-ops]');
let localOps = 0;
ydoc.on('update', (_update, origin) => {
  if (origin === provider) return;
  localOps += 1;
  if (opsEl) opsEl.textContent = String(localOps);
});

const peersEl = document.querySelector('[data-peers]');
function updatePeerCount() {
  if (!peersEl) return;
  peersEl.textContent = String(provider.awareness.getStates().size);
}
provider.awareness.on('change', updatePeerCount);
updatePeerCount();

const editor = new Editor({
  element: document.getElementById('editor'),
  extensions: [
    StarterKit.configure({
      undoRedo: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Collaboration.configure({
      document: ydoc,
      field: params.yFragmentName,
    }),
    CollaborationCaret.configure({
      provider,
      user: {
        name: params.userName,
        color: params.userColor,
      },
    }),
  ],
});

window.__rev01Editor = { editor, ydoc, provider };
`;
}
