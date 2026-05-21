// Browser-side editor bootstrap, served as an inline ES module string.
//
// No local browser bundler — modules resolve via an importmap that points to
// esm.sh with pinned versions. The Worker only needs to interpolate per-request
// values (pageId, user info, doc id of the Yjs xmlFragment) into the script
// body before emitting it inside the HTML page.
//
// The editor's ProseMirror schema is hand-rolled from the rev01 document
// vocabulary (src/document/schema.ts). Every node + mark declared here matches
// `pm-schema.ts` on the server side exactly — same names, same attrs, same
// content groups — so Y.XmlFragments produced by either side decode losslessly
// on the other. No `@tiptap/starter-kit`: the StarterKit vocabulary doesn't
// cover rev01 sections, columns, actions, media, dividers, etc. and adopting
// it would silently truncate any save.

export interface ClientScriptParams {
  pageId: string;
  wsUrl: string;
  userId: string;
  userName: string;
  userInitial: string;
  userColor: string;
  yFragmentName: string;
  agentEndpoint: string;
}

// Versions pinned for cache stability across deploys. Bumping these is a
// deliberate act — see SUBSYSTEM.md.
export const ESM_PINS = {
  yjs: '13.6.30',
  'y-protocols': '1.0.7',
  'y-websocket': '3.0.0',
  '@tiptap/core': '3.7.4',
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
      '@tiptap/core': `https://esm.sh/@tiptap/core@${ESM_PINS['@tiptap/core']}?bundle-deps`,
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
import { Editor, Node, Mark } from '@tiptap/core';
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
  agentEndpoint: ${jsString(params.agentEndpoint)},
};

// Enum allow-lists — kept in sync with src/document/schema.ts. Embedded here
// rather than imported because the editor bundle is delivered as inlined ESM
// and the Worker schema module can't cross that boundary.
const SECTION_KINDS = ['hero', 'feature', 'pricing', 'gallery', 'cta', 'footer', 'custom'];
const PADDING_SIZES = ['sm', 'md', 'lg'];
const ALIGNMENTS = ['start', 'center', 'end'];
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];
const MEDIA_TYPES = ['image', 'video', 'iframe'];
const MEDIA_LOADING = ['lazy', 'eager'];
const ACTION_VARIANTS = ['primary', 'secondary', 'ghost'];
const COLUMN_COUNTS = [2, 3, 4];
const COLUMN_GAPS = ['sm', 'md', 'lg'];
const COLUMN_WIDTHS = ['auto', '1/2', '1/3', '2/3', '1/4', '3/4'];
const DIVIDER_STYLES = ['line', 'dot', 'space'];
const LIST_STYLES = ['bullet', 'numbered', 'check'];
const LINK_TARGETS = ['_self', '_blank'];

function enumAttr(allowed) {
  return (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    return allowed.includes(raw) ? raw : null;
  };
}
function numberEnumAttr(allowed) {
  return (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return allowed.includes(n) ? n : null;
  };
}
function stringAttr(raw) {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
function boolAttr(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw === 'true' || raw === '') return true;
  if (raw === 'false') return false;
  if (typeof raw === 'boolean') return raw;
  return null;
}

// Drop null/undefined entries so emitted DOM only carries explicit attributes.
function liveAttrs(pairs) {
  const out = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') { out[k] = v; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = String(v); }
  }
  return out;
}

// Build a parseHTML closure that reads a DOM attribute and runs a coercer.
function readAttr(name, coerce) {
  return (dom) => coerce(dom.getAttribute(name));
}

// -------------------------------------------------------------------------
// Nodes — every node from NODE_SCHEMA. Name + attr keys + content groups
// match pm-schema.ts on the server; the wire-format is therefore identical.
// -------------------------------------------------------------------------

const Doc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'section+',
});

