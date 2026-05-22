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
}

const SITE_ID_RE = /^[A-Za-z0-9-]+$/;

export function canvasClientScript(params: CanvasClientScriptParams): string {
  const { siteId } = params;
  if (typeof siteId !== 'string' || !SITE_ID_RE.test(siteId)) {
    throw new Error(
      `canvasClientScript: siteId must match /^[A-Za-z0-9-]+$/ (got ${JSON.stringify(siteId)})`,
    );
  }

  // The single safe interpolation. Everything else inside the IIFE is plain JS.
  return `(() => {
  const SITE_ID = ${JSON.stringify(siteId)};
  const SITE_BASE = "/api/canvas/sites/" + SITE_ID;

  const STYLE_KITS = ["charcoal", "orange-editorial", "blue-saas", "green-organic"];
  const ACTION_VARIANTS = ["solid", "outline", "ghost", "pill", "glass", "brutalist", "underline"];
  const SURFACE_VARIANTS = ["flat", "raised", "glass", "outlined", "sticker", "editorial-frame", "soft-panel"];
  const SHAPE_VARIANTS = ["rect", "pill", "circle", "line", "badge", "blob"];
  const MOTION_PRESETS = ["none", "fade-up", "slide-left", "scale-in", "blur-in", "stagger-children", "slow-drift", "parallax-soft"];
  const INLINE_MARK_TYPES = ["bold", "italic", "underline", "strike", "code", "highlight", "link"];
  const SAFE_CSS_KEYS = ["color", "background", "borderColor"];

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
  const saveButton = document.getElementById("canvas-save");

  // -- Viewport + zoom ---------------------------------------------------
  // The route ships #canvas-root directly inside the grid. We wrap it in a
  // .rev01-viewport at boot so the viewport gets the scroll + dark
  // background + grid placement, while #canvas-root receives the CSS
  // transform that implements zoom. The wrap is purely client-side so the
  // route shell stays untouched.
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
    // Build the zoom toolbar inside the viewport so it sticks to the top-left.
    zoomToolbar = document.createElement("div");
    zoomToolbar.className = "rev01-zoom-toolbar";
    zoomToolbar.setAttribute("role", "toolbar");
    zoomToolbar.setAttribute("aria-label", "Zoom");
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
    // Insert the toolbar BEFORE #canvas-root so it sits above the page.
    viewport.insertBefore(zoomToolbar, root);
    zoomToolbar.addEventListener("click", (ev) => {
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

  async function saveStateNow() {
    if (!state) return;
    setStatus("Saving…");
    try {
      const response = await fetch(SITE_BASE, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editableState: state }),
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
        return;
      }
      setStatus("Saved", "ok");
    } catch (err) {
      setStatus("Save failed: " + (err && err.message ? err.message : String(err)), "error");
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveStateNow();
    }, 500);
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

  function buildElementBody(element) {
    switch (element.type) {
      case "text": return buildTextBody(element);
      case "media": return buildMediaBody(element);
      case "action": return buildActionBody(element);
      case "shape": return buildShapeBody(element);
      case "container": return buildContainerBody(element);
    }
    const fallback = document.createElement("div");
    return fallback;
  }

  function buildElementNode(element) {
    const wrapper = document.createElement("div");
    wrapper.className = "rev01-element";
    wrapper.setAttribute("data-rev01-element", element.id);
    wrapper.setAttribute("data-element-type", element.type);
    if (element.motion) {
      wrapper.setAttribute("data-motion-preset", element.motion.preset);
      wrapper.setAttribute("data-motion-delay-ms", String(element.motion.delayMs || 0));
    }
    setBoxStyle(wrapper, element.box);
    applyPinnedStyle(wrapper, element);
    wrapper.appendChild(buildElementBody(element));
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.setAttribute("data-resize-handle", "true");
    wrapper.appendChild(handle);
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
    const buttons = [
      { label: "+T", action: "add-text" },
      { label: "+Img", action: "add-image" },
      { label: "+Vid", action: "add-video" },
      { label: "+Btn", action: "add-action" },
      { label: "+\u25c7", action: "add-shape" },
      { label: "+\u25a1", action: "add-container" },
      { label: "Dup", action: "duplicate-section" },
      { label: "\u2191", action: "move-up" },
      { label: "\u2193", action: "move-down" },
      { label: "Del", action: "delete-section", danger: true },
    ];
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

  function renderInspector() {
    if (!inspector) return;
    if (!selectedElementId) {
      inspector.hidden = true;
      inspector.replaceChildren();
      return;
    }
    const found = findElement(selectedElementId);
    if (!found) {
      inspector.hidden = true;
      inspector.replaceChildren();
      return;
    }
    inspector.hidden = false;
    const { element, section } = found;
    inspector.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = element.type + " element";
    inspector.appendChild(heading);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "id: " + element.id;
    inspector.appendChild(meta);

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

      appendPinnedColor(element);
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

      // Upload control — separate input for image vs video mediaKinds so the
      // file picker filters appropriately. POST to the owner upload route as
      // a base64 data URL; on success, update the element's assetId / kind /
      // alt from the response and re-render.
      appendMediaUploader(element);

      const fit = selectInput(["cover", "contain"], element.fit);
      fit.addEventListener("change", () => {
        element.fit = fit.value;
        rebuildElement(element.id);
        scheduleSave();
      });
      inspector.appendChild(field("Fit", fit));

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
  // Reads a File via FileReader.readAsDataURL, POSTs to the owner asset
  // upload route, and updates the selected media element with the freshly
  // generated assetId. Uses an alt-text input so the Owner sets accessible
  // text at upload time. The control is rendered inside the inspector for
  // the currently selected media element; it lives there because uploads
  // are scoped to the element being replaced.
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string") resolve(result);
        else reject(new Error("FileReader did not return a string"));
      };
      reader.onerror = () => reject(reader.error || new Error("FileReader error"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadMediaForElement(element, file) {
    setStatus("Uploading…");
    let dataUrl;
    try {
      dataUrl = await fileToDataUrl(file);
    } catch (err) {
      setStatus("Upload failed: " + (err && err.message ? err.message : String(err)), "error");
      return;
    }
    const altInputId = "media-upload-alt-" + element.id;
    const altInput = document.getElementById(altInputId);
    const altValue =
      altInput && typeof altInput.value === "string" ? altInput.value : (element.alt || "");
    try {
      const response = await fetch(SITE_BASE + "/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl, alt: altValue }),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* ignore */ }
        setStatus("Upload failed: " + detail, "error");
        return;
      }
      const body = await response.json();
      if (!body || typeof body.assetId !== "string" || typeof body.kind !== "string") {
        setStatus("Upload failed: malformed server response", "error");
        return;
      }
      element.assetId = body.assetId;
      element.mediaKind = body.kind;
      element.alt = altValue;
      rebuildElement(element.id);
      renderInspector();
      scheduleSave();
      setStatus("Uploaded", "ok");
    } catch (err) {
      setStatus("Upload failed: " + (err && err.message ? err.message : String(err)), "error");
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

  function appendPinnedColor(element) {
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
    inspector.appendChild(wrap);
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
      const next = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
      if (next) next.setAttribute("data-selected", "true");
      const found = findElement(elementId);
      if (found) selectSection(found.section.id);
    }
    renderInspector();
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
          marks.push({ type: "link", href: cur.getAttribute("href") || "" });
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
      if (a[i].type === "link" && a[i].href !== b[i].href) return false;
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
          const reason = "href \"" + mark.href + "\" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)";
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

  // -- Inline mark toolbar ------------------------------------------------

  function removeMarkToolbar() {
    if (markToolbar && markToolbar.parentNode) {
      markToolbar.parentNode.removeChild(markToolbar);
    }
    markToolbar = null;
  }

  function positionMarkToolbar(anchor) {
    if (!markToolbar || !anchor || !viewport) return;
    // Anchor + viewport rects are both in viewport (post-transform) screen
    // space, so subtracting them gives the anchor's offset inside the
    // viewport. Adding scroll converts to the viewport's internal
    // coordinate space, which is what "position: absolute" inside the
    // viewport uses. The toolbar lives in unscaled DOM (the transform is
    // on #canvas-root, not the viewport), so we anchor it 44px above the
    // element's CURRENT screen-space top edge.
    const rect = anchor.getBoundingClientRect();
    const vpRect = viewport.getBoundingClientRect();
    const top = rect.top - vpRect.top + viewport.scrollTop - 44;
    const left = rect.left - vpRect.left + viewport.scrollLeft;
    markToolbar.style.position = "absolute";
    markToolbar.style.top = Math.max(0, top) + "px";
    markToolbar.style.left = Math.max(0, left) + "px";
  }

  function applyExecCommand(command) {
    // execCommand is deprecated but it is by far the simplest way to apply
    // bold/italic/underline/strike to the current Selection inside a
    // contenteditable. Once browsers drop it we will rewrite this with the
    // Range APIs. For the POC we lean on it.
    document.execCommand(command, false, "");
  }

  function wrapSelectionWith(tagName) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const el = document.createElement(tagName);
    try {
      range.surroundContents(el);
    } catch (_) {
      // surroundContents throws if the Range crosses an element boundary.
      // Fall back to insertHTML with a stringified fragment so the Owner
      // doesn't lose the action.
      const fragment = range.extractContents();
      el.appendChild(fragment);
      range.insertNode(el);
    }
    sel.removeAllRanges();
    const next = document.createRange();
    next.selectNode(el);
    sel.addRange(next);
  }

  function promptForLinkHref(current) {
    const initial = typeof current === "string" ? current : "https://";
    const raw = window.prompt("Link URL", initial);
    if (raw === null) return null; // cancelled
    const href = raw.trim();
    if (href.length === 0) return null;
    if (!isAllowedHref(href)) {
      setStatus("Link rejected: " + href + " is not http/https/mailto/tel/anchor/relative", "error");
      return null;
    }
    return href;
  }

  function applyLinkMark() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      setStatus("Select some text first to add a link", "error");
      return;
    }
    const href = promptForLinkHref("");
    if (href === null) return;
    const a = document.createElement("a");
    a.className = "rev01-inline-link";
    a.setAttribute("href", href);
    try {
      range.surroundContents(a);
    } catch (_) {
      const fragment = range.extractContents();
      a.appendChild(fragment);
      range.insertNode(a);
    }
    sel.removeAllRanges();
    const next = document.createRange();
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
    if (type === "link") return applyLinkMark();
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
    // Append to the viewport (unscaled coord space) instead of #canvas-root
    // (which is now CSS-transformed by zoom). Keeping the toolbar in
    // unscaled space means its hit area matches what the Owner sees.
    if (viewport) viewport.appendChild(bar);
    else root.appendChild(bar);
    positionMarkToolbar(anchor);
  }

  function beginTextEdit(elementId) {
    const found = findElement(elementId);
    if (!found || found.element.type !== "text") return;
    const wrapper = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
    if (!wrapper) return;
    const inner = wrapper.querySelector(".rev01-text");
    if (!inner) return;
    editingElementId = elementId;
    // Deep-clone the pre-edit content so Escape/Cancel can restore exactly.
    editingSnapshot = JSON.parse(JSON.stringify(found.element.content || []));
    inner.setAttribute("contenteditable", "true");
    inner.focus();
    const range = document.createRange();
    range.selectNodeContents(inner);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }

    buildMarkToolbar(wrapper);

    function restoreFromSnapshot() {
      found.element.content = JSON.parse(JSON.stringify(editingSnapshot));
      rebuildElement(elementId);
    }

    function finish(commit) {
      inner.removeAttribute("contenteditable");
      inner.removeEventListener("blur", onBlur);
      inner.removeEventListener("keydown", onKey);
      removeMarkToolbar();
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
      return "Rewrite text " + op.elementId + ": \"" + shortened + "\"";
    }
    if (op.kind === "replaceMedia") {
      return "Replace media " + op.elementId + " with asset " + op.assetId + " (" + op.mediaKind + ")";
    }
    if (op.kind === "insertSection") {
      const after = op.afterSectionId ? " after " + op.afterSectionId : " at end";
      const brief = op.input && typeof op.input.brief === "string" ? op.input.brief : "";
      return "Insert section recipe=" + op.recipeId + after + (brief.length > 0 ? " — \"" + brief + "\"" : "");
    }
    return "Unknown op";
  }

  async function applyPreview(ops) {
    try {
      const response = await fetch("/api/canvas-agent/sites/" + SITE_ID + "/apply", {
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
        return;
      }
      const body = await response.json();
      if (!body || typeof body !== "object" || !body.editableState) {
        setStatus("Apply failed: malformed server response", "error");
        return;
      }
      state = body.editableState;
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
    setStatus("Asking the assistant…");
    try {
      const response = await fetch("/api/canvas-agent/sites/" + SITE_ID + "/preview", {
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

  function aiRewriteText(elementId) {
    if (aiBusy) return;
    const brief = window.prompt(
      "What should this text say? (free text — the assistant rewrites the run array)",
      "",
    );
    if (brief === null || brief.trim().length === 0) return;
    const prompt =
      "Rewrite the text element with id=" + elementId + " using the rewriteText tool. " +
      "Owner brief: " + brief;
    runAiPreview(prompt);
  }

  function aiReplaceMedia(elementId) {
    if (aiBusy) return;
    const brief = window.prompt(
      "Describe the replacement asset. The assistant picks from already-uploaded site assets.",
      "",
    );
    if (brief === null || brief.trim().length === 0) return;
    const prompt =
      "Replace the media element with id=" + elementId +
      " by calling replaceMedia with an asset id that already exists on this site. " +
      "Owner brief: " + brief;
    runAiPreview(prompt);
  }

  function aiCreateSection(afterSectionId) {
    if (aiBusy) return;
    const recipeListing = SECTION_RECIPE_IDS.join(", ");
    const recipeId = window.prompt(
      "Which section recipe? Choose one of: " + recipeListing,
      "feature-grid",
    );
    if (recipeId === null) return;
    const normalised = recipeId.trim();
    if (SECTION_RECIPE_IDS.indexOf(normalised) < 0) {
      setStatus("Unknown recipe id: " + normalised, "error");
      return;
    }
    const brief = window.prompt(
      "Section brief — what should the new " + normalised + " say?",
      "",
    );
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
      const handle = ev.target instanceof Element ? ev.target.closest('[data-resize-handle]') : null;
      if (handle) {
        const wrapper = handle.closest('.rev01-element');
        if (wrapper) { beginResize(ev, wrapper); ev.preventDefault(); }
        return;
      }
      const wrapper = ev.target instanceof Element ? ev.target.closest('.rev01-element') : null;
      if (!wrapper) return;
      const elementId = wrapper.getAttribute('data-rev01-element');
      if (!elementId) return;
      if (editingElementId === elementId) return;
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

  function beginResize(startEv, wrapper) {
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
      let nw = originalBox.w + dx;
      let nh = originalBox.h + dy;
      if (nw < 24) nw = 24;
      if (nh < 24) nh = 24;
      if (originalBox.x + nw > pageWidth) nw = pageWidth - originalBox.x;
      if (originalBox.y + nh > sectionHeight) nh = sectionHeight - originalBox.y;
      wrapper.style.width = nw + "px";
      wrapper.style.height = nh + "px";
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
    }
  }

  // -- Wire root events ---------------------------------------------------

  function attachRootEvents() {
    root.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
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
        if (id && id !== selectedElementId) selectElement(id);
        return;
      }
      const sectionNode = target.closest('.rev01-section');
      if (sectionNode) {
        const sid = sectionNode.getAttribute('data-rev01-section');
        if (sid) { selectSection(sid); selectElement(null); }
      }
    });

    root.addEventListener("dblclick", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      const elementNode = target.closest('.rev01-element');
      if (!elementNode) return;
      const id = elementNode.getAttribute('data-rev01-element');
      if (!id) return;
      const found = findElement(id);
      if (!found) return;
      if (found.element.type === "text") {
        selectElement(id);
        beginTextEdit(id);
      }
    });
  }

  // -- Style kit ----------------------------------------------------------

  function attachStyleKitButtons() {
    const buttons = document.querySelectorAll('[data-style-kit]');
    buttons.forEach((button) => {
      button.addEventListener("click", async () => {
        const kit = button.getAttribute('data-style-kit');
        if (!kit || STYLE_KITS.indexOf(kit) < 0) return;
        try {
          const response = await fetch(SITE_BASE + "/style-kit", {
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
          buttons.forEach((b) => {
            const isActive = b.getAttribute('data-style-kit') === kit;
            b.classList.toggle("active", isActive);
            b.setAttribute("aria-pressed", isActive ? "true" : "false");
          });
          setStatus("Style kit: " + kit, "ok");
        } catch (err) {
          setStatus("Style kit change failed", "error");
        }
      });
    });
  }

  // -- Save & keyboard ----------------------------------------------------

  function attachSaveButton() {
    if (saveButton) {
      saveButton.addEventListener("click", () => {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveStateNow();
      });
    }
    window.addEventListener("keydown", (ev) => {
      const isSave = (ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S");
      if (isSave) {
        ev.preventDefault();
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        saveStateNow();
      }
    });
  }

  // -- Boot ---------------------------------------------------------------

  (async () => {
    try {
      const response = await fetch(SITE_BASE);
      if (!response.ok) {
        setStatus("Failed to load site (" + response.status + ")", "error");
        return;
      }
      const body = await response.json();
      state = body.editableState;
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
      attachStyleKitButtons();
      attachSaveButton();
      setStatus("Ready", "ok");
    } catch (err) {
      setStatus("Failed to load site: " + (err && err.message ? err.message : String(err)), "error");
    }
  })();
})();`;
}
