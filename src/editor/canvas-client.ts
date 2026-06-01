// src/editor/canvas-client.ts
//
// Browser-side bootstrap for the desktop Canvas Editor. Exported as a
// function that returns a string of inlined JavaScript so the editor route
// can embed it in the page via raw(). The script:
//
//   1. Loads the Editable Site via GET /api/canvas/sites/:siteId.
//   2. Renders the first page's sections into #canvas-root.
//   3. Lets the Owner select, edit, drag, resize, add, duplicate, delete,
//      and reorder Canvas Sections and Positioned Elements.
//   4. Persists every mutation via PUT /api/canvas/sites/:siteId (debounced).
//   5. Switches the Style Kit via POST /api/canvas/sites/:siteId/style-kit.
//
// The script body is one large template literal. The only interpolation is
// params.siteId, which the route validates against /^[A-Za-z0-9-]+$/ before
// calling this function — see the throw in canvasClientScript. Everything
// inside the literal is plain JavaScript, not TypeScript.
//
// Maintenance note: escape sequences are interpreted once by this TypeScript
// template literal and then again by the generated browser script. Run
// `bun run review:smoke` after editing string-heavy code here; that smoke
// imports the emitted client as JavaScript and catches broken escaping.

import { INSPECTOR_DISPATCH, SIDEBAR_DISPATCH } from '../canvas/elements/index.js';
import { SITE_ID_RE } from '../canvas/validate.js';

export interface CanvasClientScriptParams {
  siteId: string;
  apiBase?: string;
  wsToken?: string;
  /**
   * Display name for the local presence label rendered in remote peers'
   * cursors. Falls back to "Editor <uuid-prefix>" when omitted — see
   * loadPresenceIdentity() in the IIFE. Resolved by the editor route from
   * `customer.displayName` (or `customer.email` when displayName is null).
   */
  displayName?: string;
}

export function canvasClientScript(params: CanvasClientScriptParams): string {
  const { siteId, apiBase = '/api', wsToken = '', displayName = '' } = params;
  if (typeof siteId !== 'string' || !SITE_ID_RE.test(siteId)) {
    throw new Error(
      `canvasClientScript: siteId must match /^[A-Za-z0-9-]+$/ (got ${JSON.stringify(siteId)})`,
    );
  }
  if (typeof apiBase !== 'string' || !/^\/[a-z_/-]*$/i.test(apiBase)) {
    throw new Error(
      `canvasClientScript: apiBase must be a path starting with / (got ${JSON.stringify(apiBase)})`,
    );
  }

  // Safe interpolations: siteId, apiBase, displayName, INSPECTOR_DISPATCH,
  // SIDEBAR_DISPATCH. siteId + apiBase are validated above; displayName goes
  // through JSON.stringify so any string is safely embedded as a literal.
  // INSPECTOR_DISPATCH (ADR 0011 Step 1) and SIDEBAR_DISPATCH (ADR 0011 Step
  // 3) are static module exports of pure data so JSON.stringify produces
  // value-only payloads with no embedded code. Everything inside the IIFE is
  // plain JavaScript, not TypeScript.
  const inspectorDispatchJson = JSON.stringify(INSPECTOR_DISPATCH);
  const sidebarDispatchJson = JSON.stringify(SIDEBAR_DISPATCH);
  return `(() => {
  const SITE_ID = ${JSON.stringify(siteId)};
  const API_BASE = ${JSON.stringify(apiBase)};
  const WS_TOKEN = ${JSON.stringify(wsToken)};
  const PRESENCE_DISPLAY_NAME = ${JSON.stringify(displayName)};
  const SITE_BASE = API_BASE + "/canvas/sites/" + SITE_ID;
  const INSPECTOR_DISPATCH = ${inspectorDispatchJson};
  const SIDEBAR_DISPATCH = ${sidebarDispatchJson};
  // Flatten SIDEBAR_DISPATCH to a key→command map for O(1) lookups by
  // sidebar-add-component value or "add-X" action key (ADR 0011 Step 3).
  const SIDEBAR_COMMANDS = (function() {
    var byKey = {};
    var types = Object.keys(SIDEBAR_DISPATCH);
    for (var t = 0; t < types.length; t++) {
      var cmds = SIDEBAR_DISPATCH[types[t]].commands;
      for (var i = 0; i < cmds.length; i++) {
        byKey[cmds[i].key] = cmds[i];
      }
    }
    return byKey;
  })();

  // Named factories for the sidebar's "drop in a new X" buttons. Each
  // SidebarCommandSpec in SIDEBAR_DISPATCH names one of these by
  // factoryName; the factory returns { defaultSize, payload } where payload
  // is the new element minus its id + box (the caller fills both). Match
  // the sidebar-dispatch.smoke REGISTERED_FACTORIES list — added a factory
  // here means add the name there.
  //
  // newElementId / defaultBox are hoisted function declarations, so it is
  // safe for factories defined at IIFE top to reference them — calls only
  // happen at click time, well after declaration execution.
  const SIDEBAR_FACTORIES = {
    text: function() {
      return {
        defaultSize: { w: 320, h: 80 },
        payload: {
          type: "text",
          content: [{ text: "New text" }],
          role: "body",
          fontSize: 16,
          fontWeight: 400,
          align: "left",
        },
      };
    },
    image: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "media",
          mediaKind: "image",
          assetId: "__placeholder__",
          alt: "Image",
          fit: "cover",
        },
      };
    },
    video: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "media",
          mediaKind: "video",
          assetId: "__placeholder__",
          alt: "Video",
          fit: "cover",
          playback: { autoplay: false, muted: true, loop: false, controls: true },
        },
      };
    },
    action: function() {
      return {
        defaultSize: { w: 160, h: 48 },
        payload: {
          type: "action",
          label: "Action",
          href: "#",
          variant: "solid",
        },
      };
    },
    shape: function() {
      return {
        defaultSize: { w: 120, h: 120 },
        payload: {
          type: "shape",
          variant: "rect",
        },
      };
    },
    container: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "container",
          variant: "flat",
        },
      };
    },
    chart: function() {
      // Default to a small bar chart with two series across three categories
      // so the Owner has something to edit in the data grid immediately.
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "chart",
          kind: "bar",
          series: [
            { label: "Series A", values: [3, 5, 2] },
            { label: "Series B", values: [4, 1, 6] },
          ],
          categories: ["Jan", "Feb", "Mar"],
          showLegend: true,
        },
      };
    },
    form: function() {
      return {
        defaultSize: { w: 480, h: 360 },
        payload: {
          type: "form",
          fields: [
            { id: newElementId(), label: "Name", kind: "text", required: true, placeholder: "Your name" },
            { id: newElementId(), label: "Email", kind: "email", required: true, placeholder: "you@example.com" },
            { id: newElementId(), label: "Message", kind: "textarea", required: false, placeholder: "Your message" },
          ],
          submitLabel: "Send",
          successMessage: "Thanks! We received your submission.",
        },
      };
    },
    embed: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "embed",
          url: "",
          title: "Embed",
        },
      };
    },
    code: function() {
      // String.fromCharCode(10) is the newline trick — embedding a literal
      // backslash-n here would be reinterpreted by the outer TS template literal.
      return {
        defaultSize: { w: 480, h: 240 },
        payload: {
          type: "code",
          language: "typescript",
          source: "function hello() {" + String.fromCharCode(10) + "  return 'world';" + String.fromCharCode(10) + "}",
          showLineNumbers: true,
        },
      };
    },
    accordion: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "accordion",
          items: [
            { id: newElementId(), title: "First question", body: [{ text: "Answer to the first question." }] },
            { id: newElementId(), title: "Second question", body: [{ text: "Answer to the second question." }] },
            { id: newElementId(), title: "Third question", body: [{ text: "Answer to the third question." }] },
          ],
          allowMultipleOpen: false,
        },
      };
    },
    carousel: function() {
      return {
        defaultSize: { w: 480, h: 320 },
        payload: {
          type: "carousel",
          slides: [
            { id: newElementId(), assetId: "__placeholder__", caption: "Slide 1" },
            { id: newElementId(), assetId: "__placeholder__", caption: "Slide 2" },
            { id: newElementId(), assetId: "__placeholder__", caption: "Slide 3" },
          ],
          showArrows: true,
          showDots: true,
        },
      };
    },
    table: function() {
      var colA = newElementId();
      var colB = newElementId();
      var colC = newElementId();
      return {
        defaultSize: { w: 480, h: 240 },
        payload: {
          type: "table",
          columns: [
            { id: colA, header: "Name" },
            { id: colB, header: "Role" },
            { id: colC, header: "Status" },
          ],
          rows: [
            { id: newElementId(), cells: Object.fromEntries([[colA, "Alice"], [colB, "Engineer"], [colC, "Active"]]) },
            { id: newElementId(), cells: Object.fromEntries([[colA, "Bob"], [colB, "Designer"], [colC, "Active"]]) },
          ],
          zebra: true,
          collapseOnPhone: true,
        },
      };
    },
    nav: function() {
      return {
        defaultSize: { w: 960, h: 56 },
        payload: {
          type: "nav",
          links: [
            { label: "Home", href: "/home", kind: "internal" },
            { label: "About", href: "/about", kind: "internal" },
            { label: "Contact", href: "/contact", kind: "internal" },
          ],
          layout: "left-right",
          sticky: false,
        },
      };
    },
  };

  // Resolve a sidebar command key (e.g. "image", "table") to an inserted
  // element + add it to the section. Caller has already validated the
  // section. Throws loudly when the command key is unknown or names a
  // factory that has not been registered — both are programming errors
  // the sidebar-dispatch:smoke catches at build time, but failing here is
  // the runtime safety net.
  function insertElementForSidebarCommand(section, commandKey) {
    var cmd = SIDEBAR_COMMANDS[commandKey];
    if (!cmd) throw new Error("insertElementForSidebarCommand: unknown command key " + JSON.stringify(commandKey));
    var factory = SIDEBAR_FACTORIES[cmd.factoryName];
    if (typeof factory !== "function") {
      throw new Error("insertElementForSidebarCommand: no factory registered for " + JSON.stringify(cmd.factoryName));
    }
    var built = factory(section);
    var newEl = { id: newElementId() };
    var payload = built.payload;
    var keys = Object.keys(payload);
    for (var i = 0; i < keys.length; i++) newEl[keys[i]] = payload[keys[i]];
    newEl.box = defaultBox(section, built.defaultSize.w, built.defaultSize.h);
    addElementToSection(section, newEl);
  }

  const STYLE_KITS = ["charcoal", "orange-editorial", "blue-saas", "green-organic"];
  const ACTION_VARIANTS = ["solid", "outline", "ghost", "pill", "glass", "brutalist", "underline"];
  const SURFACE_VARIANTS = ["flat", "raised", "glass", "outlined", "sticker", "editorial-frame", "soft-panel"];
  const SHAPE_VARIANTS = ["rect", "pill", "circle", "line", "badge", "blob"];
  const MOTION_PRESETS = ["none", "fade-up", "fade-down", "fade-in", "fade-right", "slide-left", "slide-up", "slide-right", "scale-in", "zoom-out", "blur-in", "rotate-in", "flip-in", "bounce-in", "stagger-children", "slow-drift", "parallax-soft"];
  // Canonical nesting order for inline marks. Outermost first: link wraps every
  // other mark so anchor styling stays intact when marks combine; the typographic
  // tags (strong, em, u, s, mark, code) nest inside in this exact sequence so the
  // editor preview matches the server renderer (src/canvas/render.ts) and the
  // serializer's adjacent-run dedupe by JSON string stays reliable.
  // Three locations within this file MUST derive from this list (no parallel
  // hardcoded mark-name arrays anywhere):
  //   1. activeMarksFor's order map (DOM->runs serializer sort).
  //   2. buildRunNode's wrap() sequence (runs->DOM nest order is the REVERSE
  //      of CANONICAL_MARK_ORDER because wrap() pushes innermost first).
  //   3. The mark-toolbar button loop (toolbar iterates this list directly so
  //      adding a mark here surfaces a button automatically).
  const CANONICAL_MARK_ORDER = ["link", "bold", "italic", "underline", "strike", "highlight", "code"];
  // Scroll-trigger modes for page entrance animations. Mirrors schema's
  // SCROLL_TRIGGER_MODES; if you add a mode there, add it here too.
  const SCROLL_TRIGGER_MODES = ["on-load", "on-scroll"];
  // Minimum drag/resize size for a positioned element, in canvas px. Mirrored in
  // server-side validate.ts / render.ts bounds.
  const MIN_ELEMENT_SIZE_PX = 24;
  // Seek offset for video poster extraction. Some codecs emit a black frame at
  // exactly t=0, so we step in a hair past zero (clamped to half-duration for
  // very short clips).
  const FIRST_FRAME_SEEK_SECONDS = 0.05;
  // Hard ceiling on the video-poster extraction promise. A corrupted or
  // unsupported codec can leave loadeddata/seeked events un-fired; without this
  // the UI silently hangs on "Loading...". Loud failure on timeout.
  const POSTER_EXTRACTION_TIMEOUT_MS = 30000;
  // Default page width in canvas px when a new page is created. Sized to match
  // the 1440px desktop artboard the inspector is calibrated for; mirrored in
  // server-side validate.ts page width bounds.
  const DEFAULT_PAGE_WIDTH_PX = 1440;
  // Co-edit reconnect curve. Mirrors src/live/co-edit/client.ts defaults so
  // the editor host advertises the same backoff the underlying connector
  // applies. Base * 2^attempt, capped, then multiplied by [0.5, 1.0) jitter.
  const COEDIT_RECONNECT_BASE_DELAY_MS = 1000;
  const COEDIT_RECONNECT_MAX_DELAY_MS = 30000;
  // Give-up threshold for the co-edit reconnect loop. Past this many
  // consecutive failed attempts we stop retrying and tell the user to reload
  // — silent infinite reconnects mask a real outage and burn the user's
  // battery. Loud failure beats a fake "still connected" UI.
  const COEDIT_RECONNECT_MAX_ATTEMPTS = 10;
  // Text-element font bounds and weight options live on the textInspectorSpec
  // in src/canvas/elements/text.ts now (ADR 0011 Step 1); the JSON-emitted
  // INSPECTOR_DISPATCH above carries them into this script. Server-side
  // src/canvas/validate.ts mirrors the same bounds — if you change them,
  // change both places.
  // Subresource integrity for the Cropper.js v2.1.1 ESM bundle on jsDelivr.
  // Sourced at:
  //   curl -s https://cdn.jsdelivr.net/npm/cropperjs@2.1.1/dist/cropper.esm.js \
  //     | openssl dgst -sha384 -binary | openssl base64 -A
  // If you bump CROPPER_CDN's version, recompute this hash. The runtime verifies
  // the downloaded bytes against this before evaluating the module — a CDN or
  // npm compromise that ships different bytes for the same version trips a loud
  // error instead of executing attacker JS inside the Owner's session.
  const CROPPER_SRI_SHA384 = "yCR/qrwwtTzBEzopZRNsQRqJmomeGgAikrPg/5vB2wkQLsM3OGRnEktc9gpN1KDg";
  // Mirror of canvas/action-href.ts isAllowedHref -- IIFE template-literal cannot import. See ADR 0011 (canvas-element-registry) for build-pipeline ADR.
  const ALLOWED_HREF_SCHEMES = ["http:", "https:", "mailto:", "tel:"];
  function isAllowedHref(href) {
    if (typeof href !== "string" || href.length === 0) return false;
    if (href.charAt(0) === "#" || href.charAt(0) === "/") return true;
    const trimmed = href.trim().toLowerCase();
    if (trimmed.indexOf("javascript:") === 0) return false;
    try {
      const url = new URL(href);
      return ALLOWED_HREF_SCHEMES.indexOf(url.protocol) >= 0;
    } catch (_) {
      return false;
    }
  }
  function isSafeCssValue(value) {
    if (typeof value !== "string" || value.length === 0) return false;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      var ch = value.charAt(i);
      if (code < 32 || ch === ";" || ch === "{" || ch === "}" || ch === "\\\\" || ch === "/") return false;
    }
    return value.toLowerCase().indexOf("</") < 0;
  }
  function isValidActionHref(href) {
    if (!href || typeof href !== "object") return false;
    if (href.type === "external") {
      return typeof href.url === "string" && href.url.length > 0 && isAllowedHref(href.url);
    }
    if (href.type === "page") {
      return typeof href.pageId === "string" && href.pageId.length > 0;
    }
    return false;
  }

  // -- State migration: old string hrefs -> ActionHref union ---------------
  //
  // Runs on every editor load by design. A one-shot DB migration is rejected
  // because Yjs co-edit (ADR 0007) projects state through the client; old
  // peers writing legacy string hrefs would silently break a "migrated"
  // database, and the operation is cheap (linear over elements, no I/O).
  // The loud failure mode is "Action hrefs render as #"; the migration
  // fixes that in memory before render. If a tool ever needs to claim
  // "all stored data is in the new shape" the DB migration becomes
  // appropriate — until then the in-memory pass is the right floor.
  function migrateState(s) {
    if (!s || !s.pages) return s;
    function migrateSection(section) {
      if (!section || !Array.isArray(section.elements)) return;
      for (var k = 0; k < section.elements.length; k++) {
        var el = section.elements[k];
        if (el.type === "action" && typeof el.href === "string") {
          el.href = { type: "external", url: el.href };
        }
      }
    }
    for (var i = 0; i < s.pages.length; i++) {
      var page = s.pages[i];
      for (var j = 0; j < page.sections.length; j++) {
        migrateSection(page.sections[j]);
      }
    }
    migrateSection(s.header);
    migrateSection(s.footer);
    return s;
  }

  // Tag-name -> InlineMark factory used by the DOM-to-runs serializer.
  const MARK_TAGS = {
    STRONG: () => ({ type: "bold" }),
    B: () => ({ type: "bold" }),
    EM: () => ({ type: "italic" }),
    I: () => ({ type: "italic" }),
    U: () => ({ type: "underline" }),
    S: () => ({ type: "strike" }),
    STRIKE: () => ({ type: "strike" }),
    MARK: () => ({ type: "highlight" }),
    CODE: () => ({ type: "code" }),
  };

  // Shared editor state.
  let state = null;
  let selectedSectionId = null;
  let selectedElementId = null;
  let saveTimer = null;
  let saveQueue = Promise.resolve(true);
  let statusTimer = null;
  let editingElementId = null;
  // Deep clone of the InlineRun[] pre-edit — Escape/Cancel restore from this.
  let editingSnapshot = null;
  // The inline mark toolbar element, present in the DOM only while editing.
  let markToolbar = null;
  // AI preview overlay state. Only one preview at a time; while a preview is
  // open every AI button on the page is disabled. The overlay disappears on
  // Accept (after the apply call lands) or Dismiss (no save).
  let aiPanel = null;
  let aiBusy = false;
  let interactionMode = "select";
  let spaceHeldForPan = false;
  let temporaryPanPreviousMode = null;
  let isReelOpen = false;
  let reelViewMode = "tile";
  let activePageId = null;
  let pagePositions = [];
  const PAGE_GAP = 120;
  const ARTBOARD_LABEL_HEIGHT = 40;
  const root = document.getElementById("canvas-root");
  const inspector = document.getElementById("canvas-inspector");
  const statusEl = document.getElementById("canvas-status");
  const mainEl = document.querySelector("main.opencanvas-editor");
  const sidebar = document.getElementById("canvas-sidebar");
  const sidebarSelection = document.getElementById("canvas-sidebar-selection");
  const saveButton = document.getElementById("canvas-save");
  const publishButton = document.getElementById("canvas-publish");
  const versionBadge = document.getElementById("canvas-version");
  const saveTemplateButton = document.getElementById("canvas-save-template");

  // -- Chat panel toggle (wired early — no site data dependency) ----------
  var chatToggleBtn = document.getElementById("canvas-chat-toggle");
  var chatPanelEl = document.getElementById("canvas-chat-panel");
  var chatCloseBtn = document.getElementById("canvas-chat-close");

  function toggleChatPanel() {
    if (!chatPanelEl) return;
    var isOpen = !chatPanelEl.hidden;
    chatPanelEl.hidden = isOpen;
    if (chatToggleBtn) chatToggleBtn.classList.toggle("active", !isOpen);
    if (!isOpen) {
      var inp = document.getElementById("canvas-chat-input");
      if (inp) inp.focus();
    }
  }

  if (chatToggleBtn) chatToggleBtn.addEventListener("click", toggleChatPanel);
  if (chatCloseBtn) chatCloseBtn.addEventListener("click", toggleChatPanel);

  // -- Chat selection chip ------------------------------------------------
  // Mirrors selectedElementId into the chat panel so the agent can resolve
  // vague references ("change this to blue") to the element the Owner has
  // selected on the canvas. The X drops the hint for THIS send only; the
  // canvas selection itself is untouched, and the next message re-arms it.
  var chatSelectionEl = document.getElementById("canvas-chat-selection");
  var chatSelectionTextEl = document.getElementById("canvas-chat-selection-text");
  var chatSelectionClearBtn = document.getElementById("canvas-chat-selection-clear");
  var chatSelectionDropped = false;

  function updateChatSelectionChip() {
    if (!chatSelectionEl || !chatSelectionTextEl) return;
    if (!selectedElementId || chatSelectionDropped || !state) {
      chatSelectionEl.hidden = true;
      return;
    }
    var found = findElement(selectedElementId);
    var typeLabel = found && found.element ? found.element.type : "element";
    var shortId = selectedElementId.length > 10 ? selectedElementId.slice(0, 10) + "..." : selectedElementId;
    chatSelectionTextEl.textContent = typeLabel + " - " + shortId;
    chatSelectionEl.hidden = false;
  }

  if (chatSelectionClearBtn) {
    chatSelectionClearBtn.addEventListener("click", function() {
      chatSelectionDropped = true;
      updateChatSelectionChip();
    });
  }

  // -- Viewport + camera --------------------------------------------------
  // The route ships #canvas-root directly inside the editor shell. We wrap
  // it in a .opencanvas-viewport at boot so the viewport owns the dark
  // background and dock-clearing margins, while #canvas-root receives the
  // CSS transform that implements pan+zoom via the camera object. The
  // viewport has overflow:hidden — no body scroll, the camera handles
  // everything. The wrap is purely client-side so the route shell stays
  // untouched.
  let viewport = null;
  let zoomToolbar = null;
  let zoomReadout = null;
  let camera = { x: 0, y: 0, zoom: 1 };
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX_FIT = 1.0;     // "Fit" never auto-zooms past 100%
  const ZOOM_MAX_MANUAL = 2.0;  // manual +/- and wheel clamp here
  const ZOOM_STEP = 0.1;

  function clampZoom(value, max) {
    if (!Number.isFinite(value)) return 1;
    var upper = typeof max === "number" ? max : ZOOM_MAX_MANUAL;
    if (value < ZOOM_MIN) return ZOOM_MIN;
    if (value > upper) return upper;
    // Snap to one-decimal precision so repeated +/- stays predictable.
    return Math.round(value * 10) / 10;
  }

  function screenToWorld(screenX, screenY) {
    if (!viewport) return { x: 0, y: 0 };
    var rect = viewport.getBoundingClientRect();
    return {
      x: (screenX - rect.left - camera.x) / camera.zoom,
      y: (screenY - rect.top - camera.y) / camera.zoom,
    };
  }

  function worldToScreen(worldX, worldY) {
    if (!viewport) return { x: 0, y: 0 };
    var rect = viewport.getBoundingClientRect();
    return {
      x: worldX * camera.zoom + camera.x + rect.left,
      y: worldY * camera.zoom + camera.y + rect.top,
    };
  }

  function applyCameraTransform() {
    if (!root) return;
    root.style.transform =
      "translate(" + camera.x + "px, " + camera.y + "px) scale(" + camera.zoom + ")";
    root.style.transformOrigin = "0 0";
    if (zoomReadout) zoomReadout.textContent = Math.round(camera.zoom * 100) + "%";
    // Camera moved → every remote pointer-cursor's world→screen mapping
    // changed too. Skip when the layer hasn't mounted yet (very first
    // applyCameraTransform during boot fires before any peer connects).
    if (typeof repaintRemoteCursors === "function") {
      repaintRemoteCursors();
    }
  }

  function setZoom(newZoom, maxClamp) {
    camera.zoom = clampZoom(newZoom, maxClamp);
    applyCameraTransform();
  }

  function zoomAtPoint(newZoom, screenX, screenY) {
    if (!viewport) return;
    var rect = viewport.getBoundingClientRect();
    var worldX = (screenX - rect.left - camera.x) / camera.zoom;
    var worldY = (screenY - rect.top - camera.y) / camera.zoom;
    camera.zoom = clampZoom(newZoom, ZOOM_MAX_MANUAL);
    camera.x = (screenX - rect.left) - worldX * camera.zoom;
    camera.y = (screenY - rect.top) - worldY * camera.zoom;
    applyCameraTransform();
  }

  function fitToPage(pageId) {
    if (!viewport) return;
    var page = currentPage();
    var pos = getPagePosition(pageId || (page && page.id));
    if (!pos) return;
    var rect = viewport.getBoundingClientRect();
    var pad = 64;
    var availW = rect.width - pad * 2;
    var availH = rect.height - pad * 2;
    if (availW <= 0 || availH <= 0) return;
    var scaleX = availW / pos.width;
    var scaleY = availH / pos.height;
    var newZoom = clampZoom(Math.min(scaleX, scaleY), ZOOM_MAX_FIT);
    camera.zoom = newZoom;
    camera.x = (rect.width - pos.width * newZoom) / 2 - pos.x * newZoom;
    camera.y = (rect.height - pos.height * newZoom) / 2 - pos.y * newZoom;
    applyCameraTransform();
  }

  function fitZoom() {
    fitToPage(null);
  }

  function computePagePositions() {
    if (!state || !state.pages) { pagePositions = []; return; }
    var positions = [];
    var x = 0;
    for (var i = 0; i < state.pages.length; i++) {
      var page = state.pages[i];
      var totalHeight = 0;
      for (var j = 0; j < page.sections.length; j++) {
        totalHeight += page.sections[j].height || 0;
      }
      if (state.header) totalHeight += state.header.height || 0;
      if (state.footer) totalHeight += state.footer.height || 0;
      positions.push({
        pageId: page.id,
        x: x,
        y: ARTBOARD_LABEL_HEIGHT,
        width: page.width,
        height: totalHeight,
      });
      x += page.width + PAGE_GAP;
    }
    pagePositions = positions;
  }

  function getPagePosition(pageId) {
    for (var i = 0; i < pagePositions.length; i++) {
      if (pagePositions[i].pageId === pageId) return pagePositions[i];
    }
    return null;
  }

  function fitAllPages() {
    if (!viewport || pagePositions.length === 0) return;
    var rect = viewport.getBoundingClientRect();
    var pad = 64;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < pagePositions.length; i++) {
      var p = pagePositions[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.width > maxX) maxX = p.x + p.width;
      if (p.y + p.height > maxY) maxY = p.y + p.height;
    }
    var contentW = maxX - minX;
    var contentH = maxY - minY;
    if (contentW <= 0 || contentH <= 0) return;
    var availW = rect.width - pad * 2;
    var availH = rect.height - pad * 2;
    var scaleX = availW / contentW;
    var scaleY = availH / contentH;
    var newZoom = clampZoom(Math.min(scaleX, scaleY), ZOOM_MAX_FIT);
    camera.zoom = newZoom;
    camera.x = (rect.width - contentW * newZoom) / 2 - minX * newZoom;
    camera.y = (rect.height - contentH * newZoom) / 2 - minY * newZoom;
    applyCameraTransform();
  }

  function mountViewport() {
    if (!root || !root.parentNode) return;
    const parent = root.parentNode;
    viewport = document.createElement("div");
    viewport.className = "opencanvas-viewport";
    // Insert viewport in place of #canvas-root, then move #canvas-root in.
    parent.insertBefore(viewport, root);
    viewport.appendChild(root);
    // Build the zoom toolbar and append directly to document.body — the
    // CSS pins it via position: fixed at the top-left of the canvas area,
    // so it must NOT live inside the viewport (which now uses flex
    // centering and has no scroll of its own).
    zoomToolbar = document.createElement("div");
    zoomToolbar.className = "opencanvas-zoom-toolbar";
    zoomToolbar.setAttribute("role", "toolbar");
    zoomToolbar.setAttribute("aria-label", "Zoom and interaction mode");
    var modeDefs = [
      { label: "↖", title: "Select (V)", ariaLabel: "Select mode", action: "select" },
      { label: "✋", title: "Pan (Space)", ariaLabel: "Pan mode", action: "pan" },
    ];
    for (var mi = 0; mi < modeDefs.length; mi++) {
      var mbtn = document.createElement("button");
      mbtn.type = "button";
      mbtn.textContent = modeDefs[mi].label;
      mbtn.title = modeDefs[mi].title;
      mbtn.setAttribute("aria-label", modeDefs[mi].ariaLabel);
      mbtn.setAttribute("data-mode-action", modeDefs[mi].action);
      mbtn.setAttribute("aria-pressed", modeDefs[mi].action === "select" ? "true" : "false");
      zoomToolbar.appendChild(mbtn);
    }
    var sep = document.createElement("span");
    sep.className = "zoom-toolbar-sep";
    zoomToolbar.appendChild(sep);
    const defs = [
      { label: "Fit", action: "fit" },
      { label: "100%", action: "reset" },
      { label: "-", action: "out" },
      { label: "+", action: "in" },
    ];
    for (let i = 0; i < defs.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = defs[i].label;
      btn.setAttribute("data-zoom-action", defs[i].action);
      zoomToolbar.appendChild(btn);
    }
    zoomReadout = document.createElement("span");
    zoomReadout.className = "zoom-readout";
    zoomReadout.textContent = "100%";
    zoomToolbar.appendChild(zoomReadout);
    document.body.appendChild(zoomToolbar);
    zoomToolbar.addEventListener("click", (ev) => {
      var modeTarget = ev.target instanceof Element ? ev.target.closest("button[data-mode-action]") : null;
      if (modeTarget) {
        var mode = modeTarget.getAttribute("data-mode-action");
        if (mode) {
          clearTemporaryPanState();
          setInteractionMode(mode);
        }
        return;
      }
      const target = ev.target instanceof Element ? ev.target.closest("button[data-zoom-action]") : null;
      if (!target) return;
      const action = target.getAttribute("data-zoom-action");
      if (action === "fit") fitZoom();
      else if (action === "reset") setZoom(1, ZOOM_MAX_MANUAL);
      else if (action === "in") setZoom(camera.zoom + ZOOM_STEP, ZOOM_MAX_MANUAL);
      else if (action === "out") setZoom(camera.zoom - ZOOM_STEP, ZOOM_MAX_MANUAL);
    });
    // Plain wheel pans the canvas; Ctrl/Cmd + wheel zooms at pointer.
    viewport.addEventListener(
      "wheel",
      function (ev) {
        if (!ev.ctrlKey && !ev.metaKey) {
          camera.x -= ev.deltaX;
          camera.y -= ev.deltaY;
          applyCameraTransform();
          return;
        }
        ev.preventDefault();
        var direction = ev.deltaY > 0 ? -1 : 1;
        zoomAtPoint(camera.zoom + direction * ZOOM_STEP, ev.clientX, ev.clientY);
      },
      { passive: false },
    );
    viewport.addEventListener("mousedown", function (ev) {
      if (interactionMode !== "pan") return;
      if (ev.button !== 0) return;
      ev.preventDefault();
      var startX = ev.clientX;
      var startY = ev.clientY;
      var camStartX = camera.x;
      var camStartY = camera.y;
      viewport.setAttribute("data-panning", "true");
      function onMove(e) {
        e.preventDefault();
        camera.x = camStartX + (e.clientX - startX);
        camera.y = camStartY + (e.clientY - startY);
        applyCameraTransform();
      }
      function onUp() {
        viewport.removeAttribute("data-panning");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("blur", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", onUp);
    });
    setInteractionMode("select");
    applyCameraTransform();
  }

  // -- Pointer-to-canvas coordinate helper -------------------------------
  // Single source of truth for converting a pointer event's clientX/clientY
  // to coordinates inside the given section's local canvas space. Uses the
  // camera-aware screenToWorld helper to convert to world coordinates, then
  // subtracts the section's world-space origin. Returning null on missing
  // section is a loud signal — callers should bail out, not guess.
  function pointerToCanvas(event, sectionEl) {
    if (!sectionEl || typeof event.clientX !== "number") return null;
    var world = screenToWorld(event.clientX, event.clientY);
    var sectionRect = sectionEl.getBoundingClientRect();
    var sectionWorld = screenToWorld(sectionRect.left, sectionRect.top);
    return {
      x: world.x - sectionWorld.x,
      y: world.y - sectionWorld.y,
    };
  }

  function isEditableShortcutTarget(target) {
    if (!(target instanceof Element)) return false;
    var control = target.closest("input, textarea, select, button");
    if (control) return true;
    var editable = target.closest("[contenteditable]");
    if (!editable) return false;
    return editable.getAttribute("contenteditable") !== "false";
  }

  function setInteractionMode(mode) {
    if (mode !== "select" && mode !== "pan") {
      throw new Error("setInteractionMode: expected select or pan, got " + String(mode));
    }
    interactionMode = mode;
    if (viewport) {
      viewport.setAttribute("data-interaction-mode", mode);
    }
    if (zoomToolbar) {
      var btns = zoomToolbar.querySelectorAll("[data-mode-action]");
      for (var i = 0; i < btns.length; i++) {
        btns[i].setAttribute("aria-pressed",
          btns[i].getAttribute("data-mode-action") === mode ? "true" : "false");
      }
    }
  }

  function clearTemporaryPanState() {
    spaceHeldForPan = false;
    temporaryPanPreviousMode = null;
  }

  function endTemporaryPan() {
    if (!spaceHeldForPan) return;
    var nextMode = temporaryPanPreviousMode || "select";
    clearTemporaryPanState();
    setInteractionMode(nextMode);
  }

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = "";
    if (tone === "error") statusEl.classList.add("error");
    if (tone === "ok") statusEl.classList.add("ok");
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (statusEl.textContent === text) {
        // Idle default is "Saved" — every mutation goes through scheduleSave,
        // so once the toast fades we're back in the synced/saved baseline.
        // The presence pill in the header carries viewer count separately.
        statusEl.textContent = "Saved";
        statusEl.className = "";
      }
    }, 4000);
  }

  // -- Save-busy + session-expired handling ------------------------------
  // The server returns 401 JSON for every /api/* path when the Clerk session
  // expires mid-edit (see src/auth/require-auth.ts). authFetch is the single
  // place we detect that — every Owner-gated /api/* call routes through it
  // and a 401 trips handleSessionExpired once, locks the editor, and reloads
  // the page after a short grace so Clerk's handshake fires fresh.
  //
  // 403 means the user is authenticated but no longer authorized for this
  // site — typically a collaborator the Owner just revoked. That can't be
  // healed by a Clerk handshake reload (the new session would 403 just the
  // same), so handleAccessRevoked shows a locked-down "Access removed"
  // modal and offers a dashboard link instead of reloading.
  let saveBusy = false;
  let sessionExpired = false;
  let accessRevoked = false;
  function setSaveBusy(busy) {
    saveBusy = busy || sessionExpired || accessRevoked;
    if (saveButton) saveButton.disabled = saveBusy;
  }
  function handleSessionExpired() {
    if (sessionExpired) return;
    sessionExpired = true;
    setStatus("Session expired — reloading…", "error");
    // Lock every mutating control. Reload happens in ~1.5s; idempotent so
    // multiple in-flight 401s collapse into a single reload.
    setSaveBusy(true);
    setAiBusy(true);
    if (publishButton) publishButton.disabled = true;
    setTimeout(() => { location.reload(); }, 1500);
  }
  function handleAccessRevoked() {
    if (accessRevoked) return;
    accessRevoked = true;
    setStatus("Access removed", "error");
    // Lock every mutating control. Unlike sessionExpired we do not auto-
    // reload — the user's Clerk session is still valid for other sites,
    // so a reload would just put them on the same editor with another
    // 403. The modal CTAs let them navigate away on their own terms.
    setSaveBusy(true);
    setAiBusy(true);
    if (publishButton) publishButton.disabled = true;
    showAccessRemovedModal();
  }
  function showAccessRemovedModal() {
    if (document.querySelector("[data-opencanvas-access-removed]")) return;
    var backdrop = document.createElement("div");
    backdrop.className = "opencanvas-modal-backdrop";
    backdrop.setAttribute("data-opencanvas-access-removed", "true");
    var panel = document.createElement("div");
    panel.className = "opencanvas-modal";
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "opencanvas-access-removed-title");

    var title = document.createElement("h3");
    title.id = "opencanvas-access-removed-title";
    title.textContent = "Access removed";
    panel.appendChild(title);

    var body = document.createElement("p");
    body.textContent =
      "This site is no longer shared with you. Unsaved changes since your last successful save are lost. Sign out and back in to other shared sites if you need to verify which still grant you access.";
    body.style.margin = "8px 0 16px";
    panel.appendChild(body);

    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    var dashLink = document.createElement("a");
    dashLink.href = "/dashboard";
    dashLink.textContent = "Back to dashboard";
    dashLink.style.padding = "8px 14px";
    dashLink.style.borderRadius = "6px";
    dashLink.style.background = "#111";
    dashLink.style.color = "#fff";
    dashLink.style.textDecoration = "none";
    dashLink.style.fontWeight = "600";
    actions.appendChild(dashLink);

    panel.appendChild(actions);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    document.body.classList.add("opencanvas-modal-open");

    // Trap keyboard shortcuts so Ctrl+Z / Ctrl+S can't still mutate the
    // (now read-only-server) canvas while the modal is up. capture-phase
    // listener stops the events before the editor's window-level handler
    // sees them.
    function trap(e) {
      e.stopPropagation();
    }
    backdrop.addEventListener("keydown", trap, true);
    // Focus the only CTA so keyboard users land on it immediately.
    setTimeout(function() { dashLink.focus(); }, 0);
  }
  async function authFetch(input, init) {
    const response = await fetch(input, init);
    if (response.status === 401) {
      handleSessionExpired();
      throw new Error("session expired");
    }
    if (response.status === 403) {
      handleAccessRevoked();
      throw new Error("access revoked");
    }
    return response;
  }

  // -- Modal overlay (text + select) -------------------------------------
  // Single-modal stack: calling
  // openTextModal/openSelectModal while another is open throws loud so we
  // don't silently hide one behind another. Escape and backdrop click
  // resolve to null; Enter submits single-line; Ctrl/Cmd+Enter submits
  // multiline.
  let modalOpen = false;
  function openTextModal(opts) {
    if (modalOpen) {
      throw new Error("openTextModal: another modal is already open");
    }
    const title = typeof opts.title === "string" ? opts.title : "";
    const label = typeof opts.label === "string" ? opts.label : "";
    const defaultValue = typeof opts.defaultValue === "string" ? opts.defaultValue : "";
    const placeholder = typeof opts.placeholder === "string" ? opts.placeholder : "";
    const multiline = opts.multiline === true;
    modalOpen = true;
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      const panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      if (title) panel.setAttribute("aria-label", title);

      if (title) {
        const h = document.createElement("h3");
        h.textContent = title;
        panel.appendChild(h);
      }
      const lbl = document.createElement("label");
      lbl.textContent = label;
      panel.appendChild(lbl);

      const input = multiline ? document.createElement("textarea") : document.createElement("input");
      if (!multiline) input.type = "text";
      input.value = defaultValue;
      input.placeholder = placeholder;
      if (multiline) input.rows = 4;
      panel.appendChild(input);

      const actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "OK";
      actions.appendChild(cancel);
      actions.appendChild(ok);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      function close(value) {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          close(null);
          return;
        }
        if (ev.key === "Enter") {
          if (multiline) {
            if (ev.ctrlKey || ev.metaKey) {
              ev.preventDefault();
              ev.stopPropagation();
              close(input.value);
            }
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          close(input.value);
        }
      }
      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop) close(null);
      });
      cancel.addEventListener("click", () => close(null));
      ok.addEventListener("click", () => close(input.value));
      document.addEventListener("keydown", onKey, true);

      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      // Autofocus after mount so the input is ready to type.
      input.focus();
      if (typeof input.select === "function") input.select();
    });
  }

  function openSelectModal(opts) {
    if (modalOpen) {
      throw new Error("openSelectModal: another modal is already open");
    }
    const title = typeof opts.title === "string" ? opts.title : "";
    const label = typeof opts.label === "string" ? opts.label : "";
    const options = Array.isArray(opts.options) ? opts.options : [];
    const defaultValue = typeof opts.defaultValue === "string" ? opts.defaultValue : "";
    modalOpen = true;
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      const panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      if (title) panel.setAttribute("aria-label", title);

      if (title) {
        const h = document.createElement("h3");
        h.textContent = title;
        panel.appendChild(h);
      }
      const lbl = document.createElement("label");
      lbl.textContent = label;
      panel.appendChild(lbl);

      const select = document.createElement("select");
      let matched = false;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (!opt || typeof opt.value !== "string") continue;
        const optEl = document.createElement("option");
        optEl.value = opt.value;
        optEl.textContent = typeof opt.label === "string" ? opt.label : opt.value;
        if (opt.value === defaultValue) {
          optEl.selected = true;
          matched = true;
        }
        select.appendChild(optEl);
      }
      if (!matched && options.length > 0) {
        select.selectedIndex = 0;
      }
      panel.appendChild(select);

      const actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "OK";
      actions.appendChild(cancel);
      actions.appendChild(ok);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      function close(value) {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          close(null);
          return;
        }
        if (ev.key === "Enter") {
          ev.preventDefault();
          ev.stopPropagation();
          close(select.value);
        }
      }
      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop) close(null);
      });
      cancel.addEventListener("click", () => close(null));
      ok.addEventListener("click", () => close(select.value));
      document.addEventListener("keydown", onKey, true);

      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      select.focus();
    });
  }

  function openConfirmModal(opts) {
    if (modalOpen) {
      throw new Error("openConfirmModal: another modal is already open");
    }
    var title = typeof opts.title === "string" ? opts.title : "";
    var message = typeof opts.message === "string" ? opts.message : "";
    var confirmLabel = typeof opts.confirmLabel === "string" ? opts.confirmLabel : "OK";
    var cancelLabel = typeof opts.cancelLabel === "string" ? opts.cancelLabel : "Cancel";
    var danger = opts.danger === true;
    modalOpen = true;
    return new Promise(function(resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      var panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      if (title) panel.setAttribute("aria-label", title);
      if (title) {
        var h = document.createElement("h3");
        h.textContent = title;
        panel.appendChild(h);
      }
      var p = document.createElement("p");
      p.style.cssText = "margin:0 0 14px;font-size:13px;color:var(--opencanvas-fg-mute);line-height:1.5;white-space:pre-line";
      p.textContent = message;
      panel.appendChild(p);
      var actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = cancelLabel;
      var ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = confirmLabel;
      if (danger) { ok.style.background = "#ef4444"; ok.style.borderColor = "#ef4444"; ok.style.color = "#fff"; }
      actions.appendChild(cancel);
      actions.appendChild(ok);
      panel.appendChild(actions);
      backdrop.appendChild(panel);
      function close(value) {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(false); return; }
        if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); close(true); }
      }
      backdrop.addEventListener("click", function(ev) { if (ev.target === backdrop) close(false); });
      cancel.addEventListener("click", function() { close(false); });
      ok.addEventListener("click", function() { close(true); });
      document.addEventListener("keydown", onKey, true);
      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      ok.focus();
    });
  }

  // AI media modal: prompt textarea + aspect-ratio radio row + 4-up preview
  // gallery. requestFn(prompt, aspectRatio) is called four times in
  // parallel when the Owner clicks "Generate with AI"; each promise resolves
  // to { blob, mediaType }. Picking a tile resolves the outer promise with
  // { blob, mediaType, aspectRatio, prompt }. Cancel resolves with null.
  // Aspect picker offers 1:1, 16:9, 4:3, 9:16 — the existing single-shot
  // path snapped boxW/boxH to a Flux preset; this modal hands control to
  // the Owner instead.
  function openAiMediaModal(opts) {
    if (modalOpen) {
      throw new Error("openAiMediaModal: another modal is already open");
    }
    var title = typeof opts.title === "string" ? opts.title : "AI media";
    var defaultPrompt = typeof opts.defaultPrompt === "string" ? opts.defaultPrompt : "";
    var requestFn = typeof opts.requestFn === "function" ? opts.requestFn : null;
    if (!requestFn) {
      throw new Error("openAiMediaModal: requestFn is required");
    }
    var aspectOptions = [
      { label: "1:1", value: "1:1" },
      { label: "16:9", value: "16:9" },
      { label: "4:3", value: "4:3" },
      { label: "9:16", value: "9:16" }
    ];
    var defaultAspect = typeof opts.defaultAspect === "string" ? opts.defaultAspect : "1:1";
    var selectedAspect = defaultAspect;
    modalOpen = true;
    return new Promise(function(resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      var panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", title);
      panel.style.minWidth = "440px";
      panel.style.maxWidth = "560px";

      var h = document.createElement("h3");
      h.textContent = title;
      panel.appendChild(h);

      var promptLabel = document.createElement("label");
      promptLabel.textContent = "Describe the image";
      panel.appendChild(promptLabel);
      var promptInput = document.createElement("textarea");
      promptInput.rows = 3;
      promptInput.placeholder = "Sunset over ocean";
      promptInput.value = defaultPrompt;
      panel.appendChild(promptInput);

      var aspectLabel = document.createElement("label");
      aspectLabel.textContent = "Aspect ratio";
      panel.appendChild(aspectLabel);

      var aspectRow = document.createElement("div");
      aspectRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
      var aspectButtons = [];
      function paintAspect() {
        for (var i = 0; i < aspectButtons.length; i++) {
          var b = aspectButtons[i];
          var on = b.getAttribute("data-aspect") === selectedAspect;
          b.style.background = on ? "var(--red)" : "var(--surface)";
          b.style.color = on ? "#fff" : "var(--ink-2)";
          b.style.borderColor = on ? "var(--red)" : "var(--line-2)";
          b.setAttribute("aria-pressed", on ? "true" : "false");
        }
      }
      for (var ai = 0; ai < aspectOptions.length; ai++) {
        (function(option) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = option.label;
          btn.setAttribute("data-aspect", option.value);
          btn.setAttribute("role", "radio");
          btn.style.cssText =
            "appearance:none;font:inherit;font-family:var(--sans);font-weight:650;" +
            "font-size:13px;padding:7px 14px;border-radius:var(--r-pill);cursor:pointer;" +
            "background:var(--surface);border:1.5px solid var(--line-2);color:var(--ink-2);" +
            "transition:border-color .15s,background-color .15s,color .15s;";
          btn.addEventListener("click", function() {
            selectedAspect = option.value;
            paintAspect();
          });
          aspectButtons.push(btn);
          aspectRow.appendChild(btn);
        })(aspectOptions[ai]);
      }
      paintAspect();
      panel.appendChild(aspectRow);

      // Generate row: button + status line.
      var genRow = document.createElement("div");
      genRow.style.cssText = "display:flex;gap:10px;align-items:center;margin-top:4px;";
      var genBtn = document.createElement("button");
      genBtn.type = "button";
      genBtn.textContent = "Generate with AI";
      genBtn.style.cssText =
        "appearance:none;font:inherit;font-family:var(--sans);font-weight:650;font-size:13.5px;" +
        "padding:9px 18px;border-radius:var(--r-pill);cursor:pointer;background:var(--red);" +
        "border:1.5px solid var(--red);color:#fff;box-shadow:var(--shadow-red);transition:background-color .15s,transform .12s;";
      var genStatus = document.createElement("span");
      genStatus.style.cssText = "font-size:12.5px;color:var(--ink-3);";
      genRow.appendChild(genBtn);
      genRow.appendChild(genStatus);
      panel.appendChild(genRow);

      // 4-up gallery host — hidden until the first generate fires.
      var galleryLabel = document.createElement("label");
      galleryLabel.textContent = "Pick one";
      galleryLabel.style.display = "none";
      panel.appendChild(galleryLabel);
      var gallery = document.createElement("div");
      gallery.style.cssText =
        "display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;margin-top:4px;";
      panel.appendChild(gallery);

      // Tile object URLs we need to revoke on close (whether by cancel or
      // by pick — we keep only the chosen one alive via a fresh URL on the
      // resolver side and let the caller manage it).
      var liveTiles = [];
      function clearGallery() {
        for (var t = 0; t < liveTiles.length; t++) {
          var u = liveTiles[t];
          if (u) URL.revokeObjectURL(u);
        }
        liveTiles = [];
        while (gallery.firstChild) gallery.removeChild(gallery.firstChild);
        galleryLabel.style.display = "none";
      }

      function makeTile(index, payload, promptText, aspect) {
        var url = URL.createObjectURL(payload.blob);
        liveTiles[index] = url;
        var tile = document.createElement("button");
        tile.type = "button";
        tile.style.cssText =
          "appearance:none;padding:0;border:2px solid var(--line-2);border-radius:var(--r-sm);" +
          "overflow:hidden;cursor:pointer;background:var(--surface);transition:border-color .15s,transform .12s;";
        tile.addEventListener("mouseenter", function() { tile.style.borderColor = "var(--red)"; });
        tile.addEventListener("mouseleave", function() { tile.style.borderColor = "var(--line-2)"; });
        var img = document.createElement("img");
        img.src = url;
        img.alt = "AI preview " + (index + 1);
        img.style.cssText = "display:block;width:100%;height:auto;";
        tile.appendChild(img);
        tile.addEventListener("click", function() {
          // Hand the chosen blob back to the caller. The tile URL is only for
          // this modal; the preview flow creates and owns its own object URL.
          close({
            blob: payload.blob,
            mediaType: payload.mediaType,
            aspectRatio: aspect,
            prompt: promptText
          });
        });
        gallery.appendChild(tile);
      }

      function makeFailureTile(index, err) {
        var tile = document.createElement("div");
        tile.style.cssText =
          "border:1.5px dashed var(--line-2);border-radius:var(--r-sm);padding:14px;" +
          "display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--red-ink);" +
          "min-height:80px;text-align:center;";
        tile.textContent = "Failed: " + (err && err.message ? err.message : String(err));
        gallery.appendChild(tile);
      }

      var generating = false;
      var closed = false;
      genBtn.addEventListener("click", function() {
        if (generating) return;
        var promptText = promptInput.value.trim();
        if (promptText.length === 0) {
          genStatus.textContent = "Enter a prompt first";
          genStatus.style.color = "var(--red-ink)";
          promptInput.focus();
          return;
        }
        generating = true;
        genBtn.disabled = true;
        var prev = genBtn.textContent;
        genBtn.textContent = "Generating...";
        genStatus.textContent = "Asking the model for 4 previews";
        genStatus.style.color = "var(--ink-3)";
        clearGallery();
        galleryLabel.style.display = "";

        var aspectAtRequest = selectedAspect;
        var calls = [];
        for (var i = 0; i < 4; i++) {
          calls.push(requestFn(promptText, aspectAtRequest));
        }
        Promise.all(calls.map(function(p) {
          return p.then(
            function(r) { return { ok: true, value: r }; },
            function(e) { return { ok: false, error: e }; }
          );
        })).then(function(results) {
          if (closed) return;
          generating = false;
          genBtn.disabled = false;
          genBtn.textContent = prev;
          var okCount = 0;
          for (var i = 0; i < results.length; i++) {
            var r = results[i];
            if (r.ok) {
              makeTile(i, r.value, promptText, aspectAtRequest);
              okCount++;
            } else {
              makeFailureTile(i, r.error);
            }
          }
          if (okCount === 0) {
            genStatus.textContent = "All previews failed";
            genStatus.style.color = "var(--red-ink)";
          } else if (okCount < 4) {
            genStatus.textContent = okCount + " of 4 previews ready";
            genStatus.style.color = "var(--ink-3)";
          } else {
            genStatus.textContent = "Pick one to apply";
            genStatus.style.color = "var(--ink-3)";
          }
        });
      });

      var actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      actions.appendChild(cancel);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      function close(value) {
        if (closed) return;
        closed = true;
        document.removeEventListener("keydown", onKey, true);
        clearGallery();
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          close(null);
        }
      }
      backdrop.addEventListener("click", function(ev) {
        if (ev.target === backdrop) close(null);
      });
      cancel.addEventListener("click", function() { close(null); });
      document.addEventListener("keydown", onKey, true);

      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      promptInput.focus();
    });
  }

  // Modal for the "+ New Page" flow (ADR 0034). Collects title, slug,
  // and locale up front so the new page lands fully-formed instead of
  // the previous instant-create flow that named the page "Page N" and
  // forced a rename + SEO panel trip. Resolves to {title, slug, locale}
  // on submit or null on cancel. Slug auto-derives from title and
  // freezes on first manual slug edit (re-arms on slug clear). Locale
  // dropdown carries the top-10 BCP-47 tags + "Site default" + an
  // "Other..." escape that reveals a raw-tag text input. Reserved-slug
  // pre-validation blocks the reserved _404 / 404 slugs; duplicate-slug pre-validation
  // blocks any slug already taken on the site.
  function openNewPageModal(opts) {
    if (modalOpen) {
      throw new Error("openNewPageModal: another modal is already open");
    }
    var existingSlugs = opts && Array.isArray(opts.existingSlugs) ? opts.existingSlugs : [];
    modalOpen = true;
    return new Promise(function(resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      var panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Create new page");

      var h = document.createElement("h3");
      h.textContent = "New page";
      panel.appendChild(h);

      // -- Title ---------------------------------------------------------
      var titleLabel = document.createElement("label");
      titleLabel.textContent = "Title";
      panel.appendChild(titleLabel);
      var titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.placeholder = "About us";
      panel.appendChild(titleInput);

      // -- Slug ----------------------------------------------------------
      var slugLabel = document.createElement("label");
      slugLabel.textContent = "Slug";
      panel.appendChild(slugLabel);
      var slugInput = document.createElement("input");
      slugInput.type = "text";
      slugInput.placeholder = "about-us";
      panel.appendChild(slugInput);
      var slugHint = document.createElement("div");
      slugHint.style.cssText = "font-size:11px;color:var(--opencanvas-fg-mute);margin:-6px 0 8px";
      slugHint.textContent = "Auto-derived from title. Edit to override; clear to re-link.";
      panel.appendChild(slugHint);

      // -- Locale --------------------------------------------------------
      var localeLabel = document.createElement("label");
      localeLabel.textContent = "Locale";
      panel.appendChild(localeLabel);
      var localeSel = document.createElement("select");
      var localeOptions = [
        { value: "", label: "Site default" },
        { value: "en", label: "en (English)" },
        { value: "ar", label: "ar (Arabic)" },
        { value: "ja", label: "ja (Japanese)" },
        { value: "zh-CN", label: "zh-CN (Chinese simplified)" },
        { value: "es", label: "es (Spanish)" },
        { value: "fr", label: "fr (French)" },
        { value: "de", label: "de (German)" },
        { value: "pt", label: "pt (Portuguese)" },
        { value: "ru", label: "ru (Russian)" },
        { value: "hi", label: "hi (Hindi)" },
        { value: "__other__", label: "Other (type BCP-47 tag)" },
      ];
      for (var i = 0; i < localeOptions.length; i++) {
        var localeOpt = document.createElement("option");
        localeOpt.value = localeOptions[i].value;
        localeOpt.textContent = localeOptions[i].label;
        localeSel.appendChild(localeOpt);
      }
      panel.appendChild(localeSel);
      var otherLocaleInput = document.createElement("input");
      otherLocaleInput.type = "text";
      otherLocaleInput.placeholder = "e.g. en-GB or fr-CA";
      otherLocaleInput.style.cssText = "margin-top:6px;display:none";
      panel.appendChild(otherLocaleInput);
      localeSel.addEventListener("change", function() {
        otherLocaleInput.style.display = localeSel.value === "__other__" ? "block" : "none";
        if (localeSel.value === "__other__") otherLocaleInput.focus();
      });

      // -- Inline error + actions ---------------------------------------
      var errorLine = document.createElement("div");
      errorLine.style.cssText = "min-height:18px;font-size:12px;color:#ef4444;margin:8px 0";
      panel.appendChild(errorLine);

      var actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      var ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "Create";
      actions.appendChild(cancel);
      actions.appendChild(ok);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      // -- Slug auto-derive + freeze/re-arm logic -----------------------
      var slugManuallyEdited = false;
      function slugify(str) {
        var s = str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return s.length === 0 ? "page" : s;
      }
      titleInput.addEventListener("input", function() {
        if (!slugManuallyEdited) {
          slugInput.value = slugify(titleInput.value);
          validate();
        }
      });
      slugInput.addEventListener("input", function() {
        if (slugInput.value.length === 0) {
          slugManuallyEdited = false;
          slugInput.value = slugify(titleInput.value);
        } else {
          slugManuallyEdited = true;
        }
        validate();
      });

      function validate() {
        var title = titleInput.value.trim();
        var slug = slugInput.value.trim();
        if (title.length === 0) { errorLine.textContent = "Title is required."; ok.disabled = true; return; }
        if (slug.length === 0) { errorLine.textContent = "Slug is required."; ok.disabled = true; return; }
        if (slug === "_404" || slug === "404") {
          errorLine.textContent = "Slug '" + slug + "' is reserved for the custom 404 page (toggle in the page inspector after create).";
          ok.disabled = true;
          return;
        }
        if (existingSlugs.indexOf(slug) !== -1) {
          errorLine.textContent = "Slug '" + slug + "' is already used by another page on this site.";
          ok.disabled = true;
          return;
        }
        errorLine.textContent = "";
        ok.disabled = false;
      }

      function close(value) {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(value);
      }
      function onKey(ev) {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(null); return; }
        if (ev.key === "Enter" && !ok.disabled) {
          // Ignore Enter from the "Other locale" input so the user can
          // type a tag containing whitespace handling without
          // accidentally submitting.
          if (document.activeElement === otherLocaleInput) return;
          ev.preventDefault();
          ev.stopPropagation();
          submit();
        }
      }
      function submit() {
        var locale;
        if (localeSel.value === "") locale = null;
        else if (localeSel.value === "__other__") {
          var custom = otherLocaleInput.value.trim();
          locale = custom.length > 0 ? custom : null;
        } else {
          locale = localeSel.value;
        }
        close({
          title: titleInput.value.trim(),
          slug: slugInput.value.trim(),
          locale: locale,
        });
      }
      backdrop.addEventListener("click", function(ev) { if (ev.target === backdrop) close(null); });
      cancel.addEventListener("click", function() { close(null); });
      ok.addEventListener("click", submit);
      document.addEventListener("keydown", onKey, true);

      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      titleInput.focus();
      // Start in disabled state; validate runs after the first input.
      ok.disabled = true;
      validate();
    });
  }

  function openAlertModal(opts) {
    if (modalOpen) {
      throw new Error("openAlertModal: another modal is already open");
    }
    var title = typeof opts.title === "string" ? opts.title : "";
    var message = typeof opts.message === "string" ? opts.message : "";
    modalOpen = true;
    return new Promise(function(resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "opencanvas-modal-backdrop";
      var panel = document.createElement("div");
      panel.className = "opencanvas-modal";
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-modal", "true");
      if (title) panel.setAttribute("aria-label", title);
      if (title) {
        var h = document.createElement("h3");
        h.textContent = title;
        panel.appendChild(h);
      }
      var p = document.createElement("p");
      p.style.cssText = "margin:0 0 14px;font-size:13px;color:var(--opencanvas-fg-mute);line-height:1.5";
      p.textContent = message;
      panel.appendChild(p);
      var actions = document.createElement("div");
      actions.className = "opencanvas-modal-actions";
      var ok = document.createElement("button");
      ok.type = "button";
      ok.textContent = "OK";
      actions.appendChild(ok);
      panel.appendChild(actions);
      backdrop.appendChild(panel);
      function close() {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove("opencanvas-modal-open");
        modalOpen = false;
        resolve(undefined);
      }
      function onKey(ev) {
        if (ev.key === "Escape" || ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); close(); }
      }
      backdrop.addEventListener("click", function(ev) { if (ev.target === backdrop) close(); });
      ok.addEventListener("click", close);
      document.addEventListener("keydown", onKey, true);
      document.body.classList.add("opencanvas-modal-open");
      document.body.appendChild(backdrop);
      ok.focus();
    });
  }

  window.__opencanvasModal = {
    confirm: function(msg, opts) { var o = opts || {}; return openConfirmModal({ title: o.title || "", message: msg, confirmLabel: o.confirmLabel, danger: o.danger }); },
    alert: function(msg, title) { return openAlertModal({ title: title || "", message: msg }); },
    prompt: function(title, label, def) { return openTextModal({ title: title || "", label: label || "", defaultValue: def || "" }); }
  };

  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    throw new Error("crypto.randomUUID is required for editor id generation");
  }

  function newElementId() { return "el-" + uuid(); }
  function newSectionId() { return "sec-" + uuid(); }
  function newPageId() { return "page-" + uuid(); }

  function currentPage() {
    if (!state || !Array.isArray(state.pages) || state.pages.length === 0) return null;
    if (activePageId) {
      for (var i = 0; i < state.pages.length; i++) {
        if (state.pages[i].id === activePageId) return state.pages[i];
      }
    }
    return state.pages[0];
  }

  function setActivePage(pageId) {
    activePageId = pageId;
    selectedSectionId = null;
    selectedElementId = null;
    renderInspector();
    renderReel();
    renderSidebarSelection();

    updatePageSidebar();
    if (root) {
      var artboards = root.querySelectorAll(".opencanvas-artboard");
      for (var i = 0; i < artboards.length; i++) {
        var isActive = artboards[i].getAttribute("data-page-id") === pageId;
        artboards[i].setAttribute("data-active", isActive ? "true" : "false");
      }
    }
    refreshPageCrumb();
  }

  // -- Breadcrumb page chip + page switcher dropdown ----------------------
  // The header crumb renders 'Open Canvas / dashboard / {siteName} / {page}'.
  // The page chip is a button — clicking it opens a popover listing every
  // page in the site; picking one calls setActivePage. The label text is
  // refreshed inside setActivePage so it always reflects activePageId.
  var pageCrumbMenu = null;

  function refreshPageCrumb() {
    var label = document.querySelector("[data-page-crumb-label]");
    if (!label) return;
    var page = currentPage();
    if (page) {
      label.textContent = page.title || page.slug || "page";
    } else {
      label.textContent = "page";
    }
  }

  function closePageCrumbMenu() {
    if (!pageCrumbMenu) return;
    if (pageCrumbMenu.parentNode) pageCrumbMenu.parentNode.removeChild(pageCrumbMenu);
    pageCrumbMenu = null;
    var btn = document.getElementById("canvas-page-crumb");
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onPageCrumbOutside, true);
    document.removeEventListener("keydown", onPageCrumbKey, true);
  }

  function onPageCrumbOutside(ev) {
    var target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (pageCrumbMenu && pageCrumbMenu.contains(target)) return;
    if (target.closest("#canvas-page-crumb")) return;
    closePageCrumbMenu();
  }

  function onPageCrumbKey(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closePageCrumbMenu();
    }
  }

  function openPageCrumbMenu() {
    if (pageCrumbMenu) { closePageCrumbMenu(); return; }
    if (!state || !Array.isArray(state.pages) || state.pages.length === 0) return;
    var btn = document.getElementById("canvas-page-crumb");
    if (!btn) return;
    var menu = document.createElement("div");
    menu.className = "opencanvas-crumb-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Pages");
    for (var i = 0; i < state.pages.length; i++) {
      (function (p) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "opencanvas-crumb-menu-item";
        item.setAttribute("role", "menuitem");
        if (p.id === activePageId) item.classList.add("active");
        var title = document.createElement("span");
        title.className = "opencanvas-crumb-menu-title";
        title.textContent = p.title || p.slug || "page";
        var slug = document.createElement("span");
        slug.className = "opencanvas-crumb-menu-slug";
        slug.textContent = "/" + (p.slug || "");
        item.appendChild(title);
        item.appendChild(slug);
        item.addEventListener("click", function () {
          closePageCrumbMenu();
          setActivePage(p.id);
        });
        menu.appendChild(item);
      })(state.pages[i]);
    }
    document.body.appendChild(menu);
    var rect = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (rect.bottom + 4) + "px";
    menu.style.left = Math.max(8, rect.left) + "px";
    menu.style.minWidth = Math.max(200, rect.width) + "px";
    pageCrumbMenu = menu;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onPageCrumbOutside, true);
    document.addEventListener("keydown", onPageCrumbKey, true);
  }

  function attachPageCrumb() {
    var btn = document.getElementById("canvas-page-crumb");
    if (!btn) return;
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      openPageCrumbMenu();
    });
    refreshPageCrumb();
  }

  // Resolve a string href (e.g. "/about", "/about#hero", "about") to a Canvas
  // Page in the current site state. Returns null when the href is not internal
  // or no page matches. Strips query + fragment so an Owner-stored "/about#x"
  // still resolves to the about page.
  function findPageByHref(href) {
    if (typeof href !== "string" || href.length === 0) return null;
    if (!state || !Array.isArray(state.pages)) return null;
    if (href.charAt(0) === "#") return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    var path = href.split("#")[0].split("?")[0];
    if (path.charAt(0) === "/") path = path.slice(1);
    while (path.length > 1 && path.charAt(path.length - 1) === "/") {
      path = path.slice(0, -1);
    }
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].slug === path) return state.pages[i];
    }
    return null;
  }

  // Drive editor navigation from a clicked link: internal pages switch the
  // active artboard, external/mailto/tel open in a new tab, anchors no-op
  // (the editor renders the full page; in-page anchors have no meaning here).
  // Returns true when something was handled, false when the href was rejected
  // by the allowlist — caller can surface a status message.
  function goToHrefOnCanvas(href) {
    var page = findPageByHref(href);
    if (page) { setActivePage(page.id); return true; }
    if (typeof href === "string" && href.charAt(0) === "#") return true;
    if (isAllowedHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    return false;
  }

  function updatePageSidebar() {
    var listEl = document.getElementById("canvas-page-list");
    if (!listEl || !state) return;
    listEl.replaceChildren();

    for (var i = 0; i < state.pages.length; i++) {
      var page = state.pages[i];
      var item = document.createElement("div");
      item.className = "opencanvas-page-item";
      item.setAttribute("data-page-id", page.id);
      item.setAttribute("data-active", page.id === activePageId ? "true" : "false");

      var title = document.createElement("span");
      title.className = "opencanvas-page-item-title";
      title.textContent = page.title;
      item.appendChild(title);

      var slug = document.createElement("span");
      slug.className = "opencanvas-page-item-slug";
      slug.textContent = "/" + page.slug;
      item.appendChild(slug);

      var actions = document.createElement("span");
      actions.className = "opencanvas-page-item-actions";

      var renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.textContent = "Rename";
      renameBtn.setAttribute("data-page-action", "rename");
      renameBtn.setAttribute("data-page-id", page.id);
      actions.appendChild(renameBtn);

      var seoLink = document.createElement("a");
      seoLink.textContent = "SEO";
      seoLink.href = "/dashboard/sites/" + SITE_ID + "/pages/" + page.id + "/seo";
      seoLink.target = "_blank";
      seoLink.className = "opencanvas-page-seo-link";
      actions.appendChild(seoLink);

      if (state.pages.length > 1) {
        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "Del";
        deleteBtn.setAttribute("data-page-action", "delete");
        deleteBtn.setAttribute("data-page-id", page.id);
        deleteBtn.setAttribute("data-danger", "true");
        actions.appendChild(deleteBtn);
      }

      item.appendChild(actions);
      listEl.appendChild(item);
    }
  }

  async function createPage() {
    if (!state) return;
    var result = await openNewPageModal({
      existingSlugs: state.pages.map(function(p) { return p.slug; }),
    });
    if (!result) return;
    var newPage = {
      id: newPageId(),
      slug: result.slug,
      title: result.title,
      width: DEFAULT_PAGE_WIDTH_PX,
      sections: [
        {
          id: newSectionId(),
          recipeId: "feature-grid",
          name: "Blank section",
          height: 640,
          elements: [],
        },
      ],
    };
    if (result.locale !== null) newPage.locale = result.locale;
    state.pages.push(newPage);
    captureForUndo();
    setActivePage(newPage.id);
    renderAll();
    fitToPage(newPage.id);
    scheduleSave();
    setStatus("Page created: " + newPage.title, "ok");
  }

  async function renamePage(pageId) {
    if (!state) return;
    var page = null;
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === pageId) { page = state.pages[i]; break; }
    }
    if (!page) return;
    var newTitle = await openTextModal({ title: "Rename page", label: "Page title", defaultValue: page.title });
    if (!newTitle || newTitle.trim().length === 0) return;
    newTitle = newTitle.trim();
    var newSlug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (newSlug.length === 0) newSlug = "page";
    // _404 is reserved for the optional custom 404 page (src/canvas/page-routing.ts).
    // 404 is what the normaliser produces when someone types '_404' as a title; block
    // both so the dedicated custom-404 flow stays the only way in.
    if (newSlug === "_404" || newSlug === "404") {
      setStatus("Slug '" + newSlug + "' is reserved for the custom 404 page", "error");
      return;
    }
    page.title = newTitle;
    var slugBase = newSlug;
    var counter = 2;
    while (state.pages.some(function(p) { return p.id !== pageId && p.slug === newSlug; })) {
      newSlug = slugBase + "-" + counter;
      counter++;
    }
    page.slug = newSlug;
    captureForUndo();
    renderAll();
    updatePageSidebar();
    scheduleSave();
    setStatus("Renamed to: " + newTitle, "ok");
  }

  function findActionPageLinkReferences(pageId) {
    var refs = [];
    function scanSection(section, label) {
      if (!section || !Array.isArray(section.elements)) return;
      for (var i = 0; i < section.elements.length; i++) {
        var el = section.elements[i];
        if (
          el.type === "action" &&
          el.href &&
          el.href.type === "page" &&
          el.href.pageId === pageId
        ) {
          refs.push(label + " / " + (el.label || el.id));
        }
      }
    }
    if (!state) return refs;
    for (var pageIdx = 0; pageIdx < state.pages.length; pageIdx++) {
      var page = state.pages[pageIdx];
      for (var sectionIdx = 0; sectionIdx < page.sections.length; sectionIdx++) {
        scanSection(
          page.sections[sectionIdx],
          page.title + " / " + page.sections[sectionIdx].name,
        );
      }
    }
    scanSection(state.header, "Header");
    scanSection(state.footer, "Footer");
    return refs;
  }

  async function deletePage(pageId) {
    if (!state || state.pages.length <= 1) return;
    var idx = -1;
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === pageId) { idx = i; break; }
    }
    if (idx < 0) return;
    var inboundPageLinks = findActionPageLinkReferences(pageId);
    if (inboundPageLinks.length > 0) {
      setStatus("Delete blocked: page is linked from " + inboundPageLinks[0], "error");
      return;
    }
    if (!await openConfirmModal({ title: "Delete page", message: 'Delete page "' + state.pages[idx].title + '"? This cannot be undone.', confirmLabel: "Delete", danger: true })) return;
    state.pages.splice(idx, 1);
    captureForUndo();
    if (activePageId === pageId) {
      activePageId = state.pages[0].id;
    }
    renderAll();
    updatePageSidebar();
    fitAllPages();
    scheduleSave();
    setStatus("Page deleted", "ok");
  }

  function findSection(sectionId) {
    if (state.header && state.header.id === sectionId) return state.header;
    if (state.footer && state.footer.id === sectionId) return state.footer;
    var page = currentPage();
    if (!page) return null;
    for (var si = 0; si < page.sections.length; si++) {
      if (page.sections[si].id === sectionId) return page.sections[si];
    }
    return null;
  }

  function findElement(elementId) {
    if (state.header) {
      for (var hi = 0; hi < state.header.elements.length; hi++) {
        if (state.header.elements[hi].id === elementId) return { section: state.header, element: state.header.elements[hi] };
      }
    }
    if (state.footer) {
      for (var fi = 0; fi < state.footer.elements.length; fi++) {
        if (state.footer.elements[fi].id === elementId) return { section: state.footer, element: state.footer.elements[fi] };
      }
    }
    var page = currentPage();
    if (!page) return null;
    for (var si = 0; si < page.sections.length; si++) {
      var section = page.sections[si];
      for (var ei = 0; ei < section.elements.length; ei++) {
        if (section.elements[ei].id === elementId) return { section: section, element: section.elements[ei] };
      }
    }
    return null;
  }

  async function persistStateSnapshot(snapshot) {
    if (accessRevoked || sessionExpired) return false;
    setStatus("Saving...");
    try {
      const response = await authFetch(SITE_BASE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editableState: snapshot }),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && Array.isArray(body.errors) && body.errors.length > 0) {
            detail = body.errors[0];
          } else if (body && body.error) {
            detail = body.error;
          }
        } catch (_) {
          // JSON parse can fail when the server returns an empty body or a
          // non-JSON 5xx page. We've already captured response.statusText into
          // detail above; this catch deliberately swallows the parse error so
          // the user-facing message stays the HTTP status text rather than a
          // confusing "SyntaxError" toast. The real save failure (the !ok
          // response itself) is the loud signal.
        }
        if (!accessRevoked && !sessionExpired) setStatus("Save failed: " + detail, "error");
        return false;
      }
      if (accessRevoked || sessionExpired) return false;
      setStatus("Saved", "ok");
      return true;
    } catch (err) {
      if (!accessRevoked && !sessionExpired) {
        setStatus("Save failed: " + (err && err.message ? err.message : String(err)), "error");
      }
      return false;
    }
  }

  async function saveStateNow() {
    if (!state) return true;
    const snapshot = structuredClone(state);
    const task = saveQueue.catch(() => false).then(() => persistStateSnapshot(snapshot));
    saveQueue = task;
    return task;
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const saved = await saveStateNow();
    if (!saved && !accessRevoked && !sessionExpired) {
      setStatus("Save failed; action stopped", "error");
    }
    return saved;
  }

  function scheduleSave() {
    captureForUndo();
    // Two save paths, picked by whether the Yjs co-edit channel is attached:
    //   1. coEditConnection present: every mutation projects into the Y.Doc
    //      and the DO autosaves to Postgres. Status reads "Synced".
    //   2. coEditConnection absent (boot before WS attach, or co-edit not
    //      enabled for this Owner): debounced 500ms HTTP PUT. Status reads
    //      "Saved" on success.
    var coEditSent = coEditSync();
    if (coEditConnection) {
      if (coEditSent) {
        setStatus("Synced", "ok");
      } else {
        setStatus("Co-edit disconnected; changes not saved", "error");
      }
      return;
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveStateNow();
    }, 500);
  }

  // -- Undo / Redo --------------------------------------------------------
  var undoStack = [];
  var redoStack = [];
  var undoTimer = null;
  var undoRedoing = false;
  var UNDO_MAX = 60;

  function initUndo() {
    if (state) undoStack.push(structuredClone(state));
  }

  function captureForUndo() {
    if (undoRedoing || !state) return;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(function() {
      undoTimer = null;
      flushPendingUndoCapture();
    }, 800);
  }

  function flushPendingUndoCapture() {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    if (!state) return;
    var snap = structuredClone(state);
    undoStack.push(snap);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    // Visible no-op feedback: the keyboard handler runs globally on window,
    // so Ctrl+Z fires regardless of which UI surface has focus. Without a
    // status flash, a no-op undo looks identical to a non-firing shortcut,
    // which reads as "Ctrl+Z only works when something is selected."
    if (!state) { setStatus("Nothing to undo"); return; }
    // Flush any pending debounced capture so a fast Ctrl+Z (e.g. delete →
    // immediate undo) sees the post-mutation state on the stack and can
    // pop back to the snapshot the next undo expects.
    if (undoTimer) flushPendingUndoCapture();
    if (undoStack.length <= 1) { setStatus("Nothing to undo"); return; }
    undoRedoing = true;
    redoStack.push(structuredClone(state));
    undoStack.pop();
    state = structuredClone(undoStack[undoStack.length - 1]);
    renderAll();
    scheduleSave();
    undoRedoing = false;
    setStatus("Undo", "ok");
  }

  function redo() {
    if (!state) { setStatus("Nothing to redo"); return; }
    if (undoTimer) flushPendingUndoCapture();
    if (redoStack.length === 0) { setStatus("Nothing to redo"); return; }
    undoRedoing = true;
    undoStack.push(structuredClone(state));
    state = structuredClone(redoStack.pop());
    renderAll();
    scheduleSave();
    undoRedoing = false;
    setStatus("Redo", "ok");
  }

  // -- Rendering ----------------------------------------------------------

  function setBoxStyle(wrapper, box) {
    wrapper.style.position = "absolute";
    wrapper.style.left = box.x + "px";
    wrapper.style.top = box.y + "px";
    wrapper.style.width = box.w + "px";
    wrapper.style.height = box.h + "px";
    wrapper.style.zIndex = String(box.z);
    if (typeof box.rotation === "number" && box.rotation !== 0) {
      wrapper.style.transform = "rotate(" + box.rotation + "deg)";
    } else {
      wrapper.style.transform = "";
    }
  }

  // Apply Owner-pinned CSS overrides. Allowlist-driven: the key must look
  // like a CSS property name, and the value must contain none of the
  // structural delimiters (;, :, {, }) that would let an attacker break out
  // of the declaration. The server's validate.ts pinnedStyleValueIssue
  // rejects on overlapping rules at PUT time; this filter is the editor's
  // local pre-flight so a forbidden value never renders even before save.
  // If you change either rule, mirror it in validate.ts or the editor will
  // accept what the server rejects (and vice versa).
  function applyPinnedStyle(wrapper, element) {
    if (!element.pinnedStyle) return;
    for (const key of Object.keys(element.pinnedStyle)) {
      if (!/^[a-zA-Z-]+$/.test(key)) continue;
      const value = element.pinnedStyle[key];
      if (typeof value !== "string") continue;
      if (value.indexOf(";") >= 0 || value.indexOf(":") >= 0) continue;
      if (value.indexOf("{") >= 0 || value.indexOf("}") >= 0) continue;
      wrapper.style.setProperty(key, value);
    }
  }

  function applyElementStyle(wrapper, element) {
    const es = element.elementStyle;
    if (!es) return;
    if (es.backgroundColor) {
      wrapper.style.backgroundColor = es.backgroundColor;
      wrapper.setAttribute("data-es-bg", "");
    }
    if (es.backgroundImageAssetId) {
      wrapper.style.backgroundImage = 'url("' + SITE_BASE + "/assets/" + encodeURIComponent(es.backgroundImageAssetId) + '")';
      wrapper.style.backgroundSize = es.backgroundSize === "contain" ? "contain" : "cover";
      wrapper.style.backgroundPosition = "center";
      wrapper.setAttribute("data-es-bg", "");
    }
    if (typeof es.borderRadius === "number") {
      wrapper.style.borderRadius = es.borderRadius + "px";
      wrapper.setAttribute("data-es-radius", "");
    }
    if (es.borderColor || typeof es.borderWidth === "number") {
      const w = typeof es.borderWidth === "number" ? es.borderWidth : 1;
      if (es.borderColor) {
        wrapper.style.border = w + "px solid " + es.borderColor;
      } else {
        wrapper.style.borderWidth = w + "px";
        wrapper.style.borderStyle = "solid";
      }
      wrapper.setAttribute("data-es-border", "");
    }
    if (es.boxShadow) {
      wrapper.style.boxShadow = es.boxShadow;
      wrapper.setAttribute("data-es-shadow", "");
    }
    if (typeof es.opacity === "number") wrapper.style.opacity = String(es.opacity);
    if (es.color) wrapper.style.color = es.color;
    if (es.overflow) wrapper.style.overflow = es.overflow;
  }

  // Build the nested-mark DOM for one InlineRun. Mark nesting order is
  // derived directly from CANONICAL_MARK_ORDER (and the server renderer in
  // src/canvas/render.ts) so the editor preview and the published HTML agree
  // visually:
  //   <a> outermost (only when link mark present)
  //   <strong>, <em>, <u>, <s>, <mark>, <code> innermost
  // wrap() pushes a new outer wrapper around the current inner, so the loop
  // below walks CANONICAL_MARK_ORDER in reverse: innermost (code) first, then
  // link is appended last via its dedicated branch. No parallel mark-order
  // list lives in this function — the single source is CANONICAL_MARK_ORDER.
  function hasMark(run, type) {
    if (!run.marks || !Array.isArray(run.marks)) return false;
    for (let i = 0; i < run.marks.length; i++) {
      if (run.marks[i] && run.marks[i].type === type) return true;
    }
    return false;
  }
  function findLinkMark(run) {
    if (!run.marks || !Array.isArray(run.marks)) return null;
    for (let i = 0; i < run.marks.length; i++) {
      if (run.marks[i] && run.marks[i].type === "link") return run.marks[i];
    }
    return null;
  }
  // Maps CANONICAL_MARK_ORDER mark types to their DOM tags. "link" is omitted
  // because the <a> wrap needs href/target attributes and is built inline below.
  const MARK_TYPE_TO_TAG = { bold: "strong", italic: "em", underline: "u", strike: "s", highlight: "mark", code: "code" };
  function buildRunNode(run) {
    // Innermost text node carries the raw run.text. wrapInTag wraps the
    // current node in a new element of the given tag, returning the outer.
    let inner = document.createTextNode(typeof run.text === "string" ? run.text : "");
    function wrap(tag) {
      const el = document.createElement(tag);
      el.appendChild(inner);
      inner = el;
      return el;
    }
    // Walk CANONICAL_MARK_ORDER innermost-first (reverse) so wrap()'s
    // outward-growth produces the exact nesting CANONICAL_MARK_ORDER prescribes.
    // The "link" entry is handled separately below because <a> needs attributes.
    for (let mi = CANONICAL_MARK_ORDER.length - 1; mi >= 0; mi--) {
      const markType = CANONICAL_MARK_ORDER[mi];
      const tag = MARK_TYPE_TO_TAG[markType];
      if (tag && hasMark(run, markType)) wrap(tag);
    }
    const link = findLinkMark(run);
    if (link) {
      const a = document.createElement("a");
      a.className = "opencanvas-inline-link";
      a.setAttribute("href", link.href);
      if (link.target === "_blank") {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
      // Owner click semantics:
      //  - While the parent text element is in edit mode, the click places the
      //    caret as normal; the link popover surfaces an explicit "Go" button
      //    so navigation never fights with text editing.
      //  - Otherwise, navigate on the canvas: internal hrefs swap the active
      //    page, external hrefs open in a new tab. Alt-click suppresses
      //    navigation so the Owner can still select the parent element.
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        if (editingElementId) return;
        if (ev.altKey) return;
        goToHrefOnCanvas(a.getAttribute("href") || "");
      });
      a.appendChild(inner);
      inner = a;
    }
    const span = document.createElement("span");
    span.appendChild(inner);
    return span;
  }

  function buildTextBody(element) {
    const tag = element.role === "heading" ? "h1" : element.role === "body" ? "p" : "span";
    const node = document.createElement(tag);
    node.className = "opencanvas-text";
    node.setAttribute("data-role", element.role);
    node.style.fontSize = element.fontSize + "px";
    node.style.fontWeight = String(element.fontWeight);
    node.style.textAlign = element.align;
    node.style.margin = "0";
    const content = Array.isArray(element.content) ? element.content : [];
    for (let i = 0; i < content.length; i++) {
      node.appendChild(buildRunNode(content[i]));
    }
    return node;
  }

  // Build the editor-mode preview for a media element. The src points at the
  // owner-gated preview route (/api/canvas/sites/:siteId/assets/:assetId),
  // NOT the public /assets/:assetId path — visitors only see published assets,
  // but the Owner can preview anything they have uploaded BEFORE publish.
  //
  // The placeholder assetId "__placeholder__" (added when the Owner inserts a
  // new media element via the section toolbar) is rendered as a non-resolving
  // hint until the Owner uploads. We keep the box visible so the Owner can
  // drag/resize it before uploading.
  function buildMediaBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-media";
    node.setAttribute("data-opencanvas-media-kind", element.mediaKind);
    const assetId = typeof element.assetId === "string" ? element.assetId : "";
    if (assetId.length === 0 || assetId === "__placeholder__") {
      node.textContent =
        element.mediaKind === "image" ? "[image — upload to preview]" : "[video — upload to preview]";
      return node;
    }
    const previewUrl = SITE_BASE + "/assets/" + encodeURIComponent(assetId);
    if (element.mediaKind === "image") {
      const img = document.createElement("img");
      img.setAttribute("src", previewUrl);
      const altText = typeof element.alt === "string" ? element.alt : "";
      img.setAttribute("alt", altText);
      // Mirror the public renderer's a11y rule: empty alt means decorative,
      // which signals screen readers to skip the image. Without this the
      // editor preview reports differently from the published page.
      if (altText.length === 0) img.setAttribute("aria-hidden", "true");
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = element.fit === "contain" ? "contain" : "cover";
      img.style.display = "block";
      node.appendChild(img);
    } else {
      const video = document.createElement("video");
      video.setAttribute("src", previewUrl);
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = element.fit === "contain" ? "contain" : "cover";
      video.style.display = "block";
      const playback = element.playback || {};
      // Same enforcement as the public renderer + validator: autoplay forces
      // muted. We set both attributes via setAttribute so the browser's
      // autoplay policy treats the video as autoplay-eligible.
      if (playback.autoplay) {
        video.setAttribute("autoplay", "");
        video.setAttribute("muted", "");
        video.muted = true;
      } else if (playback.muted) {
        video.setAttribute("muted", "");
        video.muted = true;
      }
      if (playback.loop) video.setAttribute("loop", "");
      if (playback.controls) video.setAttribute("controls", "");
      node.appendChild(video);
    }
    return node;
  }

  // Client-side mirror of resolveActionHref in src/canvas/action-href.ts.
  // String-typed hrefs are tolerated because migrateState may not have run yet
  // on a session whose first render fires before the migrate pass completes.
  function resolveActionHref(href) {
    if (href && href.type === "external") {
      if (typeof href.url !== "string" || href.url.length === 0) {
        throw new Error("resolveActionHref: external href missing url");
      }
      return href.url;
    }
    if (href && href.type === "page") {
      for (var pi = 0; pi < state.pages.length; pi++) {
        if (state.pages[pi].id === href.pageId) {
          var base = "/" + state.pages[pi].slug;
          return href.anchor ? base + "#" + href.anchor : base;
        }
      }
      throw new Error("resolveActionHref: missing page id " + JSON.stringify(href.pageId));
    }
    if (typeof href === "string") return href;
    throw new Error("resolveActionHref: unknown href shape");
  }

  function buildActionBody(element) {
    var node = document.createElement("a");
    node.className = "opencanvas-action";
    node.setAttribute("data-variant", element.variant);
    node.setAttribute("href", resolveActionHref(element.href));
    // Plain click selects the action element on canvas (default selection
    // flow). Alt-click navigates instead — internal page hrefs swap the
    // active artboard, external hrefs open in a new tab.
    node.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!ev.altKey) return;
      ev.stopPropagation();
      if (element.href && element.href.type === "page") {
        setActivePage(element.href.pageId);
        return;
      }
      if (element.href && element.href.type === "external") {
        if (isAllowedHref(element.href.url)) {
          window.open(element.href.url, "_blank", "noopener,noreferrer");
        }
      }
    });
    node.textContent = element.label;
    return node;
  }

  function buildShapeBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-shape";
    node.setAttribute("data-variant", element.variant);
    return node;
  }

  function buildContainerBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-surface";
    node.setAttribute("data-variant", element.variant);
    return node;
  }

  // -- Chart editor preview ----------------------------------------------
  //
  // The editor preview renders an inline approximation of the server SVG
  // so the Owner sees colour bands + a kind hint while typing into the
  // data grid. The visitor-facing render is the canonical server SVG
  // (see src/canvas/elements/chart.ts) — this preview deliberately uses
  // the SAME palette algorithm by reading the kit accent off the editor
  // wrapper's --opencanvas-kit-accent token, so the editor swatch order
  // matches what the server emits. No client-side chart library: ~80 lines
  // of plain DOM + a fixed-format colour-rotation.
  // ----------------------------------------------------------------------

  const CHART_KINDS = ["bar", "line", "pie", "donut", "area"];

  function parseHexAccent(raw) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim().replace(/^#/, "");
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cleaned)) return null;
    let r, g, b;
    if (cleaned.length === 3) {
      r = parseInt(cleaned[0] + cleaned[0], 16);
      g = parseInt(cleaned[1] + cleaned[1], 16);
      b = parseInt(cleaned[2] + cleaned[2], 16);
    } else if (cleaned.length === 6) {
      r = parseInt(cleaned.slice(0, 2), 16);
      g = parseInt(cleaned.slice(2, 4), 16);
      b = parseInt(cleaned.slice(4, 6), 16);
    } else { return null; }
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
    return { r: r, g: g, b: b };
  }

  // Mirror src/charts/colors.ts buildPaletteFromAccent. The editor must
  // produce the SAME 5 colours the server emits so the swatch order in the
  // inspector matches the published SVG. If colors.ts changes, this list
  // must change too.
  const PREVIEW_OFFSETS = [
    [0, 0], [36, 0], [-36, 0.10], [72, -0.10], [-72, 0.05],
  ];

  function rgbToHslPreview(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l };
  }

  function hslToHexPreview(h, s, l) {
    const hh = (((h % 360) + 360) % 360) / 360;
    function chan(p, q, t) {
      let tn = t;
      if (tn < 0) tn += 1;
      if (tn > 1) tn -= 1;
      if (tn < 1 / 6) return p + (q - p) * 6 * tn;
      if (tn < 1 / 2) return q;
      if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
      return p;
    }
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = chan(p, q, hh + 1 / 3);
      g = chan(p, q, hh);
      b = chan(p, q, hh - 1 / 3);
    }
    function toHex(v) { return Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, "0"); }
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function clampPreview(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function previewPaletteFromAccent(accentHex) {
    const rgb = parseHexAccent(accentHex);
    if (!rgb) return ["#888", "#888", "#888", "#888", "#888"];
    const base = rgbToHslPreview(rgb.r, rgb.g, rgb.b);
    const s = clampPreview(base.s, 0.45, 0.85);
    const out = [];
    for (let i = 0; i < PREVIEW_OFFSETS.length; i++) {
      const offset = PREVIEW_OFFSETS[i];
      const h = base.h + offset[0];
      const l = clampPreview(base.l + offset[1], 0.25, 0.75);
      out.push(hslToHexPreview(h, s, l));
    }
    return out;
  }

  function currentChartPalette() {
    if (!mainEl) return ["#888", "#888", "#888", "#888", "#888"];
    const cs = window.getComputedStyle(mainEl);
    const accent = (cs.getPropertyValue("--opencanvas-kit-accent") || "").trim();
    return previewPaletteFromAccent(accent || "#888888");
  }

  function buildChartBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-chart-preview";
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.position = "relative";
    node.style.overflow = "hidden";
    node.style.borderRadius = "4px";
    node.style.background = "rgba(0, 0, 0, 0.04)";
    const palette = currentChartPalette();
    const series = Array.isArray(element.series) ? element.series : [];
    const categories = Array.isArray(element.categories) ? element.categories : [];
    if (series.length === 0 || categories.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "Chart (" + (element.kind || "bar") + ") — add data";
      empty.style.position = "absolute";
      empty.style.inset = "0";
      empty.style.display = "flex";
      empty.style.alignItems = "center";
      empty.style.justifyContent = "center";
      empty.style.fontSize = "12px";
      empty.style.opacity = "0.7";
      node.appendChild(empty);
      return node;
    }
    if (element.kind === "pie" || element.kind === "donut") {
      const values = (series[0] && Array.isArray(series[0].values)) ? series[0].values.slice(0, categories.length) : [];
      let total = 0;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (typeof v === "number" && isFinite(v) && v > 0) total += v;
      }
      if (total <= 0) {
        node.textContent = "Pie has no data";
        node.style.display = "flex";
        node.style.alignItems = "center";
        node.style.justifyContent = "center";
        node.style.fontSize = "12px";
        return node;
      }
      // CSS conic-gradient gives us a tooltip-free pie preview with zero math.
      const stops = [];
      let cursor = 0;
      for (let i = 0; i < values.length; i++) {
        const v = typeof values[i] === "number" && isFinite(values[i]) && values[i] > 0 ? values[i] : 0;
        const start = cursor;
        const end = cursor + (v / total) * 100;
        const color = palette[i % palette.length];
        stops.push(color + " " + start.toFixed(2) + "% " + end.toFixed(2) + "%");
        cursor = end;
      }
      const disc = document.createElement("div");
      disc.style.position = "absolute";
      disc.style.inset = "8px";
      disc.style.borderRadius = "50%";
      disc.style.background = "conic-gradient(" + stops.join(", ") + ")";
      if (element.kind === "donut") {
        disc.style.maskImage = "radial-gradient(circle, transparent 28%, black 29%)";
        disc.style.webkitMaskImage = "radial-gradient(circle, transparent 28%, black 29%)";
      }
      node.appendChild(disc);
      return node;
    }
    // bar / line / area share a stacked band preview. Compute per-series
    // max so legends line up; render N rows where each row is the per-
    // category values as proportional cells.
    const rowHost = document.createElement("div");
    rowHost.style.position = "absolute";
    rowHost.style.inset = "8px";
    rowHost.style.display = "flex";
    rowHost.style.flexDirection = "column";
    rowHost.style.gap = "4px";
    for (let si = 0; si < series.length; si++) {
      const row = document.createElement("div");
      row.style.flex = "1";
      row.style.display = "flex";
      row.style.gap = "2px";
      const values = Array.isArray(series[si].values) ? series[si].values : [];
      let maxVal = 0;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (typeof v === "number" && isFinite(v) && v > maxVal) maxVal = v;
      }
      const color = palette[si % palette.length];
      for (let ci = 0; ci < categories.length; ci++) {
        const cell = document.createElement("div");
        cell.style.flex = "1";
        cell.style.background = color;
        const v = values[ci];
        const ratio = (typeof v === "number" && isFinite(v) && maxVal > 0) ? Math.max(0.05, v / maxVal) : 0.05;
        cell.style.opacity = String(ratio);
        cell.title = (series[si].label || "Series " + (si + 1)) + " / " + (categories[ci] || ("Cat " + (ci + 1))) + ": " + (typeof v === "number" ? v : "—");
        row.appendChild(cell);
      }
      rowHost.appendChild(row);
    }
    node.appendChild(rowHost);
    return node;
  }

  function buildFormBody(element) {
    const node = document.createElement("form");
    node.className = "opencanvas-form-preview";
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.gap = "8px";
    node.style.width = "100%";
    node.style.height = "100%";
    node.addEventListener("submit", function(ev) { ev.preventDefault(); });
    const fields = Array.isArray(element.fields) ? element.fields : [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] || {};
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.flexDirection = "column";
      label.style.gap = "4px";
      label.style.fontSize = "12px";
      label.textContent = field.label || field.id || "Field";
      const input = document.createElement(field.kind === "textarea" ? "textarea" : "input");
      if (field.kind && field.kind !== "textarea") input.setAttribute("type", field.kind === "email" ? "email" : field.kind === "checkbox" ? "checkbox" : "text");
      input.disabled = true;
      input.placeholder = field.placeholder || "";
      input.style.boxSizing = "border-box";
      input.style.width = "100%";
      label.appendChild(input);
      node.appendChild(label);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = element.submitLabel || "Submit";
    node.appendChild(button);
    return node;
  }

  function buildEmbedBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-embed-preview";
    node.style.display = "flex";
    node.style.alignItems = "center";
    node.style.justifyContent = "center";
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.padding = "12px";
    node.style.boxSizing = "border-box";
    node.style.textAlign = "center";
    node.textContent = element.title || element.url || "Embed";
    return node;
  }

  function buildCodeBody(element) {
    const pre = document.createElement("pre");
    pre.className = "opencanvas-code-preview";
    pre.style.margin = "0";
    pre.style.width = "100%";
    pre.style.height = "100%";
    pre.style.overflow = "auto";
    pre.style.boxSizing = "border-box";
    pre.style.padding = "12px";
    pre.textContent = element.source || "";
    return pre;
  }

  function buildAccordionBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-accordion-preview";
    const items = Array.isArray(element.items) ? element.items : [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] || {};
      const details = document.createElement("details");
      if (i === 0) details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = item.title || "Item";
      details.appendChild(summary);
      const body = document.createElement("div");
      const runs = Array.isArray(item.body) ? item.body : [];
      body.textContent = runs.map(function(run) { return run && typeof run.text === "string" ? run.text : ""; }).join("");
      details.appendChild(body);
      node.appendChild(details);
    }
    return node;
  }

  function buildCarouselBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-carousel-preview";
    node.style.display = "flex";
    node.style.gap = "8px";
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.overflow = "hidden";
    const slides = Array.isArray(element.slides) ? element.slides : [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] || {};
      const cell = document.createElement("div");
      cell.style.flex = "0 0 70%";
      cell.style.display = "flex";
      cell.style.alignItems = "center";
      cell.style.justifyContent = "center";
      cell.style.background = "rgba(0,0,0,0.08)";
      cell.textContent = slide.caption || slide.assetId || "Slide";
      node.appendChild(cell);
    }
    return node;
  }

  function buildTableBody(element) {
    const table = document.createElement("table");
    table.className = "opencanvas-table-preview";
    table.style.width = "100%";
    table.style.height = "100%";
    table.style.borderCollapse = "collapse";
    const columns = Array.isArray(element.columns) ? element.columns : [];
    const rows = Array.isArray(element.rows) ? element.rows : [];
    if (columns.length > 0) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (let i = 0; i < columns.length; i++) {
        const th = document.createElement("th");
        th.textContent = columns[i].header || columns[i].id || "";
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    for (let r = 0; r < rows.length; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < columns.length; c++) {
        const td = document.createElement("td");
        const key = columns[c].id;
        const cells = rows[r] && rows[r].cells ? rows[r].cells : {};
        td.textContent = key ? String(cells[key] || "") : "";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function buildNavBody(element) {
    const nav = document.createElement("nav");
    nav.className = "opencanvas-nav-preview";
    nav.style.display = "flex";
    nav.style.alignItems = "center";
    nav.style.gap = "12px";
    nav.style.width = "100%";
    nav.style.height = "100%";
    const links = Array.isArray(element.links) ? element.links : [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i] || {};
      const a = document.createElement("a");
      a.className = "opencanvas-nav-link";
      const kind = link.kind === "external" || link.kind === "anchor" ? link.kind : "internal";
      a.setAttribute("data-opencanvas-nav-link-kind", kind);
      let resolvedHref = typeof link.href === "string" ? link.href : "";
      if (kind === "internal" && resolvedHref.length > 0 && resolvedHref.charAt(0) !== "/") {
        resolvedHref = "/" + resolvedHref;
      }
      a.setAttribute("href", resolvedHref.length > 0 ? resolvedHref : "#");
      if (kind === "external") {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      }
      a.textContent = link.label || "Link";
      // Capture href/kind per-iteration so the click handler doesn't see the
      // last loop value (the surrounding for-loop uses let but the closure is
      // attached via addEventListener, which is fine — explicit locals make
      // the intent obvious and survive refactors).
      (function (capturedHref, capturedKind) {
        a.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (ev.altKey) return;
          if (capturedKind === "internal") {
            goToHrefOnCanvas(capturedHref);
            return;
          }
          if (capturedKind === "external") {
            if (isAllowedHref(capturedHref)) {
              window.open(capturedHref, "_blank", "noopener,noreferrer");
            }
            return;
          }
          // anchor: in-page fragments have no canvas-side destination; the
          // public renderer scrolls, the editor stays put.
        });
      })(resolvedHref, kind);
      nav.appendChild(a);
    }
    return nav;
  }

  function buildCollectionBody(element) {
    const node = document.createElement("div");
    node.className = "opencanvas-collection-preview";
    node.style.display = "grid";
    node.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    node.style.gap = "8px";
    const entries = Array.isArray(element.entries) ? element.entries : [];
    for (let i = 0; i < entries.length; i++) {
      const entry = Array.isArray(entries[i]) ? entries[i] : [];
      const card = document.createElement("div");
      card.style.position = "relative";
      card.style.minHeight = "80px";
      for (let j = 0; j < entry.length; j++) {
        const child = document.createElement("div");
        child.style.position = "absolute";
        setBoxStyle(child, entry[j].box || { x: 0, y: 0, w: 120, h: 40, z: 1 });
        child.appendChild(buildElementBody(entry[j]));
        card.appendChild(child);
      }
      node.appendChild(card);
    }
    if (entries.length === 0) node.textContent = "Collection";
    return node;
  }

  function buildElementBody(element) {
    switch (element.type) {
      case "text": return buildTextBody(element);
      case "media": return buildMediaBody(element);
      case "action": return buildActionBody(element);
      case "shape": return buildShapeBody(element);
      case "container": return buildContainerBody(element);
      case "chart": return buildChartBody(element);
      case "form": return buildFormBody(element);
      case "embed": return buildEmbedBody(element);
      case "code": return buildCodeBody(element);
      case "accordion": return buildAccordionBody(element);
      case "carousel": return buildCarouselBody(element);
      case "table": return buildTableBody(element);
      case "nav": return buildNavBody(element);
      case "collection": return buildCollectionBody(element);
    }
    throw new Error("unsupported editor element type: " + String(element.type));
  }

  // -- Element context menu (3-dot, top-left on hover) --------------------

  let openMenuElementId = null;

  function closeElementMenu() {
    if (!openMenuElementId) return;
    const prev = root.querySelector('[data-opencanvas-element="' + cssEscape(openMenuElementId) + '"] .element-menu');
    if (prev) prev.remove();
    const prevTrigger = root.querySelector('[data-opencanvas-element="' + cssEscape(openMenuElementId) + '"] .element-menu-trigger');
    if (prevTrigger) prevTrigger.removeAttribute("data-menu-open");
    openMenuElementId = null;
  }

  function buildElementMenu(element, section, wrapper) {
    const menu = document.createElement("div");
    menu.className = "element-menu";
    menu.setAttribute("data-element-menu", "true");

    var items = [
      { label: "Bring to front", action: "front" },
      { label: "Send to back", action: "back" },
    ];
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "menu-item";
        btn.textContent = item.label;
        btn.addEventListener("click", function() {
          applyZOrderAction(section, element, item.action);
          closeElementMenu();
        });
        menu.appendChild(btn);
      })(items[i]);
    }

    var div2 = document.createElement("div");
    div2.className = "menu-divider";
    menu.appendChild(div2);

    var dupBtn = document.createElement("button");
    dupBtn.type = "button";
    dupBtn.className = "menu-item";
    dupBtn.textContent = "Duplicate";
    dupBtn.addEventListener("click", function() {
      // Duplicate is only surfaced once a section is already rendered, which
      // requires state.pages to be non-empty. A missing currentPage() here
      // means state went sideways between render and the click — fail loudly
      // instead of clamping against an invented width.
      var page = currentPage();
      if (!page) throw new Error("duplicate element: no current page; cannot clamp duplicate within artboard");
      var copy = JSON.parse(JSON.stringify(element));
      copy.id = newElementId();
      copy.box.x = Math.min(copy.box.x + 20, page.width - copy.box.w);
      copy.box.y = Math.min(copy.box.y + 20, section.height - copy.box.h);
      copy.box.z = nextZ(section);
      section.elements.push(copy);
      closeElementMenu();
      renderAll();
      selectElement(copy.id);
      scheduleSave();
    });
    menu.appendChild(dupBtn);

    var delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "menu-item danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", function() {
      var idx = section.elements.indexOf(element);
      if (idx >= 0) section.elements.splice(idx, 1);
      closeElementMenu();
      selectedElementId = null;
      renderAll();
      renderInspector();
      scheduleSave();
    });
    menu.appendChild(delBtn);

    return menu;
  }

  function toggleElementMenu(elementId, wrapper) {
    if (openMenuElementId === elementId) {
      closeElementMenu();
      return;
    }
    closeElementMenu();
    var found = findElement(elementId);
    if (!found) return;
    selectElement(elementId);
    var menu = buildElementMenu(found.element, found.section, wrapper);
    wrapper.appendChild(menu);
    var trigger = wrapper.querySelector(".element-menu-trigger");
    if (trigger) trigger.setAttribute("data-menu-open", "true");
    openMenuElementId = elementId;
  }

  function buildElementNode(element) {
    const wrapper = document.createElement("div");
    wrapper.className = "opencanvas-element";
    wrapper.setAttribute("data-opencanvas-element", element.id);
    wrapper.setAttribute("data-element-type", element.type);
    // Mirror the public renderer: stamp data-variant for action/shape/
    // container and data-role for text so kit CSS selectors of the form
    // [data-style-kit="X"] [data-element-type="action"][data-variant="Y"]
    // match in the editor preview exactly like they do in the published HTML.
    if (element.type === "action" || element.type === "shape" || element.type === "container") {
      if (typeof element.variant === "string") {
        wrapper.setAttribute("data-variant", element.variant);
      }
    } else if (element.type === "text") {
      if (typeof element.role === "string") {
        wrapper.setAttribute("data-role", element.role);
      }
    }
    if (element.motion) {
      wrapper.setAttribute("data-motion-preset", element.motion.preset);
      wrapper.setAttribute("data-motion-delay-ms", String(element.motion.delayMs || 0));
    }
    setBoxStyle(wrapper, element.box);
    applyElementStyle(wrapper, element);
    applyPinnedStyle(wrapper, element);
    wrapper.appendChild(buildElementBody(element));
    var dirs = ["n","s","e","w","ne","nw","se","sw"];
    for (var di = 0; di < dirs.length; di++) {
      var rh = document.createElement("div");
      rh.className = "resize-handle resize-handle-" + dirs[di];
      rh.setAttribute("data-resize-handle", "true");
      rh.setAttribute("data-resize-dir", dirs[di]);
      wrapper.appendChild(rh);
    }
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "element-menu-trigger";
    trigger.setAttribute("data-element-menu-trigger", element.id);
    trigger.textContent = "⋮";
    wrapper.appendChild(trigger);
    if (selectedElementId === element.id) {
      wrapper.setAttribute("data-selected", "true");
    }
    return wrapper;
  }

  function rebuildElement(elementId) {
    const found = findElement(elementId);
    if (!found) return;
    const existingNodes = root.querySelectorAll(
      '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
    );
    if (existingNodes.length === 0) {
      renderAll();
      return;
    }
    for (var i = 0; i < existingNodes.length; i++) {
      const existing = existingNodes[i];
      if (!existing.parentNode) continue;
      const replacement = buildElementNode(found.element);
      existing.parentNode.replaceChild(replacement, existing);
      if (found.element.type === "text") {
        var inner = replacement.querySelector(".opencanvas-text");
        if (inner) {
          var textH = inner.scrollHeight;
          if (textH > found.element.box.h) {
            found.element.box.h = textH;
            setBoxStyle(replacement, found.element.box);
          }
        }
      }
    }
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function isPinnedSection(section) {
    return !!section && (section.role === "header" || section.role === "footer");
  }

  function hasHeaderSection(page) {
    return page.sections.length > 0 && page.sections[0].role === "header";
  }

  function hasFooterSection(page) {
    return page.sections.length > 0 && page.sections[page.sections.length - 1].role === "footer";
  }

  function pinnedSectionLabel(section) {
    if (section.role === "header") return "Header";
    if (section.role === "footer") return "Footer";
    return "";
  }

  function sectionDisplayName(section, fallback) {
    const label = pinnedSectionLabel(section);
    const name = section.name || fallback;
    return label ? label + " \\u2014 " + name : name;
  }

  function buildSectionToolbar(section) {
    const bar = document.createElement("div");
    bar.className = "section-toolbar";
    // Section toolbar surfaces the curated subset of SIDEBAR_DISPATCH
    // commands that declared a toolbarLabel (ADR 0011 Step 3). The
    // dispatch insertion order in src/canvas/elements/index.ts controls
    // the visible toolbar order; missing a toolbarLabel means the
    // command appears in the sidebar grid only, not on every section.
    var types = Object.keys(SIDEBAR_DISPATCH);
    for (var t = 0; t < types.length; t++) {
      var cmds = SIDEBAR_DISPATCH[types[t]].commands;
      for (var i = 0; i < cmds.length; i++) {
        var cmd = cmds[i];
        if (!cmd.toolbarLabel) continue;
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = cmd.toolbarLabel;
        button.title = cmd.toolbarTip || cmd.sidebarTip;
        button.setAttribute("data-section-action", "add-" + cmd.key);
        button.setAttribute("data-section-id", section.id);
        bar.appendChild(button);
      }
    }
    return bar;
  }

  function buildSectionNode(section, pageWidth) {
    const node = document.createElement("section");
    node.className = "opencanvas-section";
    node.setAttribute("data-opencanvas-section", section.id);
    node.setAttribute("data-recipe", section.recipeId);
    if (isPinnedSection(section)) node.setAttribute("data-section-role", section.role);
    if (section.backgroundEffect) node.setAttribute("data-bg-effect", section.backgroundEffect);
    if (section.entrance) node.setAttribute("data-entrance", section.entrance);
    node.style.position = "relative";
    node.style.width = pageWidth + "px";
    node.style.height = section.height + "px";
    if (selectedSectionId === section.id) {
      node.setAttribute("data-selected", "true");
    }
    for (const element of section.elements) {
      node.appendChild(buildElementNode(element));
    }
    node.appendChild(buildSectionToolbar(section));
    const grip = document.createElement("div");
    grip.className = "section-grip-handle";
    grip.setAttribute("data-section-grip", section.id);
    grip.textContent = "⡇";
    node.appendChild(grip);
    return node;
  }

  function pageRenderWidth(page) {
    // Every call site passes a page resolved from state.pages (renderAll's
    // iteration, applyPageStyles' artboard lookup, applyPageStyleProperties'
    // per-page render). A null page here means the caller passed a dangling
    // reference — fail loudly instead of inventing a default width that
    // misaligns the artboard against the real page model.
    if (!page) throw new Error("pageRenderWidth: page is null; caller passed a dangling page reference");
    return page.maxWidth != null && page.maxWidth < page.width ? page.maxWidth : page.width;
  }

  function applyPageMotionAttributes(article, page) {
    article.removeAttribute("data-motion-preset");
    article.removeAttribute("data-entrance-animation");
    article.removeAttribute("data-scroll-trigger");
    if (!page.entranceAnimation || page.entranceAnimation === "none") return;
    var triggerMode = page.scrollTriggerMode || "on-load";
    if (triggerMode === "on-load") {
      article.setAttribute("data-motion-preset", page.entranceAnimation);
    } else {
      article.setAttribute("data-entrance-animation", page.entranceAnimation);
    }
    article.setAttribute("data-scroll-trigger", triggerMode);
  }

  function applyPageStyleProperties(article, page) {
    article.style.width = pageRenderWidth(page) + "px";
    article.style.background = page.pageBackground || "";
    article.style.display = page.sectionGap != null ? "flex" : "";
    article.style.flexDirection = page.sectionGap != null ? "column" : "";
    article.style.gap = page.sectionGap != null ? page.sectionGap + "px" : "";
    article.style.maxWidth = page.maxWidth != null ? page.maxWidth + "px" : "";
  }

  function renderAll() {
    if (!state) return;
    computePagePositions();

    var fragment = document.createDocumentFragment();

    for (var pi = 0; pi < state.pages.length; pi++) {
      var page = state.pages[pi];
      var pos = getPagePosition(page.id);
      if (!pos) continue;

      var artboard = document.createElement("div");
      artboard.className = "opencanvas-artboard";
      artboard.setAttribute("data-page-id", page.id);
      artboard.setAttribute("data-active", page.id === (activePageId || state.pages[0].id) ? "true" : "false");
      artboard.style.transform = "translate(" + pos.x + "px, " + pos.y + "px)";

      var label = document.createElement("div");
      label.className = "opencanvas-artboard-label";
      label.textContent = page.title || page.slug;
      label.setAttribute("data-page-id", page.id);
      artboard.appendChild(label);

      var article = document.createElement("article");
      article.className = "opencanvas-page";
      article.setAttribute("data-opencanvas-page", page.id);
      article.style.position = "relative";
      applyPageMotionAttributes(article, page);
      applyPageStyleProperties(article, page);
      var renderWidth = pageRenderWidth(page);

      if (state.header) {
        article.appendChild(buildSectionNode(state.header, renderWidth));
      }

      for (var si = 0; si < page.sections.length; si++) {
        article.appendChild(buildSectionNode(page.sections[si], renderWidth));
      }

      if (state.footer) {
        article.appendChild(buildSectionNode(state.footer, renderWidth));
      }

      artboard.appendChild(article);

      var outline = document.createElement("div");
      outline.className = "opencanvas-artboard-outline";
      artboard.appendChild(outline);

      fragment.appendChild(artboard);
    }

    root.replaceChildren(fragment);

    if (mainEl && state.styleKit) {
      mainEl.setAttribute("data-style-kit", state.styleKit);
    }
    // Keep the sidebar style-kit chips in sync with state.styleKit so that
    // undo/redo (or any non-sidebar kit change) reflects in the chip row.
    var sidebarKitButtons = document.querySelectorAll('[data-sidebar-style-kit]');
    if (sidebarKitButtons.length > 0) syncSidebarStyleKitButtons(sidebarKitButtons);

    applyCameraTransform();
    renderInspector();
    renderSidebarSelection();

    renderReel();
    autoGrowTextElements();

    if (pendingImport) {
      renderPlacementSlots();
    }

    if (!activePageId && state.pages.length > 0) {
      activePageId = state.pages[0].id;
    }
  }

  function autoGrowTextElements() {
    var wrappers = root.querySelectorAll('[data-element-type="text"]');
    for (var i = 0; i < wrappers.length; i++) {
      var w = wrappers[i];
      var inner = w.querySelector(".opencanvas-text");
      if (!inner) continue;
      var eid = w.getAttribute("data-opencanvas-element");
      var found = findElement(eid);
      if (!found) continue;
      var textH = inner.scrollHeight;
      if (textH > found.element.box.h) {
        found.element.box.h = textH;
        setBoxStyle(w, found.element.box);
      }
    }
  }

  // -- Inspector ----------------------------------------------------------

  function field(label, inner) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    wrap.appendChild(lab);
    wrap.appendChild(inner);
    return wrap;
  }

  function selectInput(options, selected) {
    const sel = document.createElement("select");
    for (const option of options) {
      const opt = document.createElement("option");
      opt.value = option;
      opt.textContent = option;
      if (option === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }

  // -- Z-order + reading-order helpers ----------------------------------
  // Z-order operates on element.box.z (visual stacking); reading order
  // operates on the section.elements[] index (DOM order). The two are
  // intentionally independent — see CONTEXT / plan invariants.

  function bringToFront(section, element) {
    let maxZ = element.box.z;
    for (let i = 0; i < section.elements.length; i++) {
      const sibling = section.elements[i];
      if (sibling.id === element.id) continue;
      if (typeof sibling.box.z === "number" && sibling.box.z > maxZ) maxZ = sibling.box.z;
    }
    element.box.z = maxZ + 1;
  }

  function sendToBack(section, element) {
    let minZ = element.box.z;
    for (let i = 0; i < section.elements.length; i++) {
      const sibling = section.elements[i];
      if (sibling.id === element.id) continue;
      if (typeof sibling.box.z === "number" && sibling.box.z < minZ) minZ = sibling.box.z;
    }
    element.box.z = minZ - 1;
  }

  // Swap z with the next-higher (forward) or next-lower (backward) sibling.
  // No-op when already at the top/bottom of the stack.
  function nudgeZ(section, element, direction) {
    const elZ = element.box.z;
    let target = null;
    for (let i = 0; i < section.elements.length; i++) {
      const sibling = section.elements[i];
      if (sibling.id === element.id) continue;
      if (typeof sibling.box.z !== "number") continue;
      if (direction > 0) {
        if (sibling.box.z > elZ && (target === null || sibling.box.z < target.box.z)) target = sibling;
      } else {
        if (sibling.box.z < elZ && (target === null || sibling.box.z > target.box.z)) target = sibling;
      }
    }
    if (!target) return false;
    const tmp = element.box.z;
    element.box.z = target.box.z;
    target.box.z = tmp;
    return true;
  }

  // Re-pack a section's element z values to 0..N-1 preserving relative
  // order. bringToFront/sendToBack widen the range every call, so without
  // this a long edit session drifts z toward Number.MAX_SAFE_INTEGer until
  // arithmetic precision becomes visible.
  function renormalizeZ(section) {
    if (!section || !Array.isArray(section.elements)) return;
    const items = section.elements
      .map(function (el, i) { return { el: el, idx: i, z: typeof el.box.z === "number" ? el.box.z : 0 }; })
      .sort(function (a, b) { return a.z - b.z || a.idx - b.idx; });
    for (let i = 0; i < items.length; i++) items[i].el.box.z = i;
  }

  function applyZOrderAction(section, element, action) {
    if (action === "front") bringToFront(section, element);
    else if (action === "back") sendToBack(section, element);
    else if (action === "forward") nudgeZ(section, element, 1);
    else if (action === "backward") nudgeZ(section, element, -1);
    renormalizeZ(section);
    renderAll();
    selectElement(element.id);
    scheduleSave();
  }

  function moveInReadingOrder(section, element, direction) {
    const idx = section.elements.indexOf(element);
    if (idx < 0) return false;
    const target = idx + direction;
    if (target < 0 || target >= section.elements.length) return false;
    section.elements.splice(idx, 1);
    section.elements.splice(target, 0, element);
    renderAll();
    selectElement(element.id);
    scheduleSave();
    return true;
  }

  function buildReorderGroup(section, element) {
    const group = document.createElement("div");
    group.className = "opencanvas-reorder-buttons";
    const idx = section.elements.indexOf(element);
    const total = section.elements.length;
    const caption = document.createElement("div");
    caption.className = "opencanvas-reorder-caption";
    caption.textContent = "Reading order: " + (idx + 1) + " of " + total;

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "Move up in reading order";
    upBtn.disabled = idx <= 0;
    upBtn.addEventListener("click", () => { moveInReadingOrder(section, element, -1); });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "Move down in reading order";
    downBtn.disabled = idx >= total - 1;
    downBtn.addEventListener("click", () => { moveInReadingOrder(section, element, 1); });

    group.appendChild(upBtn);
    group.appendChild(downBtn);

    const wrap = document.createElement("div");
    wrap.appendChild(caption);
    wrap.appendChild(group);
    return wrap;
  }

  function buildZOrderGroup(section, element) {
    const group = document.createElement("div");
    group.className = "opencanvas-zorder-buttons";
    const defs = [
      { label: "Bring to front", action: "front" },
      { label: "Send to back", action: "back" },
      { label: "Forward", action: "forward" },
      { label: "Backward", action: "backward" },
    ];
    for (let i = 0; i < defs.length; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = defs[i].label;
      const action = defs[i].action;
      btn.addEventListener("click", () => { applyZOrderAction(section, element, action); });
      group.appendChild(btn);
    }
    return group;
  }

  // Duplicate and delete verbs for the selected positioned element. Section-
  // level Duplicate/Delete live in the section toolbar; this group surfaces
  // the same verbs for elements so Owners don't have to remember a keyboard
  // shortcut (Delete still works for deletion).
  function duplicateElement(section, element) {
    var clone = structuredClone(element);
    clone.id = newElementId();
    if (clone.box && typeof clone.box === "object") {
      if (typeof clone.box.x === "number") clone.box.x = clone.box.x + 20;
      if (typeof clone.box.y === "number") clone.box.y = clone.box.y + 20;
    }
    var idx = section.elements.indexOf(element);
    if (idx >= 0) section.elements.splice(idx + 1, 0, clone);
    else section.elements.push(clone);
    selectedElementId = clone.id;
    captureForUndo();
    renderAll();
    renderInspector();
    scheduleSave();
  }

  function deleteElement(section, element) {
    var idx = section.elements.indexOf(element);
    if (idx < 0) return;
    section.elements.splice(idx, 1);
    closeElementMenu();
    if (selectedElementId === element.id) selectedElementId = null;
    captureForUndo();
    renderAll();
    renderInspector();
    scheduleSave();
  }

  function buildElementActionsGroup(section, element) {
    const group = document.createElement("div");
    group.className = "opencanvas-zorder-buttons";
    const dup = document.createElement("button");
    dup.type = "button";
    dup.textContent = "Duplicate";
    dup.addEventListener("click", () => { duplicateElement(section, element); });
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", () => { deleteElement(section, element); });
    group.appendChild(dup);
    group.appendChild(del);
    return group;
  }

  // -- Chart editor data grid --------------------------------------------
  //
  // Renders directly into the inspector. Re-renders the whole chart block
  // on every structural change (add/remove series or category) so we don't
  // have to manage incremental DOM updates for a small spreadsheet grid.
  // Cell edits update element.series[].values in place and call
  // rebuildElement(id) + scheduleSave() — same shape every other inspector
  // input uses.
  // buildChartInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/chart.ts. Top-level fields (kind, x/y axis
  // titles, showLegend) are declarative in the spec; the 2D series ×
  // categories data grid stays imperative in mountChartData below.
  function mountChartData(element, host) {
    const gridHost = document.createElement("div");
    gridHost.className = "opencanvas-chart-grid-host";
    gridHost.style.marginTop = "8px";
    host.appendChild(gridHost);

    function renderGrid() {
      gridHost.replaceChildren();
      const series = Array.isArray(element.series) ? element.series : (element.series = []);
      const cats = Array.isArray(element.categories) ? element.categories : (element.categories = []);
      // Header row: blank + each category name.
      const table = document.createElement("table");
      table.className = "opencanvas-chart-grid";
      table.style.borderCollapse = "collapse";
      table.style.width = "100%";
      table.style.fontSize = "11px";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.style.textAlign = "left";
      corner.style.padding = "4px";
      corner.textContent = "Series \\ Category";
      headRow.appendChild(corner);
      for (let ci = 0; ci < cats.length; ci++) {
        const th = document.createElement("th");
        th.style.padding = "2px";
        const catInput = document.createElement("input");
        catInput.type = "text";
        catInput.value = String(cats[ci]);
        catInput.style.width = "100%";
        catInput.style.minWidth = "60px";
        catInput.style.boxSizing = "border-box";
        catInput.addEventListener("change", () => {
          cats[ci] = catInput.value;
          rebuildElement(element.id);
          scheduleSave();
        });
        th.appendChild(catInput);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "x";
        removeBtn.title = "Remove this category";
        removeBtn.style.marginLeft = "2px";
        removeBtn.addEventListener("click", () => {
          cats.splice(ci, 1);
          for (let si = 0; si < series.length; si++) {
            if (Array.isArray(series[si].values)) series[si].values.splice(ci, 1);
          }
          renderGrid();
          rebuildElement(element.id);
          scheduleSave();
        });
        th.appendChild(removeBtn);
        headRow.appendChild(th);
      }
      // Trailing + column header for adding a category.
      const addCatTh = document.createElement("th");
      const addCatBtn = document.createElement("button");
      addCatBtn.type = "button";
      addCatBtn.textContent = "+ cat";
      addCatBtn.addEventListener("click", () => {
        cats.push("Cat " + (cats.length + 1));
        for (let si = 0; si < series.length; si++) {
          if (Array.isArray(series[si].values)) series[si].values.push(0);
        }
        renderGrid();
        rebuildElement(element.id);
        scheduleSave();
      });
      addCatTh.appendChild(addCatBtn);
      headRow.appendChild(addCatTh);
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (let si = 0; si < series.length; si++) {
        const row = document.createElement("tr");
        const labelTd = document.createElement("td");
        labelTd.style.padding = "2px";
        const labelInput = document.createElement("input");
        labelInput.type = "text";
        labelInput.value = String(series[si].label);
        labelInput.style.width = "100%";
        labelInput.style.minWidth = "80px";
        labelInput.style.boxSizing = "border-box";
        labelInput.addEventListener("change", () => {
          series[si].label = labelInput.value;
          rebuildElement(element.id);
          scheduleSave();
        });
        labelTd.appendChild(labelInput);
        row.appendChild(labelTd);
        if (!Array.isArray(series[si].values)) series[si].values = [];
        // Pad / trim values to category count so the grid is rectangular.
        while (series[si].values.length < cats.length) series[si].values.push(0);
        if (series[si].values.length > cats.length) series[si].values.length = cats.length;
        for (let ci = 0; ci < cats.length; ci++) {
          const td = document.createElement("td");
          td.style.padding = "2px";
          const num = document.createElement("input");
          num.type = "number";
          num.step = "any";
          num.style.width = "100%";
          num.style.minWidth = "60px";
          num.style.boxSizing = "border-box";
          num.value = String(series[si].values[ci]);
          num.addEventListener("change", () => {
            const n = Number(num.value);
            if (Number.isFinite(n)) {
              series[si].values[ci] = n;
              rebuildElement(element.id);
              scheduleSave();
            } else {
              num.value = String(series[si].values[ci]);
            }
          });
          td.appendChild(num);
          row.appendChild(td);
        }
        // Trailing cell — remove-series button.
        const removeTd = document.createElement("td");
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "x";
        removeBtn.title = "Remove this series";
        removeBtn.addEventListener("click", () => {
          series.splice(si, 1);
          renderGrid();
          rebuildElement(element.id);
          scheduleSave();
        });
        removeTd.appendChild(removeBtn);
        row.appendChild(removeTd);
        tbody.appendChild(row);
      }
      // Add-series row.
      const addRow = document.createElement("tr");
      const addCell = document.createElement("td");
      addCell.colSpan = cats.length + 2;
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ series";
      addBtn.addEventListener("click", () => {
        const newValues = [];
        for (let i = 0; i < cats.length; i++) newValues.push(0);
        series.push({ label: "Series " + (series.length + 1), values: newValues });
        renderGrid();
        rebuildElement(element.id);
        scheduleSave();
      });
      addCell.appendChild(addBtn);
      addRow.appendChild(addCell);
      tbody.appendChild(addRow);
      table.appendChild(tbody);
      gridHost.appendChild(table);

      if (series.length === 0 && cats.length === 0) {
        const hint = document.createElement("div");
        hint.style.fontSize = "11px";
        hint.style.opacity = "0.7";
        hint.style.marginTop = "4px";
        hint.textContent = "Add a category and a series to start.";
        gridHost.appendChild(hint);
      }
    }
    renderGrid();
  }

  // -- Spec-driven inspector interpreter (ADR 0011 Step 1) ------------------
  //
  // Walks an InspectorSpec read from INSPECTOR_DISPATCH (interpolated as
  // JSON at script-emit time) and renders DOM the same way the legacy
  // buildXInspector functions did. Every inspectable element type routes
  // through the dispatch site further down; collection intentionally has no
  // spec because selecting its children opens their own inspectors.

  function renderInspectorSpec(spec, element) {
    spec.fields.forEach(function(f) {
      if (f.kind === "select") {
        var cur = element[f.path];
        if (typeof cur !== "string" || f.options.indexOf(cur) < 0) {
          cur = f.defaultValue || f.options[0];
        }
        var sel = selectInput(f.options, cur);
        sel.addEventListener("change", function() {
          element[f.path] = sel.value;
          rebuildElement(element.id);
          scheduleSave();
        });
        inspector.appendChild(field(f.label, sel));
        return;
      }
      if (f.kind === "select-mapped") {
        var tol = typeof f.tolerance === "number" ? f.tolerance : 0.01;
        var raw = element[f.path];
        var curLabel = null;
        if (typeof raw === "number") {
          for (var oi = 0; oi < f.options.length; oi++) {
            if (Math.abs(f.options[oi].value - raw) < tol) {
              curLabel = f.options[oi].label;
              break;
            }
          }
        }
        if (curLabel === null) {
          for (var di = 0; di < f.options.length; di++) {
            if (Math.abs(f.options[di].value - f.defaultValue) < tol) {
              curLabel = f.options[di].label;
              break;
            }
          }
        }
        if (curLabel === null) curLabel = f.options[0].label;
        var labels = [];
        for (var li = 0; li < f.options.length; li++) labels.push(f.options[li].label);
        var msel = selectInput(labels, curLabel);
        msel.addEventListener("change", function() {
          for (var oj = 0; oj < f.options.length; oj++) {
            if (f.options[oj].label === msel.value) {
              element[f.path] = f.options[oj].value;
              break;
            }
          }
          rebuildElement(element.id);
          scheduleSave();
        });
        inspector.appendChild(field(f.label, msel));
        return;
      }
      if (f.kind === "text") {
        var ti = document.createElement("input");
        ti.type = "text";
        ti.value = typeof element[f.path] === "string" ? element[f.path] : "";
        if (f.placeholder) ti.placeholder = f.placeholder;
        ti.addEventListener("change", function() {
          if (f.required && ti.value.length === 0) {
            setStatus(f.label + " cannot be empty", "error");
            ti.value = element[f.path] || "";
            return;
          }
          if (f.emptyOmits && ti.value.length === 0) {
            delete element[f.path];
          } else {
            element[f.path] = ti.value;
          }
          if (!f.noRebuild) rebuildElement(element.id);
          scheduleSave();
        });
        inspector.appendChild(field(f.label, ti));
        return;
      }
      if (f.kind === "textarea") {
        var ta = document.createElement("textarea");
        if (typeof f.rows === "number") ta.rows = f.rows;
        if (typeof f.cssText === "string") ta.style.cssText = f.cssText;
        ta.value = typeof element[f.path] === "string" ? element[f.path] : "";
        if (f.placeholder) ta.placeholder = f.placeholder;
        ta.addEventListener("change", function() {
          element[f.path] = ta.value;
          rebuildElement(element.id);
          scheduleSave();
        });
        inspector.appendChild(field(f.label, ta));
        return;
      }
      if (f.kind === "checkbox") {
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!element[f.path];
        cb.addEventListener("change", function() {
          element[f.path] = cb.checked;
          rebuildElement(element.id);
          scheduleSave();
        });
        inspector.appendChild(field(f.label, cb));
        return;
      }
      if (f.kind === "number") {
        var ni = document.createElement("input");
        ni.type = "number";
        if (typeof f.min === "number") ni.min = String(f.min);
        if (typeof f.max === "number") ni.max = String(f.max);
        var prev = typeof element[f.path] === "number" ? element[f.path] : 0;
        ni.value = String(prev);
        ni.addEventListener("change", function() {
          var n = Number(ni.value);
          var minOk = typeof f.min !== "number" || n >= f.min;
          var maxOk = typeof f.max !== "number" || n <= f.max;
          if (Number.isFinite(n) && minOk && maxOk) {
            element[f.path] = n;
            prev = n;
            rebuildElement(element.id);
            scheduleSave();
          } else {
            ni.value = String(prev);
          }
        });
        inspector.appendChild(field(f.label, ni));
        return;
      }
      if (f.kind === "button-action") {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = f.label;
        if (f.dataAttr) btn.setAttribute("data-ai-button", f.dataAttr);
        if (f.busyFlag) {
          var busyReader = INSPECTOR_BUSY_FLAGS[f.busyFlag];
          if (busyReader && busyReader()) btn.disabled = true;
        }
        var handler = INSPECTOR_ACTION_HANDLERS[f.action];
        if (typeof handler !== "function") {
          throw new Error("renderInspectorSpec: no action handler registered for " + JSON.stringify(f.action));
        }
        btn.addEventListener("click", function() { handler(element.id); });
        inspector.appendChild(btn);
        return;
      }
      if (f.kind === "action-href") {
        renderActionHrefField(f, element);
        return;
      }
      if (f.kind === "custom-mount") {
        var mount = INSPECTOR_MOUNT_HANDLERS[f.name];
        if (typeof mount !== "function") {
          throw new Error("renderInspectorSpec: no mount handler registered for " + JSON.stringify(f.name));
        }
        mount(element, inspector);
        return;
      }
      throw new Error("renderInspectorSpec: unknown field kind " + JSON.stringify(f.kind));
    });
  }

  // Purpose-built editor for the ActionHref DU. The spec carries the labels +
  // path; this function owns knowledge of the DU shape (external | page), the
  // URL allowlist (isAllowedHref), and the page-source registry (state.pages).
  // When the discriminator changes, the value field is rebuilt and the entire
  // DU at element[f.path] is replaced with a fresh shape — same behaviour the
  // legacy buildActionInspector had.
  function renderActionHrefField(f, element) {
    var hrefTypeSelect = document.createElement("select");
    var optExternal = document.createElement("option");
    optExternal.value = "external";
    optExternal.textContent = "External URL";
    hrefTypeSelect.appendChild(optExternal);
    var optPage = document.createElement("option");
    optPage.value = "page";
    optPage.textContent = "Page link";
    hrefTypeSelect.appendChild(optPage);
    var currentHref = element[f.path];
    hrefTypeSelect.value = currentHref && currentHref.type ? currentHref.type : "external";

    var hrefValueContainer = document.createElement("div");

    function renderHrefValue() {
      hrefValueContainer.replaceChildren();
      var href = element[f.path];
      if (hrefTypeSelect.value === "external") {
        var urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.value = href && href.type === "external" ? href.url : "";
        urlInput.placeholder = "https://...";
        urlInput.addEventListener("change", function() {
          if (urlInput.value.length === 0) {
            setStatus("URL can not be empty", "error");
            return;
          }
          if (!isAllowedHref(urlInput.value)) {
            setStatus("URL not allowed", "error");
            return;
          }
          element[f.path] = { type: "external", url: urlInput.value };
          rebuildElement(element.id);
          scheduleSave();
        });
        hrefValueContainer.appendChild(urlInput);
        return;
      }
      // page branch
      var pageSelect = document.createElement("select");
      for (var pi = 0; pi < state.pages.length; pi++) {
        var p = state.pages[pi];
        var opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.title + " (/" + p.slug + ")";
        pageSelect.appendChild(opt);
      }
      if (href && href.type === "page") {
        pageSelect.value = href.pageId;
      }
      pageSelect.addEventListener("change", function() {
        element[f.path] = { type: "page", pageId: pageSelect.value };
        rebuildElement(element.id);
        scheduleSave();
      });
      hrefValueContainer.appendChild(pageSelect);
    }

    hrefTypeSelect.addEventListener("change", function() {
      if (hrefTypeSelect.value === "external") {
        element[f.path] = { type: "external", url: "" };
      } else {
        element[f.path] = { type: "page", pageId: state.pages[0] ? state.pages[0].id : "" };
      }
      renderHrefValue();
      rebuildElement(element.id);
      scheduleSave();
    });

    inspector.appendChild(field(f.discriminatorLabel, hrefTypeSelect));
    renderHrefValue();
    inspector.appendChild(field(f.valueLabel, hrefValueContainer));
  }

  // Action handler + busy-flag registries — spec carries the string name, the
  // interpreter holds the imperative function. Adding a new button-action
  // spec field requires registering the handler here too; the inspector
  // throws synchronously at first mount if the name is missing, surfacing
  // the gap immediately rather than as a silent no-op click.
  var INSPECTOR_ACTION_HANDLERS = {
    "rewrite-text": function(id) { aiRewriteText(id); },
    "replace-media": function(id) { aiReplaceMedia(id); },
  };
  var INSPECTOR_BUSY_FLAGS = {
    "aiBusy": function() { return aiBusy; },
  };
  // Mount handler registry for the "custom-mount" field kind. Each entry
  // receives (element, host) and is free to append nothing, one node, or
  // a full sub-tree. video-playback skips entirely on image elements
  // because the playback controls are video-only — that conditional lives
  // in the mount fn rather than the spec.
  var INSPECTOR_MOUNT_HANDLERS = {
    "media-picker": function(element, host) { mountMediaPicker(element, host); },
    "video-playback": function(element, host) { mountVideoPlayback(element, host); },
    "accordion-items": function(element, host) { mountAccordionItems(element, host); },
    "carousel-slides": function(element, host) { mountCarouselSlides(element, host); },
    "table-grid": function(element, host) { mountTableGrid(element, host); },
    "nav-links": function(element, host) { mountNavLinks(element, host); },
    "chart-data": function(element, host) { mountChartData(element, host); },
    "form-fields": function(element, host) { mountFormFields(element, host); },
    "form-style": function(element, host) { mountFormStyle(element, host); },
  };

  // Video-playback controls — autoplay, muted, loop, controls — with the
  // autoplay-implies-muted enforcement that the legacy buildMediaInspector
  // carried. No-op on images. Lazy-initialises element.playback on first
  // render so older sites that pre-date the playback field still pick up
  // the default shape on first inspector open.
  function mountVideoPlayback(element, host) {
    if (element.mediaKind !== "video") return;
    var playback = element.playback || (element.playback = { autoplay: false, muted: true, loop: false, controls: true });
    var autoplay = document.createElement("input");
    autoplay.type = "checkbox"; autoplay.checked = !!playback.autoplay;
    var muted = document.createElement("input");
    muted.type = "checkbox"; muted.checked = !!playback.muted;
    var loop = document.createElement("input");
    loop.type = "checkbox"; loop.checked = !!playback.loop;
    var controls = document.createElement("input");
    controls.type = "checkbox"; controls.checked = !!playback.controls;

    function enforceMuted() {
      if (autoplay.checked) {
        muted.checked = true;
        muted.disabled = true;
      } else {
        muted.disabled = false;
      }
    }
    enforceMuted();

    autoplay.addEventListener("change", function() {
      playback.autoplay = autoplay.checked;
      enforceMuted();
      playback.muted = muted.checked;
      scheduleSave();
    });
    muted.addEventListener("change", function() {
      if (autoplay.checked) { muted.checked = true; return; }
      playback.muted = muted.checked;
      scheduleSave();
    });
    loop.addEventListener("change", function() { playback.loop = loop.checked; scheduleSave(); });
    controls.addEventListener("change", function() { playback.controls = controls.checked; scheduleSave(); });

    function rowFor(node, labelText) {
      var row = document.createElement("div"); row.className = "row";
      row.appendChild(node);
      var lbl = document.createElement("label"); lbl.textContent = labelText; row.appendChild(lbl);
      return row;
    }
    host.appendChild(rowFor(autoplay, "autoplay"));
    host.appendChild(rowFor(muted, "muted"));
    host.appendChild(rowFor(loop, "loop"));
    host.appendChild(rowFor(controls, "controls"));
  }

  // -- Extracted inspector builders -----------------------------------------

  // buildTextInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/text.ts (uses button-action, select, number,
  // select-mapped field kinds).

  // buildActionInspector + buildShapeInspector + buildContainerInspector
  // migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1; see
  // src/canvas/elements/{action,shape,container}.ts. The action-href DU
  // editor lives in renderActionHrefField above (purpose-built; future
  // DU-shaped fields can copy the pattern or generalize when a second
  // element requires it).

  // buildMediaInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/media.ts. The two imperative sub-trees
  // (mountMediaPicker, mountVideoPlayback) are registered as custom-mount
  // handlers in INSPECTOR_MOUNT_HANDLERS above; mountVideoPlayback owns the
  // "skip on image" conditional and the autoplay-implies-muted enforcement.

  // buildFormInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/form.ts. Per-field editor (label + kind +
  // required + conditional placeholder + conditional options-list) lives
  // in mountFormFields; submitLabel / successMessage / webhookUrl are now
  // declarative text fields (webhookUrl uses noRebuild because the value
  // affects submission metadata, not the rendered output).
  function mountFormFields(element, host) {
    if (!Array.isArray(element.fields)) element.fields = [];
    var fieldListHost = document.createElement("div");

    function formOption(label) {
      return { value: label, label: label };
    }

    function assertFormOptionShape(option, fieldId, optionIndex) {
      if (!option || typeof option !== "object" || typeof option.value !== "string" || typeof option.label !== "string") {
        throw new Error("mountFormFields: field " + JSON.stringify(fieldId) + " option " + String(optionIndex) + " must be { value: string, label: string }");
      }
    }

    function renderFieldList() {
      fieldListHost.replaceChildren();
      for (var fi = 0; fi < element.fields.length; fi++) {
        (function(idx) {
          var f = element.fields[idx];
          var card = document.createElement("div");
          card.className = "inspector-list-card";

          var labelInput = document.createElement("input");
          labelInput.type = "text";
          labelInput.value = f.label;
          labelInput.placeholder = "Field label";
          labelInput.addEventListener("change", function() {
            f.label = labelInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Label", labelInput));

          var kindSel = selectInput(["text", "email", "textarea", "checkbox", "select"], f.kind);
          kindSel.addEventListener("change", function() {
            f.kind = kindSel.value;
            if (f.kind === "select" && !Array.isArray(f.options)) {
              f.options = [formOption("Option 1"), formOption("Option 2")];
            }
            rebuildElement(element.id);
            scheduleSave();
            renderFieldList();
          });
          card.appendChild(field("Kind", kindSel));

          var reqCheck = document.createElement("input");
          reqCheck.type = "checkbox";
          reqCheck.checked = !!f.required;
          reqCheck.addEventListener("change", function() {
            f.required = reqCheck.checked;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Required", reqCheck));

          if (f.kind !== "checkbox") {
            var phInput = document.createElement("input");
            phInput.type = "text";
            phInput.value = f.placeholder || "";
            phInput.placeholder = "Placeholder text";
            phInput.addEventListener("change", function() {
              f.placeholder = phInput.value;
              rebuildElement(element.id);
              scheduleSave();
            });
            card.appendChild(field("Placeholder", phInput));
          }

          if (f.kind === "select") {
            if (!Array.isArray(f.options)) f.options = [];
            var optHost = document.createElement("div");

            function renderOpts() {
              optHost.replaceChildren();
              for (var oi = 0; oi < f.options.length; oi++) {
                (function(optIdx) {
                  var option = f.options[optIdx];
                  assertFormOptionShape(option, f.id, optIdx);
                  var optRow = document.createElement("div");
                  optRow.style.cssText = "display:flex;gap:4px;margin-bottom:2px;";
                  var optInput = document.createElement("input");
                  optInput.type = "text";
                  optInput.value = option.label;
                  optInput.style.cssText = "flex:1;min-width:0;";
                  optInput.addEventListener("change", function() {
                    f.options[optIdx] = { value: optInput.value, label: optInput.value };
                    rebuildElement(element.id);
                    scheduleSave();
                  });
                  optRow.appendChild(optInput);
                  var rmOpt = document.createElement("button");
                  rmOpt.type = "button";
                  rmOpt.textContent = "x";
                  rmOpt.addEventListener("click", function() {
                    f.options.splice(optIdx, 1);
                    renderOpts();
                    rebuildElement(element.id);
                    scheduleSave();
                  });
                  optRow.appendChild(rmOpt);
                  optHost.appendChild(optRow);
                })(oi);
              }
              var addOpt = document.createElement("button");
              addOpt.type = "button";
              addOpt.textContent = "+ option";
              addOpt.addEventListener("click", function() {
                f.options.push(formOption("Option " + (f.options.length + 1)));
                renderOpts();
                rebuildElement(element.id);
                scheduleSave();
              });
              optHost.appendChild(addOpt);
            }
            renderOpts();
            card.appendChild(field("Options", optHost));
          }

          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.textContent = "Remove field";
          removeBtn.addEventListener("click", function() {
            element.fields.splice(idx, 1);
            renderFieldList();
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(removeBtn);

          fieldListHost.appendChild(card);
        })(fi);
      }

      var addFieldBtn = document.createElement("button");
      addFieldBtn.type = "button";
      addFieldBtn.textContent = "+ field";
      addFieldBtn.addEventListener("click", function() {
        element.fields.push({ id: newElementId(), label: "New field", kind: "text", required: false, placeholder: "" });
        renderFieldList();
        rebuildElement(element.id);
        scheduleSave();
      });
      fieldListHost.appendChild(addFieldBtn);
    }
    renderFieldList();
    host.appendChild(field("Fields", fieldListHost));
  }

  // Per-form visual customisation. Writes into element.formStyle and emits
  // CSS-variable overrides at render time (see src/canvas/elements/form.ts
  // formStyleAttrs). Sections are <details> disclosures so the inspector
  // stays scannable when nothing is overridden.
  function mountFormStyle(element, host) {
    var fs = element.formStyle || {};

    function ensureFs() {
      if (!element.formStyle) element.formStyle = fs;
    }
    function maybeClear() {
      var hasAny = false;
      for (var k in fs) {
        if (fs[k] !== undefined) { hasAny = true; break; }
      }
      if (!hasAny) delete element.formStyle;
    }
    function commit() {
      ensureFs();
      maybeClear();
      rebuildElement(element.id);
      scheduleSave();
    }

    function colorRowFor(key, swatchDefault, label) {
      var row = buildColorRow({
        getValue: function() { return fs[key]; },
        setValue: function(v) { fs[key] = v; },
        clearValue: function() { delete fs[key]; },
        onChange: commit,
        enabledTitle: "Enable " + label.toLowerCase(),
        swatchDefault: swatchDefault,
      });
      return field(label, row);
    }

    function pxRowFor(key, label, opts) {
      var min = opts && typeof opts.min === "number" ? opts.min : 0;
      var max = opts && typeof opts.max === "number" ? opts.max : 200;
      var placeholder = opts && opts.placeholder ? opts.placeholder : "auto";
      var row = document.createElement("div");
      row.className = "style-row";
      var input = document.createElement("input");
      input.type = "number";
      input.min = String(min);
      input.max = String(max);
      input.placeholder = placeholder;
      input.value = typeof fs[key] === "number" ? String(fs[key]) : "";
      input.style.width = "72px";
      var unit = document.createElement("span");
      unit.className = "unit-label";
      unit.textContent = "px";
      input.addEventListener("change", function() {
        var raw = input.value.trim();
        if (raw === "") {
          delete fs[key];
        } else {
          var n = Number(raw);
          if (!Number.isFinite(n) || n < min) {
            input.value = typeof fs[key] === "number" ? String(fs[key]) : "";
            return;
          }
          fs[key] = n;
        }
        commit();
      });
      row.appendChild(input);
      row.appendChild(unit);
      return field(label, row);
    }

    function weightRowFor(key, label) {
      var row = document.createElement("div");
      row.className = "style-row";
      var select = document.createElement("select");
      var options = [
        { value: "", label: "Default" },
        { value: "normal", label: "Normal" },
        { value: "medium", label: "Medium" },
        { value: "bold", label: "Bold" },
      ];
      for (var i = 0; i < options.length; i++) {
        var opt = document.createElement("option");
        opt.value = options[i].value;
        opt.textContent = options[i].label;
        select.appendChild(opt);
      }
      select.value = typeof fs[key] === "string" ? fs[key] : "";
      select.addEventListener("change", function() {
        if (select.value === "") delete fs[key];
        else fs[key] = select.value;
        commit();
      });
      row.appendChild(select);
      return field(label, row);
    }

    function checkboxRowFor(key, label) {
      var row = document.createElement("div");
      row.className = "style-row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!fs[key];
      cb.addEventListener("change", function() {
        if (cb.checked) fs[key] = true;
        else delete fs[key];
        commit();
      });
      row.appendChild(cb);
      return field(label, row);
    }

    function section(title, rows) {
      var details = document.createElement("details");
      details.className = "form-style-section";
      var summary = document.createElement("summary");
      summary.textContent = title;
      details.appendChild(summary);
      for (var i = 0; i < rows.length; i++) details.appendChild(rows[i]);
      return details;
    }

    // -- Typography
    var fontSelect = document.createElement("select");
    var fontOptions = [
      { value: "", label: "Default (inherit)" },
      { value: "kit-display", label: "Kit display font" },
      { value: "kit-body", label: "Kit body font" },
      { value: "kit-mono", label: "Kit mono font" },
      { value: "custom", label: "Custom font…" },
    ];
    for (var fi = 0; fi < fontOptions.length; fi++) {
      var fOpt = document.createElement("option");
      fOpt.value = fontOptions[fi].value;
      fOpt.textContent = fontOptions[fi].label;
      fontSelect.appendChild(fOpt);
    }
    fontSelect.value = typeof fs.fontFamily === "string" && fs.fontFamily !== "inherit" ? fs.fontFamily : "";
    var fontCustom = document.createElement("input");
    fontCustom.type = "text";
    fontCustom.placeholder = "e.g. 'Inter', system-ui, sans-serif";
    fontCustom.value = fs.fontFamilyCustom || "";
    fontCustom.style.marginTop = "6px";
    fontCustom.hidden = fontSelect.value !== "custom";
    fontSelect.addEventListener("change", function() {
      if (fontSelect.value === "") {
        delete fs.fontFamily;
        delete fs.fontFamilyCustom;
        fontCustom.hidden = true;
      } else {
        fs.fontFamily = fontSelect.value;
        if (fontSelect.value !== "custom") delete fs.fontFamilyCustom;
        fontCustom.hidden = fontSelect.value !== "custom";
      }
      commit();
    });
    fontCustom.addEventListener("change", function() {
      var v = fontCustom.value.trim();
      if (v === "") delete fs.fontFamilyCustom;
      else fs.fontFamilyCustom = v;
      commit();
    });
    var fontRowWrap = document.createElement("div");
    fontRowWrap.style.display = "flex";
    fontRowWrap.style.flexDirection = "column";
    fontRowWrap.style.gap = "4px";
    fontRowWrap.appendChild(fontSelect);
    fontRowWrap.appendChild(fontCustom);

    host.appendChild(section("Typography", [
      field("Font", fontRowWrap),
      pxRowFor("fontSize", "Base size", { min: 8, max: 48, placeholder: "inherit" }),
      pxRowFor("fieldGap", "Field gap", { min: 0, max: 64, placeholder: "14" }),
    ]));

    // -- Labels
    host.appendChild(section("Labels", [
      colorRowFor("labelColor", "#222222", "Color"),
      pxRowFor("labelFontSize", "Size", { min: 8, max: 32, placeholder: "inherit" }),
      weightRowFor("labelFontWeight", "Weight"),
    ]));

    // -- Inputs
    host.appendChild(section("Inputs", [
      colorRowFor("inputBackgroundColor", "#ffffff", "Background"),
      colorRowFor("inputColor", "#222222", "Text color"),
      colorRowFor("inputBorderColor", "#cccccc", "Border color"),
      pxRowFor("inputBorderWidth", "Border width", { min: 0, max: 8, placeholder: "1" }),
      pxRowFor("inputBorderRadius", "Radius", { min: 0, max: 40, placeholder: "6" }),
      pxRowFor("inputPaddingX", "Padding X", { min: 0, max: 40, placeholder: "12" }),
      pxRowFor("inputPaddingY", "Padding Y", { min: 0, max: 40, placeholder: "10" }),
      colorRowFor("inputPlaceholderColor", "#999999", "Placeholder"),
      colorRowFor("inputFocusRingColor", "#3b82f6", "Focus ring"),
    ]));

    // -- Submit
    host.appendChild(section("Submit button", [
      colorRowFor("submitBackgroundColor", "#3b82f6", "Background"),
      colorRowFor("submitColor", "#ffffff", "Text color"),
      colorRowFor("submitHoverBackgroundColor", "#2563eb", "Hover background"),
      colorRowFor("submitBorderColor", "#3b82f6", "Border color"),
      pxRowFor("submitBorderWidth", "Border width", { min: 0, max: 8, placeholder: "0" }),
      pxRowFor("submitBorderRadius", "Radius", { min: 0, max: 40, placeholder: "6" }),
      pxRowFor("submitPaddingX", "Padding X", { min: 0, max: 60, placeholder: "18" }),
      pxRowFor("submitPaddingY", "Padding Y", { min: 0, max: 40, placeholder: "10" }),
      pxRowFor("submitFontSize", "Font size", { min: 8, max: 32, placeholder: "14" }),
      weightRowFor("submitFontWeight", "Font weight"),
      checkboxRowFor("submitFullWidth", "Full width"),
    ]));
  }

  // buildEmbedInspector + buildCodeInspector migrated to INSPECTOR_DISPATCH
  // per ADR 0011 Step 1; see src/canvas/elements/{embed,code}.ts.

  // buildAccordionInspector migrated to INSPECTOR_DISPATCH per ADR 0011
  // Step 1; see src/canvas/elements/accordion.ts. The per-item editor
  // (title + rich-text body with contentEditable toolbar) lives in
  // mountAccordionItems below; the allowMultipleOpen checkbox is now a
  // declarative checkbox field in the spec.
  function mountAccordionItems(element, host) {
    if (!Array.isArray(element.items)) element.items = [];
    var itemListHost = document.createElement("div");

    // Accordion item bodies are stored as InlineRun[] but edited in a compact
    // inspector control. Render the saved runs as escaped HTML; only the small
    // mark allowlist below is converted back into tags.
    function runsToHtml(runs) {
      var out = "";
      for (var ri = 0; ri < runs.length; ri++) {
        var run = runs[ri];
        var text = run.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        var inner = text;
        var marks = Array.isArray(run.marks) ? run.marks : [];
        for (var mi = 0; mi < marks.length; mi++) {
          var m = marks[mi];
          if (m.type === "bold") inner = "<strong>" + inner + "</strong>";
          if (m.type === "italic") inner = "<em>" + inner + "</em>";
          if (m.type === "underline") inner = "<u>" + inner + "</u>";
          if (m.type === "strike") inner = "<s>" + inner + "</s>";
          if (m.type === "code") inner = "<code>" + inner + "</code>";
          if (m.type === "highlight") inner = "<mark>" + inner + "</mark>";
          if (m.type === "link") { var safeHref = /^(https?:|mailto:|tel:|\\/|#)/i.test(m.href) ? m.href : "#"; inner = '<a href="' + safeHref.replace(/"/g, "&quot;") + '">' + inner + "</a>"; }
        }
        out += inner;
      }
      return out;
    }

    function renderItemList() {
      itemListHost.replaceChildren();
      for (var ii = 0; ii < element.items.length; ii++) {
        (function(idx) {
          var item = element.items[idx];
          var card = document.createElement("div");
          card.className = "inspector-list-card";

          var titleInput = document.createElement("input");
          titleInput.type = "text";
          titleInput.value = item.title;
          titleInput.placeholder = "Title";
          titleInput.addEventListener("change", function() {
            item.title = titleInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Title", titleInput));

          var bodyWrap = document.createElement("div");
          var toolbar = document.createElement("div");
          toolbar.style.cssText = "display:flex;gap:2px;margin-bottom:4px;";
          var boldBtn = document.createElement("button"); boldBtn.type = "button"; boldBtn.textContent = "B"; boldBtn.style.fontWeight = "700";
          var italicBtn = document.createElement("button"); italicBtn.type = "button"; italicBtn.textContent = "I"; italicBtn.style.fontStyle = "italic";
          var underlineBtn = document.createElement("button"); underlineBtn.type = "button"; underlineBtn.textContent = "U"; underlineBtn.style.textDecoration = "underline";
          var strikeBtn = document.createElement("button"); strikeBtn.type = "button"; strikeBtn.textContent = "S"; strikeBtn.style.textDecoration = "line-through";
          toolbar.appendChild(boldBtn);
          toolbar.appendChild(italicBtn);
          toolbar.appendChild(underlineBtn);
          toolbar.appendChild(strikeBtn);
          bodyWrap.appendChild(toolbar);

          var editable = document.createElement("div");
          editable.setAttribute("contenteditable", "true");
          editable.style.cssText = "min-height:40px;padding:4px 6px;border:1px solid var(--opencanvas-hairline);border-radius:4px;font-size:12px;background:var(--opencanvas-bg-panel);color:var(--opencanvas-fg);overflow-y:auto;max-height:120px;";
          editable.innerHTML = runsToHtml(Array.isArray(item.body) ? item.body : []);
          bodyWrap.appendChild(editable);

          function wireAccordionToolbarButton(button, command) {
            button.addEventListener("mousedown", function(ev) {
              ev.preventDefault();
            });
            button.addEventListener("click", function() {
              editable.focus();
              document.execCommand(command);
            });
          }
          wireAccordionToolbarButton(boldBtn, "bold");
          wireAccordionToolbarButton(italicBtn, "italic");
          wireAccordionToolbarButton(underlineBtn, "underline");
          wireAccordionToolbarButton(strikeBtn, "strikeThrough");

          editable.addEventListener("blur", function() {
            item.body = serializeContentToRuns(editable);
            rebuildElement(element.id);
            scheduleSave();
          });

          card.appendChild(field("Body", bodyWrap));

          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.textContent = "Remove item";
          removeBtn.addEventListener("click", function() {
            element.items.splice(idx, 1);
            renderItemList();
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(removeBtn);

          itemListHost.appendChild(card);
        })(ii);
      }

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ item";
      addBtn.addEventListener("click", function() {
        element.items.push({ id: newElementId(), title: "New item", body: [{ text: "Content" }] });
        renderItemList();
        rebuildElement(element.id);
        scheduleSave();
      });
      itemListHost.appendChild(addBtn);
    }
    renderItemList();
    host.appendChild(field("Items", itemListHost));
  }

  // buildCarouselInspector migrated to INSPECTOR_DISPATCH per ADR 0011
  // Step 1; see src/canvas/elements/carousel.ts. Per-slide editor (thumbnail
  // + upload + caption + link) lives in mountCarouselSlides; showArrows /
  // showDots are now declarative checkbox fields.
  function mountCarouselSlides(element, host) {
    if (!Array.isArray(element.slides)) element.slides = [];
    var slideListHost = document.createElement("div");

    function renderSlideList() {
      slideListHost.replaceChildren();
      for (var si = 0; si < element.slides.length; si++) {
        (function(idx) {
          var slide = element.slides[idx];
          var card = document.createElement("div");
          card.className = "inspector-list-card";

          var thumbWrap = document.createElement("div");
          thumbWrap.style.cssText = "margin-bottom:4px;";
          var thumb = buildPickerThumb(slide.assetId, slide.assetId, function() {});
          thumbWrap.appendChild(thumb);

          var fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.accept = "image/*";
          fileInput.style.display = "none";
          var uploadBtn = document.createElement("button");
          uploadBtn.type = "button";
          uploadBtn.textContent = "Upload image";
          uploadBtn.addEventListener("click", function() {
            fileInput.value = "";
            fileInput.click();
          });
          fileInput.addEventListener("change", function() {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            setStatus("Uploading...");
            postAssetUpload(file, "", element.id).then(function(result) {
              slide.assetId = result.assetId;
              rebuildElement(element.id);
              scheduleSave();
              renderSlideList();
              setStatus("Uploaded", "ok");
            }).catch(function(err) {
              setStatus("Upload failed: " + (err && err.message ? err.message : String(err)), "error");
            });
          });
          thumbWrap.appendChild(uploadBtn);
          thumbWrap.appendChild(fileInput);
          card.appendChild(thumbWrap);

          var captionInput = document.createElement("input");
          captionInput.type = "text";
          captionInput.value = slide.caption || "";
          captionInput.placeholder = "Caption";
          captionInput.addEventListener("change", function() {
            slide.caption = captionInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Caption", captionInput));

          var hrefInput = document.createElement("input");
          hrefInput.type = "text";
          hrefInput.value = slide.href || "";
          hrefInput.placeholder = "Link (optional)";
          hrefInput.addEventListener("change", function() {
            slide.href = hrefInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Link", hrefInput));

          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.textContent = "Remove slide";
          removeBtn.addEventListener("click", function() {
            element.slides.splice(idx, 1);
            renderSlideList();
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(removeBtn);

          slideListHost.appendChild(card);
        })(si);
      }

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ slide";
      addBtn.addEventListener("click", function() {
        element.slides.push({ id: newElementId(), assetId: "__placeholder__", caption: "" });
        renderSlideList();
        rebuildElement(element.id);
        scheduleSave();
      });
      slideListHost.appendChild(addBtn);
    }
    renderSlideList();
    host.appendChild(field("Slides", slideListHost));
  }

  // buildTableInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/table.ts. 2D rows × columns editor lives in
  // mountTableGrid; zebra / collapseOnPhone are now declarative checkboxes.
  function mountTableGrid(element, host) {
    if (!Array.isArray(element.columns)) element.columns = [];
    if (!Array.isArray(element.rows)) element.rows = [];
    var gridHost = document.createElement("div");

    function renderTableGrid() {
      gridHost.replaceChildren();
      var table = document.createElement("table");
      table.style.cssText = "width:100%;border-collapse:collapse;font-size:11px;";

      var thead = document.createElement("thead");
      var headerRow = document.createElement("tr");
      var cornerCell = document.createElement("th");
      cornerCell.textContent = "#";
      cornerCell.style.cssText = "padding:2px 4px;border:1px solid var(--opencanvas-hairline);";
      headerRow.appendChild(cornerCell);

      for (var ci = 0; ci < element.columns.length; ci++) {
        (function(colIdx) {
          var col = element.columns[colIdx];
          var th = document.createElement("th");
          th.style.cssText = "padding:2px;border:1px solid var(--opencanvas-hairline);";
          var headerInput = document.createElement("input");
          headerInput.type = "text";
          headerInput.value = col.header;
          headerInput.style.cssText = "width:100%;box-sizing:border-box;font-size:11px;";
          headerInput.addEventListener("change", function() {
            col.header = headerInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          th.appendChild(headerInput);

          var rmColBtn = document.createElement("button");
          rmColBtn.type = "button";
          rmColBtn.textContent = "x";
          rmColBtn.title = "Remove column";
          rmColBtn.style.cssText = "font-size:9px;padding:0 3px;margin-left:2px;";
          rmColBtn.addEventListener("click", function() {
            var removedId = element.columns[colIdx].id;
            element.columns.splice(colIdx, 1);
            for (var ri = 0; ri < element.rows.length; ri++) {
              if (element.rows[ri].cells && element.rows[ri].cells[removedId] !== undefined) {
                delete element.rows[ri].cells[removedId];
              }
            }
            renderTableGrid();
            rebuildElement(element.id);
            scheduleSave();
          });
          th.appendChild(rmColBtn);
          headerRow.appendChild(th);
        })(ci);
      }

      var addColTh = document.createElement("th");
      addColTh.style.cssText = "padding:2px;border:1px solid var(--opencanvas-hairline);";
      var addColBtn = document.createElement("button");
      addColBtn.type = "button";
      addColBtn.textContent = "+ col";
      addColBtn.addEventListener("click", function() {
        var newColId = newElementId();
        element.columns.push({ id: newColId, header: "Column " + (element.columns.length + 1) });
        for (var ri = 0; ri < element.rows.length; ri++) {
          if (!element.rows[ri].cells) element.rows[ri].cells = {};
          element.rows[ri].cells[newColId] = "";
        }
        renderTableGrid();
        rebuildElement(element.id);
        scheduleSave();
      });
      addColTh.appendChild(addColBtn);
      headerRow.appendChild(addColTh);
      thead.appendChild(headerRow);
      table.appendChild(thead);

      var tbody = document.createElement("tbody");
      for (var rowIdx = 0; rowIdx < element.rows.length; rowIdx++) {
        (function(ri) {
          var rowData = element.rows[ri];
          if (!rowData.cells) rowData.cells = {};
          var tr = document.createElement("tr");

          var numCell = document.createElement("td");
          numCell.textContent = String(ri + 1);
          numCell.style.cssText = "padding:2px 4px;border:1px solid var(--opencanvas-hairline);text-align:center;color:var(--opencanvas-fg-faint);";
          tr.appendChild(numCell);

          for (var ci2 = 0; ci2 < element.columns.length; ci2++) {
            (function(colIdx2) {
              var colId = element.columns[colIdx2].id;
              var td = document.createElement("td");
              td.style.cssText = "padding:1px;border:1px solid var(--opencanvas-hairline);";
              var cellInput = document.createElement("input");
              cellInput.type = "text";
              cellInput.value = rowData.cells[colId] || "";
              cellInput.style.cssText = "width:100%;box-sizing:border-box;font-size:11px;";
              cellInput.addEventListener("change", function() {
                rowData.cells[colId] = cellInput.value;
                rebuildElement(element.id);
                scheduleSave();
              });
              td.appendChild(cellInput);
              tr.appendChild(td);
            })(ci2);
          }

          var rmCell = document.createElement("td");
          rmCell.style.cssText = "padding:2px;border:1px solid var(--opencanvas-hairline);";
          var rmRowBtn = document.createElement("button");
          rmRowBtn.type = "button";
          rmRowBtn.textContent = "x";
          rmRowBtn.title = "Remove row";
          rmRowBtn.addEventListener("click", function() {
            element.rows.splice(ri, 1);
            renderTableGrid();
            rebuildElement(element.id);
            scheduleSave();
          });
          rmCell.appendChild(rmRowBtn);
          tr.appendChild(rmCell);
          tbody.appendChild(tr);
        })(rowIdx);
      }

      var addRowTr = document.createElement("tr");
      var addRowTd = document.createElement("td");
      addRowTd.colSpan = element.columns.length + 2;
      var addRowBtn = document.createElement("button");
      addRowBtn.type = "button";
      addRowBtn.textContent = "+ row";
      addRowBtn.addEventListener("click", function() {
        var cells = {};
        for (var ci3 = 0; ci3 < element.columns.length; ci3++) {
          cells[element.columns[ci3].id] = "";
        }
        element.rows.push({ id: newElementId(), cells: cells });
        renderTableGrid();
        rebuildElement(element.id);
        scheduleSave();
      });
      addRowTd.appendChild(addRowBtn);
      addRowTr.appendChild(addRowTd);
      tbody.appendChild(addRowTr);
      table.appendChild(tbody);
      gridHost.appendChild(table);

      if (element.columns.length === 0 && element.rows.length === 0) {
        var hint = document.createElement("div");
        hint.style.fontSize = "11px";
        hint.style.opacity = "0.7";
        hint.style.marginTop = "4px";
        hint.textContent = "Add a column and a row to start.";
        gridHost.appendChild(hint);
      }
    }
    renderTableGrid();
    host.appendChild(field("Data", gridHost));
  }

  // buildNavInspector migrated to INSPECTOR_DISPATCH per ADR 0011 Step 1;
  // see src/canvas/elements/nav.ts. Per-link editor (label + href + kind
  // with per-kind href validation) lives in mountNavLinks; layout / sticky
  // / logoAssetId are now declarative select / checkbox / text fields.
  function mountNavLinks(element, host) {
    if (!Array.isArray(element.links)) element.links = [];
    var linkListHost = document.createElement("div");

    function validateNavLinkEdit(kind, href) {
      if (kind === "anchor" && (typeof href !== "string" || href.charAt(0) !== "#")) {
        setStatus("Anchor targets must start with #.", "error");
        return false;
      }
      return true;
    }

    function renderLinkList() {
      linkListHost.replaceChildren();
      for (var li = 0; li < element.links.length; li++) {
        (function(idx) {
          var lnk = element.links[idx];
          var card = document.createElement("div");
          card.className = "inspector-list-card";

          var labelInput = document.createElement("input");
          labelInput.type = "text";
          labelInput.value = lnk.label;
          labelInput.placeholder = "Label";
          labelInput.addEventListener("change", function() {
            lnk.label = labelInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Label", labelInput));

          var hrefInput = document.createElement("input");
          hrefInput.type = "text";
          hrefInput.value = lnk.href;
          hrefInput.placeholder = lnk.kind === "anchor" ? "#section" : (lnk.kind === "external" ? "https://..." : "/page");
          hrefInput.addEventListener("change", function() {
            if (!validateNavLinkEdit(lnk.kind, hrefInput.value)) {
              hrefInput.value = lnk.href;
              return;
            }
            lnk.href = hrefInput.value;
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Href", hrefInput));

          var kindSel = selectInput(["internal", "external", "anchor"], lnk.kind);
          kindSel.addEventListener("change", function() {
            if (!validateNavLinkEdit(kindSel.value, lnk.href)) {
              kindSel.value = lnk.kind;
              return;
            }
            lnk.kind = kindSel.value;
            hrefInput.placeholder = lnk.kind === "anchor" ? "#section" : (lnk.kind === "external" ? "https://..." : "/page");
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(field("Kind", kindSel));

          var removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.textContent = "Remove link";
          removeBtn.addEventListener("click", function() {
            element.links.splice(idx, 1);
            renderLinkList();
            rebuildElement(element.id);
            scheduleSave();
          });
          card.appendChild(removeBtn);

          linkListHost.appendChild(card);
        })(li);
      }

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ link";
      addBtn.addEventListener("click", function() {
        element.links.push({ label: "New link", href: "/", kind: "internal" });
        renderLinkList();
        rebuildElement(element.id);
        scheduleSave();
      });
      linkListHost.appendChild(addBtn);
    }
    renderLinkList();
    host.appendChild(field("Links", linkListHost));
  }

  // Revoke any blob URLs held by AI-preview wraps before wiping the
  // inspector. Without this, navigating selection while a preview is open
  // leaks the bytes for the rest of the tab session.
  function revokePendingPreviews() {
    if (!inspector) return;
    const previews = inspector.querySelectorAll("[data-object-url]");
    for (let i = 0; i < previews.length; i++) {
      const url = previews[i].getAttribute("data-object-url");
      if (url) URL.revokeObjectURL(url);
    }
  }

  function findCurrentPageSectionInfo(sectionId) {
    var page = currentPage();
    if (!page) return null;
    for (var i = 0; i < page.sections.length; i++) {
      if (page.sections[i].id === sectionId) return { page: page, index: i };
    }
    return null;
  }

  function selectableSectionRoles(section) {
    var roles = ["body"];
    var sectionInfo = findCurrentPageSectionInfo(section.id);
    if (!sectionInfo) {
      if (section.role === "header") return ["header"];
      if (section.role === "footer") return ["footer"];
      return roles;
    }
    var hasOtherHeader = sectionInfo.page.sections.some(function(candidate) {
      return candidate.id !== section.id && candidate.role === "header";
    });
    if (section.role === "header" || (sectionInfo.index === 0 && !hasOtherHeader)) {
      roles.push("header");
    }
    var hasOtherFooter = sectionInfo.page.sections.some(function(candidate) {
      return candidate.id !== section.id && candidate.role === "footer";
    });
    if (
      section.role === "footer" ||
      (sectionInfo.index === sectionInfo.page.sections.length - 1 && !hasOtherFooter)
    ) {
      roles.push("footer");
    }
    return roles;
  }

  function renderSectionInspector() {
    if (!inspector) return;
    var section = findSection(selectedSectionId);
    if (!section) {
      inspector.hidden = true;
      inspector.replaceChildren();
      return;
    }
    revokePendingPreviews();
    inspector.replaceChildren();
    inspector.hidden = false;

    var heading = document.createElement("h3");
    heading.textContent = "Section";
    inspector.appendChild(heading);

    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = section.name || section.recipeId;
    inspector.appendChild(meta);

    // -- Section fields (ADR 0033) --------------------------------------
    // Grouped Identity (role) -> Background (effect, video) -> Motion
    // (entrance) -> Behaviour (trigger). All five fields previously
    // existed in the schema (src/canvas/schema.ts:337-351) without
    // editor UI; AI Chat was the only mutation surface. Hand-rolled
    // groups (no spec-driven generation): the section inspector is
    // not in INSPECTOR_DISPATCH because section is not an ElementType.

    // -- Identity -------------------------------------------------------
    var groupIdentity = document.createElement("div");
    groupIdentity.className = "opencanvas-page-inspector-group";
    var hIdentity = document.createElement("h4");
    hIdentity.textContent = "Identity";
    groupIdentity.appendChild(hIdentity);
    var roleLabel = document.createElement("label");
    roleLabel.textContent = "Role";
    roleLabel.style.display = "block";
    roleLabel.style.fontSize = "12px";
    roleLabel.style.color = "var(--opencanvas-fg-mute)";
    roleLabel.style.marginBottom = "4px";
    groupIdentity.appendChild(roleLabel);
    var roleSel = selectInput(selectableSectionRoles(section), section.role || "body");
    roleSel.addEventListener("change", function() {
      if (roleSel.value === "body") delete section.role;
      else section.role = roleSel.value;
      // Re-render: role change can flip pinned/unpinned which changes
      // the action-buttons list (Duplicate/Move up/Move down are hidden
      // for pinned sections at line 4194).
      captureForUndo();
      renderAll();
      renderSectionInspector();
      scheduleSave();
    });
    groupIdentity.appendChild(roleSel);
    inspector.appendChild(groupIdentity);

    // -- Background -----------------------------------------------------
    var groupBg = document.createElement("div");
    groupBg.className = "opencanvas-page-inspector-group";
    var hBg = document.createElement("h4");
    hBg.textContent = "Background";
    groupBg.appendChild(hBg);
    var bgEffectLabel = document.createElement("label");
    bgEffectLabel.textContent = "Effect";
    bgEffectLabel.style.cssText = "display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px";
    groupBg.appendChild(bgEffectLabel);
    var bgEffectSel = selectInput(
      ["none", "grain", "grid", "soft-light", "paper", "glass"],
      section.backgroundEffect || "none"
    );
    bgEffectSel.addEventListener("change", function() {
      if (bgEffectSel.value === "none") delete section.backgroundEffect;
      else section.backgroundEffect = bgEffectSel.value;
      captureForUndo();
      renderAll();
      scheduleSave();
    });
    groupBg.appendChild(bgEffectSel);

    var bgVideoLabel = document.createElement("label");
    bgVideoLabel.textContent = "Video";
    bgVideoLabel.style.cssText = "display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin:10px 0 4px";
    groupBg.appendChild(bgVideoLabel);
    var bgVideoRow = document.createElement("div");
    bgVideoRow.style.cssText = "display:flex;gap:6px;align-items:center";
    var bgVideoStatus = document.createElement("div");
    bgVideoStatus.textContent = section.backgroundVideoAssetId
      ? ("Asset " + section.backgroundVideoAssetId.slice(0, 8) + "...")
      : "none";
    bgVideoStatus.style.cssText = "flex:1;font-size:12px;color:var(--opencanvas-fg-mute);overflow:hidden;text-overflow:ellipsis";
    var bgVideoUpload = document.createElement("button");
    bgVideoUpload.type = "button";
    bgVideoUpload.textContent = "Upload";
    bgVideoUpload.className = "style-btn";
    var bgVideoClear = document.createElement("button");
    bgVideoClear.type = "button";
    bgVideoClear.textContent = "x";
    bgVideoClear.className = "style-btn-clear";
    bgVideoClear.title = "Clear background video";
    bgVideoClear.disabled = !section.backgroundVideoAssetId;
    var bgVideoFileInput = document.createElement("input");
    bgVideoFileInput.type = "file";
    bgVideoFileInput.accept = "video/*";
    bgVideoFileInput.style.display = "none";
    bgVideoFileInput.addEventListener("change", function() {
      if (!bgVideoFileInput.files || bgVideoFileInput.files.length === 0) return;
      var file = bgVideoFileInput.files[0];
      setStatus("Uploading background video...", "info");
      postAssetUpload(file, "", "").then(function(result) {
        section.backgroundVideoAssetId = result.assetId;
        captureForUndo();
        renderAll();
        renderSectionInspector();
        scheduleSave();
        setStatus("Background video set", "ok");
      }).catch(function(err) {
        setStatus("Upload failed: " + err.message, "error");
      });
    });
    bgVideoUpload.addEventListener("click", function() {
      bgVideoFileInput.value = "";
      bgVideoFileInput.click();
    });
    bgVideoClear.addEventListener("click", function() {
      delete section.backgroundVideoAssetId;
      captureForUndo();
      renderAll();
      renderSectionInspector();
      scheduleSave();
    });
    bgVideoRow.appendChild(bgVideoStatus);
    bgVideoRow.appendChild(bgVideoUpload);
    bgVideoRow.appendChild(bgVideoClear);
    bgVideoRow.appendChild(bgVideoFileInput);
    groupBg.appendChild(bgVideoRow);
    inspector.appendChild(groupBg);

    // -- Motion ---------------------------------------------------------
    var groupMotion = document.createElement("div");
    groupMotion.className = "opencanvas-page-inspector-group";
    var hMotion = document.createElement("h4");
    hMotion.textContent = "Motion";
    groupMotion.appendChild(hMotion);
    var entranceLabel = document.createElement("label");
    entranceLabel.textContent = "Entrance preset";
    entranceLabel.style.cssText = "display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px";
    groupMotion.appendChild(entranceLabel);
    var entranceSel = selectInput(MOTION_PRESETS, section.entrance || "none");
    entranceSel.addEventListener("change", function() {
      if (entranceSel.value === "none") delete section.entrance;
      else section.entrance = entranceSel.value;
      captureForUndo();
      renderAll();
      scheduleSave();
    });
    groupMotion.appendChild(entranceSel);
    inspector.appendChild(groupMotion);

    // -- Behaviour (popup trigger) --------------------------------------
    var groupBeh = document.createElement("div");
    groupBeh.className = "opencanvas-page-inspector-group";
    var hBeh = document.createElement("h4");
    hBeh.textContent = "Behaviour";
    groupBeh.appendChild(hBeh);
    var triggerLabel = document.createElement("label");
    triggerLabel.textContent = "Popup trigger";
    triggerLabel.style.cssText = "display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px";
    groupBeh.appendChild(triggerLabel);
    var currentTriggerType = section.trigger ? section.trigger.type : "none";
    var triggerSel = selectInput(["none", "exit-intent", "delay", "scroll"], currentTriggerType);
    triggerSel.addEventListener("change", function() {
      if (triggerSel.value === "none") {
        delete section.trigger;
      } else if (triggerSel.value === "exit-intent") {
        section.trigger = { type: "exit-intent" };
      } else if (triggerSel.value === "delay") {
        var prev = section.trigger && section.trigger.type === "delay" ? section.trigger.value : 5000;
        section.trigger = { type: "delay", value: prev };
      } else if (triggerSel.value === "scroll") {
        var prevS = section.trigger && section.trigger.type === "scroll" ? section.trigger.value : 50;
        section.trigger = { type: "scroll", value: prevS };
      }
      captureForUndo();
      renderAll();
      renderSectionInspector();
      scheduleSave();
    });
    groupBeh.appendChild(triggerSel);
    if (section.trigger && (section.trigger.type === "delay" || section.trigger.type === "scroll")) {
      var valRow = document.createElement("div");
      valRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:6px";
      var valInput = document.createElement("input");
      valInput.type = "number";
      valInput.value = String(section.trigger.value);
      valInput.min = "0";
      valInput.max = section.trigger.type === "scroll" ? "100" : "60000";
      valInput.style.cssText = "flex:1";
      var unit = document.createElement("span");
      unit.textContent = section.trigger.type === "scroll" ? "%" : "ms";
      unit.style.cssText = "font-size:12px;color:var(--opencanvas-fg-mute)";
      valInput.addEventListener("change", function() {
        var v = parseInt(valInput.value, 10);
        if (!isNaN(v) && section.trigger && (section.trigger.type === "delay" || section.trigger.type === "scroll")) {
          section.trigger.value = v;
          captureForUndo();
          scheduleSave();
        }
      });
      valRow.appendChild(valInput);
      valRow.appendChild(unit);
      groupBeh.appendChild(valRow);
    }
    inspector.appendChild(groupBeh);

    // -- Action buttons (existing grid below the fields) ----------------
    var grid = document.createElement("div");
    grid.className = "opencanvas-section-inspector-grid";

    var pinned = isPinnedSection(section);
    var defs = [];
    if (!pinned) {
      defs.push({ label: "Duplicate", action: "duplicate-section", tip: "Create a copy of this section" });
      defs.push({ label: "Move up", action: "move-up", tip: "Move this section up on the page" });
      defs.push({ label: "Move down", action: "move-down", tip: "Move this section down on the page" });
    }
    defs.push({ label: "Save to library", action: "save-to-library", tip: "Save this section for reuse on other pages" });
    defs.push({ label: "Delete section", action: "delete-section", danger: true, tip: "Remove this section from the page" });

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = def.label;
      btn.title = def.tip;
      btn.setAttribute("data-section-action", def.action);
      btn.setAttribute("data-section-id", section.id);
      if (def.danger) btn.classList.add("danger");
      grid.appendChild(btn);
    }

    var aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.textContent = "Generate with AI";
    aiBtn.title = "Use AI to design this section from a description";
    aiBtn.setAttribute("data-ai-button", "create-section");
    aiBtn.setAttribute("data-section-id", section.id);
    if (aiBusy) aiBtn.disabled = true;
    aiBtn.addEventListener("click", function(ev) {
      ev.stopPropagation();
      aiCreateSection(section.id);
    });
    grid.appendChild(aiBtn);

    inspector.appendChild(grid);
  }

  // -- Animation replay ---------------------------------------------------
  function replayAnimations(scope) {
    // scope: "page" replays all, or an element id replays just that one.
    // Two motion paths exist server-side (src/canvas/render.ts):
    //   1. on-load: the element gets data-motion-preset right away and the
    //      style-kit's @keyframes fires once on mount.
    //   2. on-scroll: the page renders with data-entrance-animation +
    //      data-scroll-trigger="on-scroll" and the public renderer's
    //      IntersectionObserver promotes the attribute when the element
    //      intersects the viewport.
    // The editor doesn't ship that observer so on-scroll items would never
    // animate without help. Replay treats both paths the same: read either
    // attribute, then drive data-motion-preset to trigger the keyframes.
    var page = currentPage();
    if (!page) return;
    var targets;
    if (scope === "page") {
      var artboard = root.querySelector('[data-page-id="' + cssEscape(activePageId || page.id) + '"]');
      if (!artboard) return;
      targets = artboard.querySelectorAll("[data-motion-preset], [data-entrance-animation]");
    } else {
      var el = root.querySelector('[data-opencanvas-element="' + cssEscape(scope) + '"]');
      if (!el) { targets = []; } else { targets = [el]; }
    }
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var preset = t.getAttribute("data-motion-preset") || t.getAttribute("data-entrance-animation");
      if (!preset || preset === "none") continue;
      t.removeAttribute("data-motion-preset");
      // Force layout so the browser restarts the CSS animation. Reading
      // offsetWidth is the load-bearing op (any layout read works); the
      // void operator discards the value to keep linters quiet about a
      // useless expression. Without this read the browser may batch the
      // attribute remove + set into a single style change and skip the
      // animation entirely.
      void t.offsetWidth;
      t.setAttribute("data-motion-preset", preset);
    }
  }

  function pageHasMotion() {
    var page = currentPage();
    if (!page) return false;
    if (page.entranceAnimation && page.entranceAnimation !== "none") return true;
    for (var i = 0; i < page.sections.length; i++) {
      var sec = page.sections[i];
      for (var j = 0; j < sec.elements.length; j++) {
        if (sec.elements[j].motion) return true;
      }
    }
    return false;
  }

  // -- Page inspector (right panel when nothing selected) -----------------
  function renderPageInspector() {
    if (!inspector) return;
    var page = currentPage();
    if (!page) { inspector.hidden = true; inspector.replaceChildren(); return; }
    revokePendingPreviews();
    inspector.replaceChildren();
    inspector.hidden = false;

    var heading = document.createElement("h3");
    heading.textContent = "Page";
    inspector.appendChild(heading);
    // Editable page title. The artboard label on the canvas mirrors this
    // value (built off page.title in renderAll), so a single edit here
    // updates the on-canvas label too. We commit on blur AND on Enter so
    // a quick rename doesn't require tab-out, but withhold autosaves until
    // commit so an in-flight edit can't ship a half-typed title to peers.
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "meta meta-editable";
    titleInput.value = page.title || page.slug;
    titleInput.placeholder = page.slug;
    titleInput.setAttribute("aria-label", "Page title");
    function commitTitle() {
      var next = titleInput.value.trim();
      var current = page.title || "";
      if (next === current) return;
      if (next.length === 0) {
        // Treat clearing the field as "revert to slug" — the artboard
        // label falls back to slug anyway. Capture for undo so this
        // counts as one operation in history.
        page.title = page.slug;
      } else {
        page.title = next;
      }
      captureForUndo();
      renderAll();
      updatePageSidebar();
      scheduleSave();
      setStatus("Page renamed", "ok");
    }
    titleInput.addEventListener("blur", commitTitle);
    titleInput.addEventListener("keydown", function(ev) {
      if (ev.key === "Enter") { ev.preventDefault(); titleInput.blur(); }
      else if (ev.key === "Escape") { titleInput.value = page.title || page.slug; titleInput.blur(); }
    });
    inspector.appendChild(titleInput);

    // -- Custom 404 toggle ------------------------------------------------
    // ADR 0029: the slug '_404' IS the custom-404 mechanism; this toggle
    // is the view onto that fact (no parallel boolean field). Toggle-on
    // sets page.slug = '_404'. If another page is already '_404' it is
    // auto-demoted in the same write — the cardinality invariant (at
    // most one page per site has slug '_404', enforced at
    // src/canvas/validate.ts:1110) is never transiently violated.
    // Always-confirm policy (user-chosen) shows a modal on toggle-on
    // when a demotion is needed AND on toggle-off (significant change
    // either way).
    var group404 = document.createElement("div");
    group404.className = "opencanvas-page-inspector-group";
    var h404 = document.createElement("h4");
    h404.textContent = "Custom 404 page";
    group404.appendChild(h404);
    var toggle404Row = document.createElement("label");
    toggle404Row.style.display = "flex";
    toggle404Row.style.alignItems = "center";
    toggle404Row.style.gap = "8px";
    toggle404Row.style.cursor = "pointer";
    var toggle404Input = document.createElement("input");
    toggle404Input.type = "checkbox";
    toggle404Input.checked = page.slug === "_404";
    var toggle404Text = document.createElement("span");
    toggle404Text.textContent = "Use this page as the custom 404";
    toggle404Row.appendChild(toggle404Input);
    toggle404Row.appendChild(toggle404Text);
    function nextFreeSlugFor(targetPage) {
      var base = (targetPage.title || "page")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (base.length === 0 || base === "_404" || base === "404") base = "page";
      var slug = base;
      var counter = 2;
      while (state.pages.some(function(p) { return p.id !== targetPage.id && p.slug === slug; })) {
        slug = base + "-" + counter;
        counter++;
      }
      return slug;
    }
    toggle404Input.addEventListener("change", function() {
      if (toggle404Input.checked) {
        var existing404 = null;
        for (var i = 0; i < state.pages.length; i++) {
          if (state.pages[i].id !== page.id && state.pages[i].slug === "_404") {
            existing404 = state.pages[i];
            break;
          }
        }
        if (existing404) {
          var demotedSlug = nextFreeSlugFor(existing404);
          openConfirmModal({
            title: "Demote current 404 page",
            message: 'Page "' + (existing404.title || existing404.slug) + '" is currently your custom 404. Toggling on for this page will demote it to a regular page at slug /' + demotedSlug + '. Continue?',
            confirmLabel: "Yes, demote and switch",
          }).then(function(confirmed) {
            if (!confirmed) { toggle404Input.checked = false; return; }
            existing404.slug = demotedSlug;
            page.slug = "_404";
            captureForUndo();
            renderAll();
            updatePageSidebar();
            renderPageInspector();
            scheduleSave();
            setStatus("Custom 404 page set", "ok");
          });
        } else {
          page.slug = "_404";
          captureForUndo();
          renderAll();
          updatePageSidebar();
          renderPageInspector();
          scheduleSave();
          setStatus("Custom 404 page set", "ok");
        }
      } else {
        openConfirmModal({
          title: "Remove custom 404 status",
          message: "This page will no longer be your custom 404. Visitors hitting unknown URLs will see the default 404 page.",
          confirmLabel: "Remove",
        }).then(function(confirmed) {
          if (!confirmed) { toggle404Input.checked = true; return; }
          page.slug = nextFreeSlugFor(page);
          captureForUndo();
          renderAll();
          updatePageSidebar();
          renderPageInspector();
          scheduleSave();
          setStatus("Custom 404 status removed; slug set to /" + page.slug, "ok");
        });
      }
    });
    group404.appendChild(toggle404Row);
    inspector.appendChild(group404);

    // -- Entrance animation -----------------------------------------------
    var group1 = document.createElement("div");
    group1.className = "opencanvas-page-inspector-group";
    var h4a = document.createElement("h4");
    h4a.textContent = "Entrance animation";
    group1.appendChild(h4a);

    var entranceSel = selectInput(MOTION_PRESETS, page.entranceAnimation || "none");
    entranceSel.addEventListener("change", function() {
      if (entranceSel.value === "none") {
        delete page.entranceAnimation;
      } else {
        page.entranceAnimation = entranceSel.value;
        if (!page.scrollTriggerMode) page.scrollTriggerMode = "on-load";
      }
      applyPageStyles(page);
      renderInspector();
      scheduleSave();
    });
    group1.appendChild(entranceSel);
    inspector.appendChild(group1);

    // -- Scroll trigger mode ----------------------------------------------
    var group2 = document.createElement("div");
    group2.className = "opencanvas-page-inspector-group";
    var h4b = document.createElement("h4");
    h4b.textContent = "Animation trigger";
    group2.appendChild(h4b);

    var triggerSel = selectInput(SCROLL_TRIGGER_MODES, page.scrollTriggerMode || "on-load");
    triggerSel.addEventListener("change", function() {
      page.scrollTriggerMode = triggerSel.value;
      applyPageStyles(page);
      scheduleSave();
    });
    group2.appendChild(triggerSel);
    inspector.appendChild(group2);

    // -- Default motion preset --------------------------------------------
    var group3 = document.createElement("div");
    group3.className = "opencanvas-page-inspector-group";
    var h4c = document.createElement("h4");
    h4c.textContent = "Default motion for new elements";
    group3.appendChild(h4c);

    var defaultSel = selectInput(MOTION_PRESETS, page.defaultMotionPreset || "none");
    defaultSel.addEventListener("change", function() {
      if (defaultSel.value === "none") {
        delete page.defaultMotionPreset;
      } else {
        page.defaultMotionPreset = defaultSel.value;
      }
      scheduleSave();
    });
    group3.appendChild(defaultSel);
    inspector.appendChild(group3);

    // -- Divider ----------------------------------------------------------
    var divider1 = document.createElement("div");
    divider1.className = "opencanvas-page-inspector-divider";
    inspector.appendChild(divider1);

    // -- Play / replay animations -----------------------------------------
    var group4 = document.createElement("div");
    group4.className = "opencanvas-page-inspector-group";
    var h4d = document.createElement("h4");
    h4d.textContent = "Preview";
    group4.appendChild(h4d);

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "opencanvas-replay-btn";
    var playIcon = document.createElement("span");
    playIcon.className = "play-icon";
    playBtn.appendChild(playIcon);
    var playLabel = document.createElement("span");
    playLabel.textContent = "Replay all animations";
    playBtn.appendChild(playLabel);
    if (!pageHasMotion()) playBtn.disabled = true;
    playBtn.addEventListener("click", function() {
      replayAnimations("page");
    });
    group4.appendChild(playBtn);
    inspector.appendChild(group4);

    // -- Divider ----------------------------------------------------------
    var divider2 = document.createElement("div");
    divider2.className = "opencanvas-page-inspector-divider";
    inspector.appendChild(divider2);

    // -- Page background --------------------------------------------------
    // Uses the same swatch + hex pattern as the element-style background.
    // Page bg is hex-only as of ADR 0028; values that aren't #rgb or
    // #rrggbb are not representable here (the previous text input
    // accepted 'transparent' / named colors / gradients, but the demo
    // case is swatch-picked hex and that's what the picker exposes).
    var group5 = document.createElement("div");
    group5.className = "opencanvas-page-inspector-group";
    var h4e = document.createElement("h4");
    h4e.textContent = "Page background";
    group5.appendChild(h4e);

    var pageBgRow = buildColorRow({
      getValue: function() { return page.pageBackground; },
      setValue: function(v) { page.pageBackground = v; },
      clearValue: function() { delete page.pageBackground; },
      onChange: function() {
        applyPageStyles(page);
        scheduleSave();
      },
      enabledTitle: "Enable page background",
      swatchDefault: "#ffffff",
    });
    group5.appendChild(pageBgRow);
    inspector.appendChild(group5);

    // -- Section gap ------------------------------------------------------
    var group6 = document.createElement("div");
    group6.className = "opencanvas-page-inspector-group";
    var h4f = document.createElement("h4");
    h4f.textContent = "Section gap";
    group6.appendChild(h4f);

    var gapInput = document.createElement("input");
    gapInput.type = "number";
    gapInput.min = "0";
    gapInput.max = "120";
    gapInput.placeholder = "0";
    gapInput.value = page.sectionGap != null ? String(page.sectionGap) : "";
    gapInput.addEventListener("change", function() {
      if (gapInput.value.trim().length === 0) {
        delete page.sectionGap;
      } else {
        var n = Number(gapInput.value);
        if (!Number.isFinite(n) || n < 0 || n > 120) {
          setStatus("Section gap must be 0-120px", "error");
          return;
        }
        page.sectionGap = n;
      }
      applyPageStyles(page);
      scheduleSave();
    });
    group6.appendChild(gapInput);
    inspector.appendChild(group6);

    // -- Page max-width ---------------------------------------------------
    var group7 = document.createElement("div");
    group7.className = "opencanvas-page-inspector-group";
    var h4g = document.createElement("h4");
    h4g.textContent = "Content max-width";
    group7.appendChild(h4g);

    var maxWInput = document.createElement("input");
    maxWInput.type = "number";
    maxWInput.min = "600";
    maxWInput.max = "2400";
    maxWInput.placeholder = "1440";
    maxWInput.value = page.maxWidth != null ? String(page.maxWidth) : "";
    maxWInput.addEventListener("change", function() {
      if (maxWInput.value.trim().length === 0) {
        delete page.maxWidth;
      } else {
        var n = Number(maxWInput.value);
        if (!Number.isFinite(n) || n < 600 || n > 2400) {
          setStatus("Content max-width must be 600-2400px", "error");
          return;
        }
        page.maxWidth = n;
      }
      applyPageStyles(page);
      scheduleSave();
    });
    group7.appendChild(maxWInput);
    inspector.appendChild(group7);

    // -- Divider ----------------------------------------------------------
    var divider3 = document.createElement("div");
    divider3.className = "opencanvas-page-inspector-divider";
    inspector.appendChild(divider3);

    // -- SEO & metadata link ---------------------------------------------
    // Opens the dashboard SEO panel for this page in a new tab so the user
    // doesn't lose their editor scroll position.
    var seoGroup = document.createElement("div");
    seoGroup.className = "opencanvas-page-inspector-group";
    var seoLabel = document.createElement("h4");
    seoLabel.textContent = "SEO & metadata";
    seoGroup.appendChild(seoLabel);
    var seoLink = document.createElement("a");
    seoLink.href = "/dashboard/sites/" + encodeURIComponent(SITE_ID) + "/pages/" + encodeURIComponent(page.id) + "/seo";
    seoLink.target = "_blank";
    seoLink.rel = "noopener";
    seoLink.className = "opencanvas-page-inspector-link";
    seoLink.textContent = "Open SEO panel →";
    seoLink.title = "Edit title, description, share-card image and search settings";
    seoGroup.appendChild(seoLink);
    inspector.appendChild(seoGroup);
  }

  // Live-apply page-level visual properties on the artboard.
  function applyPageStyles(page) {
    var artboard = root.querySelector('[data-page-id="' + cssEscape(page.id) + '"]');
    if (!artboard) return;
    var article = artboard.querySelector(".opencanvas-page");
    if (article) {
      applyPageMotionAttributes(article, page);
      applyPageStyleProperties(article, page);
      var renderWidth = pageRenderWidth(page);
      var sections = article.querySelectorAll("[data-opencanvas-section]");
      for (var i = 0; i < sections.length; i++) {
        sections[i].style.width = renderWidth + "px";
      }
    }
  }

  // Build a [enable checkbox | color swatch | hex text input] row.
  // The hex input is the typed-entry escape hatch the swatch picker
  // alone doesn't offer. All three controls stay synchronised: the
  // swatch syncs to the hex text on each pick, the hex text accepts
  // both #rgb and #rrggbb (expanded to #rrggbb internally), and any
  // valid edit flips the enabled checkbox on so partial edits don't
  // silently lose the value.
  //
  // opts.onChange is invoked after every value mutation so the caller
  // can re-render / persist / repaint as appropriate for whichever
  // field (element style, page background, etc.) the row writes to.
  function buildColorRow(opts) {
    var row = document.createElement("div");
    row.className = "style-row";
    var initial = opts.getValue();
    var enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = !!initial;
    enabled.title = opts.enabledTitle;
    var swatch = document.createElement("input");
    swatch.type = "color";
    swatch.value = initial || opts.swatchDefault || "#000000";
    swatch.className = "color-swatch";
    var hex = document.createElement("input");
    hex.type = "text";
    hex.className = "color-hex";
    hex.value = initial || "";
    hex.placeholder = opts.swatchDefault || "#000000";
    hex.spellcheck = false;
    hex.maxLength = 7;
    function expandShort(v) {
      if (v.length === 4) {
        return ("#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
      }
      return v.toLowerCase();
    }
    enabled.addEventListener("change", function() {
      if (enabled.checked) {
        opts.setValue(swatch.value);
        hex.value = swatch.value;
      } else {
        opts.clearValue();
        hex.value = "";
      }
      opts.onChange();
    });
    swatch.addEventListener("input", function() {
      if (!enabled.checked) enabled.checked = true;
      opts.setValue(swatch.value);
      hex.value = swatch.value;
      opts.onChange();
    });
    hex.addEventListener("input", function() {
      var v = hex.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
        var normalised = expandShort(v);
        swatch.value = normalised;
        if (!enabled.checked) enabled.checked = true;
        opts.setValue(normalised);
        opts.onChange();
      }
    });
    row.appendChild(enabled);
    row.appendChild(swatch);
    row.appendChild(hex);
    return row;
  }

  function renderInspector() {
    if (!inspector) return;
    if (isReelOpen) {
      inspector.hidden = true;
      revokePendingPreviews();
      inspector.replaceChildren();
      return;
    }
    if (!selectedElementId) {
      if (selectedSectionId) {
        renderSectionInspector();
      } else {
        renderPageInspector();
      }
      return;
    }
    const found = findElement(selectedElementId);
    if (!found) {
      inspector.hidden = true;
      revokePendingPreviews();
      inspector.replaceChildren();
      return;
    }
    inspector.hidden = false;
    const { element, section } = found;
    revokePendingPreviews();
    inspector.replaceChildren();

    const headerRow = document.createElement("div");
    headerRow.className = "inspector-header";
    const heading = document.createElement("h3");
    heading.textContent = element.type + " element";
    headerRow.appendChild(heading);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "inspector-close";
    closeBtn.setAttribute("aria-label", "Close inspector");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => { selectElement(null); });
    headerRow.appendChild(closeBtn);
    inspector.appendChild(headerRow);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "id: " + element.id;
    inspector.appendChild(meta);

    // Active style-kit read-only summary. The token values are read directly
    // off the editor wrapper's computed CSS so the summary stays in sync with
    // whatever kit is active without the client having to ship a duplicate
    // copy of STYLE_KIT_PRESETS. Hidden if the wrapper isn't there yet.
    inspector.appendChild(buildKitSummary());

    // Reading-order group sits ABOVE the z-order group per the plan. The
    // caption is part of the group so it lives next to the buttons that
    // change it.
    inspector.appendChild(buildReorderGroup(section, element));
    inspector.appendChild(buildZOrderGroup(section, element));
    inspector.appendChild(buildElementActionsGroup(section, element));

    // ADR 0011 Step 1 cutover: INSPECTOR_DISPATCH is now
    // Record<Exclude<ElementType, 'collection'>, InspectorSpec> — every
    // element type except collection has a spec; missing a spec for a new
    // element type fails TypeScript compile in src/canvas/elements/index.ts.
    // collection still flows through here at runtime; the indexed lookup
    // returns undefined for it and the inspector body stays empty (children
    // render their own inspectors when selected).
    const inspectorSpec = INSPECTOR_DISPATCH[element.type];
    if (inspectorSpec) {
      renderInspectorSpec(inspectorSpec, element);
    }

    // -- Element style controls -----------------------------------------------
    (function buildStyleSection() {
      var styleHeading = document.createElement("h3");
      styleHeading.textContent = "Style";
      styleHeading.className = "inspector-section-heading";
      inspector.appendChild(styleHeading);

      var es = element.elementStyle || {};

      function onStyleChange() {
        var empty = true;
        for (var k in es) {
          if (es[k] !== undefined) { empty = false; break; }
        }
        if (empty) {
          delete element.elementStyle;
        } else {
          element.elementStyle = es;
        }
        rebuildElement(element.id);
        scheduleSave();
      }

      // -- Background color (uses the module-level buildColorRow helper)
      var bgRow = buildColorRow({
        getValue: function() { return es.backgroundColor; },
        setValue: function(v) { es.backgroundColor = v; },
        clearValue: function() { delete es.backgroundColor; },
        onChange: onStyleChange,
        enabledTitle: "Enable background color",
        swatchDefault: "#000000",
      });
      inspector.appendChild(field("Background", bgRow));

      // -- Background image upload
      var bgImgRow = document.createElement("div");
      bgImgRow.className = "style-row";
      var bgImgThumb = document.createElement("div");
      bgImgThumb.className = "bg-img-thumb";
      if (es.backgroundImageAssetId) {
        var thumbImg = document.createElement("img");
        thumbImg.src = SITE_BASE + "/assets/" + encodeURIComponent(es.backgroundImageAssetId);
        thumbImg.alt = "";
        bgImgThumb.appendChild(thumbImg);
      } else {
        bgImgThumb.textContent = "none";
      }
      var bgImgUpload = document.createElement("button");
      bgImgUpload.type = "button";
      bgImgUpload.textContent = "Upload";
      bgImgUpload.className = "style-btn";
      var bgImgClear = document.createElement("button");
      bgImgClear.type = "button";
      bgImgClear.textContent = "x";
      bgImgClear.className = "style-btn-clear";
      bgImgClear.title = "Clear only the background image override";
      bgImgClear.disabled = !es.backgroundImageAssetId;
      // File input lives in the DOM so the picker actually opens. Chromium
      // silently no-ops .click() on a detached input[type=file] as a
      // user-gesture security measure — mirroring the main media upload at
      // line ~4855 which also appends its hidden input to the row.
      var bgImgFileInput = document.createElement("input");
      bgImgFileInput.type = "file";
      bgImgFileInput.accept = "image/*";
      bgImgFileInput.style.display = "none";
      bgImgFileInput.addEventListener("change", function() {
        if (!bgImgFileInput.files || bgImgFileInput.files.length === 0) return;
        var file = bgImgFileInput.files[0];
        setStatus("Uploading background...", "info");
        postAssetUpload(file, "", element.id).then(function(result) {
          es.backgroundImageAssetId = result.assetId;
          if (!es.backgroundSize) es.backgroundSize = "cover";
          onStyleChange();
          renderInspector();
          setStatus("Background image set", "ok");
        }).catch(function(err) {
          setStatus("Upload failed: " + err.message, "error");
        });
      });
      bgImgUpload.addEventListener("click", function() {
        bgImgFileInput.value = "";
        bgImgFileInput.click();
      });
      bgImgClear.addEventListener("click", function() {
        delete es.backgroundImageAssetId;
        delete es.backgroundSize;
        onStyleChange();
        renderInspector();
      });
      bgImgRow.appendChild(bgImgThumb);
      bgImgRow.appendChild(bgImgUpload);
      bgImgRow.appendChild(bgImgClear);
      bgImgRow.appendChild(bgImgFileInput);
      inspector.appendChild(field("Bg image", bgImgRow));

      if (es.backgroundImageAssetId) {
        var bgSizeSelect = selectInput(["cover", "contain"], es.backgroundSize || "cover");
        bgSizeSelect.addEventListener("change", function() {
          es.backgroundSize = bgSizeSelect.value;
          onStyleChange();
        });
        inspector.appendChild(field("Bg size", bgSizeSelect));
      }

      // -- Border radius
      var radiusRow = document.createElement("div");
      radiusRow.className = "style-row";
      var radiusInput = document.createElement("input");
      radiusInput.type = "number";
      radiusInput.min = "0";
      radiusInput.max = "200";
      radiusInput.placeholder = "inherit";
      radiusInput.value = typeof es.borderRadius === "number" ? String(es.borderRadius) : "";
      radiusInput.addEventListener("change", function() {
        if (radiusInput.value === "") {
          delete es.borderRadius;
        } else {
          var n = Number(radiusInput.value);
          if (Number.isFinite(n) && n >= 0) es.borderRadius = n;
        }
        onStyleChange();
      });
      var radiusUnit = document.createElement("span");
      radiusUnit.className = "unit-label";
      radiusUnit.textContent = "px";
      radiusRow.appendChild(radiusInput);
      radiusRow.appendChild(radiusUnit);
      inspector.appendChild(field("Corner radius", radiusRow));

      // -- Border color + width
      var borderRow = document.createElement("div");
      borderRow.className = "style-row";
      var borderColor = document.createElement("input");
      borderColor.type = "color";
      borderColor.value = es.borderColor || "#ffffff";
      borderColor.className = "color-swatch";
      var borderHex = document.createElement("input");
      borderHex.type = "text";
      borderHex.className = "color-hex";
      borderHex.value = es.borderColor || "";
      borderHex.placeholder = "#ffffff";
      borderHex.spellcheck = false;
      borderHex.maxLength = 7;
      var borderEnabled = document.createElement("input");
      borderEnabled.type = "checkbox";
      borderEnabled.checked = !!(es.borderColor || typeof es.borderWidth === "number");
      borderEnabled.title = "Enable border";
      var borderWidth = document.createElement("input");
      borderWidth.type = "number";
      borderWidth.min = "0";
      borderWidth.max = "20";
      borderWidth.value = typeof es.borderWidth === "number" ? String(es.borderWidth) : "1";
      borderWidth.style.width = "48px";
      var bwUnit = document.createElement("span");
      bwUnit.className = "unit-label";
      bwUnit.textContent = "px";
      borderEnabled.addEventListener("change", function() {
        if (borderEnabled.checked) {
          es.borderColor = borderColor.value;
          es.borderWidth = Number(borderWidth.value) || 1;
          borderHex.value = borderColor.value;
        } else {
          delete es.borderColor;
          delete es.borderWidth;
          borderHex.value = "";
        }
        onStyleChange();
      });
      borderColor.addEventListener("input", function() {
        if (!borderEnabled.checked) borderEnabled.checked = true;
        es.borderColor = borderColor.value;
        borderHex.value = borderColor.value;
        if (typeof es.borderWidth !== "number") es.borderWidth = Number(borderWidth.value) || 1;
        onStyleChange();
      });
      borderHex.addEventListener("input", function() {
        var v = borderHex.value.trim();
        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
          var normalised = v.length === 4
            ? ("#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase()
            : v.toLowerCase();
          borderColor.value = normalised;
          if (!borderEnabled.checked) borderEnabled.checked = true;
          es.borderColor = normalised;
          if (typeof es.borderWidth !== "number") es.borderWidth = Number(borderWidth.value) || 1;
          onStyleChange();
        }
      });
      borderWidth.addEventListener("change", function() {
        var n = Number(borderWidth.value);
        if (Number.isFinite(n) && n >= 0) {
          es.borderWidth = n;
          if (!borderEnabled.checked) borderEnabled.checked = true;
          if (!es.borderColor) es.borderColor = borderColor.value;
          onStyleChange();
        }
      });
      borderRow.appendChild(borderEnabled);
      borderRow.appendChild(borderColor);
      borderRow.appendChild(borderHex);
      borderRow.appendChild(borderWidth);
      borderRow.appendChild(bwUnit);
      inspector.appendChild(field("Border", borderRow));

      // -- Opacity
      var opacityRow = document.createElement("div");
      opacityRow.className = "style-row";
      var opacityRange = document.createElement("input");
      opacityRange.type = "range";
      opacityRange.min = "0";
      opacityRange.max = "1";
      opacityRange.step = "0.05";
      opacityRange.value = typeof es.opacity === "number" ? String(es.opacity) : "1";
      var opacityReadout = document.createElement("span");
      opacityReadout.className = "unit-label";
      opacityReadout.textContent = typeof es.opacity === "number" ? String(es.opacity) : "1";
      opacityRange.addEventListener("input", function() {
        var n = Number(opacityRange.value);
        opacityReadout.textContent = String(n);
        if (n >= 1) {
          delete es.opacity;
        } else {
          es.opacity = n;
        }
        onStyleChange();
      });
      opacityRow.appendChild(opacityRange);
      opacityRow.appendChild(opacityReadout);
      inspector.appendChild(field("Opacity", opacityRow));

      // -- Box shadow. Preset dropdown covers ~99% of needs; "Custom CSS…"
      // reveals a raw text field so power users can paste arbitrary
      // box-shadow strings (the schema stores boxShadow as a raw CSS string
      // either way, so presets and custom values share the same code path
      // in render.ts).
      var SHADOW_PRESETS = [
        { value: "", label: "None" },
        { value: "0 1px 2px rgba(0,0,0,0.06)", label: "Subtle" },
        { value: "0 2px 8px rgba(0,0,0,0.08)", label: "Soft" },
        { value: "0 4px 14px rgba(0,0,0,0.10)", label: "Medium" },
        { value: "0 10px 30px rgba(0,0,0,0.14)", label: "Large" },
        { value: "0 20px 50px rgba(0,0,0,0.20)", label: "Dramatic" },
      ];
      var shadowRow = document.createElement("div");
      shadowRow.className = "style-row";
      shadowRow.style.flexDirection = "column";
      shadowRow.style.alignItems = "stretch";
      shadowRow.style.gap = "6px";
      var shadowSelect = document.createElement("select");
      for (var spi = 0; spi < SHADOW_PRESETS.length; spi++) {
        var sp = SHADOW_PRESETS[spi];
        var spOpt = document.createElement("option");
        spOpt.value = sp.value;
        spOpt.textContent = sp.label;
        shadowSelect.appendChild(spOpt);
      }
      var customOpt = document.createElement("option");
      customOpt.value = "__custom__";
      customOpt.textContent = "Custom CSS…";
      shadowSelect.appendChild(customOpt);
      var shadowCustom = document.createElement("input");
      shadowCustom.type = "text";
      shadowCustom.placeholder = "e.g. 0 4px 12px rgba(0,0,0,0.15)";
      shadowCustom.value = es.boxShadow || "";
      var currentShadow = es.boxShadow || "";
      var matchedPreset = SHADOW_PRESETS.find(function(p) { return p.value === currentShadow; });
      if (matchedPreset) {
        shadowSelect.value = matchedPreset.value;
        shadowCustom.hidden = true;
      } else {
        shadowSelect.value = "__custom__";
        shadowCustom.hidden = false;
      }
      shadowSelect.addEventListener("change", function() {
        if (shadowSelect.value === "__custom__") {
          shadowCustom.hidden = false;
          shadowCustom.focus();
          return;
        }
        shadowCustom.hidden = true;
        if (shadowSelect.value === "") {
          delete es.boxShadow;
        } else {
          es.boxShadow = shadowSelect.value;
        }
        shadowCustom.value = shadowSelect.value;
        onStyleChange();
      });
      shadowCustom.addEventListener("change", function() {
        var v = shadowCustom.value.trim();
        if (v === "" || v === "none") {
          delete es.boxShadow;
        } else {
          es.boxShadow = v;
        }
        onStyleChange();
      });
      shadowRow.appendChild(shadowSelect);
      shadowRow.appendChild(shadowCustom);
      inspector.appendChild(field("Shadow", shadowRow));

      // -- Text color
      var textColorRow = buildColorRow({
        getValue: function() { return es.color; },
        setValue: function(v) { es.color = v; },
        clearValue: function() { delete es.color; },
        enabledTitle: "Enable text color override",
        swatchDefault: "#ffffff",
      });
      inspector.appendChild(field("Text color", textColorRow));

      // -- Overflow
      var overflowSelect = selectInput(["auto", "visible", "hidden"], es.overflow || "auto");
      overflowSelect.addEventListener("change", function() {
        if (overflowSelect.value === "auto") {
          delete es.overflow;
        } else {
          es.overflow = overflowSelect.value;
        }
        onStyleChange();
      });
      inspector.appendChild(field("Overflow", overflowSelect));

      // -- Reset all element styles. The per-property × buttons only clear
      // their own slot; this nukes the entire elementStyle so an Owner who
      // wants a clean slate doesn't have to walk every control.
      var resetRow = document.createElement("div");
      resetRow.className = "style-row";
      var resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "style-btn-clear";
      resetBtn.textContent = "Reset all";
      resetBtn.title = "Remove every per-element style override on this element";
      resetBtn.disabled = !element.elementStyle;
      resetBtn.addEventListener("click", function() {
        delete element.elementStyle;
        rebuildElement(element.id);
        renderInspector();
        scheduleSave();
      });
      resetRow.appendChild(resetBtn);
      inspector.appendChild(field("Reset", resetRow));
    })();

    // Motion controls.
    const motionPreset = selectInput(MOTION_PRESETS, element.motion ? element.motion.preset : "none");
    motionPreset.addEventListener("change", () => {
      if (motionPreset.value === "none") {
        delete element.motion;
      } else {
        const next = { preset: motionPreset.value };
        if (element.motion && typeof element.motion.delayMs === "number") {
          next.delayMs = element.motion.delayMs;
        }
        element.motion = next;
      }
      rebuildElement(element.id);
      renderInspector();
      scheduleSave();
    });
    inspector.appendChild(field("Motion preset", motionPreset));

    if (element.motion) {
      const delay = document.createElement("input");
      delay.type = "number"; delay.min = "0"; delay.max = "2000";
      delay.value = String(element.motion.delayMs || 0);
      delay.addEventListener("change", () => {
        const n = Number(delay.value);
        if (Number.isFinite(n) && n >= 0 && n <= 2000) {
          element.motion.delayMs = n;
          rebuildElement(element.id);
          scheduleSave();
        }
      });
      inspector.appendChild(field("Motion delay (ms)", delay));
    }

    // Play/replay button for this element's animation.
    var elPlayBtn = document.createElement("button");
    elPlayBtn.type = "button";
    elPlayBtn.className = "opencanvas-replay-btn";
    var elPlayIcon = document.createElement("span");
    elPlayIcon.className = "play-icon";
    elPlayBtn.appendChild(elPlayIcon);
    var elPlayLabel = document.createElement("span");
    elPlayLabel.textContent = "Replay animation";
    elPlayBtn.appendChild(elPlayLabel);
    if (!element.motion) elPlayBtn.disabled = true;
    elPlayBtn.addEventListener("click", function() {
      replayAnimations(element.id);
    });
    inspector.appendChild(elPlayBtn);
  }

  // -- Media upload helper -----------------------------------------------
  //
  // Pipeline:
  //   image upload   -> crop bytes to slot aspect ratio via Cropper.js v2 ->
  //                     POST /assets (image)
  //   video upload   -> extract first-frame poster -> crop poster to slot ->
  //                     POST /assets (video) + POST /assets (image poster) ->
  //                     set element.assetId + element.posterAssetId
  //   ai generation  -> POST /assets/generate with slot box; server snaps to
  //                     flux-schnell's nearest preset aspect ratio
  //
  // Render-side fit:cover still handles any residual aspect drift (e.g.,
  // generated assets that snapped to a nearby preset rather than the exact
  // slot ratio).
  // Cropper.js v2 is pulled on demand from jsDelivr the first time the Owner
  // picks a file; import is cached so subsequent uploads are immediate.
  //
  // Threat model: version pinning alone DOES NOT pin content — a compromised
  // jsDelivr or npm publish could replace the bytes served at this URL with
  // attacker code that then runs inside the Owner's authenticated editor
  // session (edit-token theft, arbitrary mutations). To close that, we fetch
  // the module bytes ourselves, verify SHA-384 against CROPPER_SRI_SHA384
  // pinned at the top of this file, then import via a Blob URL. A mismatch
  // throws loudly — no silent fallback to "load it anyway."
  //
  // The library registers custom elements as a side-effect of the import, so
  // we just need the module to evaluate after integrity has been verified.
  const CROPPER_CDN = "https://cdn.jsdelivr.net/npm/cropperjs@2.1.1/dist/cropper.esm.js";
  let cropperLoadPromise = null;
  function loadCropper() {
    if (!cropperLoadPromise) {
      cropperLoadPromise = (async function() {
        const response = await fetch(CROPPER_CDN, { cache: "force-cache" });
        if (!response.ok) {
          throw new Error("Cropper.js fetch failed: HTTP " + response.status + " from " + CROPPER_CDN);
        }
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-384", bytes);
        // Encode digest as base64 to compare against CROPPER_SRI_SHA384.
        const digestBytes = new Uint8Array(digest);
        let bin = "";
        for (let i = 0; i < digestBytes.length; i++) bin += String.fromCharCode(digestBytes[i]);
        const actual = btoa(bin);
        if (actual !== CROPPER_SRI_SHA384) {
          throw new Error(
            "Cropper.js SRI mismatch: expected sha384=" + CROPPER_SRI_SHA384 +
            " but got sha384=" + actual + " from " + CROPPER_CDN +
            ". Refusing to import potentially tampered code.",
          );
        }
        const blob = new Blob([bytes], { type: "application/javascript" });
        const blobUrl = URL.createObjectURL(blob);
        try {
          return await import(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      })();
    }
    return cropperLoadPromise;
  }

  // Open a modal cropper locked to the given pixel aspect ratio. The Owner
  // pans the image with drag and zooms with wheel; the crop selection itself
  // is fixed in the centre at the requested aspect. Resolves with
  // { blob, mediaType } of the cropped image; rejects with Error("crop cancelled")
  // if the Owner backs out.
  function runCropperModal(sourceUrl, boxW, boxH, sourceMediaType) {
    return new Promise(function (resolve, reject) {
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;" +
        "display:flex;align-items:center;justify-content:center;padding:24px;" +
        "box-sizing:border-box;";

      const card = document.createElement("div");
      card.style.cssText =
        "background:#111;border-radius:8px;padding:16px;display:flex;" +
        "flex-direction:column;gap:12px;max-width:960px;width:100%;color:#fff;" +
        "font:13px system-ui,sans-serif;";
      overlay.appendChild(card);

      const heading = document.createElement("div");
      heading.style.cssText = "font-weight:600;";
      heading.textContent =
        "Crop to slot (" + Math.round(boxW) + "x" + Math.round(boxH) + ") — drag to pan, scroll to zoom";
      card.appendChild(heading);

      const canvasEl = document.createElement("cropper-canvas");
      canvasEl.setAttribute("background", "");
      canvasEl.style.cssText = "width:100%;height:60vh;background:#000;display:block;";
      card.appendChild(canvasEl);

      const img = document.createElement("cropper-image");
      img.setAttribute("src", sourceUrl);
      img.setAttribute("alt", "");
      img.setAttribute("rotatable", "");
      img.setAttribute("scalable", "");
      img.setAttribute("translatable", "");
      canvasEl.appendChild(img);

      const shade = document.createElement("cropper-shade");
      canvasEl.appendChild(shade);

      // Pointer handle on the canvas drives image pan/zoom. The selection
      // itself is not movable/resizable, so the image moves under a fixed
      // frame — matches the pan+zoom UX the Owner chose.
      const moveHandle = document.createElement("cropper-handle");
      moveHandle.setAttribute("action", "move");
      moveHandle.setAttribute("plain", "");
      canvasEl.appendChild(moveHandle);

      const selection = document.createElement("cropper-selection");
      selection.setAttribute("aspect-ratio", String(boxW / boxH));
      selection.setAttribute("initial-coverage", "0.85");
      selection.setAttribute("outlined", "");
      canvasEl.appendChild(selection);

      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = "padding:8px 14px;";
      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = "Use this crop";
      confirmBtn.style.cssText = "padding:8px 14px;";
      buttons.appendChild(cancelBtn);
      buttons.appendChild(confirmBtn);
      card.appendChild(buttons);

      function teardown() {
        overlay.remove();
      }
      cancelBtn.addEventListener("click", function () {
        teardown();
        reject(new Error("crop cancelled"));
      });
      confirmBtn.addEventListener("click", function () {
        const outWidth = Math.max(1, Math.round(boxW));
        const outHeight = Math.max(1, Math.round(boxH));
        // GIF -> PNG because re-encoding a GIF through canvas loses
        // animation; PNG keeps the still output lossless. The list below is
        // the set of mime types that canvas.toBlob() is REQUIRED to support
        // by HTML spec. Anything not in this list (AVIF, HEIC, future Apple
        // formats, exotic camera RAW) re-encodes to PNG so we never hand
        // toBlob a type the browser would silently fall back on. If a new
        // type becomes universally toBlob-supported, add it here.
        const reEncodableTypes = ["image/jpeg", "image/png", "image/webp"];
        const outType =
          typeof sourceMediaType === "string" && reEncodableTypes.indexOf(sourceMediaType) >= 0
            ? sourceMediaType
            : "image/png";
        selection
          .$toCanvas({ width: outWidth, height: outHeight })
          .then(function (cv) {
            return new Promise(function (res, rej) {
              cv.toBlob(
                function (blob) {
                  if (blob) res({ blob: blob, mediaType: outType });
                  else rej(new Error("canvas toBlob returned null"));
                },
                outType,
                0.92,
              );
            });
          })
          .then(function (out) {
            teardown();
            resolve(out);
          })
          .catch(function (err) {
            teardown();
            reject(err);
          });
      });

      document.body.appendChild(overlay);
    });
  }

  async function cropFileToSlotAspect(file, boxW, boxH) {
    await loadCropper();
    const url = URL.createObjectURL(file);
    try {
      return await runCropperModal(url, boxW, boxH, file.type);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Extracts a representative first frame from a video File as a PNG Blob,
  // so the poster can be cropped to the slot's aspect ratio. Seeks slightly
  // past t=0 (FIRST_FRAME_SEEK_SECONDS) because some codecs emit a black
  // frame at exactly zero. The whole extraction is wrapped in a
  // POSTER_EXTRACTION_TIMEOUT_MS race so a corrupted/unsupported codec that
  // never fires loadeddata or seeked fails loudly instead of leaving the
  // upload UI stuck.
  async function extractVideoFirstFrame(file) {
    const url = URL.createObjectURL(file);
    let timeoutHandle = null;
    const timeout = new Promise(function (_res, rej) {
      timeoutHandle = setTimeout(function () {
        rej(new Error("video poster extraction timed out after " + POSTER_EXTRACTION_TIMEOUT_MS + "ms"));
      }, POSTER_EXTRACTION_TIMEOUT_MS);
    });
    const work = (async function () {
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      await new Promise(function (res, rej) {
        video.onloadeddata = function () { res(undefined); };
        video.onerror = function () { rej(new Error("video failed to load for poster extraction")); };
      });
      await new Promise(function (res, rej) {
        video.onseeked = function () { res(undefined); };
        video.onerror = function () { rej(new Error("video seek failed")); };
        const target = Math.min(FIRST_FRAME_SEEK_SECONDS, (video.duration || 1) / 2);
        try { video.currentTime = target; } catch (e) { rej(e); }
      });
      const cv = document.createElement("canvas");
      cv.width = video.videoWidth || 1280;
      cv.height = video.videoHeight || 720;
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("2D context unavailable for poster extraction");
      ctx.drawImage(video, 0, 0, cv.width, cv.height);
      return await new Promise(function (res, rej) {
        cv.toBlob(
          function (blob) {
            if (blob) res(blob);
            else rej(new Error("poster toBlob returned null"));
          },
          "image/png",
        );
      });
    })();
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      URL.revokeObjectURL(url);
    }
  }

  // Canonical Owner-rooted upload per ADR 0004 + ADR 0006. The legacy
  // data-URL JSON bridge at /api/canvas/sites/:siteId/assets is deprecated
  // and has no remaining in-tree callers. We pass the Blob/File straight
  // through as the 'file' multipart field — no base64 inflation. Returns
  // { assetId, kind } so call sites stay simple; the server's full
  // UploadAssetResult is otherwise discarded.
  async function postAssetUpload(blob, altValue, elementId) {
    const form = new FormData();
    form.append("file", blob);
    form.append("alt", altValue);
    form.append("siteId", SITE_ID);
    if (typeof elementId === "string" && elementId.length > 0) {
      form.append("elementId", elementId);
    }
    const response = await authFetch(API_BASE + "/owner/assets", {
      method: "POST",
      body: form,
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        if (body && body.error) detail = body.error;
      } catch (_) { /* ignore */ }
      throw new Error(detail);
    }
    const body = await response.json();
    if (!body || typeof body.id !== "string" || typeof body.kind !== "string") {
      throw new Error("malformed server response");
    }
    return { assetId: body.id, kind: body.kind };
  }

  async function applyAssetIdToElement(element, nextAssetId, refreshFn, nextKind) {
    element.assetId = nextAssetId;
    if (typeof nextKind === "string" && nextKind.length > 0) {
      element.mediaKind = nextKind;
    }
    rebuildElement(element.id);
    scheduleSave();
    if (nextAssetId && nextAssetId !== "__placeholder__") {
      authFetch(
        API_BASE + "/sites/" + encodeURIComponent(SITE_ID) +
        "/elements/" + encodeURIComponent(element.id) +
        "/history/" + encodeURIComponent(nextAssetId),
        { method: "PUT" },
      )
        .then((r) => {
          if (!r.ok) console.error("slot-history upsert failed", r.status);
        })
        .catch((err) => console.error("slot-history upsert failed", err));
    }
    if (typeof refreshFn === "function") {
      await refreshFn();
    }
  }

  function buildPickerThumb(assetId, selectedAssetId, onClick) {
    const isEmpty = !assetId || assetId === "__placeholder__";
    if (isEmpty) {
      const cell = document.createElement("div");
      cell.className = "picker-thumb empty";
      cell.textContent = "-";
      cell.setAttribute("title", "No asset selected");
      return cell;
    }
    const img = document.createElement("img");
    img.className = "picker-thumb" + (assetId === selectedAssetId ? " selected" : "");
    img.src = SITE_BASE + "/assets/" + encodeURIComponent(assetId);
    img.alt = "";
    img.title = assetId;
    img.addEventListener("click", () => onClick(assetId));
    return img;
  }

  function mountMediaPicker(element, host) {
    const pickerWrap = document.createElement("div");
    pickerWrap.className = "media-picker";

    const currentRowLabel = document.createElement("div");
    currentRowLabel.className = "picker-row-label";
    currentRowLabel.textContent = "Current";
    pickerWrap.appendChild(currentRowLabel);

    const currentRow = document.createElement("div");
    currentRow.className = "picker-current-row";
    pickerWrap.appendChild(currentRow);

    let currentThumb = buildPickerThumb(element.assetId, element.assetId, () => {});
    currentRow.appendChild(currentThumb);

    const actionsCol = document.createElement("div");
    actionsCol.className = "picker-current-actions";
    currentRow.appendChild(actionsCol);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = element.mediaKind === "image" ? "image/*" : "video/*";

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.textContent = element.mediaKind === "image" ? "Upload image" : "Upload video";
    uploadBtn.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });
    actionsCol.appendChild(uploadBtn);
    actionsCol.appendChild(fileInput);

    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.id = "media-upload-alt-" + element.id;
    altInput.value = typeof element.alt === "string" ? element.alt : "";
    altInput.placeholder = "Alt text";
    altInput.addEventListener("change", () => {
      element.alt = altInput.value;
      rebuildElement(element.id);
      scheduleSave();
    });
    actionsCol.appendChild(altInput);

    const historyLabel = document.createElement("div");
    historyLabel.className = "picker-row-label";
    historyLabel.textContent = "Recent in this slot";
    pickerWrap.appendChild(historyLabel);

    const historyRow = document.createElement("div");
    historyRow.className = "picker-history-row";
    pickerWrap.appendChild(historyRow);

    const galleryLabel = document.createElement("div");
    galleryLabel.className = "picker-row-label";
    galleryLabel.textContent = "Your gallery";
    pickerWrap.appendChild(galleryLabel);

    const galleryGrid = document.createElement("div");
    galleryGrid.className = "picker-gallery-grid";
    pickerWrap.appendChild(galleryGrid);

    host.appendChild(pickerWrap);

    function refreshCurrentThumb() {
      const nextThumb = buildPickerThumb(element.assetId, element.assetId, () => {});
      currentRow.replaceChild(nextThumb, currentThumb);
      currentThumb = nextThumb;
    }

    function refreshAll() {
      refreshCurrentThumb();
      return Promise.all([refreshHistoryRow(), refreshGalleryGrid()]);
    }

    async function refreshHistoryRow() {
      historyRow.replaceChildren();
      let entries;
      try {
        const resp = await authFetch(
          API_BASE + "/sites/" + encodeURIComponent(SITE_ID) +
          "/elements/" + encodeURIComponent(element.id) + "/history?limit=4",
        );
        if (!resp.ok) {
          console.error("slot-history fetch failed", resp.status);
          return;
        }
        const body = await resp.json();
        entries = Array.isArray(body.entries) ? body.entries : [];
      } catch (err) {
        console.error("slot-history fetch failed", err);
        return;
      }
      for (const entry of entries) {
        const assetId = entry.assetId;
        const thumb = buildPickerThumb(assetId, element.assetId, (id) => {
          void applyAssetIdToElement(element, id, refreshAll);
        });
        historyRow.appendChild(thumb);
      }
      if (entries.length === 0) {
        const hint = document.createElement("span");
        hint.style.cssText = "font-size:11px;color:var(--opencanvas-fg-faint);font-family:var(--opencanvas-font-mono);";
        hint.textContent = "None yet";
        historyRow.appendChild(hint);
      }
    }

    async function refreshGalleryGrid() {
      galleryGrid.replaceChildren();
      let entries;
      try {
        const resp = await authFetch(API_BASE + "/owner/assets");
        if (!resp.ok) {
          console.error("gallery fetch failed", resp.status);
          return;
        }
        const body = await resp.json();
        entries = Array.isArray(body.assets)
          ? body.assets.filter((entry) => entry && entry.kind === element.mediaKind)
          : [];
      } catch (err) {
        console.error("gallery fetch failed", err);
        return;
      }
      for (const entry of entries) {
        const assetId = typeof entry.id === "string" ? entry.id : entry.assetId;
        if (typeof assetId !== "string" || assetId.length === 0) continue;
        const cell = document.createElement("div");
        cell.className = "picker-gallery-cell";

        const thumb = buildPickerThumb(assetId, element.assetId, (id) => {
          void applyAssetIdToElement(element, id, refreshAll);
        });
        cell.appendChild(thumb);

        const delBtn = document.createElement("button");
        delBtn.className = "picker-delete";
        delBtn.type = "button";
        delBtn.textContent = "x";
        delBtn.title = "Delete asset";
        delBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          await runDeleteAsset(assetId, refreshAll);
        });
        cell.appendChild(delBtn);

        galleryGrid.appendChild(cell);
      }
      if (entries.length === 0) {
        const hint = document.createElement("span");
        hint.style.cssText = "font-size:11px;color:var(--opencanvas-fg-faint);font-family:var(--opencanvas-font-mono);grid-column:1/-1;";
        hint.textContent = "No assets yet";
        galleryGrid.appendChild(hint);
      }
    }

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      void uploadMediaForElement(element, file, refreshAll);
    });

    void refreshHistoryRow();
    void refreshGalleryGrid();
  }

  function clearDeletedAssetFromLocalState(assetId) {
    if (!state || !Array.isArray(state.pages)) return 0;
    let cleared = 0;
    for (const page of state.pages) {
      const sections = Array.isArray(page.sections) ? page.sections : [];
      for (const section of sections) {
        const elements = Array.isArray(section.elements) ? section.elements : [];
        for (const mediaElement of elements) {
          if (!mediaElement || mediaElement.type !== "media") continue;
          if (mediaElement.assetId === assetId) {
            mediaElement.assetId = "";
            cleared++;
          }
          if (mediaElement.posterAssetId === assetId) {
            mediaElement.posterAssetId = "";
            cleared++;
          }
        }
      }
    }
    if (cleared > 0) {
      renderAll();
      scheduleSave();
    }
    return cleared;
  }

  async function runDeleteAsset(assetId, refreshFn) {
    let references = [];
    try {
      const resp = await authFetch(API_BASE + "/owner/assets/" + encodeURIComponent(assetId), {
        method: "DELETE",
      });
      const body = await resp.json();
      if (resp.status === 412 || resp.ok) {
        references = Array.isArray(body.references) ? body.references : [];
      } else {
        const detail = body && body.error ? body.error : resp.statusText;
        setStatus("Delete failed: " + detail, "error");
        return;
      }
    } catch (err) {
      setStatus("Delete failed: " + (err && err.message ? err.message : String(err)), "error");
      return;
    }

    const editableRefs = references.filter((ref) => ref && ref.source === "editable");
    const publishedRefs = references.filter((ref) => ref && ref.source === "published");
    const lines = ["Delete asset " + assetId + "?"];
    if (editableRefs.length > 0) {
      lines.push("", "Editable slots that will be cleared:");
      for (const ref of editableRefs) {
        lines.push(
          "  - " + (ref.siteName || ref.siteId) + " / " + ref.pageSlug +
          " / element " + ref.elementId + " (" + ref.role + ")",
        );
      }
    }
    if (publishedRefs.length > 0) {
      lines.push("", "Live published sites that will show missing media until you re-publish:");
      for (const ref of publishedRefs) {
        const address = ref.publishedAddress ? " (live: " + ref.publishedAddress + ")" : "";
        lines.push(
          "  - " + (ref.siteName || ref.siteId) + address + " / " + ref.pageSlug +
          " / element " + ref.elementId + " (" + ref.role + ")",
        );
      }
    }
    if (editableRefs.length === 0 && publishedRefs.length === 0) {
      lines.push("", "No canvas references were found.");
    }
    lines.push("", "Continue?");
    if (!await openConfirmModal({ title: "Delete asset", message: lines.join("\\n"), confirmLabel: "Delete", danger: true })) return;

    try {
      const resp = await authFetch(
        API_BASE + "/owner/assets/" + encodeURIComponent(assetId) + "?confirm=1",
        { method: "DELETE" },
      );
      if (!resp.ok) {
        let detail = resp.statusText;
        try {
          const body = await resp.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("Delete failed: " + detail, "error");
        return;
      }
    } catch (err) {
      setStatus("Delete failed: " + (err && err.message ? err.message : String(err)), "error");
      return;
    }

    clearDeletedAssetFromLocalState(assetId);
    setStatus("Asset deleted", "ok");
    if (typeof refreshFn === "function") {
      await refreshFn();
    }
  }

  async function uploadMediaForElement(element, file, refreshFn) {
    const altInputId = "media-upload-alt-" + element.id;
    const altInput = document.getElementById(altInputId);
    const altValue =
      altInput && typeof altInput.value === "string" ? altInput.value : (element.alt || "");
    const boxW = element.box && typeof element.box.w === "number" ? element.box.w : 0;
    const boxH = element.box && typeof element.box.h === "number" ? element.box.h : 0;
    if (boxW <= 0 || boxH <= 0) {
      setStatus("Cannot upload: slot has no size yet — resize the element first", "error");
      return;
    }

    try {
      if (element.mediaKind === "image") {
        setStatus("Loading cropper…");
        const cropped = await cropFileToSlotAspect(file, boxW, boxH);
        setStatus("Uploading…");
        const uploaded = await postAssetUpload(cropped.blob, altValue, element.id);
        element.alt = altValue;
        await applyAssetIdToElement(element, uploaded.assetId, refreshFn, uploaded.kind);
        renderInspector();
        setStatus("Uploaded", "ok");
        return;
      }

      // Video: upload original bytes; crop only the first-frame poster.
      setStatus("Extracting poster…");
      const posterBlob = await extractVideoFirstFrame(file);
      const posterFile = new File([posterBlob], "poster.png", { type: "image/png" });

      setStatus("Loading cropper…");
      const croppedPoster = await cropFileToSlotAspect(posterFile, boxW, boxH);

      setStatus("Uploading video…");
      const uploadedVideo = await postAssetUpload(file, altValue, element.id);

      setStatus("Uploading poster…");
      const uploadedPoster = await postAssetUpload(croppedPoster.blob, altValue, element.id);

      element.mediaKind = "video";
      element.posterAssetId = uploadedPoster.assetId;
      element.alt = altValue;
      await applyAssetIdToElement(element, uploadedVideo.assetId, refreshFn, "video");
      renderInspector();
      setStatus("Uploaded", "ok");
    } catch (err) {
      if (err && err.message === "crop cancelled") {
        setStatus("Cancelled");
        return;
      }
      setStatus("Upload failed: " + (err && err.message ? err.message : String(err)), "error");
    }
  }

  // ADR 0004 decision 2: AI generation previews are NOT Owner Assets until
  // the owner applies them to a slot. The /assets/generate route now returns
  // raw image bytes; we hold them in a blob URL through the preview moment
  // and only POST them to the canonical /api/owner/assets multipart route on
  // Apply. Discard simply revokes the blob URL and drops the bytes.
  async function generateImageForElement(element, prompt) {
    const altInputId = "media-upload-alt-" + element.id;
    const altInput = document.getElementById(altInputId);
    const altValue =
      altInput && typeof altInput.value === "string" ? altInput.value : (element.alt || "");
    const boxW = element.box && typeof element.box.w === "number" ? element.box.w : 0;
    const boxH = element.box && typeof element.box.h === "number" ? element.box.h : 0;
    if (boxW <= 0 || boxH <= 0) {
      setStatus("Cannot generate: slot has no size yet — resize the element first", "error");
      return;
    }
    setStatus("Generating…");
    try {
      const response = await authFetch(SITE_BASE + "/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt,
          alt: altValue,
          boxW: boxW,
          boxH: boxH,
        }),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("Generate failed: " + detail, "error");
        return;
      }
      const mediaType = response.headers.get("content-type") || "image/webp";
      if (!mediaType.startsWith("image/")) {
        setStatus("Generate failed: server did not return image bytes", "error");
        return;
      }
      const blob = await response.blob();
      showGeneratePreview(element, blob, mediaType, altValue);
      setStatus("Preview ready — Apply to save", "ok");
    } catch (err) {
      setStatus("Generate failed: " + (err && err.message ? err.message : String(err)), "error");
    }
  }

  function showGeneratePreview(element, blob, mediaType, altValue) {
    if (!inspector) return;
    // Drop any prior pending preview for this element so re-runs do not
    // stack and leak object URLs.
    const prior = document.getElementById("ai-preview-" + element.id);
    if (prior) {
      const staleUrl = prior.getAttribute("data-object-url");
      if (staleUrl) URL.revokeObjectURL(staleUrl);
      prior.remove();
    }

    const objectUrl = URL.createObjectURL(blob);
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.id = "ai-preview-" + element.id;
    wrap.setAttribute("data-object-url", objectUrl);

    const label = document.createElement("label");
    label.textContent = "Preview (not saved yet)";
    wrap.appendChild(label);

    const img = document.createElement("img");
    img.src = objectUrl;
    img.alt = altValue;
    img.style.cssText = "max-width:100%;display:block;border:1px solid var(--opencanvas-border,#ccc);";
    wrap.appendChild(img);

    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:6px;margin-top:6px;";

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "Apply";

    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.textContent = "Discard";

    applyBtn.addEventListener("click", () => {
      applyGeneratePreview(element, blob, mediaType, altValue, wrap, applyBtn, discardBtn, objectUrl);
    });
    discardBtn.addEventListener("click", () => {
      URL.revokeObjectURL(objectUrl);
      wrap.remove();
      setStatus("Discarded");
    });

    buttons.appendChild(applyBtn);
    buttons.appendChild(discardBtn);
    wrap.appendChild(buttons);
    inspector.appendChild(wrap);
  }

  async function applyGeneratePreview(element, blob, mediaType, altValue, wrap, applyBtn, discardBtn, objectUrl) {
    applyBtn.disabled = true;
    discardBtn.disabled = true;
    setStatus("Saving…");
    try {
      const dotIdx = mediaType.indexOf("/");
      const ext = dotIdx > 0 ? mediaType.slice(dotIdx + 1) : "webp";
      const form = new FormData();
      form.append("file", new File([blob], "generated." + ext, { type: mediaType }));
      form.append("alt", altValue);
      form.append("siteId", SITE_ID);
      form.append("elementId", element.id);

      const response = await authFetch(API_BASE + "/owner/assets", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("Apply failed: " + detail, "error");
        applyBtn.disabled = false;
        discardBtn.disabled = false;
        return;
      }
      const body = await response.json();
      if (!body || typeof body.id !== "string" || typeof body.kind !== "string") {
        setStatus("Apply failed: malformed server response", "error");
        applyBtn.disabled = false;
        discardBtn.disabled = false;
        return;
      }
      element.assetId = body.id;
      element.mediaKind = body.kind;
      element.alt = altValue;
      URL.revokeObjectURL(objectUrl);
      wrap.remove();
      rebuildElement(element.id);
      renderInspector();
      scheduleSave();
      setStatus("Applied", "ok");
    } catch (err) {
      setStatus("Apply failed: " + (err && err.message ? err.message : String(err)), "error");
      applyBtn.disabled = false;
      discardBtn.disabled = false;
    }
  }

  function appendMediaUploader(element) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent =
      element.mediaKind === "image" ? "Replace image" : "Replace video";
    wrap.appendChild(label);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = element.mediaKind === "image" ? "image/*" : "video/*";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      uploadMediaForElement(element, file);
    });
    wrap.appendChild(fileInput);
    inspector.appendChild(wrap);

    const altWrap = document.createElement("div");
    altWrap.className = "field";
    const altLabel = document.createElement("label");
    altLabel.textContent = "Alt text";
    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.id = "media-upload-alt-" + element.id;
    altInput.value = typeof element.alt === "string" ? element.alt : "";
    altInput.addEventListener("change", () => {
      element.alt = altInput.value;
      rebuildElement(element.id);
      scheduleSave();
    });
    altWrap.appendChild(altLabel);
    altWrap.appendChild(altInput);
    inspector.appendChild(altWrap);
  }

  // Direct image generation via the Replicate-backed /assets/generate route.
  // Distinct from the agent-driven "AI media" button: this one creates a
  // brand-new asset shaped to the slot's aspect ratio without an LLM round-trip.
  function appendImageGenerator(element) {
    if (element.mediaKind !== "image") return;
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = "Generate image (AI)";
    wrap.appendChild(label);

    const promptInput = document.createElement("textarea");
    promptInput.rows = 2;
    promptInput.placeholder = "Describe the image…";
    promptInput.style.cssText = "width:100%;box-sizing:border-box;";
    wrap.appendChild(promptInput);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Generate";
    btn.style.cssText = "margin-top:6px;";
    btn.addEventListener("click", () => {
      const prompt = promptInput.value.trim();
      if (!prompt) {
        setStatus("Enter a prompt first", "error");
        return;
      }
      generateImageForElement(element, prompt);
    });
    wrap.appendChild(btn);

    inspector.appendChild(wrap);
  }

  function buildPinnedColorField(element) {
    // Curated colour pinning. Restricted to safe property names and values
    // without ';' or ':' (defence-in-depth — validator also enforces this).
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("label");
    label.textContent = "Text colour (hex)";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "#ffffff";
    const current = element.pinnedStyle && element.pinnedStyle.color ? element.pinnedStyle.color : "";
    input.value = current;
    input.addEventListener("change", () => {
      const value = input.value.trim();
      if (value === "") {
        if (element.pinnedStyle) { delete element.pinnedStyle.color; }
        rebuildElement(element.id);
        scheduleSave();
        return;
      }
      if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) {
        setStatus("Colour must look like #rrggbb", "error");
        input.value = current;
        return;
      }
      if (!element.pinnedStyle) element.pinnedStyle = {};
      element.pinnedStyle.color = value;
      rebuildElement(element.id);
      scheduleSave();
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function renderSidebarSelection() {
    if (!sidebarSelection) return;
    sidebarSelection.replaceChildren();
    if (!selectedElementId) {
      sidebarSelection.hidden = true;
      return;
    }
    const found = findElement(selectedElementId);
    if (!found || found.element.type !== "text") {
      sidebarSelection.hidden = true;
      return;
    }
    sidebarSelection.hidden = false;
    const heading = document.createElement("h2");
    heading.textContent = "Selection";
    sidebarSelection.appendChild(heading);
    sidebarSelection.appendChild(buildPinnedColorField(found.element));
  }

  // -- Selection & inline edit -------------------------------------------

  // Force-open the right inspector. Called by user-initiated selection
  // paths (link popover Inspector / Edit-nav buttons, double-click on an
  // element) so the inspector content the click produces is actually
  // visible, regardless of whether the inspector was collapsed or hidden.
  // Syncs the inspector-toggle arrow so the click affordance still reads
  // correctly after the force-open.
  function forceOpenInspector() {
    if (!inspector) return;
    inspector.hidden = false;
    inspector.classList.remove("collapsed");
    var toggle = document.getElementById("inspector-toggle");
    if (toggle) toggle.textContent = "›";
  }

  function selectElement(elementId) {
    if (selectedElementId === elementId) return;
    if (selectedElementId) {
      const prev = root.querySelector('[data-opencanvas-element="' + cssEscape(selectedElementId) + '"]');
      if (prev) prev.removeAttribute("data-selected");
    }
    selectedElementId = elementId;
    chatSelectionDropped = false;
    // Dismiss any link popover anchored to the previously selected element.
    // A new selection either replaces it (action elements re-pin below) or
    // there's nothing to show for the new selection.
    if (linkPopoverPinned) removeLinkPopover();
    if (elementId) {
      if (isReelOpen) closeReel();
      const next = root.querySelector('[data-opencanvas-element="' + cssEscape(elementId) + '"]');
      if (next) next.setAttribute("data-selected", "true");
      const found = findElement(elementId);
      if (found) selectSection(found.section.id);
      // Action elements get an auto-pinned link popover so the Owner can
      // navigate to the linked page (or open the external URL) without
      // hunting for the inspector's href field. The wrapper's inner anchor
      // is the popover anchor.
      if (found && found.element && found.element.type === 'action' && next) {
        var actionAnchor = next.querySelector('a.opencanvas-action');
        if (actionAnchor) showLinkPopover(actionAnchor, { pinned: true });
      }
    }
    renderInspector();
    renderSidebarSelection();
    updateChatSelectionChip();
  }

  function selectSection(sectionId) {
    if (selectedSectionId === sectionId) return;
    if (selectedSectionId) {
      const prev = root.querySelector('[data-opencanvas-section="' + cssEscape(selectedSectionId) + '"]');
      if (prev) prev.removeAttribute("data-selected");
    }
    selectedSectionId = sectionId;
    if (sectionId) {
      const next = root.querySelector('[data-opencanvas-section="' + cssEscape(sectionId) + '"]');
      if (next) next.setAttribute("data-selected", "true");
    }
    if (!selectedElementId) renderInspector();
    if (isReelOpen) renderReel();
  }

  // -- Film reel --------------------------------------------------------

  function openReel() {
    isReelOpen = true;
    selectElement(null);
    renderReel();
  }

  function closeReel() {
    isReelOpen = false;
    renderReel();
  }

  function wireframeTextNodes(clone) {
    const textEls = clone.querySelectorAll('[data-element-type="text"]');
    for (let i = 0; i < textEls.length; i++) {
      const el = textEls[i];
      const w = el.style.width;
      const h = el.style.height;
      el.innerHTML = "";
      const rect = document.createElement("div");
      rect.style.width = w || "100%";
      rect.style.height = h || "100%";
      rect.style.background = "currentColor";
      rect.style.opacity = "0.15";
      rect.style.borderRadius = "1px";
      el.appendChild(rect);
    }
  }

  function buildSectionThumbnail(section, pageWidth, thumbWidth) {
    const clone = buildSectionNode(section, pageWidth);
    const strip = clone.querySelectorAll(
      ".section-toolbar, .resize-handle, .element-menu-trigger, .element-menu, [data-section-grip], [data-ai-button]"
    );
    for (let i = 0; i < strip.length; i++) strip[i].remove();
    const editables = clone.querySelectorAll("[contenteditable]");
    for (let i = 0; i < editables.length; i++) editables[i].removeAttribute("contenteditable");
    clone.removeAttribute("data-selected");
    const selectedInside = clone.querySelectorAll("[data-selected]");
    for (let i = 0; i < selectedInside.length; i++) selectedInside[i].removeAttribute("data-selected");
    clone.style.pointerEvents = "none";
    clone.style.userSelect = "none";

    const scale = thumbWidth / pageWidth;
    if (scale < 0.25) wireframeTextNodes(clone);

    clone.style.transform = "scale(" + scale + ")";
    clone.style.transformOrigin = "top left";

    const kitWrap = document.createElement("div");
    if (mainEl && state && state.styleKit) {
      kitWrap.setAttribute("data-style-kit", state.styleKit);
    }
    kitWrap.appendChild(clone);

    const wrap = document.createElement("div");
    wrap.className = "reel-thumbnail-wrap";
    wrap.style.width = thumbWidth + "px";
    wrap.style.height = Math.round(section.height * scale) + "px";
    wrap.appendChild(kitWrap);
    return wrap;
  }

  function buildReelInsertButton(insertAt) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reel-insert-btn";
    btn.setAttribute("data-reel-insert-at", String(insertAt));
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      insertBlankSectionAt(insertAt);
    });
    return btn;
  }

  function clampInsertIndex(page, insertAt) {
    var lo = hasHeaderSection(page) ? 1 : 0;
    var hi = hasFooterSection(page) ? page.sections.length - 1 : page.sections.length;
    if (insertAt < lo) return lo;
    if (insertAt > hi) return hi;
    return insertAt;
  }

  function insertBlankSectionAt(insertAt) {
    const page = currentPage();
    if (!page) return;
    insertAt = clampInsertIndex(page, insertAt);
    const section = {
      id: newSectionId(),
      recipeId: "feature-grid",
      name: "Blank section",
      height: 640,
      elements: [],
    };
    page.sections.splice(insertAt, 0, section);
    selectedSectionId = section.id;
    selectedElementId = null;
    renderAll();
    scheduleSave();
    setStatus("Section added", "ok");
  }

  function moveSectionToIndex(fromIdx, toIdx) {
    const page = currentPage();
    if (!page) return;
    if (fromIdx < 0 || fromIdx >= page.sections.length) return;
    if (fromIdx === toIdx || fromIdx + 1 === toIdx) return;
    const section = page.sections[fromIdx];
    if (isPinnedSection(section)) return;
    const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
    const min = hasHeaderSection(page) ? 1 : 0;
    const max = hasFooterSection(page) ? page.sections.length - 2 : page.sections.length - 1;
    if (adjustedTo < min || adjustedTo > max) return;
    page.sections.splice(fromIdx, 1);
    page.sections.splice(adjustedTo, 0, section);
    renderAll();
    scheduleSave();
  }

  function buildReelRoleSlot(role) {
    var slot = document.createElement("button");
    slot.type = "button";
    slot.className = "reel-role-slot";
    slot.setAttribute("data-reel-role-slot", role);
    var label = role === "header" ? "Header" : "Footer";
    slot.textContent = "+ Add " + label;
    slot.addEventListener("click", function() {
      var section = {
        id: newSectionId(),
        recipeId: "custom",
        name: label,
        height: role === "header" ? 80 : 120,
        role: role,
        elements: [],
      };
      if (role === "header") {
        state.header = section;
      } else {
        state.footer = section;
      }
      selectedSectionId = section.id;
      selectedElementId = null;
      captureForUndo();
      renderAll();
      scheduleSave();
      setStatus(label + " added", "ok");
    });
    return slot;
  }

  function renderReel() {
    const reelEl = document.getElementById("canvas-reel");
    if (!reelEl) return;
    if (!isReelOpen) { reelEl.hidden = true; return; }
    reelEl.hidden = false;

    const page = currentPage();
    if (!page) return;

    const body = reelEl.querySelector(".reel-body");
    if (!body) return;
    body.replaceChildren();

    const pageWidth = page.width;
    const isTile = reelViewMode === "tile";
    const thumbW = isTile ? 288 : 64;

    // -- Site-level header tile or slot ------------------------------------
    if (state.header) {
      var hTile = document.createElement("div");
      hTile.className = isTile ? "reel-tile" : "reel-list-item";
      hTile.classList.add("reel-locked");
      hTile.setAttribute("data-reel-section", state.header.id);

      var hThumb = buildSectionThumbnail(state.header, pageWidth, thumbW);
      if (selectedSectionId === state.header.id) {
        hThumb.setAttribute("data-reel-selected", "true");
      }
      hTile.appendChild(hThumb);

      if (isTile) {
        var hLabel = document.createElement("div");
        hLabel.className = "reel-tile-label";
        hLabel.textContent = "Header — " + (state.header.name || state.header.recipeId);
        hTile.appendChild(hLabel);
      } else {
        var hInfo = document.createElement("div");
        hInfo.className = "reel-list-info";
        var hName = document.createElement("div");
        hName.className = "reel-list-name";
        hName.textContent = "Header — " + (state.header.name || "Untitled");
        var hRecipe = document.createElement("div");
        hRecipe.className = "reel-list-recipe";
        hRecipe.textContent = state.header.recipeId;
        hInfo.appendChild(hName);
        hInfo.appendChild(hRecipe);
        hTile.appendChild(hInfo);
      }

      hTile.addEventListener("click", (function(sectionId) {
        return function() { selectSection(sectionId); };
      })(state.header.id));

      body.appendChild(hTile);
    } else {
      body.appendChild(buildReelRoleSlot("header"));
    }

    // -- Body section tiles (page.sections — no header/footer in array) ---
    for (var i = 0; i < page.sections.length; i++) {
      var section = page.sections[i];
      var isPinned = isPinnedSection(section);

      if (!isPinned) {
        body.appendChild(buildReelInsertButton(i));
      }

      var tile = document.createElement("div");
      tile.className = isTile ? "reel-tile" : "reel-list-item";
      if (isPinned) tile.classList.add("reel-locked");
      tile.setAttribute("data-reel-section", section.id);
      tile.setAttribute("data-reel-index", String(i));

      var thumb = buildSectionThumbnail(section, pageWidth, thumbW);
      if (selectedSectionId === section.id) {
        thumb.setAttribute("data-reel-selected", "true");
      }
      tile.appendChild(thumb);

      if (isTile) {
        var tLabel = document.createElement("div");
        tLabel.className = "reel-tile-label";
        tLabel.textContent = sectionDisplayName(section, section.recipeId);
        tile.appendChild(tLabel);
      } else {
        var tInfo = document.createElement("div");
        tInfo.className = "reel-list-info";
        var tName = document.createElement("div");
        tName.className = "reel-list-name";
        tName.textContent = sectionDisplayName(section, "Untitled");
        var tRecipe = document.createElement("div");
        tRecipe.className = "reel-list-recipe";
        tRecipe.textContent = section.recipeId;
        tInfo.appendChild(tName);
        tInfo.appendChild(tRecipe);
        tile.appendChild(tInfo);
      }

      if (!isPinned) {
        tile.addEventListener("mousedown", (function(sectionId, idx) {
          return function(ev) {
            if (ev.button !== 0) return;
            ev.preventDefault();
            beginReelDrag(sectionId, idx, ev);
          };
        })(section.id, i));
      } else {
        tile.addEventListener("click", (function(sectionId) {
          return function() { selectSection(sectionId); };
        })(section.id));
      }

      body.appendChild(tile);
    }

    var trailingInsertIdx = hasFooterSection(page) ? page.sections.length - 1 : page.sections.length;
    body.appendChild(buildReelInsertButton(trailingInsertIdx));

    // -- Site-level footer tile or slot ------------------------------------
    if (state.footer) {
      var fTile = document.createElement("div");
      fTile.className = isTile ? "reel-tile" : "reel-list-item";
      fTile.classList.add("reel-locked");
      fTile.setAttribute("data-reel-section", state.footer.id);

      var fThumb = buildSectionThumbnail(state.footer, pageWidth, thumbW);
      if (selectedSectionId === state.footer.id) {
        fThumb.setAttribute("data-reel-selected", "true");
      }
      fTile.appendChild(fThumb);

      if (isTile) {
        var fLabel = document.createElement("div");
        fLabel.className = "reel-tile-label";
        fLabel.textContent = "Footer — " + (state.footer.name || state.footer.recipeId);
        fTile.appendChild(fLabel);
      } else {
        var fInfo = document.createElement("div");
        fInfo.className = "reel-list-info";
        var fName = document.createElement("div");
        fName.className = "reel-list-name";
        fName.textContent = "Footer — " + (state.footer.name || "Untitled");
        var fRecipe = document.createElement("div");
        fRecipe.className = "reel-list-recipe";
        fRecipe.textContent = state.footer.recipeId;
        fInfo.appendChild(fName);
        fInfo.appendChild(fRecipe);
        fTile.appendChild(fInfo);
      }

      fTile.addEventListener("click", (function(sectionId) {
        return function() { selectSection(sectionId); };
      })(state.footer.id));

      body.appendChild(fTile);
    } else {
      body.appendChild(buildReelRoleSlot("footer"));
    }

    const tileBtn = reelEl.querySelector('[data-reel-view="tile"]');
    const listBtn = reelEl.querySelector('[data-reel-view="list"]');
    if (tileBtn) tileBtn.setAttribute("aria-pressed", reelViewMode === "tile" ? "true" : "false");
    if (listBtn) listBtn.setAttribute("aria-pressed", reelViewMode === "list" ? "true" : "false");
  }

  function mountReel() {
    const reelEl = document.createElement("aside");
    reelEl.id = "canvas-reel";
    reelEl.hidden = true;

    const header = document.createElement("div");
    header.className = "reel-header";
    const heading = document.createElement("h3");
    heading.textContent = "Sections";
    header.appendChild(heading);

    const actions = document.createElement("div");
    actions.className = "reel-header-actions";

    const tileBtn = document.createElement("button");
    tileBtn.type = "button";
    tileBtn.textContent = "Tile";
    tileBtn.setAttribute("data-reel-view", "tile");
    tileBtn.setAttribute("aria-pressed", "true");
    tileBtn.addEventListener("click", () => {
      reelViewMode = "tile";
      renderReel();
    });
    actions.appendChild(tileBtn);

    const listBtn = document.createElement("button");
    listBtn.type = "button";
    listBtn.textContent = "List";
    listBtn.setAttribute("data-reel-view", "list");
    listBtn.setAttribute("aria-pressed", "false");
    listBtn.addEventListener("click", () => {
      reelViewMode = "list";
      renderReel();
    });
    actions.appendChild(listBtn);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "+";
    addBtn.setAttribute("aria-label", "Add blank section");
    addBtn.addEventListener("click", () => {
      const page = currentPage();
      if (page) insertBlankSectionAt(page.sections.length);
    });
    actions.appendChild(addBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "reel-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close film reel");
    closeBtn.addEventListener("click", () => { closeReel(); });
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    reelEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "reel-body";
    reelEl.appendChild(body);

    document.body.appendChild(reelEl);
  }

  function beginSectionDrag(sectionId, startEv) {
    const page = currentPage();
    if (!page) return;
    const fromIdx = page.sections.findIndex(function(s) { return s.id === sectionId; });
    if (fromIdx < 0) return;
    const section = page.sections[fromIdx];
    if (isPinnedSection(section)) return;

    const sectionEl = root.querySelector('[data-opencanvas-section="' + cssEscape(sectionId) + '"]');
    if (sectionEl) sectionEl.style.opacity = "0.5";

    const ghost = buildSectionThumbnail(section, page.width, 200);
    ghost.style.position = "fixed";
    ghost.style.pointerEvents = "none";
    ghost.style.opacity = "0.7";
    ghost.style.zIndex = "9000";
    ghost.style.left = startEv.clientX - 100 + "px";
    ghost.style.top = startEv.clientY - 20 + "px";
    document.body.appendChild(ghost);

    const dropLine = document.createElement("div");
    dropLine.className = "reel-drop-indicator";
    dropLine.hidden = true;
    document.body.appendChild(dropLine);

    let dropTarget = null;

    function pointInsideRect(clientX, clientY, rect) {
      return clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom;
    }

    function findDropTarget(clientX, clientY) {
      const reelEl = document.getElementById("canvas-reel");
      if (reelEl && !reelEl.hidden) {
        const reelRect = reelEl.getBoundingClientRect();
        if (pointInsideRect(clientX, clientY, reelRect)) {
          const tiles = Array.from(reelEl.querySelectorAll("[data-reel-section]"));
          for (let i = 0; i < tiles.length; i++) {
            const rect = tiles[i].getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (clientY < midY) return { zone: "reel", insertAt: i, tiles: tiles };
          }
          return { zone: "reel", insertAt: tiles.length, tiles: tiles };
        }
      }

      const rootRect = root.getBoundingClientRect();
      if (!pointInsideRect(clientX, clientY, rootRect)) return null;

      const sectionNodes = Array.from(root.querySelectorAll("[data-opencanvas-section]"));
      for (let i = 0; i < sectionNodes.length; i++) {
        const rect = sectionNodes[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) return { zone: "canvas", insertAt: i, nodes: sectionNodes };
      }
      return { zone: "canvas", insertAt: sectionNodes.length, nodes: sectionNodes };
    }

    function normaliseDropTarget(target) {
      if (!target) return null;
      if (target.insertAt === fromIdx || target.insertAt === fromIdx + 1) return null;
      return target;
    }

    function positionDropLine(target) {
      if (!target) { dropLine.hidden = true; return; }
      dropLine.hidden = false;
      if (target.zone === "canvas") {
        const nodes = target.nodes;
        var refRect;
        if (target.insertAt < nodes.length) {
          refRect = nodes[target.insertAt].getBoundingClientRect();
          dropLine.style.top = refRect.top - 1 + "px";
        } else if (nodes.length > 0) {
          refRect = nodes[nodes.length - 1].getBoundingClientRect();
          dropLine.style.top = refRect.bottom - 1 + "px";
        } else { dropLine.hidden = true; return; }
        dropLine.style.left = refRect.left + "px";
        dropLine.style.width = refRect.width + "px";
      } else {
        const tiles = target.tiles;
        var refRect2;
        if (target.insertAt < tiles.length) {
          refRect2 = tiles[target.insertAt].getBoundingClientRect();
          dropLine.style.top = refRect2.top - 2 + "px";
        } else if (tiles.length > 0) {
          refRect2 = tiles[tiles.length - 1].getBoundingClientRect();
          dropLine.style.top = refRect2.bottom + "px";
        } else { dropLine.hidden = true; return; }
        dropLine.style.left = refRect2.left + "px";
        dropLine.style.width = refRect2.width + "px";
      }
    }

    function onMove(ev) {
      ghost.style.left = ev.clientX - 100 + "px";
      ghost.style.top = ev.clientY - 20 + "px";
      dropTarget = normaliseDropTarget(findDropTarget(ev.clientX, ev.clientY));
      positionDropLine(dropTarget);
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      ghost.remove();
      dropLine.remove();
      if (sectionEl) sectionEl.style.opacity = "";
      if (dropTarget) {
        moveSectionToIndex(fromIdx, dropTarget.insertAt);
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function beginReelDrag(sectionId, fromIdx, startEv) {
    const page = currentPage();
    if (!page) return;
    const section = page.sections[fromIdx];
    if (!section || section.id !== sectionId) return;

    const startX = startEv.clientX;
    const startY = startEv.clientY;
    let hasMoved = false;
    let ghost = null;
    let dropLine = null;
    let dropTarget = null;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!hasMoved && Math.sqrt(dx * dx + dy * dy) < 5) return;
      if (!hasMoved) {
        hasMoved = true;
        const isTile = reelViewMode === "tile";
        ghost = buildSectionThumbnail(section, page.width, isTile ? 200 : 64);
        ghost.style.position = "fixed";
        ghost.style.pointerEvents = "none";
        ghost.style.opacity = "0.7";
        ghost.style.zIndex = "9000";
        document.body.appendChild(ghost);

        dropLine = document.createElement("div");
        dropLine.className = "reel-drop-indicator";
        dropLine.hidden = true;
        document.body.appendChild(dropLine);
      }

      ghost.style.left = ev.clientX - 50 + "px";
      ghost.style.top = ev.clientY - 10 + "px";

      const reelEl = document.getElementById("canvas-reel");
      if (!reelEl || reelEl.hidden) { dropLine.hidden = true; dropTarget = null; return; }
      const reelRect = reelEl.getBoundingClientRect();
      if (ev.clientX < reelRect.left || ev.clientX > reelRect.right ||
          ev.clientY < reelRect.top || ev.clientY > reelRect.bottom) {
        dropLine.hidden = true;
        dropTarget = null;
        return;
      }
      const tiles = Array.from(reelEl.querySelectorAll("[data-reel-section]"));
      var insertAt = tiles.length;
      for (let i = 0; i < tiles.length; i++) {
        const rect = tiles[i].getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) { insertAt = i; break; }
      }
      if (insertAt === fromIdx || insertAt === fromIdx + 1) {
        dropLine.hidden = true;
        dropTarget = null;
        return;
      }
      dropTarget = { insertAt: insertAt };
      dropLine.hidden = false;
      var refRect;
      if (insertAt < tiles.length) {
        refRect = tiles[insertAt].getBoundingClientRect();
        dropLine.style.top = refRect.top - 2 + "px";
      } else if (tiles.length > 0) {
        refRect = tiles[tiles.length - 1].getBoundingClientRect();
        dropLine.style.top = refRect.bottom + "px";
      }
      if (refRect) {
        dropLine.style.left = refRect.left + "px";
        dropLine.style.width = refRect.width + "px";
      }
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (ghost) ghost.remove();
      if (dropLine) dropLine.remove();
      if (hasMoved && dropTarget) {
        moveSectionToIndex(fromIdx, dropTarget.insertAt);
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function attachGripHandlers() {
    root.addEventListener("mousedown", (ev) => {
      if (interactionMode === "pan") return;
      const grip = ev.target instanceof Element ? ev.target.closest("[data-section-grip]") : null;
      if (!grip) return;
      ev.preventDefault();
      ev.stopPropagation();
      const sectionId = grip.getAttribute("data-section-grip");
      if (!sectionId) return;

      const startX = ev.clientX;
      const startY = ev.clientY;
      let hasMoved = false;

      function onMove(moveEv) {
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;
        if (!hasMoved && Math.sqrt(dx * dx + dy * dy) >= 5) {
          hasMoved = true;
          openReel();
          beginSectionDrag(sectionId, moveEv);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        }
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!hasMoved) {
          if (isReelOpen) {
            closeReel();
          } else {
            openReel();
          }
          selectSection(sectionId);
        }
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  // -- Rich text: DOM to InlineRun[] serializer -------------------------

  // Walk up from node until we hit stopAt (exclusive). Collect each
  // ancestor whose tag is a mark tag - STRONG/B, EM/I, U, S/STRIKE, MARK,
  // CODE, A (link). Returns a freshly-built InlineMark[] in canonical order
  // (link first, then bold, italic, underline, strike, highlight, code) and
  // deduped by type. Adjacent runs with byte-identical marks are merged
  // later - at this stage we only care that the mark set is well-formed.
  function activeMarksFor(node, stopAt) {
    const seen = new Set();
    const marks = [];
    let cur = node.parentNode;
    while (cur && cur !== stopAt) {
      if (cur.nodeType === 1) {
        const tag = cur.tagName;
        if (tag === "A" && !seen.has("link")) {
          seen.add("link");
          var linkMark = { type: "link", href: cur.getAttribute("href") || "" };
          if (cur.getAttribute("target") === "_blank") {
            linkMark.target = "_blank";
          }
          marks.push(linkMark);
        } else if (MARK_TAGS[tag]) {
          const built = MARK_TAGS[tag]();
          if (!seen.has(built.type)) {
            seen.add(built.type);
            marks.push(built);
          }
        }
      }
      cur = cur.parentNode;
    }
    // Order the marks deterministically so adjacent-run dedupe by JSON
    // string is reliable. Derived from CANONICAL_MARK_ORDER so the single
    // source of truth at the top of this file controls every consumer.
    const order = {};
    for (var oi = 0; oi < CANONICAL_MARK_ORDER.length; oi++) order[CANONICAL_MARK_ORDER[oi]] = oi;
    marks.sort((a, b) => order[a.type] - order[b.type]);
    return marks;
  }

  function marksEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].type !== b[i].type) return false;
      if (a[i].type === "link") {
        if (a[i].href !== b[i].href) return false;
        if ((a[i].target || "") !== (b[i].target || "")) return false;
      }
    }
    return true;
  }

  // Serialize the contenteditable subtree into an InlineRun[]. The result is
  // deduped (adjacent identical-mark runs merge) and trimmed (empty
  // marks-only placeholders dropped). Throws if any link mark href fails the
  // allowlist — the caller treats that as "do not commit".
  function serializeContentToRuns(rootNode) {
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    const raw = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const marks = activeMarksFor(textNode, rootNode);
      raw.push({ text: textNode.nodeValue || "", marks });
      textNode = walker.nextNode();
    }
    // Merge adjacent runs whose mark sets are byte-identical.
    const merged = [];
    for (let i = 0; i < raw.length; i++) {
      const run = raw[i];
      const prev = merged.length > 0 ? merged[merged.length - 1] : null;
      if (prev && marksEqual(prev.marks, run.marks)) {
        prev.text += run.text;
      } else {
        merged.push({ text: run.text, marks: run.marks });
      }
    }
    // Drop runs that are empty AND have no marks — they carry no signal.
    const trimmed = merged.filter((r) => r.text.length > 0 || r.marks.length > 0);
    // Validate link hrefs (fail loud — no silent rewrite).
    for (let i = 0; i < trimmed.length; i++) {
      for (let m = 0; m < trimmed[i].marks.length; m++) {
        const mark = trimmed[i].marks[m];
        if (mark.type === "link" && !isAllowedHref(mark.href)) {
          const reason = "href " + JSON.stringify(mark.href) + " is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)";
          throw new Error(reason);
        }
      }
    }
    // Final shape: drop empty marks arrays so the JSON is minimal and equal
    // to what hand-written fixtures look like.
    return trimmed.map((r) => {
      if (r.marks.length === 0) return { text: r.text };
      return { text: r.text, marks: r.marks };
    });
  }

  // Concatenate the plain text projection of a content array — used to
  // enforce the "concatenated plain text must not be empty" rule client-side
  // before saving so the server doesn't see a doomed payload.
  function plainTextOf(content) {
    let out = "";
    for (let i = 0; i < content.length; i++) out += content[i].text;
    return out;
  }

  // -- Link hover/selection popover ---------------------------------------
  //
  // Singleton popover shown for inline link marks (<a class="opencanvas-inline-link">)
  // inside the text element currently in edit mode. Two trigger modes:
  //   - hover: 150ms show delay, auto-hides on mouseleave.
  //   - pinned: shown when the caret enters a link (selectionchange) and
  //     persists until the caret leaves the link or text edit ends.
  // The pinned mode makes the popover act like a per-link toolbar without
  // needing a second UI surface.
  var linkPopover = null;
  var linkPopoverAnchor = null;
  var linkPopoverPinned = false;
  var linkPopoverShowTimer = null;
  var linkPopoverHideTimer = null;

  function removeLinkPopover() {
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    if (linkPopover && linkPopover.parentNode) {
      linkPopover.parentNode.removeChild(linkPopover);
    }
    linkPopover = null;
    linkPopoverAnchor = null;
    linkPopoverPinned = false;
  }

  function positionLinkPopover(anchorEl) {
    if (!linkPopover || !anchorEl) return;
    var rect = anchorEl.getBoundingClientRect();
    var popoverHeight = linkPopover.offsetHeight || 32;
    var spaceBelow = window.innerHeight - rect.bottom;
    var top;
    if (spaceBelow >= popoverHeight + 8) {
      top = rect.bottom + 6;
    } else {
      top = rect.top - popoverHeight - 6;
    }
    linkPopover.style.top = Math.max(0, top) + 'px';
    linkPopover.style.left = Math.max(0, rect.left) + 'px';
  }

  // Classify a link anchor in the canvas. The popover's button set + preview
  // class adapt to this kind so each link primitive gets the right toolbar
  // without three separate popover implementations.
  function linkPopoverKindOf(anchorEl) {
    if (!anchorEl || !anchorEl.classList) return 'inline';
    if (anchorEl.classList.contains('opencanvas-action')) return 'action';
    if (anchorEl.classList.contains('opencanvas-nav-link')) return 'nav';
    return 'inline';
  }

  // Walk up from a clicked sub-anchor (nav link, inline mark) to the canvas
  // element wrapper that owns it. Used by the nav-link "Edit nav" button to
  // surface the inspector for the parent NavElement.
  function parentElementIdOf(node) {
    var n = node;
    while (n && n !== document.body) {
      if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-opencanvas-element')) {
        return n.getAttribute('data-opencanvas-element');
      }
      n = n.parentNode;
    }
    return null;
  }

  function showLinkPopover(anchorEl, opts) {
    removeLinkPopover();
    var pinned = !!(opts && opts.pinned);
    var href = anchorEl.getAttribute('href') || '';
    var kind = linkPopoverKindOf(anchorEl);
    var bar = document.createElement('div');
    bar.className = 'opencanvas-link-popover';
    bar.setAttribute('data-opencanvas-link-popover-kind', kind);
    if (pinned) bar.setAttribute('data-opencanvas-link-popover-pinned', 'true');

    // Top row: URL + buttons. Bottom row: visitor-view preview chip when the
    // kind has a meaningful styling mismatch (inline marks, nav links). Two
    // rows live in one column so the popover stays a single floating
    // surface anchored to the link.
    var topRow = document.createElement('div');
    topRow.className = 'opencanvas-link-popover-row';
    bar.appendChild(topRow);

    var urlSpan = document.createElement('span');
    urlSpan.className = 'opencanvas-link-popover-url';
    urlSpan.textContent = href.length > 40 ? href.slice(0, 37) + '...' : href;
    urlSpan.title = href;
    topRow.appendChild(urlSpan);

    // Smart "Go" button — internal hrefs swap the active page so the Owner
    // can keep editing the destination; anchors and external hrefs fall
    // through to the existing open-in-new-tab path. Label adapts so the
    // Owner knows what will happen before they click.
    var goBtn = document.createElement('button');
    goBtn.type = 'button';
    var matchedPage = findPageByHref(href);
    if (matchedPage) {
      goBtn.textContent = 'Go to ' + (matchedPage.title || matchedPage.slug || 'page');
      goBtn.title = 'Switch the canvas to ' + (matchedPage.title || matchedPage.slug);
    } else if (href.charAt(0) === '#') {
      goBtn.textContent = 'Jump';
      goBtn.title = 'In-page anchor — no destination in the editor';
      goBtn.disabled = true;
    } else {
      goBtn.textContent = 'Open';
      goBtn.title = 'Open in new tab';
    }
    goBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    goBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (goBtn.disabled) return;
      if (matchedPage) {
        removeLinkPopover();
        setActivePage(matchedPage.id);
        return;
      }
      if (!isAllowedHref(href)) {
        setStatus('Link rejected: ' + href + ' is not http/https/mailto/tel/anchor/relative', 'error');
        removeLinkPopover();
        return;
      }
      window.open(href, '_blank', 'noopener,noreferrer');
      removeLinkPopover();
    });
    topRow.appendChild(goBtn);

    if (kind === 'inline') {
      // Inline link marks: full edit (modal) + unlink. These manipulate the
      // contenteditable DOM directly because the text element is in edit mode.
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      editBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var currentHref = anchorEl.getAttribute('href') || '';
        var currentTarget = anchorEl.getAttribute('target') || '';
        var linkText = anchorEl.textContent || '';
        removeLinkPopover();
        openLinkModal({
          linkText: linkText,
          href: currentHref,
          blank: currentTarget === '_blank',
          focusAfterClose: closestEditableRoot(anchorEl),
        }).then(function (result) {
          if (result === null) return;
          anchorEl.setAttribute('href', result.href);
          if (result.target === '_blank') {
            anchorEl.setAttribute('target', '_blank');
            anchorEl.setAttribute('rel', 'noopener noreferrer');
          } else {
            anchorEl.removeAttribute('target');
            anchorEl.removeAttribute('rel');
          }
        }).catch(function (err) {
          setStatus('Link edit failed: ' + (err && err.message ? err.message : String(err)), 'error');
        });
      });
      topRow.appendChild(editBtn);

      var unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.textContent = 'Unlink';
      unlinkBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      unlinkBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var parent = anchorEl.parentNode;
        if (!parent) return;
        while (anchorEl.firstChild) {
          parent.insertBefore(anchorEl.firstChild, anchorEl);
        }
        parent.removeChild(anchorEl);
        removeLinkPopover();
      });
      topRow.appendChild(unlinkBtn);
    } else if (kind === 'nav') {
      // Nav links are structured (label/href/kind), not free text — editing
      // happens through the parent NavElement's inspector. The button
      // selects the owning element so the inspector opens for it.
      var navEditBtn = document.createElement('button');
      navEditBtn.type = 'button';
      navEditBtn.textContent = 'Edit nav';
      navEditBtn.title = 'Open the nav element inspector';
      navEditBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      navEditBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var ownerId = parentElementIdOf(anchorEl);
        removeLinkPopover();
        if (ownerId) {
          selectElement(ownerId);
          forceOpenInspector();
        }
      });
      topRow.appendChild(navEditBtn);
    } else if (kind === 'action') {
      // Action elements expose every field (label/href/variant) in the
      // inspector. The Inspector button just guarantees the inspector is
      // pointed at this element (helpful when the popover was triggered by
      // hover rather than selection).
      var inspBtn = document.createElement('button');
      inspBtn.type = 'button';
      inspBtn.textContent = 'Inspector';
      inspBtn.title = 'Select this action so the inspector opens its fields';
      inspBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      inspBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var ownerId = parentElementIdOf(anchorEl);
        removeLinkPopover();
        if (ownerId) {
          selectElement(ownerId);
          forceOpenInspector();
        }
      });
      topRow.appendChild(inspBtn);
    }

    // Preview row — renders the link text inside a sandbox that disables the
    // editor-only contenteditable underline-cursor override so the Owner sees
    // exactly what a visitor sees on the published page. Action elements
    // skip the preview because they already render full-fidelity on the
    // canvas (no contenteditable override sits on them).
    if (kind === 'inline' || kind === 'nav') {
      var previewRow = document.createElement('div');
      previewRow.className = 'opencanvas-link-popover-preview';
      var previewLabel = document.createElement('span');
      previewLabel.className = 'opencanvas-link-popover-preview-label';
      previewLabel.textContent = 'Visitors see';
      previewRow.appendChild(previewLabel);
      var previewLink = document.createElement('a');
      // Use the matching published class so the kit accent / hover colour
      // flow through unchanged. Adding the popover-specific class disables
      // pointer events so accidental clicks don't navigate.
      var previewClass = kind === 'nav' ? 'opencanvas-nav-link' : 'opencanvas-inline-link';
      previewLink.className = previewClass + ' opencanvas-link-popover-preview-link';
      previewLink.setAttribute('href', href || '#');
      previewLink.setAttribute('tabindex', '-1');
      previewLink.textContent = (anchorEl.textContent || '').trim() || 'link text';
      previewLink.addEventListener('click', function (ev) { ev.preventDefault(); });
      previewRow.appendChild(previewLink);
      bar.appendChild(previewRow);
    }

    bar.addEventListener('mouseenter', function () {
      if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    });
    bar.addEventListener('mouseleave', function () {
      // Pinned popovers stay until something else dismisses them (caret
      // leaves the link, element is deselected, text edit ends). Hover-
      // triggered popovers auto-hide as before.
      if (!linkPopoverPinned) removeLinkPopover();
    });

    linkPopover = bar;
    linkPopoverAnchor = anchorEl;
    linkPopoverPinned = pinned;
    document.body.appendChild(bar);
    positionLinkPopover(anchorEl);
  }

  function onLinkMouseEnter(ev) {
    if (!editingElementId) return;
    var target = ev.target;
    if (!target || target.tagName !== 'A') return;
    // Don't disturb a pinned popover already showing for the same link.
    if (linkPopoverPinned && linkPopoverAnchor === target) return;
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    linkPopoverShowTimer = setTimeout(function () {
      linkPopoverShowTimer = null;
      showLinkPopover(target);
    }, 150);
  }

  function onLinkMouseLeave(ev) {
    var target = ev.target;
    if (!target || target.tagName !== 'A') return;
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverPinned) return;
    linkPopoverHideTimer = setTimeout(function () {
      linkPopoverHideTimer = null;
      removeLinkPopover();
    }, 200);
  }

  // Walk up from a DOM node to the nearest inline link mark anchor inside the
  // text element currently in edit mode. Returns null when the node is not
  // inside a link or not inside an edited text element.
  function closestInlineLinkInEditMode(node) {
    if (!editingElementId || !node) return null;
    var n = node;
    if (n.nodeType !== 1) n = n.parentNode;
    while (n && n !== document.body) {
      if (n.nodeType === 1 && n.tagName === 'A' && n.classList && n.classList.contains('opencanvas-inline-link')) {
        return n;
      }
      n = n.parentNode;
    }
    return null;
  }

  // Whether the popover may trigger for this anchor given the current editor
  // state. Inline marks fire only inside a text element being edited; nav
  // links and action elements fire only when no text edit is in progress
  // (otherwise they'd race the mark toolbar for the same screen real estate).
  function canHoverPopover(anchorEl) {
    if (!anchorEl || anchorEl.tagName !== 'A') return false;
    var kind = linkPopoverKindOf(anchorEl);
    if (kind === 'inline') return !!editingElementId;
    return !editingElementId;
  }

  // Canvas-wide link hover handlers. Attached on root in attachPointerHandlers
  // so nav links and action elements get the same popover treatment as inline
  // marks, without each renderer wiring its own listeners.
  function onCanvasLinkHover(ev) {
    var target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.tagName !== 'A') {
      target = target.closest && target.closest('a');
      if (!target) return;
    }
    if (!canHoverPopover(target)) return;
    if (linkPopoverPinned && linkPopoverAnchor === target) return;
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    var captured = target;
    linkPopoverShowTimer = setTimeout(function () {
      linkPopoverShowTimer = null;
      showLinkPopover(captured);
    }, 150);
  }

  function onCanvasLinkHoverLeave(ev) {
    var target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.tagName !== 'A') {
      target = target.closest && target.closest('a');
      if (!target) return;
    }
    if (linkPopoverShowTimer) { clearTimeout(linkPopoverShowTimer); linkPopoverShowTimer = null; }
    if (linkPopoverPinned) return;
    linkPopoverHideTimer = setTimeout(function () {
      linkPopoverHideTimer = null;
      removeLinkPopover();
    }, 200);
  }

  // selectionchange driver — pin the popover to whichever link contains the
  // caret while text is in edit mode. When the caret leaves the link, the
  // pinned popover dismisses (hover may re-show it without pinning).
  function onSelectionChangeForLinkPopover() {
    if (!editingElementId) return;
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) {
      if (linkPopoverPinned) removeLinkPopover();
      return;
    }
    var anchorNode = sel.anchorNode;
    var linkEl = closestInlineLinkInEditMode(anchorNode);
    if (!linkEl) {
      if (linkPopoverPinned) removeLinkPopover();
      return;
    }
    // Already pinned to this link → nothing to do.
    if (linkPopoverPinned && linkPopoverAnchor === linkEl) return;
    showLinkPopover(linkEl, { pinned: true });
  }

  // -- Inline mark toolbar ------------------------------------------------

  // Anchor we re-position the toolbar against on scroll/resize. Set in
  // buildMarkToolbar, cleared in removeMarkToolbar so the listeners
  // become no-ops when no text element is in edit mode.
  let markToolbarAnchor = null;

  function removeMarkToolbar() {
    if (markToolbar && markToolbar.parentNode) {
      markToolbar.parentNode.removeChild(markToolbar);
    }
    markToolbar = null;
    markToolbarAnchor = null;
  }

  function positionMarkToolbar(anchor) {
    if (!markToolbar || !anchor) return;
    // The toolbar is appended to document.body and uses position: fixed,
    // so top/left are in viewport coordinates. getBoundingClientRect()
    // already returns viewport-relative coords, so we just anchor 44px
    // above the element's current top edge. Body scroll moves the anchor
    // rect on each scroll event; the scroll/resize listeners installed in
    // buildMarkToolbar call back into this function to keep the toolbar
    // pinned above the element while the body scrolls.
    const rect = anchor.getBoundingClientRect();
    const top = rect.top - 44;
    const left = rect.left;
    markToolbar.style.top = Math.max(0, top) + "px";
    markToolbar.style.left = Math.max(0, left) + "px";
  }

  // Listeners are installed once and check markToolbarAnchor each call —
  // they're cheap no-ops when no text is in edit mode.
  function onMarkToolbarReflow() {
    if (markToolbarAnchor) positionMarkToolbar(markToolbarAnchor);
    if (linkPopoverAnchor) positionLinkPopover(linkPopoverAnchor);
  }
  window.addEventListener("scroll", onMarkToolbarReflow, { passive: true });
  window.addEventListener("resize", onMarkToolbarReflow);

  function applyExecCommand(command) {
    // execCommand is deprecated but it is by far the simplest way to apply
    // bold/italic/underline/strike to the current Selection inside a
    // contenteditable. Once browsers drop it we will rewrite this with the
    // Range APIs. For the POC we lean on it.
    document.execCommand(command, false, "");
  }

  function wrapSelectionWith(tagName) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return;
    var upper = tagName.toUpperCase();
    var existing = findAncestor(range.commonAncestorContainer, upper);
    if (existing) {
      var parent = existing.parentNode;
      if (!parent) return;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      return;
    }
    var el = document.createElement(tagName);
    try {
      range.surroundContents(el);
    } catch (_) {
      var fragment = range.extractContents();
      el.appendChild(fragment);
      range.insertNode(el);
    }
    sel.removeAllRanges();
    var next = document.createRange();
    // selectNodeContents (not selectNode) so the range lives INSIDE the wrapper:
    // a follow-up click on the same toolbar button can detect the wrapper via
    // findAncestor(commonAncestorContainer) and unwrap it. selectNode places the
    // range around the element, making its parent the commonAncestor and the
    // toggle-off path unreachable until the user reselects.
    next.selectNodeContents(el);
    sel.addRange(next);
  }

  function findAncestor(node, tagName) {
    var cur = node;
    while (cur && cur.nodeType !== 9) {
      if (cur.nodeType === 1 && cur.tagName === tagName) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  function closestEditableRoot(node) {
    if (!node) return null;
    var element = node.nodeType === 1 ? node : node.parentElement;
    return element ? element.closest('[contenteditable="true"]') : null;
  }

  function openLinkModal(opts) {
    if (modalOpen) {
      throw new Error('openLinkModal: another modal is already open');
    }
    var linkText = typeof opts.linkText === 'string' ? opts.linkText : '';
    var defaultHref = typeof opts.href === 'string' ? opts.href : 'https://';
    var defaultBlank = opts.blank === true;
    var focusAfterClose = opts.focusAfterClose && typeof opts.focusAfterClose.focus === 'function'
      ? opts.focusAfterClose
      : null;
    modalOpen = true;
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'opencanvas-modal-backdrop';
      var panel = document.createElement('div');
      panel.className = 'opencanvas-modal';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Link');

      var h = document.createElement('h3');
      h.textContent = 'Link';
      panel.appendChild(h);

      if (linkText.length > 0) {
        var previewLabel = document.createElement('label');
        previewLabel.textContent = 'Text';
        panel.appendChild(previewLabel);
        var preview = document.createElement('div');
        preview.className = 'opencanvas-link-modal-preview';
        preview.textContent = linkText;
        panel.appendChild(preview);
      }

      var urlLabel = document.createElement('label');
      urlLabel.textContent = 'URL';
      panel.appendChild(urlLabel);
      var urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.value = defaultHref;
      urlInput.placeholder = 'https://...';
      panel.appendChild(urlInput);

      var errorEl = document.createElement('div');
      errorEl.className = 'opencanvas-link-modal-error';
      errorEl.textContent = '';
      panel.appendChild(errorEl);

      var checkLabel = document.createElement('label');
      checkLabel.className = 'opencanvas-link-modal-checkbox';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = defaultBlank;
      checkLabel.appendChild(checkbox);
      var checkText = document.createTextNode(' Open in new tab');
      checkLabel.appendChild(checkText);
      panel.appendChild(checkLabel);

      function autoToggleBlank() {
        var val = urlInput.value.trim();
        if (val.startsWith('http://') || val.startsWith('https://')) {
          checkbox.checked = true;
        } else if (val.startsWith('#') || val.startsWith('/')) {
          checkbox.checked = false;
        }
      }
      if (defaultHref === 'https://') {
        urlInput.addEventListener('input', autoToggleBlank);
      }

      var actions = document.createElement('div');
      actions.className = 'opencanvas-modal-actions';
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Cancel';
      var applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Apply';
      actions.appendChild(cancelBtn);
      actions.appendChild(applyBtn);
      panel.appendChild(actions);

      backdrop.appendChild(panel);

      function close(value) {
        document.removeEventListener('keydown', onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.body.classList.remove('opencanvas-modal-open');
        modalOpen = false;
        if (focusAfterClose && document.contains(focusAfterClose)) {
          focusAfterClose.focus({ preventScroll: true });
        }
        resolve(value);
      }

      function tryApply() {
        var href = urlInput.value.trim();
        if (href.length === 0) {
          errorEl.textContent = 'URL cannot be empty';
          return;
        }
        if (!isAllowedHref(href)) {
          errorEl.textContent = 'URL must be http, https, mailto, tel, /relative, or #anchor';
          return;
        }
        var result = { href: href };
        if (checkbox.checked) {
          result.target = '_blank';
        }
        close(result);
      }

      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          close(null);
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          tryApply();
        }
      }
      backdrop.addEventListener('click', function (ev) {
        if (ev.target === backdrop) close(null);
      });
      cancelBtn.addEventListener('click', function () { close(null); });
      applyBtn.addEventListener('click', function () { tryApply(); });
      urlInput.addEventListener('input', function () { errorEl.textContent = ''; });
      document.addEventListener('keydown', onKey, true);

      document.body.classList.add('opencanvas-modal-open');
      document.body.appendChild(backdrop);
      urlInput.focus();
      urlInput.select();
    });
  }

  async function applyLinkMark() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (range.collapsed) {
      setStatus('Select some text first to add a link', 'error');
      return;
    }
    var savedRange = range.cloneRange();
    var selectedText = savedRange.toString();
    var result = await openLinkModal({
      linkText: selectedText,
      href: 'https://',
      blank: true,
      focusAfterClose: closestEditableRoot(range.commonAncestorContainer),
    });
    if (result === null) return;
    sel.removeAllRanges();
    sel.addRange(savedRange);
    var a = document.createElement('a');
    a.className = 'opencanvas-inline-link';
    a.setAttribute('href', result.href);
    if (result.target === '_blank') {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    try {
      savedRange.surroundContents(a);
    } catch (_) {
      var fragment = savedRange.extractContents();
      a.appendChild(fragment);
      savedRange.insertNode(a);
    }
    sel.removeAllRanges();
    var next = document.createRange();
    next.selectNode(a);
    sel.addRange(next);
  }

  function applyMark(type) {
    if (type === "bold") return applyExecCommand("bold");
    if (type === "italic") return applyExecCommand("italic");
    if (type === "underline") return applyExecCommand("underline");
    // Browsers' execCommand("strikeThrough") emits the HTML4-deprecated
    // <strike> tag (verified on Chrome 130, Firefox 132) which trips both
    // the render-utils smoke and any consumer parsing the contenteditable
    // back to mark-runs by tag name. Use the Range-based wrap path that
    // already powers code / highlight to land <s> instead.
    if (type === "strike") return wrapSelectionWith("s");
    if (type === "code") return wrapSelectionWith("code");
    if (type === "highlight") return wrapSelectionWith("mark");
    if (type === "link") {
      applyLinkMark().catch((err) => {
        setStatus("Link failed: " + (err && err.message ? err.message : String(err)), "error");
      });
      return;
    }
  }

  // Apply an element-level field change while a text element is in edit mode.
  // We mutate the data model AND mirror the new value into the live .opencanvas-text
  // inline style so the change is visible immediately without a rebuild — a
  // rebuild would tear down the contenteditable and drop the caret.
  function applyAlignToEditing(direction) {
    if (!editingElementId) return;
    var found = findElement(editingElementId);
    if (!found || found.element.type !== "text") return;
    found.element.align = direction;
    var wrapper = root.querySelector('[data-opencanvas-element="' + cssEscape(editingElementId) + '"]');
    var inner = wrapper ? wrapper.querySelector(".opencanvas-text") : null;
    if (inner) inner.style.textAlign = direction;
    refreshMarkToolbarAlignState();
    scheduleSave();
  }

  // Element-level text color, applied via elementStyle.color — same field
  // the inspector "Style" block writes (see render.ts applyElementStyle).
  // Color inherits, so we set it on the wrapper to mirror the renderer.
  function applyTextColorToEditing(color) {
    if (!editingElementId) return;
    var found = findElement(editingElementId);
    if (!found || found.element.type !== "text") return;
    var es = found.element.elementStyle || {};
    if (color) {
      es.color = color;
    } else {
      delete es.color;
    }
    var anyKey = false;
    for (var k in es) { if (es[k] !== undefined) { anyKey = true; break; } }
    if (anyKey) {
      found.element.elementStyle = es;
    } else {
      delete found.element.elementStyle;
    }
    var wrapper = root.querySelector('[data-opencanvas-element="' + cssEscape(editingElementId) + '"]');
    if (wrapper) wrapper.style.color = color || "";
    scheduleSave();
  }

  function refreshMarkToolbarAlignState() {
    if (!markToolbar || !editingElementId) return;
    var found = findElement(editingElementId);
    if (!found || found.element.type !== "text") return;
    var current = found.element.align;
    var btns = markToolbar.querySelectorAll('[data-mark-align]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.getAttribute('data-mark-align') === current) {
        b.setAttribute('aria-pressed', 'true');
        b.classList.add('active');
      } else {
        b.setAttribute('aria-pressed', 'false');
        b.classList.remove('active');
      }
    }
  }

  function buildMarkToolbar(anchor) {
    removeMarkToolbar();
    const bar = document.createElement("div");
    bar.className = "opencanvas-mark-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Inline formatting");
    const dragBtn = document.createElement("button");
    dragBtn.type = "button";
    dragBtn.className = "opencanvas-mark-drag";
    dragBtn.setAttribute("data-mark-drag", "true");
    dragBtn.setAttribute("aria-label", "Drag to move");
    dragBtn.title = "Drag to move";
    dragBtn.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
      '<circle cx="5.5" cy="4" r="1.2" fill="currentColor"/>' +
      '<circle cx="10.5" cy="4" r="1.2" fill="currentColor"/>' +
      '<circle cx="5.5" cy="8" r="1.2" fill="currentColor"/>' +
      '<circle cx="10.5" cy="8" r="1.2" fill="currentColor"/>' +
      '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/>' +
      '<circle cx="10.5" cy="12" r="1.2" fill="currentColor"/>' +
      '</svg>';
    // mousedown.preventDefault() keeps the contenteditable selection alive
    // while we initiate the drag on the parent text element wrapper.
    dragBtn.addEventListener("mousedown", function(ev) {
      ev.preventDefault();
      if (!editingElementId) return;
      var wrapper = root.querySelector('[data-opencanvas-element="' + cssEscape(editingElementId) + '"]');
      if (!wrapper) return;
      beginDrag(ev, wrapper);
    });
    bar.appendChild(dragBtn);
    const labels = {
      bold: "B",
      italic: "I",
      underline: "U",
      strike: "S",
      code: "</>",
      highlight: "HL",
      link: "Link",
    };
    for (let i = 0; i < CANONICAL_MARK_ORDER.length; i++) {
      const type = CANONICAL_MARK_ORDER[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = labels[type];
      btn.setAttribute("data-mark", type);
      // Keep focus inside the contenteditable so the Selection survives the click.
      btn.addEventListener("mousedown", (ev) => { ev.preventDefault(); });
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        applyMark(type);
      });
      bar.appendChild(btn);
    }

    // -- Alignment block --------------------------------------------------
    // Element-level alignment buttons mirror the inspector's align select
    // (left/center/right). Pressed state is refreshed after each apply via
    // refreshMarkToolbarAlignState — and once below after the toolbar is
    // attached, so the initial state matches element.align.
    var sep1 = document.createElement("span");
    sep1.className = "opencanvas-mark-sep";
    sep1.setAttribute("aria-hidden", "true");
    bar.appendChild(sep1);

    var alignDirs = ["left", "center", "right"];
    var alignTitles = { left: "Align left", center: "Align center", right: "Align right" };
    var alignSvg = {
      left:
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="2" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
        '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="2" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
      center:
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="4" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
        '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="4" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
      right:
        '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="6" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
        '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
        '<rect x="6" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
    };
    for (var ai = 0; ai < alignDirs.length; ai++) {
      (function (dir) {
        var ab = document.createElement("button");
        ab.type = "button";
        ab.className = "opencanvas-mark-align";
        ab.setAttribute("data-mark-align", dir);
        ab.setAttribute("aria-label", alignTitles[dir]);
        ab.title = alignTitles[dir];
        ab.innerHTML = alignSvg[dir];
        ab.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        ab.addEventListener("click", function (ev) {
          ev.preventDefault();
          applyAlignToEditing(dir);
        });
        bar.appendChild(ab);
      })(alignDirs[ai]);
    }

    // -- Text color block -------------------------------------------------
    // Element-level color via elementStyle.color. The native <input type="color">
    // is hidden behind the swatch button — clicking the swatch triggers the
    // browser's color picker. The swatch fill mirrors the current color so
    // the user can see the active value without opening the picker.
    var sep2 = document.createElement("span");
    sep2.className = "opencanvas-mark-sep";
    sep2.setAttribute("aria-hidden", "true");
    bar.appendChild(sep2);

    var initColor = "#222222";
    var foundInit = editingElementId ? findElement(editingElementId) : null;
    if (foundInit && foundInit.element && foundInit.element.elementStyle && foundInit.element.elementStyle.color) {
      initColor = foundInit.element.elementStyle.color;
    }
    var colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "opencanvas-mark-color";
    colorBtn.setAttribute("aria-label", "Text color");
    colorBtn.title = "Text color";
    var colorGlyph = document.createElement("span");
    colorGlyph.className = "opencanvas-mark-color-glyph";
    colorGlyph.textContent = "A";
    var colorSwatch = document.createElement("span");
    colorSwatch.className = "opencanvas-mark-color-swatch";
    colorSwatch.style.background = initColor;
    colorBtn.appendChild(colorGlyph);
    colorBtn.appendChild(colorSwatch);
    var colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = initColor;
    colorInput.className = "opencanvas-mark-color-input";
    colorInput.setAttribute("aria-hidden", "true");
    colorInput.tabIndex = -1;
    colorBtn.appendChild(colorInput);
    colorBtn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    colorBtn.addEventListener("click", function (ev) {
      // The hidden input is inside the button — pressing the button bubbles a
      // click here. Only forward to the native picker when the event target was
      // the button itself, not the input.
      if (ev.target === colorInput) return;
      ev.preventDefault();
      colorInput.click();
    });
    colorInput.addEventListener("input", function () {
      var v = colorInput.value;
      colorSwatch.style.background = v;
      applyTextColorToEditing(v);
    });
    bar.appendChild(colorBtn);

    // -- AI rewrite button ------------------------------------------------
    // Same handler the inspector's "AI rewrite" button uses (aiRewriteText).
    // Surfaced in the toolbar so the author can rewrite without leaving the
    // selection — Notion/Gamma-style inline AI affordance.
    var aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.className = "opencanvas-mark-ai";
    aiBtn.setAttribute("aria-label", "Rewrite with AI");
    aiBtn.title = "Rewrite with AI";
    aiBtn.textContent = "AI";
    aiBtn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    aiBtn.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!editingElementId) return;
      aiRewriteText(editingElementId);
    });
    bar.appendChild(aiBtn);

    markToolbar = bar;
    markToolbarAnchor = anchor;
    // Append to document.body (NOT viewport or #canvas-root) so the
    // toolbar lives in viewport coordinate space and stays pinned via
    // position: fixed while the body scrolls.
    document.body.appendChild(bar);
    positionMarkToolbar(anchor);
    refreshMarkToolbarAlignState();
  }

  function beginTextEdit(elementId) {
    const found = findElement(elementId);
    if (!found || found.element.type !== "text") return;
    const wrapper = root.querySelector('[data-opencanvas-element="' + cssEscape(elementId) + '"]');
    if (!wrapper) return;
    const inner = wrapper.querySelector(".opencanvas-text");
    if (!inner) return;
    var textH = inner.scrollHeight;
    if (textH > found.element.box.h) {
      found.element.box.h = textH;
      setBoxStyle(wrapper, found.element.box);
      scheduleSave();
    }

    editingElementId = elementId;
    // Deep-clone the pre-edit content so Escape/Cancel can restore exactly.
    editingSnapshot = JSON.parse(JSON.stringify(found.element.content || []));
    inner.setAttribute("contenteditable", "true");
    inner.focus();

    buildMarkToolbar(wrapper);

    inner.addEventListener('mouseover', function (ev) {
      var node = ev.target;
      while (node && node !== inner) {
        if (node.nodeType === 1 && node.tagName === 'A') {
          onLinkMouseEnter({ target: node });
          return;
        }
        node = node.parentNode;
      }
    });
    inner.addEventListener('mouseout', function (ev) {
      var node = ev.target;
      while (node && node !== inner) {
        if (node.nodeType === 1 && node.tagName === 'A') {
          onLinkMouseLeave({ target: node });
          return;
        }
        node = node.parentNode;
      }
    });

    // selectionchange is a document-level event; register it for the
    // duration of text edit and remove it in finish(). The handler
    // short-circuits when editingElementId is cleared, but removing keeps
    // the global listener set small.
    document.addEventListener('selectionchange', onSelectionChangeForLinkPopover);

    function restoreFromSnapshot() {
      found.element.content = JSON.parse(JSON.stringify(editingSnapshot));
      rebuildElement(elementId);
    }

    function finish(commit) {
      inner.removeAttribute("contenteditable");
      inner.removeEventListener("blur", onBlur);
      inner.removeEventListener("keydown", onKey);
      document.removeEventListener('selectionchange', onSelectionChangeForLinkPopover);
      removeMarkToolbar();
      removeLinkPopover();
      const snapshot = editingSnapshot;
      editingElementId = null;
      editingSnapshot = null;
      if (!commit) {
        // Restore the visible DOM too — the user may have pressed marks.
        found.element.content = JSON.parse(JSON.stringify(snapshot));
        rebuildElement(elementId);
        return;
      }
      let runs;
      try {
        runs = serializeContentToRuns(inner);
      } catch (err) {
        setStatus("Link rejected: " + (err && err.message ? err.message : String(err)), "error");
        // Loud failure — do not commit, restore pre-edit content.
        found.element.content = JSON.parse(JSON.stringify(snapshot));
        rebuildElement(elementId);
        return;
      }
      if (runs.length === 0 || plainTextOf(runs).length === 0) {
        setStatus("Text can't be empty", "error");
        found.element.content = JSON.parse(JSON.stringify(snapshot));
        rebuildElement(elementId);
        return;
      }
      found.element.content = runs;
      rebuildElement(elementId);
      scheduleSave();
    }
    function onBlur(ev) {
      // Ignore blur events caused by clicks on the mark toolbar buttons —
      // those keep the editor in edit mode by design.
      const next = ev.relatedTarget;
      if (next && markToolbar && markToolbar.contains(next)) return;
      if (next && linkPopover && linkPopover.contains(next)) return;
      if (modalOpen) return;
      finish(true);
    }
    function onKey(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
        inner.blur();
        return;
      }
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      const key = (ev.key || "").toLowerCase();
      if (key === "b") { ev.preventDefault(); applyMark("bold"); return; }
      if (key === "i") { ev.preventDefault(); applyMark("italic"); return; }
      if (key === "u") { ev.preventDefault(); applyMark("underline"); return; }
      if (ev.shiftKey && key === "x") { ev.preventDefault(); applyMark("strike"); return; }
      if (key === "k") { ev.preventDefault(); applyMark("link"); return; }
    }
    inner.addEventListener("blur", onBlur);
    inner.addEventListener("keydown", onKey);
  }

  // -- AI preview panel ---------------------------------------------------
  //
  // Three entry points (AI rewrite, AI media, AI section) drive the same
  // POST /api/canvas-agent/sites/:siteId/preview pipeline. The response
  // carries an op list and a previewState; the editor renders a transient
  // side panel describing the ops with Accept/Dismiss buttons. Accept calls
  // /apply on the server (which re-validates from scratch) and replaces
  // the editor state with the response's editableState. Dismiss closes the
  // panel without saving — the local state never changed in the first place.
  //
  // While the panel is open, aiBusy=true disables every AI button so the
  // Owner cannot stack previews on top of each other.

  function setAiBusy(busy) {
    aiBusy = busy || sessionExpired || accessRevoked;
    const buttons = document.querySelectorAll("[data-ai-button]");
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].disabled = aiBusy;
    }
  }

  function closeAiPanel() {
    if (aiPanel && aiPanel.parentNode) {
      aiPanel.parentNode.removeChild(aiPanel);
    }
    aiPanel = null;
    setAiBusy(false);
  }

  function describeOp(op) {
    if (op.kind === "rewriteText") {
      const preview =
        Array.isArray(op.content)
          ? op.content.map((r) => (r && typeof r.text === "string" ? r.text : "")).join("")
          : "";
      const shortened = preview.length > 80 ? preview.slice(0, 77) + "…" : preview;
      return "Rewrite text " + op.elementId + ": " + JSON.stringify(shortened);
    }
    if (op.kind === "replaceMedia") {
      return "Replace media " + op.elementId + " with asset " + op.assetId + " (" + op.mediaKind + ")";
    }
    if (op.kind === "insertSection") {
      const after = op.afterSectionId ? " after " + op.afterSectionId : " at end";
      const brief = op.input && typeof op.input.brief === "string" ? op.input.brief : "";
      return "Insert section recipe=" + op.recipeId + after + (brief.length > 0 ? " — " + JSON.stringify(brief) : "");
    }
    if (op.kind === "designSection") {
      const after = op.afterSectionId ? " after " + op.afterSectionId : " at end";
      const name = op.input && typeof op.input.sectionName === "string" ? op.input.sectionName : "Custom section";
      return "Design section " + JSON.stringify(name) + after;
    }
    return "Unknown op";
  }

  async function applyPreview(ops) {
    // Every exit path must release the AI UI lock. If we leave aiBusy=true or
    // the preview <aside> mounted, every [data-ai-button] stays disabled and
    // the Owner sees a frozen editor after the first failed apply.
    try {
      const saved = await flushPendingSave();
      if (!saved) {
        closeAiPanel();
        return;
      }
      const response = await authFetch(API_BASE + "/canvas-agent/sites/" + SITE_ID + "/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops }),
      });
      if (accessRevoked || sessionExpired) {
        closeAiPanel();
        return;
      }
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && Array.isArray(body.errors) && body.errors.length > 0) detail = body.errors[0];
          else if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("Apply failed: " + detail, "error");
        closeAiPanel();
        return;
      }
      const body = await response.json();
      if (!body || typeof body !== "object" || !body.editableState) {
        setStatus("Apply failed: malformed server response", "error");
        closeAiPanel();
        return;
      }
      state = body.editableState;
      if (state) state = migrateState(state);
      selectedSectionId = null;
      selectedElementId = null;
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      renderAll();
      closeAiPanel();
      setStatus("AI edit applied", "ok");
    } catch (err) {
      if (!accessRevoked && !sessionExpired) {
        setStatus("Apply failed: " + (err && err.message ? err.message : String(err)), "error");
      }
      closeAiPanel();
    }
  }

  function buildAiPanel(payload) {
    closeAiPanel();
    const panel = document.createElement("aside");
    panel.className = "opencanvas-ai-panel";
    panel.setAttribute("aria-label", "AI preview");
    const heading = document.createElement("h3");
    heading.textContent = "AI preview";
    panel.appendChild(heading);

    const ops = Array.isArray(payload.ops) ? payload.ops : [];
    if (typeof payload.text === "string" && payload.text.length > 0) {
      const note = document.createElement("p");
      note.className = "opencanvas-ai-note";
      note.textContent = payload.text;
      panel.appendChild(note);
    }
    if (ops.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "The assistant did not propose any changes.";
      panel.appendChild(empty);
    } else {
      const list = document.createElement("ol");
      for (let i = 0; i < ops.length; i++) {
        const item = document.createElement("li");
        item.textContent = describeOp(ops[i]);
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    const actions = document.createElement("div");
    actions.className = "opencanvas-ai-actions";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Accept";
    accept.disabled = ops.length === 0;
    accept.addEventListener("click", () => { applyPreview(ops); });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      closeAiPanel();
      setStatus("AI preview dismissed", "ok");
    });
    actions.appendChild(accept);
    actions.appendChild(dismiss);
    panel.appendChild(actions);

    document.body.appendChild(panel);
    aiPanel = panel;
  }

  async function runAiPreview(prompt) {
    setAiBusy(true);
    const saved = await flushPendingSave();
    if (!saved) {
      setAiBusy(false);
      return;
    }
    setStatus("Asking the assistant...");
    try {
      const response = await authFetch(API_BASE + "/canvas-agent/sites/" + SITE_ID + "/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && Array.isArray(body.errors) && body.errors.length > 0) detail = body.errors[0];
          else if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("AI preview failed", "error");
        setAiBusy(false);
        // Modal surface — the status-line flash is too easy to miss and the
        // server's error message often tells the Owner exactly what to do.
        try {
          await openAlertModal({ title: "AI preview failed", message: detail });
        } catch (_) { /* another modal was open; status line still has the error */ }
        return;
      }
      const body = await response.json();
      buildAiPanel(body || {});
      setStatus("AI preview ready", "ok");
    } catch (err) {
      setStatus("AI preview failed: " + (err && err.message ? err.message : String(err)), "error");
      setAiBusy(false);
    }
  }

  async function aiRewriteText(elementId) {
    if (aiBusy) return;
    const brief = await openTextModal({
      title: "AI rewrite",
      label: "How should this text change?",
      placeholder: "Make it punchier",
      multiline: true,
    });
    if (brief === null || brief.trim().length === 0) return;
    const prompt =
      "Rewrite the text element with id=" + elementId + " using the rewriteText tool. " +
      "Owner brief: " + brief;
    runAiPreview(prompt);
  }

  // Map the modal's aspect ratio choice to a synthetic boxW/boxH pair so the
  // /assets/generate server (which snaps box ratio to a Flux preset) lands
  // on the exact preset the Owner picked. We keep the server contract
  // unchanged — no new aspect_ratio field on the wire — so the existing
  // single-shot generation path and tests stay valid.
  function aspectRatioToBox(aspect) {
    if (aspect === "1:1") return { w: 1024, h: 1024 };
    if (aspect === "16:9") return { w: 1024, h: 576 };
    if (aspect === "4:3") return { w: 1024, h: 768 };
    if (aspect === "9:16") return { w: 576, h: 1024 };
    return { w: 1024, h: 1024 };
  }

  async function aiReplaceMedia(elementId) {
    if (aiBusy) return;
    const found = findElement(elementId);
    if (!found || found.element.type !== "media" || found.element.mediaKind !== "image") {
      setStatus("AI generation supports image elements only", "error");
      return;
    }
    const element = found.element;
    const altInputId = "media-upload-alt-" + element.id;
    function readAltValue() {
      var altInput = document.getElementById(altInputId);
      return altInput && typeof altInput.value === "string" ? altInput.value : (element.alt || "");
    }

    // requestFn invoked four times in parallel by the modal. Each call hits
    // the same /assets/generate route the single-shot path uses; only the
    // synthesised box dimensions change to steer Flux toward the chosen
    // aspect preset.
    async function requestOne(prompt, aspectRatio) {
      var box = aspectRatioToBox(aspectRatio);
      var altValue = readAltValue();
      var response = await authFetch(SITE_BASE + "/assets/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt,
          alt: altValue,
          boxW: box.w,
          boxH: box.h
        }),
      });
      if (!response.ok) {
        var detail = response.statusText;
        try {
          var errBody = await response.json();
          if (errBody && errBody.error) detail = errBody.error;
        } catch (_) { /* ignore */ }
        throw new Error(detail);
      }
      var mediaType = response.headers.get("content-type") || "image/webp";
      if (!mediaType.startsWith("image/")) {
        throw new Error("server did not return image bytes");
      }
      var blob = await response.blob();
      return { blob: blob, mediaType: mediaType };
    }

    const picked = await openAiMediaModal({
      title: "AI media",
      defaultPrompt: "",
      requestFn: requestOne,
    });
    if (!picked) return;
    // Reuse the existing preview-in-inspector flow so the chosen image
    // follows the same Apply / Discard path as the single-shot generator.
    showGeneratePreview(element, picked.blob, picked.mediaType, readAltValue());
    setStatus("Preview ready — Apply to save", "ok");
  }

  async function aiCreateSection(afterSectionId) {
    if (aiBusy) return;
    const brief = await openTextModal({
      title: "AI section",
      label: "What goes in this section?",
      placeholder: "pricing tiers for a launch plan",
      multiline: true,
    });
    if (brief === null || brief.trim().length === 0) return;
    const afterClause = afterSectionId
      ? "Insert it after section id=" + afterSectionId + "."
      : "Append it at the end of the page.";
    const prompt =
      "Create a new section using the designSection tool. " +
      "Use a semantic layout tree with stack, grid, or split nodes; avoid media leaves. " +
      afterClause + " Owner brief: " + brief;
    runAiPreview(prompt);
  }

  // -- Drag & resize ------------------------------------------------------

  function attachPointerHandlers() {
    // Canvas-wide link hover → popover. Inline marks inside a contenteditable
    // text element are handled by beginTextEdit's per-inner listeners; this
    // wiring covers nav links and action elements which live outside any
    // contenteditable subtree.
    root.addEventListener("mouseover", onCanvasLinkHover);
    root.addEventListener("mouseout", onCanvasLinkHoverLeave);
    root.addEventListener("mousedown", (ev) => {
      if (interactionMode === "pan") return;
      if (ev.target instanceof Element && (ev.target.closest("[data-element-menu-trigger]") || ev.target.closest("[data-element-menu]"))) return;
      const handle = ev.target instanceof Element ? ev.target.closest('[data-resize-handle]') : null;
      if (handle) {
        const wrapper = handle.closest('.opencanvas-element');
        const dir = handle.getAttribute('data-resize-dir') || 'se';
        if (wrapper) { beginResize(ev, wrapper, dir); ev.preventDefault(); }
        return;
      }
      const wrapper = ev.target instanceof Element
        ? resolveElementWrapperAtPoint(ev.target, ev.clientX, ev.clientY)
        : null;
      if (!wrapper) return;
      const elementId = wrapper.getAttribute('data-opencanvas-element');
      if (!elementId) return;
      if (editingElementId === elementId) return;
      const elType = wrapper.getAttribute('data-element-type');
      if (elType === "text") return;
      if (selectedElementId !== elementId) {
        selectElement(elementId);
        return;
      }
      beginDrag(ev, wrapper);
      ev.preventDefault();
    });
  }

  function beginDrag(startEv, wrapper) {
    const elementId = wrapper.getAttribute('data-opencanvas-element');
    if (!elementId) return;
    const found = findElement(elementId);
    if (!found) return;
    const sectionEl = wrapper.closest('.opencanvas-section');
    if (!sectionEl) return;
    const start = pointerToCanvas(startEv, sectionEl);
    if (!start) return;
    const originalBox = Object.assign({}, found.element.box);
    const page = currentPage();
    // Page width is required by the schema; a missing page here means the
    // element being dragged has no page, which is a bug worth surfacing.
    if (!page) throw new Error("beginDrag: element " + elementId + " has no active page");
    const pageWidth = page.width;
    const sectionHeight = found.section.height;

    function onMove(ev) {
      const current = pointerToCanvas(ev, sectionEl);
      if (!current) return;
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      let nx = originalBox.x + dx;
      let ny = originalBox.y + dy;
      if (nx < 0) nx = 0;
      if (ny < 0) ny = 0;
      if (nx + originalBox.w > pageWidth) nx = pageWidth - originalBox.w;
      if (ny + originalBox.h > sectionHeight) ny = sectionHeight - originalBox.h;
      wrapper.style.left = nx + "px";
      wrapper.style.top = ny + "px";
      found.element.box.x = nx;
      found.element.box.y = ny;
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      scheduleSave();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function beginResize(startEv, wrapper, dir) {
    const elementId = wrapper.getAttribute('data-opencanvas-element');
    if (!elementId) return;
    const found = findElement(elementId);
    if (!found) return;
    const sectionEl = wrapper.closest('.opencanvas-section');
    if (!sectionEl) return;
    const start = pointerToCanvas(startEv, sectionEl);
    if (!start) return;
    const ob = Object.assign({}, found.element.box);
    const page = currentPage();
    // Page width is required by the schema; a missing page here means the
    // element being resized has no page, which is a bug worth surfacing.
    if (!page) throw new Error("beginResize: element " + elementId + " has no active page");
    const pageWidth = page.width;
    const sectionHeight = found.section.height;
    const moveX = dir.includes("e") || dir.includes("w");
    const moveY = dir.includes("s") || dir.includes("n");
    const fromLeft = dir.includes("w");
    const fromTop = dir.includes("n");

    function onMove(ev) {
      const current = pointerToCanvas(ev, sectionEl);
      if (!current) return;
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      var nx = ob.x, ny = ob.y, nw = ob.w, nh = ob.h;
      if (moveX) {
        if (fromLeft) { nx = ob.x + dx; nw = ob.w - dx; }
        else { nw = ob.w + dx; }
      }
      if (moveY) {
        if (fromTop) { ny = ob.y + dy; nh = ob.h - dy; }
        else { nh = ob.h + dy; }
      }
      if (nw < MIN_ELEMENT_SIZE_PX) { if (fromLeft) nx = ob.x + ob.w - MIN_ELEMENT_SIZE_PX; nw = MIN_ELEMENT_SIZE_PX; }
      if (nh < MIN_ELEMENT_SIZE_PX) { if (fromTop) ny = ob.y + ob.h - MIN_ELEMENT_SIZE_PX; nh = MIN_ELEMENT_SIZE_PX; }
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      if (nx + nw > pageWidth) nw = pageWidth - nx;
      if (ny + nh > sectionHeight) nh = sectionHeight - ny;
      wrapper.style.left = nx + "px";
      wrapper.style.top = ny + "px";
      wrapper.style.width = nw + "px";
      wrapper.style.height = nh + "px";
      found.element.box.x = nx;
      found.element.box.y = ny;
      found.element.box.w = nw;
      found.element.box.h = nh;
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      scheduleSave();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // -- Section toolbar actions -------------------------------------------

  function nextZ(section) {
    return section.elements.length + 1;
  }

  function defaultBox(section, w, h) {
    const page = currentPage();
    // defaultBox is only reachable via addElement* paths that resolve a
    // section first (targetSectionForSidebar / addBlankSectionFromSidebar /
    // direct selection), and every section lives inside a page. A null page
    // here means the caller fed us a section that no longer belongs to any
    // page in state — fail loudly instead of silently inventing a width.
    if (!page) throw new Error("defaultBox: no current page; section/page state out of sync");
    const pageWidth = page.width;
    let width = w;
    let height = h;
    if (width > pageWidth) width = pageWidth - 40;
    if (height > section.height) height = section.height - 40;
    return { x: 40, y: 40, w: width, h: height, z: nextZ(section) };
  }

  function addElementToSection(section, element) {
    // Apply page default motion if the element has no motion set.
    if (!element.motion) {
      var pg = currentPage();
      if (pg && pg.defaultMotionPreset && pg.defaultMotionPreset !== "none") {
        element.motion = { preset: pg.defaultMotionPreset, delayMs: 0 };
      }
    }
    section.elements.push(element);
    renderAll();
    selectElement(element.id);
    // Pan the camera so the freshly-inserted element is centred in the
    // viewport — without this, an element added far from the current scroll
    // (e.g. footer when user is at the hero) appears off-screen.
    panToElement(element.id);
    scheduleSave();
  }

  // Pick the section the user is currently looking at, so newly-added
  // elements land where the cursor is — not in the page footer.
  // Priority:
  //   1. Explicitly-selected section.
  //   2. The section under the viewport centre (what the user is editing).
  //   3. The first body section (skip pinned header/footer roles).
  //   4. The first section of any kind.
  function targetSectionForSidebar() {
    const page = currentPage();
    if (!page || !Array.isArray(page.sections) || page.sections.length === 0) return null;
    if (selectedSectionId) {
      const selected = findSection(selectedSectionId);
      if (selected) return selected;
    }
    if (viewport) {
      var vRect = viewport.getBoundingClientRect();
      var cx = vRect.left + vRect.width / 2;
      var cy = vRect.top + vRect.height / 2;
      var hit = document.elementFromPoint(cx, cy);
      if (hit && hit instanceof Element) {
        var secNode = hit.closest('.opencanvas-section');
        if (secNode) {
          var sid = secNode.getAttribute('data-opencanvas-section');
          if (sid) {
            var hitSection = findSection(sid);
            if (hitSection) return hitSection;
          }
        }
      }
    }
    for (var i = 0; i < page.sections.length; i++) {
      var role = page.sections[i].role || 'body';
      if (role === 'body') return page.sections[i];
    }
    return page.sections[0];
  }

  // Centre the camera on an element's world position. No-op if anything in
  // the lookup chain is missing (page/section/element/viewport).
  function panToElement(elementId) {
    if (!viewport) return;
    var found = findElement(elementId);
    if (!found) return;
    var page = currentPage();
    if (!page) return;
    var pos = getPagePosition(page.id);
    if (!pos) return;
    var sectionY = pos.y;
    if (state && state.header) sectionY += state.header.height || 0;
    for (var i = 0; i < page.sections.length; i++) {
      if (page.sections[i].id === found.section.id) break;
      sectionY += page.sections[i].height || 0;
    }
    var box = found.element.box;
    var worldX = pos.x + box.x + box.w / 2;
    var worldY = sectionY + box.y + box.h / 2;
    var rect = viewport.getBoundingClientRect();
    camera.x = rect.width / 2 - worldX * camera.zoom;
    camera.y = rect.height / 2 - worldY * camera.zoom;
    applyCameraTransform();
  }

  function addBlankSectionFromSidebar() {
    const page = currentPage();
    if (!page) return;
    const section = {
      id: newSectionId(),
      recipeId: "feature-grid",
      name: "Blank section",
      height: 640,
      elements: [],
    };
    const selectedIndex = selectedSectionId
      ? page.sections.findIndex((candidate) => candidate.id === selectedSectionId)
      : -1;
    const insertAt = clampInsertIndex(page, selectedIndex >= 0 ? selectedIndex + 1 : page.sections.length);
    page.sections.splice(insertAt, 0, section);
    selectedSectionId = section.id;
    selectedElementId = null;
    renderAll();
    scheduleSave();
    setStatus("Section added", "ok");
  }

  // Sidebar drop-in keys are sourced from SIDEBAR_DISPATCH; "add-X" is the
  // canonical section-action string (matches buildSectionToolbar's data
  // attribute + handleSectionAction's branch lookup).
  function componentActionForSidebar(component) {
    if (!SIDEBAR_COMMANDS[component]) return null;
    return "add-" + component;
  }

  function addComponentFromSidebar(component) {
    const section = targetSectionForSidebar();
    if (!section) {
      setStatus("Add a section first", "error");
      return;
    }
    const action = componentActionForSidebar(component);
    if (!action) {
      setStatus("Unknown component: " + component, "error");
      return;
    }
    handleSectionAction(action, section.id);
  }

  function handleSectionAction(action, sectionId) {
    // Handle site-level header/footer delete before page lookup
    if (action === "delete-section") {
      if (state.header && state.header.id === sectionId) {
        state.header = undefined;
        selectedSectionId = null;
        selectedElementId = null;
        captureForUndo();
        renderAll();
        scheduleSave();
        setStatus("Header removed", "ok");
        return;
      }
      if (state.footer && state.footer.id === sectionId) {
        state.footer = undefined;
        selectedSectionId = null;
        selectedElementId = null;
        captureForUndo();
        renderAll();
        scheduleSave();
        setStatus("Footer removed", "ok");
        return;
      }
    }
    // For add-* actions on site-level header/footer, resolve the section
    var siteSection = null;
    if (state.header && state.header.id === sectionId) siteSection = state.header;
    if (state.footer && state.footer.id === sectionId) siteSection = state.footer;
    if (siteSection && action.indexOf("add-") === 0) {
      // Delegate add-element actions to the site-level section
    }
    var page = currentPage();
    if (!page) return;
    var idx = page.sections.findIndex(function(s) { return s.id === sectionId; });
    if (idx < 0 && !siteSection) return;
    var section = siteSection || page.sections[idx];

    // "add-X" routes through SIDEBAR_DISPATCH + SIDEBAR_FACTORIES (ADR 0011
    // Step 3). The previous 14-arm switch is gone; each per-element module
    // owns its sidebar metadata and the canvas-client owns the matching
    // factory closure. The sidebar-dispatch:smoke verifies every spec
    // factoryName has a registered factory above.
    if (action.indexOf("add-") === 0 && SIDEBAR_COMMANDS[action.slice(4)]) {
      insertElementForSidebarCommand(section, action.slice(4));
    } else if (action === "duplicate-section") {
      if (isPinnedSection(section)) return;
      const copy = JSON.parse(JSON.stringify(section));
      copy.id = newSectionId();
      copy.name = section.name + " copy";
      copy.role = undefined;
      for (const el of copy.elements) { el.id = newElementId(); }
      page.sections.splice(idx + 1, 0, copy);
      renderAll();
      selectSection(copy.id);
      scheduleSave();
    } else if (action === "delete-section") {
      if (page.sections.length <= 1) {
        setStatus("Can't delete the last section", "error");
        return;
      }
      page.sections.splice(idx, 1);
      selectedSectionId = null;
      selectedElementId = null;
      renderAll();
      scheduleSave();
    } else if (action === "move-up") {
      if (idx === 0) return;
      if (isPinnedSection(section)) return;
      const prev = page.sections[idx - 1];
      if (prev.role === "header") return;
      page.sections[idx - 1] = section;
      page.sections[idx] = prev;
      renderAll();
      scheduleSave();
    } else if (action === "move-down") {
      if (idx >= page.sections.length - 1) return;
      if (isPinnedSection(section)) return;
      const next = page.sections[idx + 1];
      if (next.role === "footer") return;
      page.sections[idx + 1] = section;
      page.sections[idx] = next;
      renderAll();
      scheduleSave();
    } else if (action === "save-to-library") {
      void saveToLibrary(section);
    }
  }

  // -- Save section to library -------------------------------------------

  async function saveToLibrary(section) {
    var name = await openTextModal({ title: "Save to library", label: "Section name", defaultValue: section.name || "" });
    if (name === null) return;
    if (name.trim().length === 0) name = section.name || "Untitled";
    var description = await openTextModal({ title: "Save to library", label: "Description (optional)", defaultValue: "" });
    if (description === null) return;
    var visibility = await openSelectModal({
      title: "Save to library",
      label: "Where can this section be reused?",
      options: [
        { value: "private", label: "Private — only my sites" },
        { value: "global", label: "Community — shared with everyone" },
      ],
      defaultValue: "private",
    });
    if (visibility === null) return;
    try {
      var saved = await flushPendingSave();
      if (!saved) return;
      setStatus("Saving section to library...", "ok");
      var response = await authFetch(API_BASE + "/library/sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: SITE_ID,
          sectionId: section.id,
          name: name.trim(),
          description: description.trim(),
          visibility: visibility,
        }),
      });
      if (!response.ok) {
        var detail = response.statusText;
        try {
          var body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (e2) { /* ignore */ }
        setStatus("Save failed: " + detail, "error");
        return;
      }
      sectionsCatalog = null;
      setStatus("Section saved to library", "ok");
    } catch (err) {
      setStatus("Save failed: " + (err && err.message ? err.message : String(err)), "error");
    }
  }

  // -- Save site as template ----------------------------------------------

  async function saveSiteAsTemplate() {
    var name = await openTextModal({ title: "Save as template", label: "Template name", defaultValue: state && state.pages && state.pages[0] ? state.pages[0].title : "" });
    if (name === null) return;
    if (name.trim().length === 0) {
      setStatus("Template name is required", "error");
      return;
    }
    var tagline = await openTextModal({ title: "Save as template", label: "Description", defaultValue: "" });
    if (tagline === null) return;
    var visibility = await openSelectModal({
      title: "Save as template",
      label: "Who can use this template?",
      options: [
        { value: "private", label: "Private — only me" },
        { value: "global", label: "Community — anyone on Open Canvas" },
      ],
      defaultValue: "private",
    });
    if (visibility === null) return;
    try {
      var saved = await flushPendingSave();
      if (!saved) return;
      setStatus("Saving as template...", "ok");
      var response = await authFetch(API_BASE + "/custom-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteId: SITE_ID,
          name: name.trim(),
          tagline: tagline.trim(),
          visibility: visibility,
        }),
      });
      if (!response.ok) {
        var detail = response.statusText;
        try {
          var body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (e2) { /* ignore */ }
        setStatus("Save as template failed: " + detail, "error");
        return;
      }
      setStatus("Saved as template", "ok");
    } catch (err) {
      setStatus("Save as template failed: " + (err && err.message ? err.message : String(err)), "error");
    }
  }

  // -- Click → element wrapper resolution --------------------------------
  //
  // Resolving the clicked widget is harder than ev.target.closest('.opencanvas-
  // element') because three widget bodies (form / table / carousel) render
  // semantic HTML (form, table, transformed divs) whose layout/overflow
  // rules let the inner content escape the wrapper's bounding box. The CSS
  // shield (the wrappers .opencanvas-element::after pseudo) catches centre
  // clicks, but clicks on overflowed cells, transformed slides, or stacked
  // form rows can:
  //   (1) skip the ::after shield because the click coord is outside the
  //       wrapper's box,
  //   (2) report ev.target as the section or the canvas background — both
  //       outside any .opencanvas-element subtree, so closest() returns null and
  //       the click bounces to the section / page inspector.
  // Pass-9 retest pinned this regression to table / form / carousel even
  // though Pass-8 added an elementsFromPoint() fallback.
  //
  // The resolver below combines four signals so the deepest widget wins:
  //   - ev.target ancestor walk (cheap, handles centre-of-wrapper clicks).
  //   - document.elementsFromPoint(clientX, clientY) (handles wrapper-area
  //     clicks where descendants forward the event to the wrapper itself).
  //   - For every element in that stack, walk its ancestor chain so a click
  //     on overflowed content inside a section still resolves to its
  //     .opencanvas-element wrapper.
  //   - A geometry pass over wrapper + descendant client rects, which catches
  //     visible overflow whose descendants were removed from hit-testing by
  //     pointer-events:none while the widget is unselected.
  // It then ranks candidates by DOM depth and picks the deepest one whose
  // box contains the click coords (or, lacking a containing match, the
  // deepest match overall). The bbox-contains pass guards against picking
  // a different widget that merely sits in the same stack.
  function resolveElementWrapperAtPoint(target, clientX, clientY) {
    const seen = new Set();
    const candidates = [];

    function addCandidate(node) {
      while (node && node !== root) {
        if (
          node.nodeType === 1 &&
          node.classList &&
          node.classList.contains('opencanvas-element')
        ) {
          if (!seen.has(node)) {
            seen.add(node);
            candidates.push(node);
          }
          return;
        }
        node = node.parentNode;
      }
    }

    function pointInsideAnyRect(node, x, y) {
      if (!node || typeof node.getClientRects !== "function") return false;
      const rects = node.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return true;
        }
      }
      return false;
    }

    function addGeometryCandidates() {
      const wrappers = root.querySelectorAll(".opencanvas-element");
      for (let i = 0; i < wrappers.length; i++) {
        const wrapper = wrappers[i];
        if (pointInsideAnyRect(wrapper, clientX, clientY)) {
          addCandidate(wrapper);
          continue;
        }
        const descendants = wrapper.querySelectorAll("*");
        for (let j = 0; j < descendants.length; j++) {
          if (pointInsideAnyRect(descendants[j], clientX, clientY)) {
            addCandidate(wrapper);
            break;
          }
        }
      }
    }

    if (target instanceof Element) {
      addCandidate(target);
    }
    if (typeof document.elementsFromPoint === 'function') {
      const stack = document.elementsFromPoint(clientX, clientY);
      for (let i = 0; i < stack.length; i++) {
        const node = stack[i];
        if (node instanceof Element) addCandidate(node);
      }
    }
    addGeometryCandidates();
    if (candidates.length === 0) return null;

    function depth(node) {
      let d = 0;
      let n = node;
      while (n && n !== root) { d += 1; n = n.parentNode; }
      return d;
    }

    function rectContains(node, x, y) {
      const r = node.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    let best = null;
    let bestDepth = -1;
    let bestContains = false;
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i];
      const contains = rectContains(node, clientX, clientY);
      const d = depth(node);
      // Prefer bbox-containing candidates over not-containing ones. Within
      // the same containment bucket, deeper wins so a widget nested under a
      // container is picked over the container.
      if (best === null) {
        best = node; bestDepth = d; bestContains = contains;
        continue;
      }
      if (contains && !bestContains) {
        best = node; bestDepth = d; bestContains = contains;
        continue;
      }
      if (contains === bestContains && d > bestDepth) {
        best = node; bestDepth = d;
      }
    }
    return best;
  }

  // -- Wire root events ---------------------------------------------------

  function attachRootEvents() {
    root.addEventListener("click", (ev) => {
      if (interactionMode === "pan") return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      // -- Artboard label click: switch active page and zoom to fit --------
      var artboardLabel = target.closest(".opencanvas-artboard-label");
      if (artboardLabel) {
        var labelPageId = artboardLabel.getAttribute("data-page-id");
        if (labelPageId && labelPageId !== activePageId) {
          setActivePage(labelPageId);
          fitToPage(labelPageId);
        }
        root.classList.remove("canvas-pages-deselected");
        return;
      }
      // -- Inactive artboard click: activate it ---------------------------
      var clickedArtboard = target.closest(".opencanvas-artboard");
      if (clickedArtboard && clickedArtboard.getAttribute("data-active") === "false") {
        var abPageId = clickedArtboard.getAttribute("data-page-id");
        if (abPageId) {
          setActivePage(abPageId);
        }
        root.classList.remove("canvas-pages-deselected");
        return;
      }
      var menuTrigger = target.closest("[data-element-menu-trigger]");
      if (menuTrigger) {
        var triggerId = menuTrigger.getAttribute("data-element-menu-trigger");
        var triggerWrapper = menuTrigger.closest(".opencanvas-element");
        if (triggerId && triggerWrapper) toggleElementMenu(triggerId, triggerWrapper);
        ev.stopPropagation();
        return;
      }
      if (target.closest("[data-element-menu]")) {
        ev.stopPropagation();
        return;
      }
      closeElementMenu();
      const toolbarButton = target.closest('[data-section-action]');
      if (toolbarButton) {
        const action = toolbarButton.getAttribute('data-section-action');
        const sid = toolbarButton.getAttribute('data-section-id');
        if (action && sid) handleSectionAction(action, sid);
        ev.stopPropagation();
        return;
      }
      let elementNode = resolveElementWrapperAtPoint(target, ev.clientX, ev.clientY);
      if (elementNode) {
        const id = elementNode.getAttribute('data-opencanvas-element');
        if (!id) return;
        const elType = elementNode.getAttribute('data-element-type');
        if (elType === "text") {
          if (editingElementId !== id) {
            selectElement(id);
            beginTextEdit(id);
          }
          return;
        }
        if (id !== selectedElementId) selectElement(id);
        return;
      }
      const sectionNode = target.closest('.opencanvas-section');
      if (sectionNode) {
        const sid = sectionNode.getAttribute('data-opencanvas-section');
        if (sid) { selectSection(sid); selectElement(null); }
        return;
      }
      // Background click inside the canvas viewport (artboard padding or
      // the gutter around pages): drop the active section and element so the
      // selection outline clears and the inspector goes back to its empty
      // state. Clicks on the sidebar/inspector/header reach here too via the
      // document-level mousedown listener below.
      if (selectedSectionId) selectSection(null);
      if (selectedElementId) selectElement(null);
      // Mark the canvas as page-deselected — CSS clears the .7 dim that
      // .opencanvas-artboard[data-active="false"] usually carries so every page
      // reads as neutral until the user clicks an artboard or label again.
      root.classList.add("canvas-pages-deselected");
    });

    root.addEventListener("dblclick", function(ev) {
      var dblLabel = ev.target instanceof Element ? ev.target.closest(".opencanvas-artboard-label") : null;
      if (dblLabel) {
        var dblPageId = dblLabel.getAttribute("data-page-id");
        if (dblPageId) {
          setActivePage(dblPageId);
          fitToPage(dblPageId);
        }
      }
    });

    // Viewport-level deselect.
    //
    // canvas-root has zero width/height — it's a transform-anchored layout
    // sentinel whose descendants (artboards) are positioned via translate.
    // Clicks that hit the visible canvas BACKGROUND (the gutter between
    // artboards, or anywhere inside opencanvas-viewport that isn't an artboard
    // child) never bubble through canvas-root, so the deselect branch
    // attached above misses them entirely. The user's mental model is:
    // "click anywhere off a page = un-grey everything," so we mirror the
    // same deselect logic at the viewport level. Filtered to skip clicks
    // that land on artboard descendants (those are handled by root's
    // listener above) and on the side-chrome buttons (zoom controls etc.)
    // that the route renders inside the viewport.
    if (viewport) {
      viewport.addEventListener("click", function(ev) {
        if (interactionMode === "pan") return;
        const target = ev.target instanceof Element ? ev.target : null;
        if (!target) return;
        if (root && root.contains(target) && target !== root) return;
        if (target.closest("[data-zoom-action], [data-mode-action]")) return;
        if (selectedSectionId) selectSection(null);
        if (selectedElementId) selectElement(null);
        root.classList.add("canvas-pages-deselected");
      });
    }

    document.addEventListener("mousedown", (ev) => {
      if (!selectedElementId) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (target.closest('.opencanvas-modal-backdrop')) return;
      if (target.closest('.opencanvas-ai-panel')) return;
      if (inspector && inspector.contains(target)) return;
      if (target.closest('#canvas-reel')) return;
      if (target.closest('.opencanvas-element')) return;
      if (target.closest('#canvas-sidebar')) return;
      selectElement(null);
    });

    document.addEventListener("mousedown", (ev) => {
      if (!selectedElementId) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (inspector && inspector.contains(target)) return;
      if (target.closest('.opencanvas-element')) return;
      if (target.closest('#canvas-sidebar')) return;
      selectElement(null);
    });
  }

  // -- Style kit ----------------------------------------------------------

  // Inspector summary of the active kit — reads computed CSS off the editor
  // wrapper, so it stays in sync with whatever style-kits.ts emits. There is
  // no duplicate copy of STYLE_KIT_PRESETS in the client bundle: the wrapper
  // is the source of truth at runtime.
  function buildKitSummary() {
    const wrap = document.createElement("div");
    wrap.className = "opencanvas-kit-summary";
    if (!mainEl || !state || !state.styleKit) {
      wrap.textContent = "kit: (unknown)";
      return wrap;
    }
    const cs = window.getComputedStyle(mainEl);
    function token(name, fallback) {
      const value = cs.getPropertyValue(name);
      return value && value.trim().length > 0 ? value.trim() : (fallback || "");
    }
    const accent = token("--opencanvas-kit-accent", "(unset)");
    const display = token("--opencanvas-kit-font-display", "(unset)");
    const duration = token("--opencanvas-kit-motion-duration", "(unset)");
    const rows = [
      ["kit", state.styleKit, null],
      ["accent", accent, accent],
      ["display", display.split(",")[0].replace(/['"]/g, "").trim(), null],
      ["motion", duration, null],
    ];
    for (let i = 0; i < rows.length; i++) {
      const row = document.createElement("div");
      row.className = "row";
      if (rows[i][2]) {
        const sw = document.createElement("span");
        sw.className = "swatch";
        sw.style.background = rows[i][2];
        row.appendChild(sw);
      }
      const label = document.createElement("span");
      label.textContent = rows[i][0] + ": " + rows[i][1];
      row.appendChild(label);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function syncSidebarStyleKitButtons(buttons) {
    buttons.forEach((b) => {
      const isActive = !!state && b.getAttribute('data-sidebar-style-kit') === state.styleKit;
      b.classList.toggle("active", isActive);
      b.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  async function applySidebarStyleKit(kit, buttons) {
    if (!kit || STYLE_KITS.indexOf(kit) < 0) return;
    try {
      const saved = await flushPendingSave();
      if (!saved) return;
      const response = await authFetch(SITE_BASE + "/style-kit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ styleKit: kit }),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try { const body = await response.json(); if (body && body.error) detail = body.error; } catch (_) {}
        setStatus(detail, "error");
        return;
      }
      captureForUndo();
      state.styleKit = kit;
      if (mainEl) mainEl.setAttribute("data-style-kit", kit);
      syncSidebarStyleKitButtons(buttons);
      // Re-render the inspector so the kit summary picks up the new
      // computed CSS values. Cheap because the inspector is a small DOM.
      renderInspector();
      setStatus("Style kit: " + kit, "ok");
    } catch (err) {
      setStatus("Style kit change failed", "error");
    }
  }

  function attachSidebarTabs() {
    // Listeners attach to the 3 static tabs rendered in route.tsx (Add /
    // Sections / Pages). The Versions tab is mounted dynamically later by
    // ensureVersionsTabMounted and brings its own click handler. All four
    // delegate to the single activateSidebarTab() function so the active
    // class is toggled on every live tab — querying [data-sidebar-tab]
    // fresh on each click is what keeps the Versions tab's underline from
    // sticking when the user switches back to Add/Sections/Pages.
    const tabButtons = document.querySelectorAll('[data-sidebar-tab]');
    const panels = document.querySelectorAll('[data-sidebar-panel]');
    if (tabButtons.length === 0 || panels.length === 0) return;

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const tabName = button.getAttribute('data-sidebar-tab');
        if (tabName) activateSidebarTab(tabName);
      });
    });
  }

  // -- Sections picker (cross-template catalog) --------------------------
  // sectionsCatalog: null = unloaded; [] = loaded-empty; [...] = loaded.
  // pendingImport stays null until the Owner clicks "Use" on a card; the
  // canvas renderer reads it to show drop slots.
  let sectionsCatalog = null;
  let pendingImport = null;
  let activeTemplateFilter = 'all';
  let activeSearchQuery = '';

  // Local HTML/attr escapers. The canvas/render.ts helpers aren't reachable
  // from this script body (it's a string-emitted IIFE), so we inline minimal
  // versions matching the same character set.
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => {
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return '&#39;';
    });
  }
  // HTML-encoding all 5 chars is over-escaping for attributes but correct;
  // matches src/canvas/render.ts ATTR_ESCAPES.
  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function ensureSectionsPanelLoaded() {
    const root = document.querySelector('[data-section-picker-root]');
    if (!root) return;
    if (sectionsCatalog === null) {
      try {
        const response = await authFetch(API_BASE + '/library/sections');
        if (!response.ok) {
          root.innerHTML = '<p class="opencanvas-section-picker-empty">Failed to load sections.</p>';
          return;
        }
        const body = await response.json();
        sectionsCatalog = Array.isArray(body && body.sections) ? body.sections : [];
      } catch (err) {
        root.innerHTML = '<p class="opencanvas-section-picker-empty">Failed to load sections.</p>';
        return;
      }
    }
    renderSectionsPanel();
  }

  function renderSectionsPanel() {
    const root = document.querySelector('[data-section-picker-root]');
    if (!root || sectionsCatalog === null) return;

    let gridContainer = root.querySelector('[data-section-picker-grid-container]');
    if (!gridContainer) {
      // First paint: build the persistent shell (controls + empty grid container).
      // Subsequent calls skip this branch so the search input keeps focus across
      // keystroke-triggered re-renders.
      renderSectionsPickerShell(root);
      gridContainer = root.querySelector('[data-section-picker-grid-container]');
    }

    renderSectionsPickerGrid(gridContainer);
  }

  function renderSectionsPickerShell(root) {
    const filterOptions = [
      '<option value="all">All sections</option>',
      '<option value="seed">Built-in</option>',
      '<option value="library">Library</option>',
    ].join('');

    root.innerHTML =
      '<div class="opencanvas-section-picker-controls">' +
        '<input type="search" class="opencanvas-section-picker-search" placeholder="Search sections" ' +
          'value="' + escapeAttr(activeSearchQuery) + '" data-section-picker-search />' +
        '<select class="opencanvas-section-picker-filter" data-section-picker-filter>' + filterOptions + '</select>' +
      '</div>' +
      '<div data-section-picker-grid-container></div>';

    const filter = root.querySelector('[data-section-picker-filter]');
    if (filter) {
      filter.value = activeTemplateFilter;
      filter.addEventListener('change', () => {
        activeTemplateFilter = filter.value;
        renderSectionsPickerGrid(root.querySelector('[data-section-picker-grid-container]'));
      });
    }
    const search = root.querySelector('[data-section-picker-search]');
    if (search) {
      search.addEventListener('input', () => {
        activeSearchQuery = search.value;
        renderSectionsPickerGrid(root.querySelector('[data-section-picker-grid-container]'));
      });
    }
  }

  function renderSectionsPickerGrid(gridContainer) {
    if (!gridContainer || sectionsCatalog === null) return;

    const filtered = sectionsCatalog.filter((entry) => {
      if (activeTemplateFilter !== 'all' && entry.source !== activeTemplateFilter) return false;
      if (activeSearchQuery.length > 0) {
        const haystack = (entry.name + ' ' + entry.headingPreview + ' ' + (entry.templateName || '')).toLowerCase();
        if (!haystack.includes(activeSearchQuery.toLowerCase())) return false;
      }
      return true;
    });

    const cards = filtered.map((entry) => {
      const isPending = pendingImport && pendingImport.id === entry.id;
      const sourceLabel = entry.source === 'seed'
        ? escapeHtml(entry.templateName || 'Built-in')
        : (entry.visibility === 'private' ? 'Your library' : 'Library');
      return (
        '<li class="opencanvas-section-card' + (isPending ? ' is-pending' : '') + '">' +
          '<div class="opencanvas-section-card-head">' +
            '<span class="opencanvas-section-card-name">' + escapeHtml(entry.name) + '</span>' +
            '<span class="opencanvas-section-card-recipe">' + escapeHtml(entry.recipeId) + '</span>' +
          '</div>' +
          '<p class="opencanvas-section-card-preview">' + escapeHtml(entry.headingPreview) + '</p>' +
          '<div class="opencanvas-section-card-foot">' +
            '<span class="opencanvas-section-card-template">' + sourceLabel + '</span>' +
            '<button type="button" class="opencanvas-section-card-use" data-section-card-use ' +
              'data-entry-id="' + escapeAttr(entry.id) + '" ' +
              'data-entry-source="' + escapeAttr(entry.source) + '" ' +
              'data-entry-name="' + escapeAttr(entry.name) + '"' +
              (entry.templateId ? ' data-template-id="' + escapeAttr(entry.templateId) + '"' : '') +
              (entry.librarySectionId ? ' data-library-section-id="' + escapeAttr(entry.librarySectionId) + '"' : '') +
              (entry.sectionId ? ' data-section-id="' + escapeAttr(entry.sectionId) + '"' : '') + '>' +
              (isPending ? 'Cancel' : 'Use') +
            '</button>' +
          '</div>' +
        '</li>'
      );
    }).join('');

    gridContainer.innerHTML = filtered.length === 0
      ? '<p class="opencanvas-section-picker-empty">No sections match.</p>'
      : '<ul class="opencanvas-section-picker-grid">' + cards + '</ul>';

    gridContainer.querySelectorAll('[data-section-card-use]').forEach((button) => {
      button.addEventListener('click', () => {
        const entryId = button.getAttribute('data-entry-id') || '';
        const entrySource = button.getAttribute('data-entry-source') || '';
        const entryName = button.getAttribute('data-entry-name') || '';
        const templateId = button.getAttribute('data-template-id') || '';
        const sectionId = button.getAttribute('data-section-id') || '';
        const librarySectionId = button.getAttribute('data-library-section-id') || '';
        if (pendingImport && pendingImport.id === entryId) {
          exitPlacementMode();
        } else {
          enterPlacementMode({
            id: entryId,
            source: entrySource,
            name: entryName,
            templateId: templateId,
            sectionId: sectionId,
            librarySectionId: librarySectionId,
          });
        }
      });
    });
  }

  function enterPlacementMode(target) {
    pendingImport = target;
    // setStatus only recognises "error" / "ok" tones in this codebase;
    // "info" would silently fall through. Use "ok" for the pending banner.
    setStatus('Click a slot to insert "' + target.name + '" section', 'ok');
    renderSectionsPanel();
    renderPlacementSlots();
  }

  function exitPlacementMode() {
    pendingImport = null;
    setStatus('Cancelled', 'ok');
    renderSectionsPanel();
    renderPlacementSlots();
  }

  function renderPlacementSlots() {
    const canvasRoot = document.getElementById('canvas-root');
    if (!canvasRoot) return;

    // Remove any previously-drawn slots so we never double-draw.
    canvasRoot.querySelectorAll('.opencanvas-section-slot').forEach((node) => node.remove());

    if (!pendingImport) {
      document.body.removeAttribute('data-placement-active');
      return;
    }
    document.body.setAttribute('data-placement-active', 'true');

    const page = state && state.pages ? state.pages[0] : null;
    if (!page) return;
    const sections = Array.isArray(page.sections) ? page.sections : [];

    function makeSlot(insertAt) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'opencanvas-section-slot';
      slot.setAttribute('data-slot-index', String(insertAt));
      slot.setAttribute('aria-label', 'Insert section here (position ' + insertAt + ')');
      slot.textContent = '+ Insert here';
      slot.addEventListener('click', () => {
        void importPendingSectionAt(insertAt);
      });
      return slot;
    }

    if (sections.length === 0) {
      canvasRoot.appendChild(makeSlot(0));
      return;
    }

    const sectionNodes = Array.from(
      canvasRoot.querySelectorAll('[data-opencanvas-section]:not([data-section-role])'),
    );
    for (let i = 0; i < sectionNodes.length; i += 1) {
      const node = sectionNodes[i];
      if (node.parentNode) node.parentNode.insertBefore(makeSlot(i), node);
    }
    const lastNode = sectionNodes[sectionNodes.length - 1];
    if (lastNode && lastNode.parentNode) {
      const afterLast = lastNode.nextSibling;
      if (afterLast) {
        lastNode.parentNode.insertBefore(makeSlot(sections.length), afterLast);
      } else {
        lastNode.parentNode.appendChild(makeSlot(sections.length));
      }
    }
  }

  async function importPendingSectionAt(insertAt) {
    if (!pendingImport) return;
    const target = pendingImport;
    try {
      const saved = await flushPendingSave();
      if (!saved) return;
      setStatus('Inserting section…', 'ok');
      const importBody = target.source === 'library'
        ? { source: 'library', librarySectionId: target.librarySectionId, insertAt: insertAt }
        : { templateId: target.templateId, sectionId: target.sectionId, insertAt: insertAt };
      const response = await authFetch(API_BASE + '/sites/' + SITE_ID + '/sections/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(importBody),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (e2) { /* ignore */ }
        setStatus('Insert failed: ' + detail, 'error');
        return;
      }
      const body = await response.json();
      if (!body || typeof body !== 'object' || !body.editableState) {
        setStatus('Insert failed: malformed server response', 'error');
        return;
      }
      state = body.editableState;
      if (state) state = migrateState(state);
      selectedSectionId = null;
      selectedElementId = null;
      pendingImport = null;
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute('data-style-kit', state.styleKit);
      }
      renderAll();
      renderSectionsPanel();
      setStatus('Inserted section from ' + target.name, 'ok');
    } catch (err) {
      setStatus('Insert failed: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  function attachSidebarActions() {
    if (!sidebar) return;
    const sectionButtons = sidebar.querySelectorAll('[data-sidebar-add-section]');
    sectionButtons.forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        const kind = button.getAttribute('data-sidebar-add-section');
        if (kind === "blank") addBlankSectionFromSidebar();
      });
    });

    const componentButtons = sidebar.querySelectorAll('[data-sidebar-add-component]');
    componentButtons.forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        const component = button.getAttribute('data-sidebar-add-component');
        if (component) addComponentFromSidebar(component);
      });
    });

    const styleButtons = sidebar.querySelectorAll('[data-sidebar-style-kit]');
    syncSidebarStyleKitButtons(styleButtons);
    styleButtons.forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.preventDefault();
        const kit = button.getAttribute('data-sidebar-style-kit');
        void applySidebarStyleKit(kit, styleButtons);
      });
    });

    if (inspector) {
      inspector.addEventListener("click", function(ev) {
        var btn = ev.target.closest("[data-section-action]");
        if (!btn) return;
        var action = btn.getAttribute("data-section-action");
        var sid = btn.getAttribute("data-section-id");
        if (action && sid) handleSectionAction(action, sid);
      });
    }
  }

  // -- Real-time co-edit via Yjs ------------------------------------------
  //
  // The co-edit bundle (window.__opencanvasCoEdit) is loaded as a separate
  // <script> tag before this IIFE. It exposes connectCoEdit which opens a
  // WebSocket to /__live, runs the Yjs sync protocol, and provides
  // applyLocalState / onRemoteState / presence APIs.
  //
  // Every local mutation calls coEditSync() which projects the current
  // state into the Y.Doc. Remote updates arrive via onRemoteState and
  // re-render the canvas. The DO's autosave writes the projected state
  // to site.editableState in Postgres — the HTTP PUT save path is kept
  // for the explicit Save button but continuous sync goes through Yjs.
  // --------------------------------------------------------------------

  var coEditConnection = null;
  var coEditSocketOpen = false;

  function coEditSync() {
    if (coEditConnection && state) {
      coEditConnection.applyLocalState(state);
      return coEditSocketOpen;
    }
    return false;
  }

  // -- Co-edit presence: local identity + remote caret rendering --------
  // The connector only ships name/color when we call setPresence — the
  // count pill stayed at 1 until both initialPresence and a caret-
  // following republish loop existed.
  //
  // Name resolution order (first non-empty wins):
  //   1. PRESENCE_DISPLAY_NAME — server-injected customer display name /
  //      email (resolved by the editor route from the customer row tied
  //      to the current Clerk session or invite acceptance).
  //   2. localStorage "opencanvas-presence-name" — operator-overridable label
  //      (no UI ships yet but the slot is reserved for a profile setting).
  //   3. "Editor " + 4-char uuid prefix — final fallback so anonymous
  //      sessions still get a stable handle.
  var PRESENCE_PALETTE = [
    "#ff6600","#0066ff","#22aa55","#cc2266","#aa44dd","#dd9900","#00aaaa","#6677aa"
  ];
  function loadPresenceIdentity() {
    var id = null;
    try { id = window.localStorage.getItem("opencanvas-presence-id"); } catch (_) {}
    if (!id) {
      id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : String(Math.random()).slice(2) + String(Date.now());
      try { window.localStorage.setItem("opencanvas-presence-id", id); } catch (_) {}
    }
    var name = null;
    if (typeof PRESENCE_DISPLAY_NAME === "string" && PRESENCE_DISPLAY_NAME.length > 0) {
      name = PRESENCE_DISPLAY_NAME;
    }
    if (!name) {
      try { name = window.localStorage.getItem("opencanvas-presence-name"); } catch (_) {}
    }
    if (!name) name = "Editor " + String(id).slice(0, 4);
    var sum = 0;
    for (var i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) | 0;
    var color = PRESENCE_PALETTE[Math.abs(sum) % PRESENCE_PALETTE.length];
    return { name: name, color: color };
  }
  var localPresence = loadPresenceIdentity();
  var presenceLayer = null;
  var remoteCursors = new Map();

  function ensurePresenceLayer() {
    if (presenceLayer && presenceLayer.isConnected) return presenceLayer;
    presenceLayer = document.createElement("div");
    presenceLayer.className = "opencanvas-presence-layer";
    document.body.appendChild(presenceLayer);
    return presenceLayer;
  }

  // Resolve a peer's {elementId, offset} to a viewport rect by walking
  // the wrapper's text nodes until the cumulative length covers the
  // offset, then collapsing a Range there. Falls back to the wrapper's
  // bounding box when the element is non-text or the offset is stale
  // (a common case during remote edits the peer hasn't caught up to).
  function findCaretRect(elementId, offset) {
    if (!elementId) return null;
    var wrapper = document.querySelector(
      '[data-opencanvas-element="' + cssEscape(elementId) + '"]'
    );
    if (!wrapper) return null;
    var editable = wrapper.querySelector('[contenteditable]') || wrapper;
    if (typeof offset === "number" && editable && editable.firstChild) {
      try {
        var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null);
        var node = walker.nextNode();
        var consumed = 0;
        while (node) {
          var len = node.nodeValue ? node.nodeValue.length : 0;
          if (consumed + len >= offset) {
            var range = document.createRange();
            range.setStart(node, Math.max(0, Math.min(len, offset - consumed)));
            range.collapse(true);
            var rects = range.getClientRects();
            if (rects && rects[0] && rects[0].height > 0) {
              return { left: rects[0].left, top: rects[0].top, height: rects[0].height };
            }
            break;
          }
          consumed += len;
          node = walker.nextNode();
        }
      } catch (error) {
        console.warn("[co-edit:presence] remote caret rect failed", { error: error, elementId: elementId, offset: offset });
      }
    }
    var bb = wrapper.getBoundingClientRect();
    if (bb.height <= 0) return null;
    return { left: bb.left, top: bb.top, height: Math.min(bb.height, 22) };
  }

  function localPresenceTextOffset(editable, anchorNode, anchorOffset, elementId) {
    if (!editable || !anchorNode) return null;
    var anchorRoot = anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
    if (!anchorRoot || !editable.contains(anchorRoot)) return null;
    try {
      var range = document.createRange();
      var maxOffset = anchorNode.nodeType === 3
        ? (anchorNode.nodeValue ? anchorNode.nodeValue.length : 0)
        : anchorNode.childNodes.length;
      var boundedOffset = Math.max(0, Math.min(maxOffset, anchorOffset | 0));
      range.setStart(editable, 0);
      range.setEnd(anchorNode, boundedOffset);
      return range.toString().length;
    } catch (error) {
      console.warn("[co-edit:presence] local text offset failed", {
        error: error,
        elementId: elementId,
        anchorNodeType: anchorNode.nodeType,
        anchorOffset: anchorOffset,
      });
      return null;
    }
  }

  function repaintRemoteCursors() {
    if (!presenceLayer) return;
    remoteCursors.forEach(function(entry) {
      // Free-floating pointer position wins when present (Figma-style
      // mouse follow). Fall back to the text-caret resolver when the
      // peer is editing text but the mouse isn't over the canvas — the
      // operator still wants to see WHERE in the doc the peer is typing.
      var point = entry.cursor && entry.cursor.point;
      if (point && typeof point.x === "number" && typeof point.y === "number") {
        var screen = worldToScreen(point.x, point.y);
        entry.caret.style.display = "";
        entry.label.style.display = "";
        entry.caret.style.left = screen.x + "px";
        entry.caret.style.top = screen.y + "px";
        entry.caret.style.height = "18px";
        entry.label.style.left = screen.x + "px";
        entry.label.style.top = screen.y + "px";
        return;
      }
      var rect = entry.cursor ? findCaretRect(entry.cursor.elementId, entry.cursor.offset) : null;
      if (!rect) {
        entry.caret.style.display = "none";
        entry.label.style.display = "none";
        return;
      }
      entry.caret.style.display = "";
      entry.label.style.display = "";
      entry.caret.style.left = rect.left + "px";
      entry.caret.style.top = rect.top + "px";
      entry.caret.style.height = rect.height + "px";
      entry.label.style.left = rect.left + "px";
      entry.label.style.top = rect.top + "px";
    });
  }

  window.addEventListener("scroll", repaintRemoteCursors, true);
  window.addEventListener("resize", repaintRemoteCursors);

  // Figma-style mouse-follow: every mousemove over the canvas viewport
  // publishes the pointer's WORLD-space coordinates so remote peers see
  // it tracking like a real cursor. World coords (not screen pixels)
  // because each peer applies its own camera transform — the same
  // pointer must render correctly across different zoom levels.
  // Throttled to one publish per animation frame; the previous setup
  // only ran on selectionchange events, so the cursor only moved when
  // the operator clicked or selected text. The user's complaint
  // verbatim: "stilol cant see the cursor moving around of other
  // session like figma does."
  var lastWorldPoint = null;
  var pointerPublishPending = false;
  function publishPointer() {
    pointerPublishPending = false;
    if (!coEditConnection || !lastWorldPoint) return;
    // Reuse the selection-derived cursor anchor if there is one — text
    // editors still benefit from the offset-aware caret while the
    // pointer trail rides on top. Strictly free-floating (no anchor)
    // is the common case for someone mousing around an inactive area.
    var sel = window.getSelection();
    var anchorCursor = null;
    if (sel && sel.anchorNode) {
      var anchorEl = sel.anchorNode.nodeType === 1
        ? sel.anchorNode
        : sel.anchorNode.parentElement;
      var wrapper = anchorEl ? anchorEl.closest('[data-opencanvas-element]') : null;
      var sectionNode = anchorEl ? anchorEl.closest('[data-opencanvas-section]') : null;
      if (wrapper && sectionNode) {
        var elementId = wrapper.getAttribute('data-opencanvas-element');
        var sectionId = sectionNode.getAttribute('data-opencanvas-section');
        if (elementId && sectionId) {
          var editable = wrapper.querySelector('[contenteditable]') || wrapper;
          var textOffset = localPresenceTextOffset(editable, sel.anchorNode, sel.anchorOffset, elementId);
          anchorCursor = { sectionId: sectionId, elementId: elementId };
          if (typeof textOffset === "number") anchorCursor.offset = textOffset;
        }
      }
    }
    var cursor = { point: { x: lastWorldPoint.x, y: lastWorldPoint.y } };
    if (anchorCursor) {
      cursor.sectionId = anchorCursor.sectionId;
      cursor.elementId = anchorCursor.elementId;
      if (typeof anchorCursor.offset === "number") cursor.offset = anchorCursor.offset;
    }
    coEditConnection.setPresence({
      name: localPresence.name,
      color: localPresence.color,
      cursor: cursor,
      selection: anchorCursor ? { sectionId: anchorCursor.sectionId, elementId: anchorCursor.elementId } : null,
    });
  }
  function schedulePointer() {
    if (pointerPublishPending) return;
    pointerPublishPending = true;
    requestAnimationFrame(publishPointer);
  }
  window.addEventListener("mousemove", function(ev) {
    if (typeof ev.clientX !== "number") return;
    var target = ev.target;
    if (!(target instanceof Element) || !viewport.contains(target)) return;
    lastWorldPoint = screenToWorld(ev.clientX, ev.clientY);
    schedulePointer();
  }, { passive: true });

  // Coalesce selectionchange (fires per keystroke and per mouse-tick
  // during drag-select) to one publish per frame.
  var presencePublishPending = false;
  function schedulePublishLocalPresence() {
    if (presencePublishPending) return;
    presencePublishPending = true;
    requestAnimationFrame(function() {
      presencePublishPending = false;
      if (!coEditConnection) return;
      var sel = window.getSelection();
      var cursor = null;
      if (sel && sel.anchorNode) {
        var anchorEl = sel.anchorNode.nodeType === 1
          ? sel.anchorNode
          : sel.anchorNode.parentElement;
        var wrapper = anchorEl ? anchorEl.closest('[data-opencanvas-element]') : null;
        var sectionNode = anchorEl ? anchorEl.closest('[data-opencanvas-section]') : null;
        if (wrapper && sectionNode) {
          var elementId = wrapper.getAttribute('data-opencanvas-element');
          var sectionId = sectionNode.getAttribute('data-opencanvas-section');
          if (elementId && sectionId) {
            var editable = wrapper.querySelector('[contenteditable]') || wrapper;
            var textOffset = localPresenceTextOffset(editable, sel.anchorNode, sel.anchorOffset, elementId);
            cursor = {
              sectionId: sectionId,
              elementId: elementId,
            };
            if (typeof textOffset === "number") cursor.offset = textOffset;
          }
        }
      }
      coEditConnection.setPresence({
        name: localPresence.name,
        color: localPresence.color,
        cursor: cursor,
        selection: cursor ? { sectionId: cursor.sectionId, elementId: cursor.elementId } : null,
      });
    });
  }
  document.addEventListener("selectionchange", schedulePublishLocalPresence);

  function attachCoEdit() {
    if (typeof window.__opencanvasCoEdit === "undefined" || !window.__opencanvasCoEdit || typeof window.__opencanvasCoEdit.connectCoEdit !== "function") {
      return;
    }

    var scheme = location.protocol === "https:" ? "wss:" : "ws:";
    var wsUrl = scheme + "//" + location.host + "/__live?siteId=" + encodeURIComponent(SITE_ID) + (WS_TOKEN ? "&wsToken=" + encodeURIComponent(WS_TOKEN) : "");

    // Consecutive failed reconnect attempts since the last successful open.
    // The "open" handler resets this so a long-stable connection that later
    // drops restarts retries at the base delay rather than the last cap.
    // When this crosses COEDIT_RECONNECT_MAX_ATTEMPTS, we stop retrying and
    // call destroy() on the connection so the underlying client.ts no longer
    // schedules further reconnects; the user must reload to recover.
    var reconnectAttempt = 0;
    var givenUp = false;

    coEditSocketOpen = false;
    var conn = window.__opencanvasCoEdit.connectCoEdit(SITE_ID, state, {
      websocketUrl: wsUrl,
      // Mirrors src/live/co-edit/client.ts defaults so the curve advertised
      // here matches what the connector actually applies. Passed explicitly
      // (instead of relying on defaults) so the editor host's reconnect
      // behaviour is self-documenting at this call site.
      reconnectDelayMs: COEDIT_RECONNECT_BASE_DELAY_MS,
      reconnectMaxDelayMs: COEDIT_RECONNECT_MAX_DELAY_MS,
      // Without this, the awareness filter on the receive side drops every
      // peer (name/color required) — the "N editing" pill stays at 1 and
      // remote-cursor rendering has nothing to draw.
      initialPresence: {
        name: localPresence.name,
        color: localPresence.color,
        cursor: null,
        selection: null,
      },
      websocketFactory: function(url) {
        var socket = new WebSocket(url);
        socket.addEventListener("open", function() {
          // Successful re-handshake — reset the attempt counter so any future
          // outage starts retries fresh instead of continuing the escalation.
          reconnectAttempt = 0;
          coEditSocketOpen = true;
          coEditSync();
          setStatus("Synced", "ok");
        });
        socket.addEventListener("close", function() {
          coEditSocketOpen = false;
          if (givenUp) return;
          reconnectAttempt += 1;
          if (reconnectAttempt > COEDIT_RECONNECT_MAX_ATTEMPTS) {
            givenUp = true;
            // Stop the underlying client.ts reconnect loop so it doesn't keep
            // scheduling timers behind a UI that has already given up.
            if (coEditConnection) {
              try { coEditConnection.destroy(); } catch (_) { /* noop */ }
            }
            console.error("[co-edit] reconnect gave up after " + COEDIT_RECONNECT_MAX_ATTEMPTS + " attempts; user must reload");
            setStatus("Co-edit lost — refresh the page to reconnect", "error");
            return;
          }
          setStatus("Co-edit disconnected; reconnecting (" + reconnectAttempt + "/" + COEDIT_RECONNECT_MAX_ATTEMPTS + ")", "error");
        });
        socket.addEventListener("error", function() {
          coEditSocketOpen = false;
          // Let the close handler drive the reconnect counter — error+close
          // both fire on some browsers and we want one increment per failure.
        });
        return socket;
      },
    });

    conn.onRemoteState(function(newState) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      state = newState;
      if (selectedElementId && !findElement(selectedElementId)) {
        selectedElementId = null;
        editingElementId = null;
        editingSnapshot = null;
      }
      if (selectedSectionId && !findSection(selectedSectionId)) {
        selectedSectionId = null;
      }
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      renderAll();
      // renderAll replaces element wrappers, invalidating cached caret
      // rects. Re-resolve them against the fresh DOM so remote cursors
      // don't lag a frame behind the new positions.
      repaintRemoteCursors();
    });

    conn.onRemotePresence(function(peers) {
      var pill = document.querySelector("[data-opencanvas-presence]");
      var counter = document.querySelector("[data-opencanvas-presence-count]");
      if (pill && counter) {
        // Always reveal the pill once the WS is attached and we know the
        // count — solo edit reads "1 editing", co-edit reads "N editing".
        // The hidden default in route.tsx covers the pre-connection moment
        // only.
        counter.textContent = String(peers.size + 1);
        pill.hidden = false;
      }
      // Diff the rendered cursor set against the active peers: add DOM
      // for new arrivals, refresh color/name/cursor for known peers,
      // drop nodes for departed clients.
      ensurePresenceLayer();
      var seen = new Set();
      peers.forEach(function(peer, clientId) {
        seen.add(clientId);
        var entry = remoteCursors.get(clientId);
        if (!entry) {
          var caret = document.createElement("div");
          caret.className = "opencanvas-remote-caret";
          var label = document.createElement("div");
          label.className = "opencanvas-remote-caret-label";
          presenceLayer.appendChild(caret);
          presenceLayer.appendChild(label);
          entry = { caret: caret, label: label, cursor: null };
          remoteCursors.set(clientId, entry);
        }
        entry.caret.style.background = peer.color;
        entry.label.style.background = peer.color;
        entry.label.textContent = peer.name;
        entry.cursor = peer.cursor || null;
      });
      remoteCursors.forEach(function(entry, clientId) {
        if (!seen.has(clientId)) {
          entry.caret.remove();
          entry.label.remove();
          remoteCursors.delete(clientId);
        }
      });
      repaintRemoteCursors();
    });

    coEditConnection = conn;

    window.addEventListener("beforeunload", function() {
      // Mark as given-up so any in-flight close event on the way out doesn't
      // try to setStatus or schedule another retry while the page is tearing
      // down. destroy() cancels the connector's pending reconnect timer too.
      givenUp = true;
      coEditSocketOpen = false;
      conn.destroy();
    });
  }

  // -- Publish ------------------------------------------------------------

  // -- Header version badge + social-preview pill ------------------------
  // Persistent surface that mirrors site.publishedVersion so the Owner can
  // tell at a glance which version is live without waiting for the 4-second
  // "Saved" / "Published" status flash. Clicking opens a popover that shows
  // what social embeds will see (og:title / description / image) — the same
  // signals src/seo/meta-emit.ts ships on the published HTML.

  var versionPill = null;

  function updateVersionBadge(version) {
    if (!versionBadge) return;
    var n = typeof version === "number" && Number.isFinite(version) ? version : 0;
    versionBadge.setAttribute("data-version", String(n));
    versionBadge.textContent = n > 0 ? "v" + n : "Draft";
  }

  function closeVersionPill() {
    if (!versionPill) return;
    if (versionPill.parentNode) versionPill.parentNode.removeChild(versionPill);
    versionPill = null;
    if (versionBadge) versionBadge.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onVersionPillOutside, true);
    document.removeEventListener("keydown", onVersionPillKey, true);
  }

  function onVersionPillOutside(ev) {
    var target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    if (versionPill && versionPill.contains(target)) return;
    if (target.closest("#canvas-version")) return;
    closeVersionPill();
  }

  function onVersionPillKey(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeVersionPill();
    }
  }

  function openVersionPill() {
    if (versionPill) { closeVersionPill(); return; }
    if (!versionBadge) return;
    var version = parseInt(versionBadge.getAttribute("data-version") || "0", 10);
    if (!Number.isFinite(version)) version = 0;
    var page = state && Array.isArray(state.pages) && state.pages.length > 0 ? state.pages[0] : null;
    var addressEl = document.querySelector(".opencanvas-editor-header .address");
    var addressText = addressEl && addressEl.textContent ? addressEl.textContent.trim() : "";

    var pill = document.createElement("div");
    pill.className = "opencanvas-version-pill";
    pill.setAttribute("role", "dialog");
    pill.setAttribute("aria-label", "Social preview");

    var head = document.createElement("div");
    head.className = "opencanvas-version-pill-head";
    var title = document.createElement("span");
    title.className = "opencanvas-version-pill-title";
    title.textContent = "Social preview";
    var chip = document.createElement("span");
    chip.className = version > 0 ? "opencanvas-version-pill-chip live" : "opencanvas-version-pill-chip draft";
    chip.textContent = version > 0 ? "v" + version + " live" : "Draft";
    head.appendChild(title);
    head.appendChild(chip);
    pill.appendChild(head);

    if (page && page.ogImageAssetId) {
      var img = document.createElement("img");
      img.className = "opencanvas-version-pill-image";
      img.alt = "";
      img.src = SITE_BASE + "/assets/" + encodeURIComponent(page.ogImageAssetId);
      pill.appendChild(img);
    }

    var card = document.createElement("div");
    card.className = "opencanvas-version-pill-card";
    var cardTitle = document.createElement("div");
    cardTitle.className = "opencanvas-version-pill-card-title";
    cardTitle.textContent = (page && page.title) ? page.title : "Untitled site";
    var cardDesc = document.createElement("div");
    cardDesc.className = "opencanvas-version-pill-card-desc";
    cardDesc.textContent = (page && page.description) ? page.description : "No meta description set.";
    var cardUrl = document.createElement("div");
    cardUrl.className = "opencanvas-version-pill-card-url";
    cardUrl.textContent = addressText || "Not published yet";
    card.appendChild(cardTitle);
    card.appendChild(cardDesc);
    card.appendChild(cardUrl);
    pill.appendChild(card);

    if (version > 0 && addressText) {
      var actions = document.createElement("div");
      actions.className = "opencanvas-version-pill-actions";
      var view = document.createElement("a");
      view.className = "opencanvas-version-pill-view";
      view.href = "https://" + addressText;
      view.target = "_blank";
      view.rel = "noopener";
      view.textContent = "View live site";
      actions.appendChild(view);
      pill.appendChild(actions);
    }

    document.body.appendChild(pill);
    var rect = versionBadge.getBoundingClientRect();
    pill.style.position = "fixed";
    pill.style.top = (rect.bottom + 6) + "px";
    var right = window.innerWidth - rect.right;
    pill.style.right = Math.max(8, right) + "px";
    versionPill = pill;
    versionBadge.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onVersionPillOutside, true);
    document.addEventListener("keydown", onVersionPillKey, true);
  }

  function attachVersionBadge() {
    if (!versionBadge) return;
    versionBadge.addEventListener("click", function () {
      openVersionPill();
    });
  }

  async function publishSite() {
    if (!publishButton) return;
    publishButton.disabled = true;
    try {
      const saved = await flushPendingSave();
      if (!saved) return;
      setStatus("Publishing...");
      const response = await authFetch(API_BASE + "/publish/sites/" + SITE_ID, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (accessRevoked || sessionExpired) return;
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        let detail = response.statusText;
        if (body && Array.isArray(body.errors) && body.errors.length > 0) {
          detail = body.errors[0];
        } else if (body && Array.isArray(body.missingAssetIds) && body.missingAssetIds.length > 0) {
          detail = "missing assets: " + body.missingAssetIds.join(", ");
        } else if (body && body.error) {
          detail = body.error;
        }
        setStatus("Publish failed", "error");
        // Modal surface — same reasoning as the AI-preview path: the
        // status-line flash is too quiet for a failure the Owner needs to act
        // on (fix the issue, then re-publish).
        try {
          await openAlertModal({ title: "Publish failed", message: detail });
        } catch (_) { /* another modal was open; status line still has it */ }
        return;
      }
      const versionSuffix =
        body && typeof body.version === "number" && Number.isFinite(body.version)
          ? " v" + body.version
          : "";
      setStatus("Published" + versionSuffix, "ok");
      if (body && typeof body.version === "number") {
        updateVersionBadge(body.version);
      }

      // Refresh Versions sidebar panel so the new snapshot is visible without
      // a page reload. Invalidate the cache flag always; repaint only if the
      // panel is currently visible (otherwise the next tab-click triggers a
      // fresh fetch via activateSidebarTab).
      versionsLoaded = false;
      var versionsPanel = sidebar ? sidebar.querySelector('[data-sidebar-panel="versions"]') : null;
      if (versionsPanel && !versionsPanel.hidden) {
        renderVersionsPanel();
      }

      // Publish-success modal — gives the Owner an explicit "View live site"
      // exit (opens published URL in new tab + leaves editor) and an
      // unambiguous "Continue editing" path that just dismisses. Replaces the
      // 4-second status-line flash that was easy to miss.
      var addrEl = document.querySelector(".opencanvas-editor-header .address");
      var publishedHost = addrEl && addrEl.textContent ? addrEl.textContent.trim() : "";
      var modalTitle = "Published" + versionSuffix;
      var modalMessage = publishedHost
        ? publishedHost + " is live.\\nVisitors with the page open see your changes without refreshing."
        : "Your site is live. Visitors with the page open see your changes without refreshing.";
      try {
        var openLive = await openConfirmModal({
          title: modalTitle,
          message: modalMessage,
          confirmLabel: "View live site",
          cancelLabel: "Continue editing",
        });
        if (openLive && publishedHost) {
          window.open("https://" + publishedHost, "_blank");
          window.location.href = "/dashboard";
        }
      } catch (_) {
        // Another modal was already open; the status line still announced
        // success so the Owner is not left without feedback.
      }
    } catch (err) {
      if (!accessRevoked && !sessionExpired) {
        setStatus("Publish failed: " + (err && err.message ? err.message : String(err)), "error");
      }
    } finally {
      if (!accessRevoked && !sessionExpired) publishButton.disabled = false;
    }
  }

  function attachPublishButton() {
    if (!publishButton) return;
    publishButton.addEventListener("click", () => {
      void publishSite();
    });
  }

  // -- Save & keyboard ----------------------------------------------------

  function attachSaveButton() {
    if (saveButton) {
      saveButton.addEventListener("click", () => {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        void saveStateNow();
      });
    }
    if (saveTemplateButton) {
      saveTemplateButton.addEventListener("click", () => {
        void saveSiteAsTemplate();
      });
    }
    window.addEventListener("keydown", (ev) => {
      // Placement-mode Escape takes priority — it cancels the pending import
      // before any other Escape behaviour (e.g. inline-editing exits, which
      // are scoped to their own targets and won't fire here anyway).
      if (ev.key === "Escape" && pendingImport) {
        ev.preventDefault();
        exitPlacementMode();
        return;
      }
      var mod = ev.ctrlKey || ev.metaKey;
      if (mod && (ev.key === "z" || ev.key === "Z") && !ev.shiftKey) {
        ev.preventDefault();
        undo();
        return;
      }
      if (mod && ((ev.key === "y" || ev.key === "Y") || ((ev.key === "z" || ev.key === "Z") && ev.shiftKey))) {
        ev.preventDefault();
        redo();
        return;
      }
      var isSave = mod && (ev.key === "s" || ev.key === "S");
      if (isSave) {
        ev.preventDefault();
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        void saveStateNow();
        return;
      }
      if (
        ev.key === " " &&
        !ev.repeat &&
        !editingElementId &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        !isEditableShortcutTarget(ev.target)
      ) {
        ev.preventDefault();
        temporaryPanPreviousMode = interactionMode;
        spaceHeldForPan = true;
        setInteractionMode("pan");
        return;
      }
      if (
        (ev.key === "v" || ev.key === "V") &&
        !editingElementId &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        !isEditableShortcutTarget(ev.target)
      ) {
        clearTemporaryPanState();
        setInteractionMode("select");
        return;
      }
      if (
        (ev.key === "Delete" || ev.key === "Backspace") &&
        !editingElementId &&
        !isEditableShortcutTarget(ev.target)
      ) {
        if (selectedElementId) {
          ev.preventDefault();
          var found = findElement(selectedElementId);
          if (found) deleteElement(found.section, found.element);
          return;
        }
        if (selectedSectionId) {
          ev.preventDefault();
          handleSectionAction("delete-section", selectedSectionId);
          return;
        }
      }
      if (ev.key === "1" && !isEditableShortcutTarget(ev.target)) {
        ev.preventDefault();
        fitToPage(activePageId);
      }
      if (ev.key === "0" && !isEditableShortcutTarget(ev.target)) {
        ev.preventDefault();
        fitAllPages();
      }
    });
    window.addEventListener("keyup", (ev) => {
      if (ev.key === " ") { ev.preventDefault(); endTemporaryPan(); }
    });
    window.addEventListener("blur", endTemporaryPan);
  }

  function activateSidebarTab(tabName) {
    const tabButtons = sidebar ? sidebar.querySelectorAll('[data-sidebar-tab]') : [];
    const panels = sidebar ? sidebar.querySelectorAll('[data-sidebar-panel]') : [];
    tabButtons.forEach((button) => {
      const isActive = button.getAttribute("data-sidebar-tab") === tabName;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    panels.forEach((p) => {
      p.hidden = p.getAttribute("data-sidebar-panel") !== tabName;
    });
    if (tabName === "sections") {
      ensureSectionsPanelLoaded();
    }
    if (tabName === "versions") {
      renderVersionsPanel();
    }
    if (tabName === "pages") {
      updatePageSidebar();
    }
  }

  // -- Version History sidebar tab -----------------------------------------

  var versionsLoaded = false;
  var versionsList = [];

  function ensureVersionsTabMounted() {
    if (!sidebar) return null;
    var tabsRow = sidebar.querySelector(".opencanvas-sidebar-tabs");
    if (!tabsRow) return null;
    if (sidebar.querySelector('[data-sidebar-tab="versions"]')) {
      return sidebar.querySelector('[data-sidebar-panel="versions"]');
    }

    var tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", "false");
    tabButton.setAttribute("data-sidebar-tab", "versions");
    tabButton.textContent = "Versions";
    tabsRow.appendChild(tabButton);

    var panel = document.createElement("div");
    panel.className = "opencanvas-sidebar-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", "Versions");
    panel.setAttribute("data-sidebar-panel", "versions");
    panel.hidden = true;
    sidebar.appendChild(panel);

    tabButton.addEventListener("click", function() {
      activateSidebarTab("versions");
    });

    return panel;
  }

  function formatVersionDate(iso) {
    var d = new Date(iso);
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, "0");
    var ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return months[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + m + ampm;
  }

  function renderVersionsPanel() {
    var panel = ensureVersionsTabMounted();
    if (!panel) return;
    panel.replaceChildren();

    var group = document.createElement("section");
    group.className = "opencanvas-sidebar-group";

    var heading = document.createElement("h2");
    heading.textContent = "Version History";
    group.appendChild(heading);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "opencanvas-sidebar-command";
    saveBtn.textContent = "Save snapshot";
    saveBtn.style.marginBottom = "12px";
    saveBtn.addEventListener("click", async function() {
      var label = await openTextModal({ title: "Save snapshot", label: "Snapshot label", defaultValue: "" });
      if (!label || !label.trim()) return;
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      authFetch(API_BASE + "/sites/" + SITE_ID + "/snapshots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || "Failed"); });
        setStatus("Snapshot saved", "ok");
        versionsLoaded = false;
        renderVersionsPanel();
      })
      .catch(function(err) {
        setStatus("Snapshot failed: " + (err.message || err), "error");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save snapshot";
      });
    });
    group.appendChild(saveBtn);

    if (!versionsLoaded) {
      var loading = document.createElement("p");
      loading.style.opacity = "0.5";
      loading.style.fontSize = "12px";
      loading.textContent = "Loading versions...";
      group.appendChild(loading);
      panel.appendChild(group);

      authFetch(API_BASE + "/sites/" + SITE_ID + "/snapshots?limit=30")
        .then(function(r) { return r.json(); })
        .then(function(data) {
          versionsList = data.items || [];
          versionsLoaded = true;
          renderVersionsPanel();
        })
        .catch(function() {
          loading.textContent = "Failed to load versions.";
        });
      return;
    }

    if (versionsList.length === 0) {
      var empty = document.createElement("p");
      empty.style.opacity = "0.7";
      empty.style.fontSize = "12px";
      empty.textContent = "No snapshots yet. Publish or save a snapshot.";
      group.appendChild(empty);
      panel.appendChild(group);
      return;
    }

    var list = document.createElement("ul");
    list.style.listStyle = "none";
    list.style.margin = "0";
    list.style.padding = "0";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";

    for (var i = 0; i < versionsList.length; i++) {
      (function(snap) {
        var li = document.createElement("li");
        li.style.padding = "8px 10px";
        li.style.borderRadius = "6px";
        li.style.background = "rgba(255,255,255,0.04)";
        li.style.border = "1px solid rgba(255,255,255,0.08)";
        li.style.fontSize = "12px";

        var top = document.createElement("div");
        top.style.display = "flex";
        top.style.justifyContent = "space-between";
        top.style.alignItems = "center";
        top.style.marginBottom = "4px";

        var dateEl = document.createElement("span");
        dateEl.style.color = "#f6f7fb";
        dateEl.style.fontWeight = "500";
        dateEl.textContent = formatVersionDate(snap.capturedAt);
        top.appendChild(dateEl);

        var badge = document.createElement("span");
        badge.style.fontSize = "10px";
        badge.style.padding = "2px 6px";
        badge.style.borderRadius = "4px";
        badge.style.fontWeight = "500";
        if (snap.reason === "publish") {
          badge.style.background = "rgba(74,222,128,0.12)";
          badge.style.color = "#4ade80";
          badge.textContent = "v" + (snap.publishedVersion || "?");
        } else {
          badge.style.background = "rgba(125,211,252,0.12)";
          badge.style.color = "#7dd3fc";
          badge.textContent = "manual";
        }
        top.appendChild(badge);
        li.appendChild(top);

        if (snap.label) {
          var labelEl = document.createElement("div");
          labelEl.style.color = "#aeb7c8";
          labelEl.style.fontSize = "11px";
          labelEl.style.marginBottom = "6px";
          labelEl.textContent = snap.label;
          li.appendChild(labelEl);
        }

        var actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "6px";

        var restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.textContent = "Restore";
        restoreBtn.style.fontSize = "11px";
        restoreBtn.style.padding = "3px 10px";
        restoreBtn.style.borderRadius = "4px";
        restoreBtn.style.border = "1px solid rgba(255,255,255,0.12)";
        restoreBtn.style.background = "rgba(255,255,255,0.06)";
        restoreBtn.style.color = "#f6f7fb";
        restoreBtn.style.cursor = "pointer";
        restoreBtn.style.fontFamily = "inherit";
        restoreBtn.addEventListener("click", async function() {
          if (!await openConfirmModal({ title: "Restore version", message: "Restore to this version? Current state will be saved as a snapshot first." })) return;
          restoreBtn.disabled = true;
          restoreBtn.textContent = "Restoring...";
          authFetch(API_BASE + "/sites/" + SITE_ID + "/snapshots/" + snap.id + "/restore", {
            method: "POST",
          })
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || "Restore failed"); });
            return r.json();
          })
          .then(function() {
            setStatus("Restored — reloading editor...", "ok");
            setTimeout(function() { location.reload(); }, 800);
          })
          .catch(function(err) {
            setStatus("Restore failed: " + (err.message || err), "error");
            restoreBtn.disabled = false;
            restoreBtn.textContent = "Restore";
          });
        });
        actions.appendChild(restoreBtn);

        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.style.fontSize = "11px";
        deleteBtn.style.padding = "3px 10px";
        deleteBtn.style.borderRadius = "4px";
        deleteBtn.style.border = "1px solid rgba(255,255,255,0.12)";
        deleteBtn.style.background = "rgba(255,255,255,0.06)";
        deleteBtn.style.color = "#f6f7fb";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.style.fontFamily = "inherit";
        deleteBtn.addEventListener("mouseenter", function() {
          deleteBtn.style.background = "rgba(248,113,113,0.16)";
          deleteBtn.style.borderColor = "rgba(248,113,113,0.45)";
          deleteBtn.style.color = "#fca5a5";
        });
        deleteBtn.addEventListener("mouseleave", function() {
          deleteBtn.style.background = "rgba(255,255,255,0.06)";
          deleteBtn.style.borderColor = "rgba(255,255,255,0.12)";
          deleteBtn.style.color = "#f6f7fb";
        });
        deleteBtn.addEventListener("click", async function() {
          if (!await openConfirmModal({ title: "Delete snapshot", message: "This permanently removes the snapshot. The current state is not affected." })) return;
          deleteBtn.disabled = true;
          deleteBtn.textContent = "Deleting...";
          authFetch(API_BASE + "/sites/" + SITE_ID + "/snapshots/" + snap.id, {
            method: "DELETE",
          })
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || "Delete failed"); });
            return r.json();
          })
          .then(function() {
            setStatus("Snapshot deleted", "ok");
            versionsLoaded = false;
            renderVersionsPanel();
          })
          .catch(function(err) {
            setStatus("Delete failed: " + (err.message || err), "error");
            deleteBtn.disabled = false;
            deleteBtn.textContent = "Delete";
          });
        });
        actions.appendChild(deleteBtn);

        li.appendChild(actions);

        list.appendChild(li);
      })(versionsList[i]);
    }

    group.appendChild(list);
    panel.appendChild(group);
  }

  // -- Boot ---------------------------------------------------------------

  (async () => {
    try {
      const response = await authFetch(SITE_BASE);
      if (!response.ok) {
        setStatus("Failed to load site (" + response.status + ")", "error");
        return;
      }
      const body = await response.json();
      // Minimal shape guard against server-response drift. The full schema
      // lives server-side in src/canvas/schema.ts; here we only assert the
      // bare bones the editor needs to boot. Anything else (missing fields,
      // bad element types) surfaces loudly later via render / migrate paths
      // instead of silently coercing the editor into a broken state.
      if (!body || typeof body !== "object" || !body.editableState || typeof body.editableState !== "object" || !Array.isArray(body.editableState.pages)) {
        throw new Error("GET site returned an unexpected body shape (missing editableState.pages array)");
      }
      state = body.editableState;
      if (state) state = migrateState(state);
      if (state && state.pages && state.pages.length > 0) {
        activePageId = state.pages[0].id;
      }
      updateVersionBadge(body.publishedVersion);
      attachVersionBadge();
      initUndo();
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      // Mount the viewport BEFORE the first render so #canvas-root is in its
      // final DOM position when sections render in. The transform set by
      // applyCameraTransform() then persists across subsequent renderAll()
      // calls (which only mutate root's children).
      mountViewport();
      renderAll();
      attachRootEvents();
      attachPointerHandlers();
      mountReel();
      attachGripHandlers();
      document.addEventListener("click", function(ev) {
        if (openMenuElementId && ev.target instanceof Element && !ev.target.closest("[data-element-menu]") && !ev.target.closest("[data-element-menu-trigger]")) {
          closeElementMenu();
        }
      });
      attachSidebarTabs();
      attachPageCrumb();
      var sidebarToggle = document.getElementById("sidebar-toggle");
      if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener("click", function() {
          var collapsed = sidebar.classList.toggle("collapsed");
          sidebarToggle.textContent = collapsed ? "›" : "‹";
          if (viewport) viewport.classList.toggle("sidebar-collapsed", collapsed);
        });
      }
      var inspectorToggle = document.getElementById("inspector-toggle");
      if (inspectorToggle && inspector) {
        // Sync the arrow with the initial state — inspector boots hidden,
        // so the user-facing affordance is "expand" (›). Click flips both
        // the collapsed class AND forces a page-inspector render the first
        // time so an empty inspector has something to show.
        function syncInspectorToggleIcon() {
          var collapsed = inspector.classList.contains("collapsed");
          var hiddenAttr = inspector.hidden;
          inspectorToggle.textContent = (collapsed || hiddenAttr) ? "‹" : "›";
        }
        syncInspectorToggleIcon();
        inspectorToggle.addEventListener("click", function() {
          var willOpen = inspector.hidden || inspector.classList.contains("collapsed");
          if (willOpen) {
            inspector.classList.remove("collapsed");
            // If nothing is selected, surface the page inspector so the
            // expanded panel has content. selectElement(null) already
            // routes through renderInspector → renderPageInspector when
            // both selectedElementId and selectedSectionId are null.
            if (!selectedElementId && !selectedSectionId) {
              renderInspector();
            } else if (inspector.hidden) {
              renderInspector();
            }
          } else {
            inspector.classList.add("collapsed");
          }
          syncInspectorToggleIcon();
        });
      }
      // Inject tabs dynamically so the static canvas shell can stay focused
      // on layout. The tab + panel mount immediately; contents render lazily
      // on first activation.
      ensureVersionsTabMounted();
      attachSidebarActions();
      updatePageSidebar();

      // -- Page CRUD event wiring -------------------------------------------
      var addPageBtn = document.getElementById("canvas-add-page");
      if (addPageBtn) {
        addPageBtn.addEventListener("click", createPage);
      }

      var pageListEl = document.getElementById("canvas-page-list");
      if (pageListEl) {
        pageListEl.addEventListener("click", function(ev) {
          var actionBtn = ev.target instanceof Element ? ev.target.closest("[data-page-action]") : null;
          if (actionBtn) {
            var action = actionBtn.getAttribute("data-page-action");
            var pid = actionBtn.getAttribute("data-page-id");
            if (action === "rename") renamePage(pid);
            else if (action === "delete") deletePage(pid);
            return;
          }
          var pageItem = ev.target instanceof Element ? ev.target.closest(".opencanvas-page-item") : null;
          if (pageItem) {
            var pid2 = pageItem.getAttribute("data-page-id");
            if (pid2 && pid2 !== activePageId) {
              setActivePage(pid2);
              fitToPage(pid2);
            }
          }
        });
      }

      attachSaveButton();
      attachPublishButton();
      attachCoEdit();
      setStatus("Ready", "ok");

      // Session keepalive — prevents auth expiry during long editing sessions.
      // Dashboard editors (Clerk sessions) get a periodic heartbeat that keeps
      // the Clerk cookie alive. Published-site editors (edit tokens) get a
      // proactive token refresh ~15 min before expiry.
      if (API_BASE === "/api") {
        setInterval(function() {
          fetch(SITE_BASE, { method: "HEAD" }).catch(function() {});
        }, 5 * 60 * 1000);
      } else if (API_BASE === "/__api") {
        var REFRESH_BUFFER = 900; // seconds before expiry to refresh
        function scheduleTokenRefresh(ttl) {
          var delay = Math.max((ttl - REFRESH_BUFFER) * 1000, 60000);
          setTimeout(function() {
            fetch(API_BASE + "/edit-token/refresh", { method: "POST" })
              .then(function(r) { return r.json(); })
              .then(function(d) {
                if (d && d.ok && d.ttl) scheduleTokenRefresh(d.ttl);
              })
              .catch(function() {
                // Refresh failed — do nothing. The existing 401 detection in
                // authFetch will handle it on the next real API call.
              });
          }, delay);
        }
        // Kick off the first refresh cycle. Call the endpoint immediately to
        // learn the current TTL (and get a fresh token), then schedule based
        // on the response.
        fetch(API_BASE + "/edit-token/refresh", { method: "POST" })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d && d.ok && d.ttl) scheduleTokenRefresh(d.ttl);
          })
          .catch(function() {});
      }

      // -- Chat panel form submission -----------------------------------------
      var chatForm = document.getElementById("canvas-chat-form");
      var chatInput = document.getElementById("canvas-chat-input");
      var chatMessages = document.getElementById("canvas-chat-messages");
      var chatWelcome = document.getElementById("canvas-chat-welcome");
      var chatSessionId = null;
      var chatBusy = false;

      function appendChatMessage(role, text) {
        if (!chatMessages) return;
        var div = document.createElement("div");
        div.className = "opencanvas-chat-msg " + role;
        div.textContent = text;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }

      function hideChatWelcome() {
        if (chatWelcome && !chatWelcome.hidden) chatWelcome.hidden = true;
      }

      // Suggestion chips: clicking pre-fills the input AND submits, so the
      // chat does the work without the Owner having to retype. We rely on
      // requestSubmit() so the existing submit listener fires its full flow
      // (busy state, payload assembly, SSE stream) rather than re-implementing.
      var chatChips = document.querySelectorAll(".opencanvas-chat-chip");
      for (var ci = 0; ci < chatChips.length; ci++) {
        (function(chip) {
          chip.addEventListener("click", function() {
            if (chatBusy || !chatInput || !chatForm) return;
            var prompt = chip.getAttribute("data-chip-prompt") || chip.textContent || "";
            if (!prompt) return;
            chatInput.value = prompt;
            if (typeof chatForm.requestSubmit === "function") {
              chatForm.requestSubmit();
            } else {
              chatForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }
          });
        })(chatChips[ci]);
      }

      if (chatForm) {
        chatForm.addEventListener("submit", function(ev) {
          ev.preventDefault();
          if (chatBusy || !chatInput) return;
          var msg = chatInput.value.trim();
          if (msg.length === 0) return;
          chatInput.value = "";
          hideChatWelcome();
          appendChatMessage("user", msg);
          chatBusy = true;
          var submitBtn = chatForm.querySelector("button[type=submit]");
          if (submitBtn) submitBtn.disabled = true;

          var payload = { message: msg };
          if (chatSessionId) payload.sessionId = chatSessionId;
          if (selectedElementId && !chatSelectionDropped) {
            payload.selectedElementId = selectedElementId;
          }
          // The X drops selection for one send only; re-arm so the next
          // message picks up the current canvas selection again.
          chatSelectionDropped = false;
          updateChatSelectionChip();

          authFetch(API_BASE + "/sites/" + SITE_ID + "/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }).then(function(response) {
            if (!response.ok) {
              appendChatMessage("error", "Chat request failed: " + response.status);
              chatBusy = false;
              if (submitBtn) submitBtn.disabled = false;
              return;
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = "";
            var assistantText = "";
            var msgDiv = document.createElement("div");
            msgDiv.className = "opencanvas-chat-msg assistant";
            chatMessages.appendChild(msgDiv);

            function readChunk() {
              reader.read().then(function(result) {
                if (result.done) {
                  chatBusy = false;
                  if (submitBtn) submitBtn.disabled = false;
                  return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split(String.fromCharCode(10));
                buffer = lines.pop() || "";
                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i];
                  if (line.indexOf("data: ") === 0) {
                    var dataStr = line.slice(6);
                    try {
                      var data = JSON.parse(dataStr);
                      var kind = data.kind || data.event || "";
                      if (kind === "session") {
                        chatSessionId = data.sessionId || chatSessionId;
                      } else if (kind === "token") {
                        assistantText += data.text || data.token || "";
                        msgDiv.textContent = assistantText;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                      } else if (kind === "tool-call") {
                        appendChatMessage("assistant", "[Calling " + (data.name || "tool") + "]");
                      } else if (kind === "op-preview") {
                        // IIFE-scope the op + toolName snapshots so the Accept
                        // handler captures THIS event's op, not whatever the
                        // function-scoped data happens to hold at click time.
                        // Without this, accepting any preview after another
                        // SSE event arrived sent the wrong (or empty) op body
                        // and the apply layer returned 400.
                        (function(opSnapshot, toolNameSnapshot) {
                          var opDiv = document.createElement("div");
                          opDiv.className = "opencanvas-chat-msg assistant";
                          opDiv.textContent = "Proposed: " + (toolNameSnapshot || "edit") + " ";
                          var acceptBtn = document.createElement("button");
                          acceptBtn.textContent = "Accept";
                          acceptBtn.style.cssText = "margin-left:8px;padding:4px 10px;border:1px solid var(--opencanvas-accent);background:var(--opencanvas-accent);color:var(--opencanvas-bg);border-radius:4px;cursor:pointer;font-size:12px;";
                          acceptBtn.addEventListener("click", function() {
                            acceptBtn.disabled = true;
                            acceptBtn.textContent = "Applying...";
                            authFetch(API_BASE + "/canvas-agent/sites/" + SITE_ID + "/apply", {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ ops: [opSnapshot] }),
                            }).then(function(r) { return r.json(); }).then(function(body) {
                              if (body && body.editableState) {
                                state = body.editableState;
                                renderAll();
                                scheduleSave();
                                setStatus("Agent changes applied", "ok");
                                acceptBtn.textContent = "Applied";
                              } else {
                                acceptBtn.textContent = "Failed";
                              }
                            }).catch(function() { acceptBtn.textContent = "Failed"; });
                          });
                          opDiv.appendChild(acceptBtn);
                          chatMessages.appendChild(opDiv);
                          chatMessages.scrollTop = chatMessages.scrollHeight;
                        })(data.op, data.toolName);
                      } else if (kind === "error") {
                        appendChatMessage("error", data.error || data.message || "Agent error");
                      } else if (kind === "done") {
                        chatBusy = false;
                        if (submitBtn) submitBtn.disabled = false;
                      }
                    } catch (_) { /* ignore malformed SSE lines */ }
                  }
                }
                readChunk();
              }).catch(function(err) {
                appendChatMessage("error", "Stream error: " + (err.message || String(err)));
                chatBusy = false;
                if (submitBtn) submitBtn.disabled = false;
              });
            }
            readChunk();
          }).catch(function(err) {
            appendChatMessage("error", "Network error: " + (err.message || String(err)));
            chatBusy = false;
            if (submitBtn) submitBtn.disabled = false;
          });
        });
      }

    } catch (err) {
      setStatus("Failed to load site: " + (err && err.message ? err.message : String(err)), "error");
    }
  })();
})();`;
}