const SectionNode = Node.create({
  name: 'section',
  group: 'section',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      kind: { default: 'custom', parseHTML: readAttr('data-kind', enumAttr(SECTION_KINDS)) },
      surface: { default: null, parseHTML: readAttr('data-surface', stringAttr) },
      padding: { default: null, parseHTML: readAttr('data-padding', enumAttr(PADDING_SIZES)) },
      bg: { default: null, parseHTML: readAttr('data-bg', stringAttr) },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-kind]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'section',
      liveAttrs({
        ...HTMLAttributes,
        'data-kind': node.attrs.kind ?? 'custom',
        'data-surface': node.attrs.surface,
        'data-padding': node.attrs.padding,
        'data-bg': node.attrs.bg,
      }),
      0,
    ];
  },
});

const HeadingNode = Node.create({
  name: 'heading',
  group: 'block',
  // 'inline*' (not 'inline+') so PM can auto-generate the node during edits.
  // The server-side validator enforces non-empty at snapshot time.
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (dom) => {
          const fromDataset = Number(dom.getAttribute('data-level'));
          if (HEADING_LEVELS.includes(fromDataset)) return fromDataset;
          const tag = dom.tagName.toLowerCase();
          const m = /^h([1-6])$/.exec(tag);
          return m ? Number(m[1]) : 1;
        },
      },
      align: { default: null, parseHTML: readAttr('data-align', enumAttr(ALIGNMENTS)) },
    };
  },
  parseHTML() {
    return HEADING_LEVELS.map((level) => ({ tag: 'h' + level, attrs: { level } }));
  },
  renderHTML({ HTMLAttributes, node }) {
    const lvl = HEADING_LEVELS.includes(node.attrs.level) ? node.attrs.level : 1;
    return [
      'h' + String(lvl),
      liveAttrs({ ...HTMLAttributes, 'data-align': node.attrs.align }),
      0,
    ];
  },
});

const ParagraphNode = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  addAttributes() {
    return {
      align: { default: null, parseHTML: readAttr('data-align', enumAttr(ALIGNMENTS)) },
    };
  },
  parseHTML() {
    return [{ tag: 'p' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'p',
      liveAttrs({ ...HTMLAttributes, 'data-align': node.attrs.align }),
      0,
    ];
  },
});

const MediaNode = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: (dom) => stringAttr(dom.getAttribute('data-src') || dom.getAttribute('src')) ?? '' },
      mediaType: {
        default: 'image',
        parseHTML: (dom) => {
          const fromData = enumAttr(MEDIA_TYPES)(dom.getAttribute('data-media-type'));
          if (fromData) return fromData;
          const tag = dom.tagName.toLowerCase();
          if (tag === 'img') return 'image';
          if (tag === 'video') return 'video';
          if (tag === 'iframe') return 'iframe';
          return 'image';
        },
      },
      alt: { default: null, parseHTML: (dom) => stringAttr(dom.getAttribute('data-alt') || dom.getAttribute('alt')) },
      aspectRatio: { default: null, parseHTML: readAttr('data-aspect-ratio', stringAttr) },
      loading: { default: null, parseHTML: readAttr('data-loading', enumAttr(MEDIA_LOADING)) },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-media-type]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'figure',
      liveAttrs({
        ...HTMLAttributes,
        'data-media-type': node.attrs.mediaType ?? 'image',
        'data-src': node.attrs.src ?? '',
        'data-alt': node.attrs.alt,
        'data-aspect-ratio': node.attrs.aspectRatio,
        'data-loading': node.attrs.loading,
      }),
    ];
  },
});

const ActionsNode = Node.create({
  name: 'actions',
  group: 'block',
  content: 'action+',
  addAttributes() {
    return {
      align: { default: null, parseHTML: readAttr('data-align', enumAttr(ALIGNMENTS)) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-actions]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      liveAttrs({ ...HTMLAttributes, 'data-actions': '', 'data-align': node.attrs.align }),
      0,
    ];
  },
});

