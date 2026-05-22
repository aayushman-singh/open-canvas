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
  const SAFE_CSS_KEYS = ["color", "background", "borderColor"];

  // Shared editor state.
  let state = null;
  let selectedSectionId = null;
  let selectedElementId = null;
  let saveTimer = null;
  let statusTimer = null;
  let editingElementId = null;
  let editingSnapshot = null;

  const root = document.getElementById("canvas-root");
  const inspector = document.getElementById("canvas-inspector");
  const statusEl = document.getElementById("canvas-status");
  const mainEl = document.querySelector("main.rev01-editor");
  const saveButton = document.getElementById("canvas-save");

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

  function buildTextBody(element) {
    const tag = element.role === "heading" ? "h1" : element.role === "body" ? "p" : "span";
    const node = document.createElement(tag);
    node.className = "rev01-text";
    node.setAttribute("data-role", element.role);
    node.style.fontSize = element.fontSize + "px";
    node.style.fontWeight = String(element.fontWeight);
    node.style.textAlign = element.align;
    node.style.margin = "0";
    node.textContent = element.text;
    return node;
  }

  function buildMediaBody(element) {
    const node = document.createElement("div");
    node.className = "rev01-media";
    node.setAttribute("data-rev01-media-kind", element.mediaKind);
    node.textContent = element.mediaKind === "image" ? "[image]" : "[video]";
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
    const { element } = found;
    inspector.replaceChildren();

    const heading = document.createElement("h3");
    heading.textContent = element.type + " element";
    inspector.appendChild(heading);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "id: " + element.id;
    inspector.appendChild(meta);

    if (element.type === "text") {
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

  function beginTextEdit(elementId) {
    const found = findElement(elementId);
    if (!found || found.element.type !== "text") return;
    const wrapper = root.querySelector('[data-rev01-element="' + cssEscape(elementId) + '"]');
    if (!wrapper) return;
    const inner = wrapper.querySelector(".rev01-text");
    if (!inner) return;
    editingElementId = elementId;
    editingSnapshot = found.element.text;
    inner.setAttribute("contenteditable", "true");
    inner.focus();
    const range = document.createRange();
    range.selectNodeContents(inner);
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }

    function finish(commit) {
      inner.removeAttribute("contenteditable");
      const next = inner.textContent || "";
      inner.removeEventListener("blur", onBlur);
      inner.removeEventListener("keydown", onKey);
      editingElementId = null;
      const snapshot = editingSnapshot;
      editingSnapshot = null;
      if (commit && next.length > 0 && next !== snapshot) {
        found.element.text = next;
        scheduleSave();
      } else if (commit && next.length === 0) {
        found.element.text = snapshot;
        inner.textContent = snapshot;
        setStatus("Text can't be empty", "error");
      } else if (!commit) {
        found.element.text = snapshot;
        inner.textContent = snapshot;
      }
    }
    function onBlur() { finish(true); }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); finish(false); inner.blur(); }
    }
    inner.addEventListener("blur", onBlur);
    inner.addEventListener("keydown", onKey);
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
    const startX = startEv.clientX;
    const startY = startEv.clientY;
    const originalBox = Object.assign({}, found.element.box);
    const page = currentPage();
    const pageWidth = page ? page.width : 1440;
    const sectionHeight = found.section.height;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
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
    const startX = startEv.clientX;
    const startY = startEv.clientY;
    const originalBox = Object.assign({}, found.element.box);
    const page = currentPage();
    const pageWidth = page ? page.width : 1440;
    const sectionHeight = found.section.height;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
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
        text: "New text",
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
