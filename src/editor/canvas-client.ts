// src/editor/canvas-client.ts
//
// Browser-side bootstrap for the desktop Canvas Editor (T4). Exported as a
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

export interface CanvasClientScriptParams {
  siteId: string;
  apiBase?: string;
}

const SITE_ID_RE = /^[A-Za-z0-9-]+$/;

export function canvasClientScript(params: CanvasClientScriptParams): string {
  const { siteId, apiBase = '/api' } = params;
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

  // Two safe interpolations: siteId and apiBase. Both are validated above.
  // Everything inside the IIFE is plain JavaScript, not TypeScript.
  return `(() => {
  const SITE_ID = ${JSON.stringify(siteId)};
  const API_BASE = ${JSON.stringify(apiBase)};
  const SITE_BASE = API_BASE + "/canvas/sites/" + SITE_ID;

  const STYLE_KITS = ["charcoal", "orange-editorial", "blue-saas", "green-organic"];
  const ACTION_VARIANTS = ["solid", "outline", "ghost", "pill", "glass", "brutalist", "underline"];
  const SURFACE_VARIANTS = ["flat", "raised", "glass", "outlined", "sticker", "editorial-frame", "soft-panel"];
  const SHAPE_VARIANTS = ["rect", "pill", "circle", "line", "badge", "blob"];
  const MOTION_PRESETS = ["none", "fade-up", "slide-left", "scale-in", "blur-in", "stagger-children", "slow-drift", "parallax-soft"];
  const INLINE_MARK_TYPES = ["bold", "italic", "underline", "strike", "code", "highlight", "link"];
  // -- href allowlist (mirrors src/canvas/validate.ts isAllowedHref) -------
  // Centralised so the inline-link mark toolbar uses the SAME rules as the
  // server validator. If you change one, change the other.
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
  // The recipe-id list mirrors src/canvas/schema.ts SECTION_RECIPE_IDS.
  const SECTION_RECIPE_IDS = [
    "hero-split",
    "feature-grid",
    "gallery-strip",
    "cta-band",
    "logo-strip",
    "testimonial-row",
    "video-hero",
  ];

  const root = document.getElementById("canvas-root");
  const inspector = document.getElementById("canvas-inspector");
  const statusEl = document.getElementById("canvas-status");
  const mainEl = document.querySelector("main.rev01-editor");
  const sidebar = document.getElementById("canvas-sidebar");
  const sidebarSelection = document.getElementById("canvas-sidebar-selection");
  const saveButton = document.getElementById("canvas-save");
  const publishButton = document.getElementById("canvas-publish");
  const saveTemplateButton = document.getElementById("canvas-save-template");

  // -- Viewport + zoom ---------------------------------------------------
  // The route ships #canvas-root directly inside the editor shell. We wrap
  // it in a .rev01-viewport at boot so the viewport owns the dark
  // background, horizontal centering, and dock-clearing margins, while
  // #canvas-root receives the CSS transform that implements zoom. The
  // viewport no longer scrolls — the browser's native body scroll handles
  // vertical overflow when zoomed in. The wrap is purely client-side so
  // the route shell stays untouched.
  let viewport = null;
  let zoomToolbar = null;
  let zoomReadout = null;
  let zoom = 1;
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX_FIT = 1.0;     // "Fit" never auto-zooms past 100%
  const ZOOM_MAX_MANUAL = 2.0;  // manual +/- and wheel clamp here
  const ZOOM_STEP = 0.1;

  function clampZoom(value, max) {
    if (!Number.isFinite(value)) return 1;
    const upper = typeof max === "number" ? max : ZOOM_MAX_MANUAL;
    if (value < ZOOM_MIN) return ZOOM_MIN;
    if (value > upper) return upper;
    // Snap to one-decimal precision so repeated +/- stays predictable.
    return Math.round(value * 10) / 10;
  }

  function applyZoom() {
    if (!root) return;
    root.style.transform = "scale(" + zoom + ")";
    root.style.transformOrigin = "top left";
    // CSS transform doesn't change layout, so the viewport scrollWidth/
    // scrollHeight would stay unchanged from zoom=1. We need the viewport
    // to scroll proportionally to the scaled content. Compute the page's
    // logical extent and set #canvas-root's width/height to its post-scale
    // size so the viewport's scrollbars match what the Owner sees.
    const page = currentPage();
    if (page) {
      let logicalHeight = 0;
      for (let i = 0; i < page.sections.length; i++) {
        logicalHeight += page.sections[i].height || 0;
      }
      root.style.width = page.width * zoom + "px";
      root.style.height = logicalHeight * zoom + "px";
    }
    if (zoomReadout) zoomReadout.textContent = Math.round(zoom * 100) + "%";
  }

  function setZoom(value, max) {
    zoom = clampZoom(value, max);
    applyZoom();
  }

  function fitZoom() {
    if (!viewport) return;
    const page = currentPage();
    const pageWidth = page ? page.width : 1440;
    if (pageWidth <= 0) return;
    // Account for the viewport's horizontal padding so the fit zoom doesn't
    // overflow into the scrollbar. clientWidth already excludes scrollbars.
    const style = window.getComputedStyle(viewport);
    const padX =
      (parseFloat(style.paddingLeft) || 0) +
      (parseFloat(style.paddingRight) || 0);
    const available = Math.max(0, viewport.clientWidth - padX);
    const raw = available / pageWidth;
    setZoom(raw, ZOOM_MAX_FIT);
  }

  function mountViewport() {
    if (!root || !root.parentNode) return;
    const parent = root.parentNode;
    viewport = document.createElement("div");
    viewport.className = "rev01-viewport";
    // Insert viewport in place of #canvas-root, then move #canvas-root in.
    parent.insertBefore(viewport, root);
    viewport.appendChild(root);
    // Build the zoom toolbar and append directly to document.body — the
    // CSS pins it via position: fixed at the top-left of the canvas area,
    // so it must NOT live inside the viewport (which now uses flex
    // centering and has no scroll of its own).
    zoomToolbar = document.createElement("div");
    zoomToolbar.className = "rev01-zoom-toolbar";
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
      else if (action === "in") setZoom(zoom + ZOOM_STEP, ZOOM_MAX_MANUAL);
      else if (action === "out") setZoom(zoom - ZOOM_STEP, ZOOM_MAX_MANUAL);
    });
    // Ctrl/Cmd + wheel zooms; plain wheel scrolls naturally. We must call
    // preventDefault inside the zoom branch so the page doesn't also scroll.
    viewport.addEventListener(
      "wheel",
      (ev) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const direction = ev.deltaY > 0 ? -1 : 1;
        setZoom(zoom + direction * ZOOM_STEP, ZOOM_MAX_MANUAL);
      },
      { passive: false },
    );
    viewport.addEventListener("mousedown", function (ev) {
      if (interactionMode !== "pan") return;
      if (ev.button !== 0) return;
      ev.preventDefault();
      var startX = ev.clientX;
      var startY = ev.clientY;
      var scrollX = window.scrollX;
      var scrollY = window.scrollY;
      viewport.setAttribute("data-panning", "true");
      function onMove(e) {
        e.preventDefault();
        window.scrollTo(scrollX - (e.clientX - startX), scrollY - (e.clientY - startY));
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
    applyZoom();
  }

  // -- Pointer-to-canvas coordinate helper -------------------------------
  // Single source of truth for converting a pointer event's clientX/clientY
  // to coordinates inside the given section's local canvas space. The
  // section element is the .rev01-section DOM node; its bounding rect
  // already reflects the current CSS transform (zoom), so dividing the
  // pointer delta by zoom yields native canvas units. Returning null on
  // missing section is a loud signal — callers should bail out, not guess.
  function pointerToCanvas(event, sectionEl) {
    if (!sectionEl || typeof event.clientX !== "number") return null;
    const rect = sectionEl.getBoundingClientRect();
    const z = zoom || 1;
    return {
      x: (event.clientX - rect.left) / z,
      y: (event.clientY - rect.top) / z,
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
        statusEl.textContent = "Ready";
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
  let saveBusy = false;
  let sessionExpired = false;
  function setSaveBusy(busy) {
    saveBusy = busy;
    if (saveButton) saveButton.disabled = busy;
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
  async function authFetch(input, init) {
    const response = await fetch(input, init);
    if (response.status === 401) {
      handleSessionExpired();
      throw new Error("session expired");
    }
    return response;
  }

  // -- Modal overlay (text + select) -------------------------------------
  // Replaces the five window.prompt sites. Single-modal stack — calling
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
      backdrop.className = "rev01-modal-backdrop";
      const panel = document.createElement("div");
      panel.className = "rev01-modal";
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
      actions.className = "rev01-modal-actions";
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
        document.body.classList.remove("rev01-modal-open");
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

      document.body.classList.add("rev01-modal-open");
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
      backdrop.className = "rev01-modal-backdrop";
      const panel = document.createElement("div");
      panel.className = "rev01-modal";
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
      actions.className = "rev01-modal-actions";
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
        document.body.classList.remove("rev01-modal-open");
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

      document.body.classList.add("rev01-modal-open");
      document.body.appendChild(backdrop);
      select.focus();
    });
  }

  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  }

  function newElementId() { return "el-" + uuid(); }
  function newSectionId() { return "sec-" + uuid(); }

  function currentPage() {
    if (!state || !Array.isArray(state.pages) || state.pages.length === 0) return null;
    return state.pages[0];
  }

  function findSection(sectionId) {
    const page = currentPage();
    if (!page) return null;
    for (const section of page.sections) {
      if (section.id === sectionId) return section;
    }
    return null;
  }

  function findElement(elementId) {
    const page = currentPage();
    if (!page) return null;
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id === elementId) return { section, element };
      }
    }
    return null;
  }

  async function persistStateSnapshot(snapshot) {
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
        } catch (_) { /* ignore */ }
        setStatus("Save failed: " + detail, "error");
        return false;
      }
      setStatus("Saved", "ok");
      return true;
    } catch (err) {
      setStatus("Save failed: " + (err && err.message ? err.message : String(err)), "error");
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
    if (!saved) {
      setStatus("Save failed; action stopped", "error");
    }
    return saved;
  }

  function scheduleSave() {
    captureForUndo();
    coEditSync();
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
      if (!state) return;
      var snap = structuredClone(state);
      undoStack.push(snap);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack = [];
    }, 800);
  }

  function undo() {
    if (undoStack.length <= 1 || !state) return;
    undoRedoing = true;
    redoStack.push(structuredClone(state));
    undoStack.pop();
    state = structuredClone(undoStack[undoStack.length - 1]);
    if (state && !Array.isArray(state.symbols)) state.symbols = [];
    renderAll();
    scheduleSave();
    undoRedoing = false;
    setStatus("Undo", "ok");
  }

  function redo() {
    if (redoStack.length === 0 || !state) return;
    undoRedoing = true;
    undoStack.push(structuredClone(state));
    state = structuredClone(redoStack.pop());
    if (state && !Array.isArray(state.symbols)) state.symbols = [];
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

  // Build the nested-mark DOM for one InlineRun. Mark nesting order must
  // match the server renderer in src/canvas/render.ts so the editor preview
  // and the published HTML agree visually:
  //   <a> outermost (only when link mark present)
  //   <strong>, <em>, <u>, <s>, <mark>, <code> innermost
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
    if (hasMark(run, "code")) wrap("code");
    if (hasMark(run, "highlight")) wrap("mark");
    if (hasMark(run, "strike")) wrap("s");
    if (hasMark(run, "underline")) wrap("u");
    if (hasMark(run, "italic")) wrap("em");
    if (hasMark(run, "bold")) wrap("strong");
    const link = findLinkMark(run);
    if (link) {
      const a = document.createElement("a");
      a.className = "rev01-inline-link";
      a.setAttribute("href", link.href);
      if (link.target === "_blank") {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      }
      // Don't navigate from inside the editor when the Owner clicks a link.
      a.addEventListener("click", (ev) => { ev.preventDefault(); });
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
    node.className = "rev01-text";
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
    node.className = "rev01-media";
    node.setAttribute("data-rev01-media-kind", element.mediaKind);
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
      img.setAttribute("alt", typeof element.alt === "string" ? element.alt : "");
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

  function buildActionBody(element) {
    const node = document.createElement("a");
    node.className = "rev01-action";
    node.setAttribute("data-variant", element.variant);
    node.setAttribute("href", element.href);
    node.addEventListener("click", (ev) => { ev.preventDefault(); });
    node.textContent = element.label;
    return node;
  }

  function buildShapeBody(element) {
    const node = document.createElement("div");
    node.className = "rev01-shape";
    node.setAttribute("data-variant", element.variant);
    return node;
  }

  function buildContainerBody(element) {
    const node = document.createElement("div");
    node.className = "rev01-surface";
    node.setAttribute("data-variant", element.variant);
    return node;
  }

  // -- Wave 2 #11 chart editor extensibility slot ------------------------
  //
  // The editor preview renders an inline approximation of the server SVG
  // so the Owner sees colour bands + a kind hint while typing into the
  // data grid. The visitor-facing render is the canonical server SVG
  // (see src/canvas/elements/chart.ts) — this preview deliberately uses
  // the SAME palette algorithm by reading the kit accent off the editor
  // wrapper's --rev01-kit-accent token, so the editor swatch order
  // matches what the server emits. No client-side chart library: ~80 lines
  // of plain DOM + a fixed-format colour-rotation.
  // ----------------------------------------------------------------------

  const CHART_KINDS = ["bar", "line", "pie", "donut", "area"];

  function parseHexAccent(raw) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim().replace(/^#/, "");
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
    const accent = (cs.getPropertyValue("--rev01-kit-accent") || "").trim();
    return previewPaletteFromAccent(accent || "#888888");
  }

  function buildChartBody(element) {
    const node = document.createElement("div");
    node.className = "rev01-chart-preview";
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

  function buildElementBody(element) {
    switch (element.type) {
      case "text": return buildTextBody(element);
      case "media": return buildMediaBody(element);
      case "action": return buildActionBody(element);
      case "shape": return buildShapeBody(element);
      case "container": return buildContainerBody(element);
      case "chart": return buildChartBody(element);
      // Wave 3 #14 — symbol-instance editor placeholder. Renders a card that
      // identifies the referenced master by name + lists override count. The
      // public renderer does the real merge + render at publish/preview time;
      // the editor surface is intentionally minimal because instances should
      // be primarily edited via the Symbol panel (master edits propagate).
      case "symbol-instance": return buildSymbolInstanceBody(element);
    }
    const fallback = document.createElement("div");
    return fallback;
  }

  // -- Element context menu (3-dot, top-left on hover) --------------------

  let openMenuElementId = null;

  function closeElementMenu() {
    if (!openMenuElementId) return;
    const prev = root.querySelector('[data-rev01-element="' + cssEscape(openMenuElementId) + '"] .element-menu');
    if (prev) prev.remove();
    const prevTrigger = root.querySelector('[data-rev01-element="' + cssEscape(openMenuElementId) + '"] .element-menu-trigger');
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
      var copy = JSON.parse(JSON.stringify(element));
      copy.id = newElementId();
      copy.box.x = Math.min(copy.box.x + 20, (currentPage() ? currentPage().width : 1440) - copy.box.w);
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
    wrapper.className = "rev01-element";
    wrapper.setAttribute("data-rev01-element", element.id);
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
    const existing = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
    if (!existing || !existing.parentNode) {
      renderAll();
      return;
    }
    const replacement = buildElementNode(found.element);
    existing.parentNode.replaceChild(replacement, existing);
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  }

  function buildSectionToolbar(section) {
    const bar = document.createElement("div");
    bar.className = "section-toolbar";
    // Wave 3 #14 \u2014 Symbol controls. We surface "Sym" (convert-to-symbol) for
    // every section, and "Det" (detach-instance) only when the section
    // contains a symbol-instance element. The Owner cannot "convert" a
    // section whose only element is already a symbol-instance \u2014 that would
    // require nested symbols (forbidden by scope).
    const hasInstance = section.elements.some((e) => e && e.type === "symbol-instance");
    const onlyInstance = section.elements.length === 1 && hasInstance;
    const buttons = [
      { label: "+T", action: "add-text" },
      { label: "+Img", action: "add-image" },
      { label: "+Vid", action: "add-video" },
      { label: "+Btn", action: "add-action" },
      { label: "+\u25c7", action: "add-shape" },
      { label: "+\u25a1", action: "add-container" },
      // Wave 2 #11 \u2014 chart element. Additive entry; existing buttons unchanged.
      { label: "+\ud83d\udcca", action: "add-chart" },
      { label: "Dup", action: "duplicate-section" },
      { label: "\u2191", action: "move-up" },
      { label: "\u2193", action: "move-down" },
      { label: "Save", action: "save-to-library" },
      { label: "Del", action: "delete-section", danger: true },
    ];
    if (!hasInstance) {
      buttons.splice(buttons.length - 1, 0, { label: "Sym", action: "convert-to-symbol" });
    }
    for (const def of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = def.label;
      button.setAttribute("data-section-action", def.action);
      button.setAttribute("data-section-id", section.id);
      if (def.danger) button.classList.add("danger");
      bar.appendChild(button);
    }
    // AI section button \u2014 drives /api/canvas-agent/sites/.../preview with a
    // createSection prompt. The button shares the disabled-while-busy
    // contract with the other AI controls via data-ai-button.
    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.textContent = "AI section";
    aiBtn.setAttribute("data-ai-button", "create-section");
    aiBtn.setAttribute("data-section-id", section.id);
    if (aiBusy) aiBtn.disabled = true;
    aiBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      aiCreateSection(section.id);
    });
    bar.appendChild(aiBtn);
    return bar;
  }

  function buildSectionNode(section, pageWidth) {
    const node = document.createElement("section");
    node.className = "rev01-section";
    node.setAttribute("data-rev01-section", section.id);
    node.setAttribute("data-recipe", section.recipeId);
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

  function renderAll() {
    if (!state) return;
    const page = currentPage();
    if (!page) {
      root.replaceChildren();
      return;
    }
    const article = document.createElement("article");
    article.className = "rev01-page";
    article.setAttribute("data-rev01-page", page.id);
    article.style.width = page.width + "px";
    article.style.margin = "0 auto";
    article.style.position = "relative";
    for (const section of page.sections) {
      article.appendChild(buildSectionNode(section, page.width));
    }
    root.replaceChildren(article);
    if (mainEl && state.styleKit) {
      mainEl.setAttribute("data-style-kit", state.styleKit);
    }
    // Re-apply zoom so #canvas-root's width/height reflect the (possibly
    // changed) section heights or page width that this render produced.
    applyZoom();
    renderInspector();
    renderSidebarSelection();
    renderReel();
    // If a cross-template import is pending, the article we just replaced
    // wiped any previously-drawn slots; re-draw them now.
    if (pendingImport) {
      renderPlacementSlots();
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

  function applyZOrderAction(section, element, action) {
    if (action === "front") bringToFront(section, element);
    else if (action === "back") sendToBack(section, element);
    else if (action === "forward") nudgeZ(section, element, 1);
    else if (action === "backward") nudgeZ(section, element, -1);
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
    group.className = "rev01-reorder-buttons";
    const idx = section.elements.indexOf(element);
    const total = section.elements.length;
    const caption = document.createElement("div");
    caption.className = "rev01-reorder-caption";
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
    group.className = "rev01-zorder-buttons";
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

  // -- Wave 2 #11 chart editor data grid ---------------------------------
  //
  // Renders directly into the inspector. Re-renders the whole chart block
  // on every structural change (add/remove series or category) so we don't
  // have to manage incremental DOM updates for a small spreadsheet grid.
  // Cell edits update element.series[].values in place and call
  // rebuildElement(id) + scheduleSave() — same shape every other inspector
  // input uses.
  function buildChartInspector(element) {
    const wrap = document.createElement("div");
    wrap.className = "rev01-chart-inspector";
    inspector.appendChild(wrap);

    // Kind picker.
    const kind = selectInput(CHART_KINDS, element.kind);
    kind.addEventListener("change", () => {
      element.kind = kind.value;
      rebuildElement(element.id);
      scheduleSave();
    });
    wrap.appendChild(field("Chart kind", kind));

    // Axis titles (bar / line / area only — pie/donut ignore these on the
    // server. We still let the Owner type them so switching kinds doesn't
    // lose data.)
    const xTitle = document.createElement("input");
    xTitle.type = "text";
    xTitle.value = typeof element.xAxisTitle === "string" ? element.xAxisTitle : "";
    xTitle.placeholder = "X-axis title (optional)";
    xTitle.addEventListener("change", () => {
      if (xTitle.value.length === 0) { delete element.xAxisTitle; }
      else { element.xAxisTitle = xTitle.value; }
      rebuildElement(element.id);
      scheduleSave();
    });
    wrap.appendChild(field("X-axis title", xTitle));

    const yTitle = document.createElement("input");
    yTitle.type = "text";
    yTitle.value = typeof element.yAxisTitle === "string" ? element.yAxisTitle : "";
    yTitle.placeholder = "Y-axis title (optional)";
    yTitle.addEventListener("change", () => {
      if (yTitle.value.length === 0) { delete element.yAxisTitle; }
      else { element.yAxisTitle = yTitle.value; }
      rebuildElement(element.id);
      scheduleSave();
    });
    wrap.appendChild(field("Y-axis title", yTitle));

    // Legend toggle.
    const legendRow = document.createElement("div");
    legendRow.className = "row";
    const legendBox = document.createElement("input");
    legendBox.type = "checkbox";
    legendBox.checked = element.showLegend !== false;
    legendBox.addEventListener("change", () => {
      element.showLegend = legendBox.checked;
      rebuildElement(element.id);
      scheduleSave();
    });
    const legendLabel = document.createElement("label");
    legendLabel.textContent = "show legend";
    legendRow.appendChild(legendBox);
    legendRow.appendChild(legendLabel);
    wrap.appendChild(legendRow);

    // Data grid host. Stored on 'wrap' so the controls below can target it
    // when the grid needs a structural rebuild (add/remove series/cat).
    const gridHost = document.createElement("div");
    gridHost.className = "rev01-chart-grid-host";
    gridHost.style.marginTop = "8px";
    wrap.appendChild(gridHost);

    function renderGrid() {
      gridHost.replaceChildren();
      const series = Array.isArray(element.series) ? element.series : (element.series = []);
      const cats = Array.isArray(element.categories) ? element.categories : (element.categories = []);
      // Header row: blank + each category name.
      const table = document.createElement("table");
      table.className = "rev01-chart-grid";
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

  function renderInspector() {
    if (!inspector) return;
    if (isReelOpen) {
      inspector.hidden = true;
      revokePendingPreviews();
      inspector.replaceChildren();
      return;
    }
    if (!selectedElementId) {
      inspector.hidden = true;
      revokePendingPreviews();
      inspector.replaceChildren();
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

    const heading = document.createElement("h3");
    heading.textContent = element.type + " element";
    inspector.appendChild(heading);

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

    if (element.type === "text") {
      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.textContent = "AI rewrite";
      aiBtn.setAttribute("data-ai-button", "rewrite-text");
      if (aiBusy) aiBtn.disabled = true;
      aiBtn.addEventListener("click", () => { aiRewriteText(element.id); });
      inspector.appendChild(aiBtn);

      const role = selectInput(["heading", "body", "label"], element.role);
      role.addEventListener("change", () => {
        element.role = role.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Role", role));

      const fontSize = document.createElement("input");
      fontSize.type = "number";
      fontSize.min = "12"; fontSize.max = "96";
      fontSize.value = String(element.fontSize);
      fontSize.addEventListener("change", () => {
        const n = Number(fontSize.value);
        if (Number.isFinite(n) && n >= 12 && n <= 96) {
          element.fontSize = n;
          rebuildElement(element.id);
          scheduleSave();
        }
      });
      inspector.appendChild(field("Font size", fontSize));

      const weight = selectInput(["400", "500", "600", "700"], String(element.fontWeight));
      weight.addEventListener("change", () => {
        element.fontWeight = Number(weight.value);
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Font weight", weight));

      const align = selectInput(["left", "center", "right"], element.align);
      align.addEventListener("change", () => {
        element.align = align.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Align", align));
    }

    if (element.type === "action") {
      const variant = selectInput(ACTION_VARIANTS, element.variant);
      variant.addEventListener("change", () => {
        element.variant = variant.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Variant", variant));

      const label = document.createElement("input");
      label.type = "text";
      label.value = element.label;
      label.addEventListener("change", () => {
        if (label.value.length === 0) {
          setStatus("Label can't be empty", "error");
          label.value = element.label;
          return;
        }
        element.label = label.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Label", label));

      const href = document.createElement("input");
      href.type = "text";
      href.value = element.href;
      href.addEventListener("change", () => {
        if (href.value.length === 0) {
          setStatus("Href can't be empty", "error");
          href.value = element.href;
          return;
        }
        element.href = href.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Href", href));
    }

    if (element.type === "shape") {
      const variant = selectInput(SHAPE_VARIANTS, element.variant);
      variant.addEventListener("change", () => {
        element.variant = variant.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Variant", variant));
    }

    if (element.type === "container") {
      const variant = selectInput(SURFACE_VARIANTS, element.variant);
      variant.addEventListener("change", () => {
        element.variant = variant.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Variant", variant));
    }

    if (element.type === "media") {
      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.textContent = "AI media";
      aiBtn.setAttribute("data-ai-button", "replace-media");
      if (aiBusy) aiBtn.disabled = true;
      aiBtn.addEventListener("click", () => { aiReplaceMedia(element.id); });
      inspector.appendChild(aiBtn);

      // Three-row media picker: current thumb + upload + AI generate + alt,
      // history row (slot MRU), gallery grid (all owner assets by kind).
      mountMediaPicker(element, inspector);

      const fit = selectInput(["cover", "contain"], element.fit);
      fit.addEventListener("change", () => {
        element.fit = fit.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Fit", fit));

      // chart inspector block follows below (additive Wave 2 #11 slot).
      if (element.mediaKind === "video") {
        const playback = element.playback || (element.playback = { autoplay: false, muted: true, loop: false, controls: true });
        const autoplay = document.createElement("input");
        autoplay.type = "checkbox"; autoplay.checked = !!playback.autoplay;
        const muted = document.createElement("input");
        muted.type = "checkbox"; muted.checked = !!playback.muted;
        const loop = document.createElement("input");
        loop.type = "checkbox"; loop.checked = !!playback.loop;
        const controls = document.createElement("input");
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

        autoplay.addEventListener("change", () => {
          playback.autoplay = autoplay.checked;
          enforceMuted();
          playback.muted = muted.checked;
          scheduleSave();
        });
        muted.addEventListener("change", () => {
          if (autoplay.checked) { muted.checked = true; return; }
          playback.muted = muted.checked;
          scheduleSave();
        });
        loop.addEventListener("change", () => { playback.loop = loop.checked; scheduleSave(); });
        controls.addEventListener("change", () => { playback.controls = controls.checked; scheduleSave(); });

        const row = document.createElement("div"); row.className = "row";
        row.appendChild(autoplay);
        const al = document.createElement("label"); al.textContent = "autoplay"; row.appendChild(al);
        inspector.appendChild(row);

        const row2 = document.createElement("div"); row2.className = "row";
        row2.appendChild(muted);
        const ml = document.createElement("label"); ml.textContent = "muted"; row2.appendChild(ml);
        inspector.appendChild(row2);

        const row3 = document.createElement("div"); row3.className = "row";
        row3.appendChild(loop);
        const ll = document.createElement("label"); ll.textContent = "loop"; row3.appendChild(ll);
        inspector.appendChild(row3);

        const row4 = document.createElement("div"); row4.className = "row";
        row4.appendChild(controls);
        const cl = document.createElement("label"); cl.textContent = "controls"; row4.appendChild(cl);
        inspector.appendChild(row4);
      }
    }

    // -- Wave 2 #11 chart inspector ----------------------------------------
    //
    // Kind picker, axis title fields, legend toggle, and a spreadsheet-like
    // data grid (series rows x category columns) with add/remove controls
    // for both. Every keystroke calls scheduleSave() and rebuildElement()
    // so the preview thumbnail updates inline. The grid is rendered fresh
    // on every change via a local renderChartGrid() helper so we don't
    // have to manage incremental DOM diffs for a 6x6 grid.
    if (element.type === "chart") {
      buildChartInspector(element);
    }

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
  // picks a file; import is cached so subsequent uploads are immediate. Pinned
  // to a specific version so jsDelivr cache hits and the CDN side can't ship
  // breaking changes silently. The library registers custom elements as a
  // side-effect of the import, so we just need the module to evaluate.
  const CROPPER_CDN = "https://cdn.jsdelivr.net/npm/cropperjs@2.1.1/dist/cropper.esm.js";
  let cropperLoadPromise = null;
  function loadCropper() {
    if (!cropperLoadPromise) {
      cropperLoadPromise = import(CROPPER_CDN);
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
        // animation; PNG keeps the still output lossless. Other browser-safe
        // image types pass through unchanged.
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
  // past t=0 because some codecs emit a black frame at exactly zero.
  async function extractVideoFirstFrame(file) {
    const url = URL.createObjectURL(file);
    try {
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
        const target = Math.min(0.05, (video.duration || 1) / 2);
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
    } finally {
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

    if (element.mediaKind === "image") {
      const genRow = document.createElement("div");
      genRow.style.cssText = "display:flex;gap:4px;";

      const promptInput = document.createElement("textarea");
      promptInput.rows = 1;
      promptInput.placeholder = "Describe image...";
      promptInput.style.cssText = "flex:1;min-width:0;font-size:11px;resize:none;box-sizing:border-box;" +
        "appearance:none;background:var(--rev01-bg-panel);border:1px solid var(--rev01-hairline);" +
        "color:var(--rev01-fg);border-radius:4px;padding:4px 6px;font-family:inherit;";

      const genBtn = document.createElement("button");
      genBtn.type = "button";
      genBtn.textContent = "AI";
      genBtn.addEventListener("click", () => {
        const prompt = promptInput.value.trim();
        if (!prompt) {
          setStatus("Enter a prompt first", "error");
          return;
        }
        generateImageForElement(element, prompt);
      });

      genRow.appendChild(promptInput);
      genRow.appendChild(genBtn);
      actionsCol.appendChild(genRow);
    }

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
        hint.style.cssText = "font-size:11px;color:var(--rev01-fg-faint);font-family:var(--rev01-font-mono);";
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
        hint.style.cssText = "font-size:11px;color:var(--rev01-fg-faint);font-family:var(--rev01-font-mono);grid-column:1/-1;";
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
    if (!confirm(lines.join("\\n"))) return;

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
    img.style.cssText = "max-width:100%;display:block;border:1px solid var(--rev01-border,#ccc);";
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

  function selectElement(elementId) {
    if (selectedElementId === elementId) return;
    if (selectedElementId) {
      const prev = root.querySelector('[data-rev01-element="' + cssEscape(selectedElementId) + '"]');
      if (prev) prev.removeAttribute("data-selected");
    }
    selectedElementId = elementId;
    if (elementId) {
      if (isReelOpen) closeReel();
      const next = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
      if (next) next.setAttribute("data-selected", "true");
      const found = findElement(elementId);
      if (found) selectSection(found.section.id);
    }
    renderInspector();
    renderSidebarSelection();
  }

  function selectSection(sectionId) {
    if (selectedSectionId === sectionId) return;
    if (selectedSectionId) {
      const prev = root.querySelector('[data-rev01-section="' + cssEscape(selectedSectionId) + '"]');
      if (prev) prev.removeAttribute("data-selected");
    }
    selectedSectionId = sectionId;
    if (sectionId) {
      const next = root.querySelector('[data-rev01-section="' + cssEscape(sectionId) + '"]');
      if (next) next.setAttribute("data-selected", "true");
    }
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

  function insertBlankSectionAt(insertAt) {
    const page = currentPage();
    if (!page) return;
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
    if (fromIdx === toIdx || fromIdx + 1 === toIdx) return;
    const section = page.sections.splice(fromIdx, 1)[0];
    const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
    page.sections.splice(adjustedTo, 0, section);
    renderAll();
    scheduleSave();
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

    for (let i = 0; i < page.sections.length; i++) {
      const section = page.sections[i];
      body.appendChild(buildReelInsertButton(i));

      const tile = document.createElement("div");
      tile.className = isTile ? "reel-tile" : "reel-list-item";
      tile.setAttribute("data-reel-section", section.id);
      tile.setAttribute("data-reel-index", String(i));

      const thumb = buildSectionThumbnail(section, pageWidth, thumbW);
      if (selectedSectionId === section.id) {
        thumb.setAttribute("data-reel-selected", "true");
      }
      tile.appendChild(thumb);

      if (isTile) {
        const label = document.createElement("div");
        label.className = "reel-tile-label";
        label.textContent = section.name || section.recipeId;
        tile.appendChild(label);
      } else {
        const info = document.createElement("div");
        info.className = "reel-list-info";
        const name = document.createElement("div");
        name.className = "reel-list-name";
        name.textContent = section.name || "Untitled";
        const recipe = document.createElement("div");
        recipe.className = "reel-list-recipe";
        recipe.textContent = section.recipeId;
        info.appendChild(name);
        info.appendChild(recipe);
        tile.appendChild(info);
      }

      tile.addEventListener("mousedown", (function(sectionId, idx) {
        return function(ev) {
          if (ev.button !== 0) return;
          ev.preventDefault();
          beginReelDrag(sectionId, idx, ev);
        };
      })(section.id, i));

      body.appendChild(tile);
    }
    body.appendChild(buildReelInsertButton(page.sections.length));

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

    const sectionEl = root.querySelector('[data-rev01-section="' + cssEscape(sectionId) + '"]');
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

      const sectionNodes = Array.from(root.querySelectorAll("[data-rev01-section]"));
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
    // string is reliable.
    const order = { link: 0, bold: 1, italic: 2, underline: 3, strike: 4, highlight: 5, code: 6 };
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

  // -- Link hover popover --------------------------------------------------
  var linkPopover = null;
  var linkPopoverAnchor = null;
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

  function showLinkPopover(anchorEl) {
    removeLinkPopover();
    var href = anchorEl.getAttribute('href') || '';
    var bar = document.createElement('div');
    bar.className = 'rev01-link-popover';

    var urlSpan = document.createElement('span');
    urlSpan.className = 'rev01-link-popover-url';
    urlSpan.textContent = href.length > 40 ? href.slice(0, 37) + '...' : href;
    urlSpan.title = href;
    bar.appendChild(urlSpan);

    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    openBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (!isAllowedHref(href)) {
        setStatus('Link rejected: ' + href + ' is not http/https/mailto/tel/anchor/relative', 'error');
        removeLinkPopover();
        return;
      }
      window.open(href, '_blank', 'noopener,noreferrer');
      removeLinkPopover();
    });
    bar.appendChild(openBtn);

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
    bar.appendChild(editBtn);

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
    bar.appendChild(unlinkBtn);

    bar.addEventListener('mouseenter', function () {
      if (linkPopoverHideTimer) { clearTimeout(linkPopoverHideTimer); linkPopoverHideTimer = null; }
    });
    bar.addEventListener('mouseleave', function () {
      removeLinkPopover();
    });

    linkPopover = bar;
    linkPopoverAnchor = anchorEl;
    document.body.appendChild(bar);
    positionLinkPopover(anchorEl);
  }

  function onLinkMouseEnter(ev) {
    if (!editingElementId) return;
    var target = ev.target;
    if (!target || target.tagName !== 'A') return;
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
    linkPopoverHideTimer = setTimeout(function () {
      linkPopoverHideTimer = null;
      removeLinkPopover();
    }, 200);
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
    next.selectNode(el);
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
      backdrop.className = 'rev01-modal-backdrop';
      var panel = document.createElement('div');
      panel.className = 'rev01-modal';
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
        preview.className = 'rev01-link-modal-preview';
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
      errorEl.className = 'rev01-link-modal-error';
      errorEl.textContent = '';
      panel.appendChild(errorEl);

      var checkLabel = document.createElement('label');
      checkLabel.className = 'rev01-link-modal-checkbox';
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
      actions.className = 'rev01-modal-actions';
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
        document.body.classList.remove('rev01-modal-open');
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

      document.body.classList.add('rev01-modal-open');
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
    a.className = 'rev01-inline-link';
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
    if (type === "strike") return applyExecCommand("strikeThrough");
    if (type === "code") return wrapSelectionWith("code");
    if (type === "highlight") return wrapSelectionWith("mark");
    if (type === "link") {
      applyLinkMark().catch((err) => {
        setStatus("Link failed: " + (err && err.message ? err.message : String(err)), "error");
      });
      return;
    }
  }

  function buildMarkToolbar(anchor) {
    removeMarkToolbar();
    const bar = document.createElement("div");
    bar.className = "rev01-mark-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Inline formatting");
    const labels = {
      bold: "B",
      italic: "I",
      underline: "U",
      strike: "S",
      code: "</>",
      highlight: "HL",
      link: "Link",
    };
    for (let i = 0; i < INLINE_MARK_TYPES.length; i++) {
      const type = INLINE_MARK_TYPES[i];
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
    markToolbar = bar;
    markToolbarAnchor = anchor;
    // Append to document.body (NOT viewport or #canvas-root) so the
    // toolbar lives in viewport coordinate space and stays pinned via
    // position: fixed while the body scrolls.
    document.body.appendChild(bar);
    positionMarkToolbar(anchor);
  }

  function beginTextEdit(elementId) {
    const found = findElement(elementId);
    if (!found || found.element.type !== "text") return;
    const wrapper = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
    if (!wrapper) return;
    const inner = wrapper.querySelector(".rev01-text");
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

    function restoreFromSnapshot() {
      found.element.content = JSON.parse(JSON.stringify(editingSnapshot));
      rebuildElement(elementId);
    }

    function finish(commit) {
      inner.removeAttribute("contenteditable");
      inner.removeEventListener("blur", onBlur);
      inner.removeEventListener("keydown", onKey);
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
    aiBusy = busy;
    const buttons = document.querySelectorAll("[data-ai-button]");
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].disabled = busy;
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
      if (state && !Array.isArray(state.symbols)) state.symbols = [];
      selectedSectionId = null;
      selectedElementId = null;
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      renderAll();
      closeAiPanel();
      setStatus("AI edit applied", "ok");
    } catch (err) {
      setStatus("Apply failed: " + (err && err.message ? err.message : String(err)), "error");
      closeAiPanel();
    }
  }

  function buildAiPanel(payload) {
    closeAiPanel();
    const panel = document.createElement("aside");
    panel.className = "rev01-ai-panel";
    panel.setAttribute("aria-label", "AI preview");
    const heading = document.createElement("h3");
    heading.textContent = "AI preview";
    panel.appendChild(heading);

    const ops = Array.isArray(payload.ops) ? payload.ops : [];
    if (typeof payload.text === "string" && payload.text.length > 0) {
      const note = document.createElement("p");
      note.className = "rev01-ai-note";
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
    actions.className = "rev01-ai-actions";
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
        setStatus("AI preview failed: " + detail, "error");
        setAiBusy(false);
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

  async function aiReplaceMedia(elementId) {
    if (aiBusy) return;
    const brief = await openTextModal({
      title: "AI media",
      label: "Describe the asset",
      placeholder: "Sunset over ocean",
      multiline: true,
    });
    if (brief === null || brief.trim().length === 0) return;
    const prompt =
      "Replace the media element with id=" + elementId +
      " by calling replaceMedia with an asset id that already exists on this site. " +
      "Owner brief: " + brief;
    runAiPreview(prompt);
  }

  async function aiCreateSection(afterSectionId) {
    if (aiBusy) return;
    const recipeId = await openSelectModal({
      title: "AI section",
      label: "Recipe",
      options: SECTION_RECIPE_IDS.map((id) => ({ value: id, label: id })),
      defaultValue: "feature-grid",
    });
    if (recipeId === null) return;
    const normalised = recipeId.trim();
    if (SECTION_RECIPE_IDS.indexOf(normalised) < 0) {
      setStatus("Unknown recipe id: " + normalised, "error");
      return;
    }
    const brief = await openTextModal({
      title: "Section brief",
      label: "What goes in this section?",
      placeholder: "three reasons to migrate",
      multiline: true,
    });
    if (brief === null || brief.trim().length === 0) return;
    const afterClause = afterSectionId
      ? "Insert it after section id=" + afterSectionId + "."
      : "Append it at the end of the page.";
    const prompt =
      "Create a new section using the createSection tool with recipeId=" + normalised + ". " +
      afterClause + " Owner brief: " + brief;
    runAiPreview(prompt);
  }

  // -- Drag & resize ------------------------------------------------------

  function attachPointerHandlers() {
    root.addEventListener("mousedown", (ev) => {
      if (interactionMode === "pan") return;
      if (ev.target instanceof Element && (ev.target.closest("[data-element-menu-trigger]") || ev.target.closest("[data-element-menu]"))) return;
      const handle = ev.target instanceof Element ? ev.target.closest('[data-resize-handle]') : null;
      if (handle) {
        const wrapper = handle.closest('.rev01-element');
        const dir = handle.getAttribute('data-resize-dir') || 'se';
        if (wrapper) { beginResize(ev, wrapper, dir); ev.preventDefault(); }
        return;
      }
      const wrapper = ev.target instanceof Element ? ev.target.closest('.rev01-element') : null;
      if (!wrapper) return;
      const elementId = wrapper.getAttribute('data-rev01-element');
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
    const elementId = wrapper.getAttribute('data-rev01-element');
    if (!elementId) return;
    const found = findElement(elementId);
    if (!found) return;
    const sectionEl = wrapper.closest('.rev01-section');
    if (!sectionEl) return;
    const start = pointerToCanvas(startEv, sectionEl);
    if (!start) return;
    const originalBox = Object.assign({}, found.element.box);
    const page = currentPage();
    const pageWidth = page ? page.width : 1440;
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
    const elementId = wrapper.getAttribute('data-rev01-element');
    if (!elementId) return;
    const found = findElement(elementId);
    if (!found) return;
    const sectionEl = wrapper.closest('.rev01-section');
    if (!sectionEl) return;
    const start = pointerToCanvas(startEv, sectionEl);
    if (!start) return;
    const ob = Object.assign({}, found.element.box);
    const page = currentPage();
    const pageWidth = page ? page.width : 1440;
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
      if (nw < 24) { if (fromLeft) nx = ob.x + ob.w - 24; nw = 24; }
      if (nh < 24) { if (fromTop) ny = ob.y + ob.h - 24; nh = 24; }
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
    const pageWidth = page ? page.width : 1440;
    let width = w;
    let height = h;
    if (width > pageWidth) width = pageWidth - 40;
    if (height > section.height) height = section.height - 40;
    return { x: 40, y: 40, w: width, h: height, z: nextZ(section) };
  }

  function addElementToSection(section, element) {
    section.elements.push(element);
    renderAll();
    selectElement(element.id);
    scheduleSave();
  }

  function targetSectionForSidebar() {
    const page = currentPage();
    if (!page || !Array.isArray(page.sections) || page.sections.length === 0) return null;
    if (selectedSectionId) {
      const selected = findSection(selectedSectionId);
      if (selected) return selected;
    }
    return page.sections[page.sections.length - 1] || null;
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
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : page.sections.length;
    page.sections.splice(insertAt, 0, section);
    selectedSectionId = section.id;
    selectedElementId = null;
    renderAll();
    scheduleSave();
    setStatus("Section added", "ok");
  }

  function componentActionForSidebar(component) {
    if (component === "text") return "add-text";
    if (component === "image") return "add-image";
    if (component === "video") return "add-video";
    if (component === "action") return "add-action";
    if (component === "shape") return "add-shape";
    if (component === "container") return "add-container";
    // Wave 2 #11 — sidebar entry for chart elements.
    if (component === "chart") return "add-chart";
    return null;
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
    const page = currentPage();
    if (!page) return;
    const idx = page.sections.findIndex((s) => s.id === sectionId);
    if (idx < 0) return;
    const section = page.sections[idx];

    if (action === "add-text") {
      addElementToSection(section, {
        id: newElementId(),
        type: "text",
        content: [{ text: "New text" }],
        role: "body",
        fontSize: 16,
        fontWeight: 400,
        align: "left",
        box: defaultBox(section, 320, 80),
      });
    } else if (action === "add-image") {
      addElementToSection(section, {
        id: newElementId(),
        type: "media",
        mediaKind: "image",
        assetId: "__placeholder__",
        alt: "Image",
        fit: "cover",
        box: defaultBox(section, 480, 320),
      });
    } else if (action === "add-video") {
      addElementToSection(section, {
        id: newElementId(),
        type: "media",
        mediaKind: "video",
        assetId: "__placeholder__",
        alt: "Video",
        fit: "cover",
        playback: { autoplay: false, muted: true, loop: false, controls: true },
        box: defaultBox(section, 480, 320),
      });
    } else if (action === "add-action") {
      addElementToSection(section, {
        id: newElementId(),
        type: "action",
        label: "Action",
        href: "#",
        variant: "solid",
        box: defaultBox(section, 160, 48),
      });
    } else if (action === "add-shape") {
      addElementToSection(section, {
        id: newElementId(),
        type: "shape",
        variant: "rect",
        box: defaultBox(section, 120, 120),
      });
    } else if (action === "add-container") {
      addElementToSection(section, {
        id: newElementId(),
        type: "container",
        variant: "flat",
        box: defaultBox(section, 480, 320),
      });
    } else if (action === "add-chart") {
      // Wave 2 #11 — additive chart element creation. Default to a small
      // bar chart with two series across three categories so the Owner has
      // something to edit in the data grid the moment they click +Chart.
      addElementToSection(section, {
        id: newElementId(),
        type: "chart",
        kind: "bar",
        series: [
          { label: "Series A", values: [3, 5, 2] },
          { label: "Series B", values: [4, 1, 6] },
        ],
        categories: ["Jan", "Feb", "Mar"],
        showLegend: true,
        box: defaultBox(section, 480, 320),
      });
    } else if (action === "duplicate-section") {
      const copy = JSON.parse(JSON.stringify(section));
      copy.id = newSectionId();
      copy.name = section.name + " copy";
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
      const prev = page.sections[idx - 1];
      page.sections[idx - 1] = section;
      page.sections[idx] = prev;
      renderAll();
      scheduleSave();
    } else if (action === "move-down") {
      if (idx >= page.sections.length - 1) return;
      const next = page.sections[idx + 1];
      page.sections[idx + 1] = section;
      page.sections[idx] = next;
      renderAll();
      scheduleSave();
    } else if (action === "save-to-library") {
      void saveToLibrary(section);
    } else if (action === "convert-to-symbol") {
      // Wave 3 #14 — "Convert to Symbol": lift the section into a new
      // SymbolMaster on the site, then replace its slot with a symbol-instance
      // element wrapped in a new host section.
      void convertSectionToSymbol(section, idx, page);
    } else if (action === "detach-instance") {
      // Wave 3 #14 — "Detach": inline the master + overrides into the host
      // section, removing the symbol-instance reference.
      void detachInstanceInSection(section, idx, page);
    }
  }

  // -- Save section to library -------------------------------------------

  async function saveToLibrary(section) {
    var name = prompt("Section name for the library:", section.name || "");
    if (name === null) return;
    if (name.trim().length === 0) name = section.name || "Untitled";
    try {
      var saved = await flushPendingSave();
      if (!saved) return;
      setStatus("Saving section to library...", "ok");
      var response = await authFetch(API_BASE + "/library/sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: SITE_ID, sectionId: section.id, name: name.trim() }),
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
    var name = prompt("Template name:", state && state.pages && state.pages[0] ? state.pages[0].title : "");
    if (name === null) return;
    if (name.trim().length === 0) {
      setStatus("Template name is required", "error");
      return;
    }
    var tagline = prompt("One-line description:", "");
    if (tagline === null) tagline = "";
    try {
      var saved = await flushPendingSave();
      if (!saved) return;
      setStatus("Saving as template...", "ok");
      var response = await authFetch(API_BASE + "/custom-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: SITE_ID, name: name.trim(), tagline: tagline.trim() }),
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

  // -- Wire root events ---------------------------------------------------

  function attachRootEvents() {
    root.addEventListener("click", (ev) => {
      if (interactionMode === "pan") return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      var menuTrigger = target.closest("[data-element-menu-trigger]");
      if (menuTrigger) {
        var triggerId = menuTrigger.getAttribute("data-element-menu-trigger");
        var triggerWrapper = menuTrigger.closest(".rev01-element");
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
      const elementNode = target.closest('.rev01-element');
      if (elementNode) {
        const id = elementNode.getAttribute('data-rev01-element');
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
      const sectionNode = target.closest('.rev01-section');
      if (sectionNode) {
        const sid = sectionNode.getAttribute('data-rev01-section');
        if (sid) { selectSection(sid); selectElement(null); }
      }
    });

    document.addEventListener("mousedown", (ev) => {
      if (!selectedElementId) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (inspector && inspector.contains(target)) return;
      if (target.closest('#canvas-reel')) return;
      if (target.closest('.rev01-element')) return;
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
    wrap.className = "rev01-kit-summary";
    if (!mainEl || !state || !state.styleKit) {
      wrap.textContent = "kit: (unknown)";
      return wrap;
    }
    const cs = window.getComputedStyle(mainEl);
    function token(name, fallback) {
      const value = cs.getPropertyValue(name);
      return value && value.trim().length > 0 ? value.trim() : (fallback || "");
    }
    const accent = token("--rev01-kit-accent", "(unset)");
    const display = token("--rev01-kit-font-display", "(unset)");
    const duration = token("--rev01-kit-motion-duration", "(unset)");
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
    const tabButtons = document.querySelectorAll('[data-sidebar-tab]');
    const panels = document.querySelectorAll('[data-sidebar-panel]');
    if (tabButtons.length === 0 || panels.length === 0) return;

    function activate(tabName) {
      tabButtons.forEach((button) => {
        const isActive = button.getAttribute('data-sidebar-tab') === tabName;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        panel.hidden = panel.getAttribute('data-sidebar-panel') !== tabName;
      });
      if (tabName === 'sections') {
        ensureSectionsPanelLoaded();
      }
    }

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activate(button.getAttribute('data-sidebar-tab'));
      });
    });
  }

  // -- Sections picker (cross-template catalog) --------------------------
  // sectionsCatalog: null = unloaded; [] = loaded-empty; [...] = loaded.
  // pendingImport stays null until the Owner clicks "Use" on a card —
  // Task 6 will read it to render drop slots on the canvas.
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
          root.innerHTML = '<p class="rev01-section-picker-empty">Failed to load sections.</p>';
          return;
        }
        const body = await response.json();
        sectionsCatalog = Array.isArray(body && body.sections) ? body.sections : [];
      } catch (err) {
        root.innerHTML = '<p class="rev01-section-picker-empty">Failed to load sections.</p>';
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
      '<div class="rev01-section-picker-controls">' +
        '<input type="search" class="rev01-section-picker-search" placeholder="Search sections" ' +
          'value="' + escapeAttr(activeSearchQuery) + '" data-section-picker-search />' +
        '<select class="rev01-section-picker-filter" data-section-picker-filter>' + filterOptions + '</select>' +
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
        '<li class="rev01-section-card' + (isPending ? ' is-pending' : '') + '">' +
          '<div class="rev01-section-card-head">' +
            '<span class="rev01-section-card-name">' + escapeHtml(entry.name) + '</span>' +
            '<span class="rev01-section-card-recipe">' + escapeHtml(entry.recipeId) + '</span>' +
          '</div>' +
          '<p class="rev01-section-card-preview">' + escapeHtml(entry.headingPreview) + '</p>' +
          '<div class="rev01-section-card-foot">' +
            '<span class="rev01-section-card-template">' + sourceLabel + '</span>' +
            '<button type="button" class="rev01-section-card-use" data-section-card-use ' +
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
      ? '<p class="rev01-section-picker-empty">No sections match.</p>'
      : '<ul class="rev01-section-picker-grid">' + cards + '</ul>';

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
    canvasRoot.querySelectorAll('.rev01-section-slot').forEach((node) => node.remove());

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
      slot.className = 'rev01-section-slot';
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

    // Section nodes carry data-rev01-section (see buildSectionNode); the
    // [data-section-id] attribute is used by toolbar buttons, not the section
    // DOM root.
    const sectionNodes = Array.from(canvasRoot.querySelectorAll('[data-rev01-section]'));
    for (let i = 0; i < sectionNodes.length; i += 1) {
      const node = sectionNodes[i];
      if (node.parentNode) node.parentNode.insertBefore(makeSlot(i), node);
    }
    const lastNode = sectionNodes[sectionNodes.length - 1];
    if (lastNode && lastNode.parentNode) {
      if (lastNode.nextSibling) {
        lastNode.parentNode.insertBefore(makeSlot(sections.length), lastNode.nextSibling);
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
      if (state && !Array.isArray(state.symbols)) state.symbols = [];
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
  }

  // -- Real-time co-edit via Yjs ------------------------------------------
  //
  // The co-edit bundle (window.__rev01CoEdit) is loaded as a separate
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

  function coEditSync() {
    if (coEditConnection && state) {
      coEditConnection.applyLocalState(state);
    }
  }

  function attachCoEdit() {
    if (typeof window.__rev01CoEdit === "undefined" || !window.__rev01CoEdit || typeof window.__rev01CoEdit.connectCoEdit !== "function") {
      return;
    }

    var scheme = location.protocol === "https:" ? "wss:" : "ws:";
    var wsUrl = scheme + "//" + location.host + "/__live?siteId=" + encodeURIComponent(SITE_ID);

    var conn = window.__rev01CoEdit.connectCoEdit(SITE_ID, state, {
      websocketUrl: wsUrl,
    });

    conn.onRemoteState(function(newState) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      state = newState;
      selectedSectionId = null;
      selectedElementId = null;
      editingElementId = null;
      editingSnapshot = null;
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      renderAll();
    });

    conn.onRemotePresence(function(peers) {
      var pill = document.querySelector("[data-rev01-presence]");
      var counter = document.querySelector("[data-rev01-presence-count]");
      if (!pill || !counter) return;
      var count = peers.size + 1;
      if (count > 1) {
        counter.textContent = String(count);
        pill.hidden = false;
      } else {
        pill.hidden = true;
      }
    });

    coEditConnection = conn;
  }

  // -- Publish ------------------------------------------------------------

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
        setStatus("Publish failed: " + detail, "error");
        return;
      }
      const version =
        body && typeof body.version === "number" && Number.isFinite(body.version)
          ? " v" + body.version
          : "";
      setStatus("Published" + version, "ok");
    } catch (err) {
      setStatus("Publish failed: " + (err && err.message ? err.message : String(err)), "error");
    } finally {
      publishButton.disabled = false;
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
    });
    window.addEventListener("keyup", (ev) => {
      if (ev.key === " ") { ev.preventDefault(); endTemporaryPan(); }
    });
    window.addEventListener("blur", endTemporaryPan);
  }

  // -- Wave 3 #14 — Symbols (masters + instances + override UX) ----------
  //
  // The server-side authoritative store is CanvasSiteState.symbols plus the
  // 'symbol-instance' element type. This editor surface is additive: it adds
  // a "Symbols" tab to the sidebar, a "Sym" / "Det" button to every section
  // toolbar, an "Add symbol instance" entry to the Add panel, and a small
  // visual placeholder for symbol-instance elements.
  //
  // All persistence flows through the same PUT /api/canvas/sites/:siteId path
  // the rest of the editor uses — we do NOT call the symbol HTTP router from
  // here for the POC because the pure functions on the canvas state are
  // simpler to drive. The HTTP router exists for cross-process consumers
  // (Wave 4 #16 nav) and standalone agent flows.
  //
  // ----------------------------------------------------------------------

  function newSymbolMasterId() { return "sym-" + uuid(); }

  // Deep-clone an arbitrary canvas section/element/etc. Using JSON because
  // structuredClone is available but the rest of the editor uses this
  // exact idiom (see section duplication around line 3148).
  function deepCloneCanvas(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function findSymbolMaster(symbolId) {
    if (!state || !Array.isArray(state.symbols)) return null;
    for (const s of state.symbols) {
      if (s && s.id === symbolId) return s;
    }
    return null;
  }

  // Locate the symbol-instance element inside a host section. The editor's
  // "Convert to Symbol" treats every section as eligible, but the host
  // section created when an instance is dropped contains exactly ONE
  // symbol-instance element (matching the publish-time render structure).
  function findInstanceElementInSection(section) {
    if (!section || !Array.isArray(section.elements)) return null;
    for (const el of section.elements) {
      if (el && el.type === "symbol-instance") return el;
    }
    return null;
  }

  // Find every page+section+element location of a symbol-instance pointing
  // at the given symbolId. Returns [] when none.
  function findInstancesOfSymbol(symbolId) {
    const hits = [];
    if (!state || !Array.isArray(state.pages)) return hits;
    for (const page of state.pages) {
      if (!page || !Array.isArray(page.sections)) continue;
      for (const section of page.sections) {
        if (!section || !Array.isArray(section.elements)) continue;
        for (const el of section.elements) {
          if (el && el.type === "symbol-instance" && el.symbolId === symbolId) {
            hits.push({ pageId: page.id, sectionId: section.id, elementId: el.id });
          }
        }
      }
    }
    return hits;
  }

  // Visual placeholder for a symbol-instance in the editor. The published
  // renderer does the real master-merge + emit; here we just show a card
  // identifying the symbol and the override count so the Owner has something
  // to interact with at the right slot.
  function buildSymbolInstanceBody(element) {
    const wrapper = document.createElement("div");
    wrapper.className = "rev01-symbol-instance-placeholder";
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "column";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";
    wrapper.style.gap = "8px";
    wrapper.style.padding = "24px";
    wrapper.style.width = "100%";
    wrapper.style.height = "100%";
    wrapper.style.boxSizing = "border-box";
    wrapper.style.border = "2px dashed rgba(255,255,255,0.35)";
    wrapper.style.borderRadius = "12px";
    wrapper.style.background = "rgba(255,255,255,0.04)";
    wrapper.style.color = "rgba(255,255,255,0.85)";
    wrapper.style.font = "12px/1.4 system-ui, sans-serif";
    wrapper.style.pointerEvents = "none";

    const master = findSymbolMaster(element.symbolId);
    const title = document.createElement("strong");
    title.textContent = "Symbol: " + (master ? master.name : "(missing master " + element.symbolId + ")");
    title.style.fontSize = "14px";
    wrapper.appendChild(title);

    const meta = document.createElement("span");
    const overrideCount = element.overrides ? Object.keys(element.overrides).length : 0;
    const elementCount = master && master.section && Array.isArray(master.section.elements)
      ? master.section.elements.length : 0;
    meta.textContent = elementCount + " element" + (elementCount === 1 ? "" : "s")
      + ", " + overrideCount + " override" + (overrideCount === 1 ? "" : "s");
    meta.style.opacity = "0.7";
    wrapper.appendChild(meta);

    if (!master) {
      meta.style.color = "#ff8080";
      meta.textContent = "Master not found — Detach or remove this instance.";
    }

    return wrapper;
  }

  // ---- Convert to Symbol -----------------------------------------------
  //
  // Lift the given section into a new SymbolMaster, then replace the
  // section's page slot with a host section containing ONE symbol-instance
  // element pointing at the master. We prompt for a name; cancel aborts.
  //
  // Refuses if the section already contains a symbol-instance — nested
  // symbols are forbidden by the scope-out. The Owner should detach first.
  async function convertSectionToSymbol(section, idx, page) {
    if (!state) return;
    if (findInstanceElementInSection(section)) {
      setStatus("This section already contains a symbol instance — nested symbols are not supported", "error");
      return;
    }
    if (!Array.isArray(section.elements) || section.elements.length === 0) {
      setStatus("Add at least one element before converting to a Symbol", "error");
      return;
    }

    const name = await openTextModal({
      title: "Convert to Symbol",
      label: "Symbol name",
      defaultValue: section.name || "Symbol",
    });
    if (name === null || name.trim().length === 0) return;

    if (!Array.isArray(state.symbols)) state.symbols = [];

    // The master's section is a DEEP CLONE of the original — masters live
    // independently from any one page slot. The original page slot then
    // becomes a host section wrapping a symbol-instance.
    const masterId = newSymbolMasterId();
    const masterSection = deepCloneCanvas(section);
    state.symbols.push({ id: masterId, name: name.trim(), section: masterSection });

    // Build the host section + instance.
    const instance = {
      id: newElementId(),
      type: "symbol-instance",
      symbolId: masterId,
      overrides: {},
      box: { x: 0, y: 0, w: page.width, h: section.height, z: 1 },
    };
    const host = {
      id: newSectionId(),
      recipeId: section.recipeId,
      name: section.name + " (instance)",
      height: section.height,
      elements: [instance],
    };
    page.sections.splice(idx, 1, host);

    selectedSectionId = host.id;
    selectedElementId = instance.id;
    renderAll();
    renderSymbolsPanelIfMounted();
    scheduleSave();
    setStatus("Converted to Symbol: " + name.trim(), "ok");
  }

  // ---- Detach instance -------------------------------------------------
  //
  // Reverse of "Convert to Symbol" for one instance: replace the host section
  // with a fresh CanvasSection whose content is the master + overrides applied.
  // The master itself is unchanged. All ids in the new section are regenerated
  // so subsequent detaches of OTHER instances of the same symbol don't collide.
  async function detachInstanceInSection(section, idx, page) {
    if (!state) return;
    const instance = findInstanceElementInSection(section);
    if (!instance) {
      setStatus("No symbol instance to detach in this section", "error");
      return;
    }
    const master = findSymbolMaster(instance.symbolId);
    if (!master) {
      setStatus("Master not found for symbol " + instance.symbolId, "error");
      return;
    }

    // Mirror src/symbols/merge.ts MERGE PRECEDENCE rule (Wave 3 contract).
    // Deep-clone master, then apply each override via Object.assign on the
    // matching inner element. Strip 'type'/'id' from overrides defensively.
    const detached = deepCloneCanvas(master.section);
    detached.id = newSectionId();
    for (let i = 0; i < detached.elements.length; i++) {
      const inner = detached.elements[i];
      if (!inner) continue;
      const patch = instance.overrides && instance.overrides[inner.id];
      if (patch && typeof patch === "object") {
        const safe = Object.assign({}, patch);
        delete safe.type;
        delete safe.id;
        Object.assign(inner, safe);
      }
      inner.id = newElementId();
    }

    page.sections.splice(idx, 1, detached);
    selectedSectionId = detached.id;
    selectedElementId = null;
    renderAll();
    renderSymbolsPanelIfMounted();
    scheduleSave();
    setStatus("Detached instance of: " + master.name, "ok");
  }

  // ---- Add symbol instance from sidebar --------------------------------
  //
  // Wraps a fresh symbol-instance in a new host section. The Owner is asked
  // to pick a master; cancel aborts. Refuses when the site has no masters
  // yet (the right next move is "Convert to Symbol" on an existing section).
  async function addSymbolInstanceFromSidebar() {
    if (!state) return;
    const symbols = Array.isArray(state.symbols) ? state.symbols : [];
    if (symbols.length === 0) {
      setStatus("No Symbols yet — convert a section first", "error");
      return;
    }
    const choice = await openSelectModal({
      title: "Add symbol instance",
      label: "Symbol",
      options: symbols.map((s) => ({ value: s.id, label: s.name })),
      okLabel: "Add",
    });
    if (choice === null) return;

    const page = currentPage();
    if (!page) return;
    const master = findSymbolMaster(choice);
    if (!master) {
      setStatus("Master not found: " + choice, "error");
      return;
    }
    const height = (master.section && typeof master.section.height === "number") ? master.section.height : 320;
    const instance = {
      id: newElementId(),
      type: "symbol-instance",
      symbolId: choice,
      overrides: {},
      box: { x: 0, y: 0, w: page.width, h: height, z: 1 },
    };
    const host = {
      id: newSectionId(),
      recipeId: master.section.recipeId || "cta-band",
      name: master.name + " (instance)",
      height,
      elements: [instance],
    };

    const selectedIndex = selectedSectionId
      ? page.sections.findIndex((s) => s.id === selectedSectionId)
      : -1;
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : page.sections.length;
    page.sections.splice(insertAt, 0, host);
    selectedSectionId = host.id;
    selectedElementId = instance.id;
    renderAll();
    scheduleSave();
    setStatus("Added instance of " + master.name, "ok");
  }

  // ---- Symbols sidebar panel ------------------------------------------
  //
  // Dynamically injected (the page shell in canvas-index.tsx is frozen for
  // this wave). We add a "Symbols" tab button next to "Add" / "Sections", a
  // panel listing every master with rename / delete / detach-all-and-delete
  // actions, and the "Add symbol instance" sidebar command.

  function ensureSymbolsTabMounted() {
    return null;
    if (!sidebar) return null;
    const tabsRow = sidebar.querySelector(".rev01-sidebar-tabs");
    if (!tabsRow) return null;
    if (sidebar.querySelector('[data-sidebar-tab="symbols"]')) {
      return sidebar.querySelector('[data-sidebar-panel="symbols"]');
    }

    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.setAttribute("role", "tab");
    tabButton.setAttribute("aria-selected", "false");
    tabButton.setAttribute("data-sidebar-tab", "symbols");
    tabButton.textContent = "Symbols";
    tabsRow.appendChild(tabButton);

    const panel = document.createElement("div");
    panel.className = "rev01-sidebar-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-label", "Symbols");
    panel.setAttribute("data-sidebar-panel", "symbols");
    panel.hidden = true;
    sidebar.appendChild(panel);

    // Wire tab activation manually — attachSidebarTabs() in the existing
    // boot path queried the tab buttons once at boot, so a newly-added tab
    // misses the listener. We replicate the activate() behaviour locally.
    tabButton.addEventListener("click", () => {
      activateSidebarTab("symbols");
    });

    return panel;
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
    if (tabName === "symbols") {
      renderSymbolsPanel();
    }
    if (tabName === "versions") {
      renderVersionsPanel();
    }
  }

  function renderSymbolsPanelIfMounted() {
    if (!sidebar) return;
    const panel = sidebar.querySelector('[data-sidebar-panel="symbols"]');
    if (panel && !panel.hidden) renderSymbolsPanel();
  }

  function renderSymbolsPanel() {
    const panel = ensureSymbolsTabMounted();
    if (!panel) return;
    panel.replaceChildren();

    const group = document.createElement("section");
    group.className = "rev01-sidebar-group";
    const heading = document.createElement("h2");
    heading.textContent = "Symbols";
    group.appendChild(heading);

    const symbols = state && Array.isArray(state.symbols) ? state.symbols : [];
    if (symbols.length === 0) {
      const empty = document.createElement("p");
      empty.style.opacity = "0.7";
      empty.textContent = "No Symbols yet. Use Sym on a section to create one.";
      group.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.style.listStyle = "none";
      list.style.margin = "0";
      list.style.padding = "0";
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "8px";
      for (const sym of symbols) {
        list.appendChild(buildSymbolListItem(sym));
      }
      group.appendChild(list);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "rev01-sidebar-command";
    addBtn.textContent = "Add symbol instance";
    addBtn.addEventListener("click", () => { void addSymbolInstanceFromSidebar(); });
    group.appendChild(addBtn);

    panel.appendChild(group);
  }

  function buildSymbolListItem(sym) {
    const li = document.createElement("li");
    li.style.padding = "10px";
    li.style.border = "1px solid rgba(255,255,255,0.12)";
    li.style.borderRadius = "8px";
    li.style.display = "flex";
    li.style.flexDirection = "column";
    li.style.gap = "8px";

    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.justifyContent = "space-between";
    head.style.gap = "8px";
    const nameEl = document.createElement("strong");
    nameEl.textContent = sym.name;
    head.appendChild(nameEl);
    const count = findInstancesOfSymbol(sym.id).length;
    const countEl = document.createElement("span");
    countEl.style.opacity = "0.7";
    countEl.style.fontSize = "11px";
    countEl.textContent = count + " instance" + (count === 1 ? "" : "s");
    head.appendChild(countEl);
    li.appendChild(head);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", () => { void renameSymbolPrompt(sym.id); });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.classList.add("danger");
    deleteBtn.addEventListener("click", () => { void deleteSymbolMasterPrompt(sym.id); });
    actions.appendChild(deleteBtn);

    li.appendChild(actions);
    return li;
  }

  async function renameSymbolPrompt(symbolId) {
    const sym = findSymbolMaster(symbolId);
    if (!sym) return;
    const next = await openTextModal({
      title: "Rename Symbol",
      label: "Symbol name",
      defaultValue: sym.name,
    });
    if (next === null || next.trim().length === 0) return;
    sym.name = next.trim();
    renderAll();
    renderSymbolsPanelIfMounted();
    scheduleSave();
    setStatus("Renamed", "ok");
  }

  async function deleteSymbolMasterPrompt(symbolId) {
    if (!state || !Array.isArray(state.symbols)) return;
    const sym = findSymbolMaster(symbolId);
    if (!sym) return;
    const locations = findInstancesOfSymbol(symbolId);
    if (locations.length > 0) {
      // Refuse-and-offer-escape: the Owner must explicitly confirm
      // "Detach all & delete" before we collapse instances to copies.
      const confirmed = await openSelectModal({
        title: "Delete “" + sym.name + "”",
        label: locations.length + " instance" + (locations.length === 1 ? "" : "s") + " reference this symbol",
        options: [
          { value: "cancel", label: "Cancel" },
          { value: "detach", label: "Detach all instances to copies, then delete" },
        ],
        okLabel: "Continue",
      });
      if (confirmed !== "detach") return;
      // Detach every instance site-wide (single-page POC = single page, but
      // we still walk pages defensively).
      for (const loc of locations) {
        const page = state.pages.find((p) => p.id === loc.pageId);
        if (!page) continue;
        const sectionIdx = page.sections.findIndex((s) => s.id === loc.sectionId);
        if (sectionIdx < 0) continue;
        const section = page.sections[sectionIdx];
        await detachInstanceInSection(section, sectionIdx, page);
      }
    }
    // Remove the master.
    const idx = state.symbols.findIndex((s) => s.id === symbolId);
    if (idx >= 0) state.symbols.splice(idx, 1);
    renderAll();
    renderSymbolsPanelIfMounted();
    scheduleSave();
    setStatus("Deleted symbol: " + sym.name, "ok");
  }

  // -- Version History sidebar tab -----------------------------------------

  var versionsLoaded = false;
  var versionsList = [];

  function ensureVersionsTabMounted() {
    if (!sidebar) return null;
    var tabsRow = sidebar.querySelector(".rev01-sidebar-tabs");
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
    panel.className = "rev01-sidebar-panel";
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
    group.className = "rev01-sidebar-group";

    var heading = document.createElement("h2");
    heading.textContent = "Version History";
    group.appendChild(heading);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "rev01-sidebar-command";
    saveBtn.textContent = "Save snapshot";
    saveBtn.style.marginBottom = "12px";
    saveBtn.addEventListener("click", function() {
      var label = prompt("Snapshot label:");
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
        restoreBtn.addEventListener("click", function() {
          if (!confirm("Restore to this version? Current state will be saved as a snapshot first.")) return;
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
        li.appendChild(restoreBtn);

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
      state = body.editableState;
      if (state && !Array.isArray(state.symbols)) state.symbols = [];
      initUndo();
      if (mainEl && state && state.styleKit) {
        mainEl.setAttribute("data-style-kit", state.styleKit);
      }
      // Mount the viewport BEFORE the first render so #canvas-root is in its
      // final DOM position when sections render in. The transform set by
      // applyZoom() then persists across subsequent renderAll() calls (which
      // only mutate root's children).
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
      var sidebarToggle = document.getElementById("sidebar-toggle");
      if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener("click", function() {
          var collapsed = sidebar.classList.toggle("collapsed");
          sidebarToggle.textContent = collapsed ? "›" : "‹";
          if (viewport) viewport.classList.toggle("sidebar-collapsed", collapsed);
        });
      }
      // Wave 3 #14 — inject the "Components" tab dynamically because the
      // canvas-index.tsx shell is frozen for this wave. The tab + panel
      // mount immediately so the Owner can click into it; the panel's
      // contents render lazily on first activation.
      ensureSymbolsTabMounted();
      ensureVersionsTabMounted();
      attachSidebarActions();
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
    } catch (err) {
      setStatus("Failed to load site: " + (err && err.message ? err.message : String(err)), "error");
    }
  })();
})();`;
}