const ActionNode = Node.create({
  name: 'action',
  // No 'group' here — matched by name in ActionsNode's content rule 'action+'.
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: '', parseHTML: (dom) => stringAttr(dom.getAttribute('href')) ?? '' },
      label: { default: '', parseHTML: (dom) => dom.textContent ?? '' },
      variant: { default: null, parseHTML: readAttr('data-variant', enumAttr(ACTION_VARIANTS)) },
      newTab: { default: null, parseHTML: readAttr('data-new-tab', boolAttr) },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-action]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'a',
      liveAttrs({
        ...HTMLAttributes,
        'data-action': '',
        href: node.attrs.href ?? '',
        'data-variant': node.attrs.variant,
        'data-new-tab': node.attrs.newTab,
      }),
      typeof node.attrs.label === 'string' ? node.attrs.label : '',
    ];
  },
});

const ColumnsNode = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column+',
  addAttributes() {
    return {
      count: { default: 2, parseHTML: readAttr('data-count', numberEnumAttr(COLUMN_COUNTS)) },
      gap: { default: null, parseHTML: readAttr('data-gap', enumAttr(COLUMN_GAPS)) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      liveAttrs({
        ...HTMLAttributes,
        'data-columns': '',
        'data-count': node.attrs.count ?? 2,
        'data-gap': node.attrs.gap,
      }),
      0,
    ];
  },
});

const ColumnNode = Node.create({
  name: 'column',
  // No 'group' — matched by name in ColumnsNode's content rule 'column+'.
  content: 'block+',
  addAttributes() {
    return {
      width: { default: null, parseHTML: readAttr('data-width', enumAttr(COLUMN_WIDTHS)) },
      align: { default: null, parseHTML: readAttr('data-align', enumAttr(ALIGNMENTS)) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      liveAttrs({
        ...HTMLAttributes,
        'data-column': '',
        'data-width': node.attrs.width,
        'data-align': node.attrs.align,
      }),
      0,
    ];
  },
});

const DividerNode = Node.create({
  name: 'divider',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      style: { default: null, parseHTML: readAttr('data-divider', enumAttr(DIVIDER_STYLES)) },
    };
  },
  parseHTML() {
    return [{ tag: 'hr[data-divider]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'hr',
      liveAttrs({ ...HTMLAttributes, 'data-divider': node.attrs.style ?? 'line' }),
    ];
  },
});

const ListNode = Node.create({
  name: 'list',
  group: 'block',
  content: 'listItem+',
  addAttributes() {
    return {
      style: {
        default: 'bullet',
        parseHTML: (dom) => enumAttr(LIST_STYLES)(dom.getAttribute('data-list-style')) ?? 'bullet',
      },
    };
  },
  parseHTML() {
    return [
      { tag: 'ul[data-list-style]' },
      { tag: 'ol[data-list-style]' },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const tag = node.attrs.style === 'numbered' ? 'ol' : 'ul';
    return [
      tag,
      liveAttrs({ ...HTMLAttributes, 'data-list-style': node.attrs.style ?? 'bullet' }),
      0,
    ];
  },
});

const ListItemNode = Node.create({
  name: 'listItem',
  // 'inline*' (not 'inline+') for PM generatability; validator enforces
  // non-empty at snapshot time.
  content: 'inline*',
  parseHTML() {
    return [{ tag: 'li' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['li', liveAttrs(HTMLAttributes), 0];
  },
});

const TextNode = Node.create({
  name: 'text',
  group: 'inline',
});

// -------------------------------------------------------------------------
// Marks — every entry in MARK_TYPES.
// -------------------------------------------------------------------------

const BoldMark = Mark.create({
  name: 'bold',
  parseHTML() {
    return [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (n) => n.style.fontWeight !== 'normal' && null },
      { style: 'font-weight=bold' },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['strong', liveAttrs(HTMLAttributes), 0];
  },
});

const ItalicMark = Mark.create({
  name: 'italic',
  parseHTML() {
    return [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['em', liveAttrs(HTMLAttributes), 0];
  },
});

const UnderlineMark = Mark.create({
  name: 'underline',
  parseHTML() {
    return [{ tag: 'u' }, { style: 'text-decoration=underline' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['u', liveAttrs(HTMLAttributes), 0];
  },
});

const CodeMark = Mark.create({
  name: 'code',
  // 'code' excludes all other marks per spec §1.3.
  excludes: '_',
  parseHTML() {
    return [{ tag: 'code' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['code', liveAttrs(HTMLAttributes), 0];
  },
});

const LinkMark = Mark.create({
  name: 'link',
  inclusive: false,
  addAttributes() {
    return {
      href: { default: '', parseHTML: (dom) => stringAttr(dom.getAttribute('href')) ?? '' },
      target: { default: null, parseHTML: readAttr('target', enumAttr(LINK_TARGETS)) },
      rel: { default: null, parseHTML: readAttr('rel', stringAttr) },
    };
  },
  parseHTML() {
    // Excludes a[data-action] so action atoms aren't reabsorbed as link marks.
    return [{ tag: 'a[href]:not([data-action])' }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    return [
      'a',
      liveAttrs({
        ...HTMLAttributes,
        href: mark.attrs.href ?? '',
        target: mark.attrs.target,
        rel: mark.attrs.rel,
      }),
      0,
    ];
  },
});

const ColorMark = Mark.create({
  name: 'color',
  addAttributes() {
    return {
      value: { default: '', parseHTML: (dom) => stringAttr(dom.getAttribute('data-color')) ?? '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-color]' }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    const value = typeof mark.attrs.value === 'string' ? mark.attrs.value : '';
    return [
      'span',
      liveAttrs({
        ...HTMLAttributes,
        'data-color': value,
        style: 'color:' + value,
      }),
      0,
    ];
  },
});

const HighlightMark = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      value: { default: '', parseHTML: (dom) => stringAttr(dom.getAttribute('data-highlight')) ?? '' },
    };
  },
  parseHTML() {
    return [{ tag: 'mark[data-highlight]' }];
  },
  renderHTML({ HTMLAttributes, mark }) {
    const value = typeof mark.attrs.value === 'string' ? mark.attrs.value : '';
    return [
      'mark',
      liveAttrs({
        ...HTMLAttributes,
        'data-highlight': value,
        style: 'background-color:' + value,
      }),
      0,
    ];
  },
});

const rev01Nodes = [
  Doc,
  SectionNode,
  HeadingNode,
  ParagraphNode,
  MediaNode,
  ActionsNode,
  ActionNode,
  ColumnsNode,
  ColumnNode,
  DividerNode,
  ListNode,
  ListItemNode,
  TextNode,
];

const rev01Marks = [
  BoldMark,
  ItalicMark,
  UnderlineMark,
  CodeMark,
  LinkMark,
  ColorMark,
  HighlightMark,
];

// -------------------------------------------------------------------------
// Yjs + presence wiring (identical to prior bootstrap).
// -------------------------------------------------------------------------

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
    const isMe = clientID === localClientID;
    const isAgent = user && user.kind === 'agent';
    a.className = 'avatar' + (isMe ? ' me' : '') + (isAgent ? ' agent' : '');
    a.style.background = user.color || 'oklch(0.78 0.15 200)';
    a.textContent = isAgent ? 'A' : ((user.initial || '?').slice(0, 1));
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.textContent = isAgent ? '<agent>' : (user.name + (isMe ? ' (you)' : ''));
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
  // No default doc — Collaboration takes the initial state from the Y.Doc that
  // the DurableObject hydrated from page.doc.
  extensions: [
    ...rev01Nodes,
    ...rev01Marks,
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

// -------------------------------------------------------------------------
// Agent chat panel — POSTs to /api/agent/edit, streams NDJSON, renders each
// event in #agent-log. Edits arrive in the editor via the existing Yjs
// WebSocket (the DO broadcasts updates from clientID=1 to all WS clients).
// -------------------------------------------------------------------------

const agentForm = document.getElementById('agent-form');
const agentLog = document.getElementById('agent-log');
const agentTextarea = document.getElementById('agent-message');
const agentSend = document.getElementById('agent-send');
const agentStatus = document.getElementById('agent-status');

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
    }
    return ch;
  });
}

function fmtTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

function appendBubble(kind, body) {
  if (!agentLog) return null;
  const wrap = document.createElement('div');
  wrap.className = 'agent-bubble ' + kind;
  wrap.innerHTML = body;
  agentLog.appendChild(wrap);
  agentLog.scrollTop = agentLog.scrollHeight;
  return wrap;
}

function appendUser(msg) {
  appendBubble(
    'agent-user',
    '<span class="who">you</span><span class="text">' + escapeText(msg) + '</span>',
  );
}

function appendAgentText() {
  // Returns the text span so the caller can append streamed text into it.
  if (!agentLog) return null;
  const wrap = document.createElement('div');
  wrap.className = 'agent-bubble agent-reply';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = 'agent';
  const text = document.createElement('span');
  text.className = 'text';
  wrap.appendChild(who);
  wrap.appendChild(text);
  agentLog.appendChild(wrap);
  agentLog.scrollTop = agentLog.scrollHeight;
  return text;
}

function appendToolEvent(label, detail, kind) {
  appendBubble(
    'agent-tool ' + (kind || ''),
    '<span class="when">[' + fmtTime() + ']</span> ' +
      '<span class="arrow">→</span> ' +
      '<span class="label">' + escapeText(label) + '</span>' +
      (detail ? ' <span class="detail">' + escapeText(detail) + '</span>' : ''),
  );
}

function appendErr(message) {
  appendBubble(
    'agent-error',
    '<span class="who">err</span><span class="text">' + escapeText(message) + '</span>',
  );
}

function setAgentStatus(label) {
  if (agentStatus) agentStatus.textContent = label;
}

async function runAgentRequest(message) {
  if (!agentSend || !agentTextarea) return;
  agentSend.disabled = true;
  agentTextarea.disabled = true;
  setAgentStatus('thinking…');

  let currentTextSpan = null;
  try {
    const res = await fetch(params.agentEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId: params.pageId, message }),
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error('agent endpoint ' + String(res.status) + ': ' + errText);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch (parseErr) {
          appendErr('bad ndjson line: ' + line);
          continue;
        }
        renderAgentEvent(event);
        if (event.type === 'text') {
          if (!currentTextSpan) currentTextSpan = appendAgentText();
          if (currentTextSpan) currentTextSpan.textContent += event.text;
        } else if (event.type !== 'text') {
          currentTextSpan = null;
        }
      }
    }
  } catch (err) {
    appendErr(err && err.message ? err.message : String(err));
  } finally {
    agentSend.disabled = false;
    agentTextarea.disabled = false;
    agentTextarea.value = '';
    setAgentStatus('idle');
    agentTextarea.focus();
  }
}

function renderAgentEvent(event) {
  if (!event || typeof event !== 'object') return;
  switch (event.type) {
    case 'thinking':
      setAgentStatus('turn ' + String(event.turn));
      break;
    case 'tool_call':
      appendToolEvent(
        event.name + '(' + summariseArgs(event.arguments) + ')',
        '',
        'agent-tool-call',
      );
      break;
    case 'tool_result':
      if (event.ok) {
        appendToolEvent('ok', event.opKind, 'agent-tool-ok');
      } else {
        appendToolEvent('err', event.error || '', 'agent-tool-err');
      }
      break;
    case 'done':
      appendToolEvent('done', String(event.reason) + ' (' + String(event.turns) + ' turns)', 'agent-tool-done');
      break;
    case 'error':
      appendErr(event.message || 'agent error');
      break;
    case 'text':
      // Streamed into the bubble by runAgentRequest.
      break;
    default:
      break;
  }
}

function summariseArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(args)) {
    const display = typeof v === 'string' && v.length > 30 ? v.slice(0, 27) + '...' : v;
    parts.push(k + ': ' + JSON.stringify(display));
  }
  return parts.join(', ');
}

if (agentForm) {
  agentForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (!agentTextarea) return;
    const message = agentTextarea.value.trim();
    if (message.length === 0) return;
    appendUser(message);
    void runAgentRequest(message);
  });
}

if (agentTextarea) {
  agentTextarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      if (agentForm) {
        const event = new Event('submit', { cancelable: true });
        agentForm.dispatchEvent(event);
      }
    }
  });
}
`;
}
