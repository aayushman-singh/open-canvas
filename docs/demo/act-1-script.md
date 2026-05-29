# Act 1 — Product Demo

> **Runtime target:** ~90 minutes. **Persona:** Maya, indie founder rebranding the Apogee template into her launch site "Briar." **Voice:** host-narrator throughout (you, as developer-of-record, narrating Maya's behaviour). **Format:** pre-baked screen actions, studio voiceover synced in post.

## How to read this script

Each **Session** or **Interlude** opens with a banner:

- **Runtime** — target length on the timeline
- **Features driven** — coverage commitment (cross-referenced to `feature-coverage.md`)
- **Pre-record state** — what the editor / dashboard / fixture must look like BEFORE you start recording this beat
- **Outcome** — the state the editor / site is in when the beat ends (the pre-record state of the next beat)

Then the script body. Two columns: **VOICEOVER** (what the host says) and **ON-SCREEN ACTION** (what the camera shows + the keystrokes/clicks performed). Each row is one beat of typically 3–15 seconds.

**Diction guide:** keep voiceover conversational, not formal. Cut to one sentence per row most of the time. Where the voice trails or pauses, write `…` rather than dragging it out. Where a line is a host aside (not narrating Maya), prefix with `// ASIDE:`. Where a line is a callout to something that gets explained in Act 2, prefix with `// ACT 2 →`.

**Reuse rules:** every beat is recordable in isolation against a pre-record state. If a beat depends on something visible from an earlier beat, name the earlier beat in the pre-record block. Don't assume continuity in post.

---

## Beat index

| Beat | Title | Runtime | Features driven |
|---|---|---|---|
| [S0](#session-0--cold-open) | Cold open: landing page hero | 0:30 | §37 Landing |
| [S1](#session-1--sign-up--profile--template-pick) | Sign-up, profile, template pick | 4:00 | §35 Clerk, §36 Profile + site grid + template gallery, §4 Apogee pick |
| [S2](#session-2--editor-tour--ai-rebrand) | Editor tour + AI Chat rebrand + AI Chat refinement | 12:00 | §1 Editor full surface, §8 + §9 AI Chat (one surface, both batches and multi-turn), §1 Rich text |
| [S3](#session-3--style-kit--assets--custom-font) | Style kit cycling, asset upload, AI image gen, custom font | 6:00 | §3 Style Kits, §1 element style controls, §12 Owner Assets + AI image gen, §39 Slot history, §13 Custom fonts |
| [S4](#session-4--multi-page-deep-dive) | Multi-page deep dive — add/delete pages, SEO, locale, 404 toggle | 6:00 | §6 Multi-page, §22 SEO + locale, §1 custom 404 + rename protection |
| [S5](#session-5--element-by-element-exercise) | Every element type, every variant axis, sections + popups + motion | 18:00 | §2 all 14, §40 16 motion presets, 6 bgEffects + bg video + 3 popup triggers, §28 interactives, §29 embeds, §30 charts, §31 code, §32 collections (+add/inspector/nested), §1 section roles + film reel + element rotation/opacity |
| [S6](#session-6--responsive--library--custom-template) | Responsive breakpoints, library save, custom template save | 5:00 | §7 Responsive, §15 Library, §16 Custom templates |
| [I1](#interlude-1--sam-joins-as-collaborator) | Sam accepts collaborator invite, co-edits live | 1:30 | §11 Invites, §38 Email, §35 edit-token, §10 Yjs CRDT + presence |
| [S7](#session-7--a11y-audit--first-publish) | A11y audit, fix issues, first publish | 7:00 | §26 A11y, §5 Publish, §17 snapshot, §23 OG render, §25 search rebuild |
| [I2](#interlude-2--visitor-first-visit) | Visitor opens the published site, submits the form | 2:00 | §5 Visitor view, §27 Light/dark, §19 Form submit (Turnstile), §24 Sitemap/robots, §25 Search, §1 custom 404 |
| [S8](#session-8--forms-inbox--owner-notification) | Forms inbox, CSV export, owner notification email | 3:00 | §19 Inbox + CSV + Resend owner notif |
| [I3](#interlude-3--site-import-gloss) | Site Import — brief mention only (POC disabled) | 0:30 | §18 (gloss) |
| [I4](#interlude-4--doha-pop-up-rtli18n) | Maya adds an Arabic page for a Doha launch event | 1:00 | §22 locale picker, RTL direction + mirror, BCP-47 |
| [S9](#session-9--custom-domain--on-site-editing) | Buy briar.app, register hostname, status flip, edit on the custom domain | 5:00 | §21 Custom domains, §1 on-site editing, §35 edit-token origin binding |
| [S10](#session-10--addon-shop--per-site-config) | Acquire GA4 + Custom Scripts, configure per-site, validation error → fix | 5:00 | §33 Addons (entitlement + site config), §35 GA validation |
| [S11](#session-11--dashboard-tour-megabeat) | Site settings, nav editor, account settings, dashboard chat panel | 8:00 | §36 Dashboard panels (5 distinct surfaces), §20 password toggle, locale picker, favicon, §9 chat persistence |
| [I5](#interlude-5--visitor-hits-password-gate) | Visitor hits the password gate, fails once, unlocks | 0:45 | §20 Password gate, rate limit, redirect sanitization |
| [I6](#interlude-6--lead-inflow-montage) | Three visitor form submissions roll in; inbox refreshes; owner emails stack | 1:00 | §19 Form pipeline at scale, §38 Resend |
| [S12](#session-12--regret--version-restore) | Maya breaks the hero deliberately, undoes, restores from a previous snapshot | 5:00 | §1 Undo (Yjs history), §17 Version restore + auto safety snapshot |
| [S13](#session-13--v2-publish--closing) | Final polish, v2 publish, live visitor broadcast, save as community template, delete old draft template | 4:00 | §5 Publish v2 + live broadcast, §16 Custom template save + delete UX, bridge to Act 2 |

**Total:** ~90:15. Adjust by trimming Session 5 (densest beat) if total runs long.

---

## Session 0 — Cold open

> **Runtime:** 0:30 · **Features driven:** §37 Landing page · **Pre-record state:** logged out, fresh browser, `https://opencanvas.aayushman.dev` loaded. Landing-page hero JS demo running (it cycles style kits automatically per `project_landing_page_demo` — let it run a full cycle once before recording). · **Outcome:** the viewer wants to click "Sign up."

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S0.1 | "I built a site builder. It has every piece you'd expect from one of the big ones — and a few that none of them have. Over the next two hours, I'm going to show you both halves of that: first, how someone uses it. Then, how the whole thing works under the hood." | Wide shot of landing page hero. The hero canvas plays its build-and-restyle animation — sections appearing, style kits cycling charcoal → orange → blue → green. Multiplayer cursors moving in the demo. |
| S0.2 | "We're going to follow someone called Maya. She's an indie founder launching a small focus app. She's not a designer; she's not a developer. She just wants a site." | Cursor scrolls down past the hero — feature grid blurs past, stat counters tick — and lands on the "Launch dashboard" button in the top-right of the landing page status bar. |
| S0.3 | "Let's start where she would start." | Click "Launch dashboard." Hard cut. |

---

## Session 1 — Sign-up, profile, template pick

> **Runtime:** 4:00 · **Features driven:** §35 Clerk auth, §36 Profile panel + Site grid (empty) + Template gallery (Community/Personal tabs), §4 Apogee Showcase pick · **Pre-record state:** Clerk sign-up screen, fresh-account flow ready. Maya is recorded from a fresh Clerk session on a brand-new test account with 0 sites. Apogee Showcase fixture patched (verified in `feature-coverage.md`). Dashboard plan-limit set so creating one site is permitted. Email + display-name template values prepared. · **Outcome:** Maya has created a new site from Apogee Showcase, named it "Briar," and is staring at the dashboard site grid with one tile.

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S1.1 | "rev01 uses Clerk for the owner auth layer. It's session-based, JWT under the hood, auto-refreshes — the usual." `// ACT 2 →` *we'll come back to the token model in Act 2.* | Clerk modal: enter Maya's email, magic-link or password (whichever is faster to record cleanly). Sign-in completes. |
| S1.2 | "First time here. She lands on her dashboard, which is empty." | Dashboard `/dashboard` route loads. Empty site grid: "No sites yet" placeholder. Stat cards at top show 0 sites / 0 storage / Free plan. |
| S1.3 | "Before she creates anything, she fills in her profile — just so the dashboard knows who she is." | Click "Profile" in dashboard sidebar (or top nav, whichever is the current shipped surface). Profile panel opens: avatar upload, display name field, bio, timezone dropdown. Maya fills display name = "Maya Chen," bio = one sentence, timezone = "America/Los_Angeles." Save. |
| S1.4 | "Then she goes back to the dashboard and clicks Create site." | Back to `/dashboard`. Click "Create site" CTA. |
| S1.5 | "This is the template gallery. It's split into two tabs — Community for the built-in and globally-published templates, Personal for stuff she's saved herself. She has nothing saved yet, so Personal is empty." | Template gallery `/dashboard/templates`. Hover the "Community" tab — six templates render with live preview iframes (Starter, Launch, Enterprise, Studio, Local, Apogee Showcase). Click "Personal" tab — empty state. Click "Community" again. |
| S1.6 | "She's drawn to the most loaded one — the Apogee Showcase. It's got every kind of section she might need: hero, pricing, blog, customers, the lot. She figures it's easier to strip down than build up." | Hover the Apogee Showcase tile. Preview iframe shows the dark, blue-accent SaaS layout — hero with video background, feature grid, customer carousel. Click the tile. |
| S1.7 | "Picks the template. Types her site name." | "Create from Apogee Showcase" modal opens. Fields: Site name + subdomain. Maya types "Briar" → subdomain auto-derives to `briar`. Confirms `briar.opencanvas.aayushman.dev`. |
| S1.8 | "And she's in." | Click "Create." Loading shimmer. Editor route opens: `/dashboard/sites/briar/editor` (or whatever the current routing is). Apogee's index page renders in the canvas. Maya's first frame in the editor. |
| S1.9 | "// ASIDE: that template seed was a fixture in the repo — six of them ship today, and an Owner can save their own. We'll see Maya save her finished Briar as a community template at the very end of Act 1." | Hold on the editor for a beat. End of session 1. |

---

## Session 2 — Editor tour + AI rebrand

> **Runtime:** 12:00 · **Features driven:** §1 Canvas Editor (header controls, sidebar tabs, film reel, inspector, status line, pan/zoom, live preview, styled modal), §8 + §9 AI Chat (single panel — handles both bulk-rebrand batches and multi-turn refinement via `rewriteText`, `query_site`, `updateElement` op-preview, per-card Accept/Reject), §1 Rich text (7 marks, keyboard shortcuts, link popover, mark toggle-off, paste-safe, semantic roles) · **Pre-record state:** Maya's first frame in the editor on briar's index page, Apogee Showcase loaded, no edits yet. AI Chat and Gemini key configured. AI Chat history empty for this site. · **Outcome:** Every "Apogee" string on every page has been rewritten to "Briar," the hero copy has been refined via chat, and three rich-text marks have been applied to the hero body. Undo state has visible history.

### 2.A — Header + topbar tour (2:00)

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S2.A.1 | "Editor opens. Top bar across the whole thing." | Pan camera across the top bar from left to right slowly. |
| S2.A.2 | "Breadcrumb on the left — site name, page name. Click the page name to switch pages." | Click breadcrumb page chip. Page switcher dropdown — six pages including `_404`. Close. |
| S2.A.3 | "Next to it: the published-address chip. Once she publishes, this links to `briar.opencanvas.aayushman.dev`. Right now it's grey because nothing's live yet." | Hover the published-address chip — tooltip "Not published yet." |
| S2.A.7 | "Then the action cluster on the right — dashboard chip back to her site list, the published-address pill we just looked at, the AI Chat button, Settings, Save, Publish, and Save as template. That's the whole topbar — no Undo/Redo buttons up here; Ctrl+Z and Ctrl+Y wrap the underlying Yjs history so she just uses the keyboard." | Hover each button in sequence from left to right — dashboard chip, published-address pill, AI Chat button, Settings, Save, Publish, Save as template. Don't click yet. |

### 2.B — Sidebar tabs + film reel + inspector tour (2:00)

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S2.B.1 | "Left sidebar. Three tabs." | Click "Add" tab. |
| S2.B.2 | "Add — fourteen direct-add buttons for every element type: text, image, video, button, shape, container, chart, form, embed, code, accordion, carousel, table, nav. Anything she drops here lands at the cursor on the canvas." | Show the 14 element buttons. Hover each briefly. Don't add anything yet. |
| S2.B.3 | "Sections — searchable catalog of section recipes she can drop in, plus the Collection element which lives here rather than Add." | Click "Sections" tab. Show the catalog. Type "cta" in the search field — recipes filter. Clear. |
| S2.B.4 | "Pages — page list with SEO links per page." | Click "Pages" tab. List shows index, blog, pricing, enterprise, customers, `_404`. Each row has an "SEO" link. |
| S2.B.5 | "Right side: the film reel. Every section of the current page as a thumbnail. Drag to reorder. Click a thumbnail to scroll the canvas to that section." | Open film reel panel. Drag-hover the third section thumbnail (don't drop). Click the fifth thumbnail — canvas scrolls to it. |
| S2.B.6 | "And below the film reel: the inspector. Empty for now because she hasn't selected anything." | Inspector panel visible, blank-state "Select an element to inspect." |
| S2.B.7 | "Click an element — inspector fills in for that element's type." | Click the hero heading text element. Inspector populates: AI rewrite button, semantic role dropdown, font size, weight, alignment. |
| S2.B.8 | "Click a section header — inspector switches to the section fields. Role: header, footer, or body. Background effect. Entrance animation. Background video. Popup trigger. All in one panel." | Click the Hero section's title bar in the film reel. Section inspector replaces element inspector. Cycle each dropdown briefly: role, backgroundEffect (already grain on this hero — show the menu), entrance (fade-up), backgroundVideoAssetId (already set), popup trigger (none). |
| S2.B.9 | "Pan and zoom on the canvas with the mouse wheel. Hold space to grab and pan." | Scroll wheel zooms canvas from 100% to 60% to 130%. Press fit-to-viewport button. Hold space, drag to pan. Release. |
| S2.B.10 | "Status line at the bottom tells her what's saved, who else is here. Right now it's just her." | Pan to status bar: "Saved · 1 viewer (you)." |

### 2.C — AI Chat bulk rebrand (4:00)

> One AI surface for both the bulk rebrand here and the hero-copy refinement in 2.D — same chat panel, same model, same Accept/Reject card flow. The split between sub-sessions is narrative, not UI.

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S2.C.1 | "OK. Now the rebrand. This template is called Apogee — that name's everywhere across five pages, in the nav, in the hero, in the pricing copy, in the customer testimonials, in the footer. Manually changing every one would take her half an hour." | Quick montage: pan through each page in the canvas, highlighting "Apogee" text occurrences. |
| S2.C.2 | "So she's going to ask the agent. Same AI Chat panel she'll use later for tone tweaks — it does both." | Click the "AI Chat" button in the header. The chat panel slides out on the right. Empty thread. Maya types directly into the chat input: `Rename every "Apogee" mention to "Briar" across all pages — nav, hero copy, pricing, customer cards, footer. Keep capitalization.` Send. |
| S2.C.3 | "Plain English. The agent reads her whole site, figures out the operations, and shows her exactly what it'll change before anything is applied." | Chat shows a small italic "Looking at your site..." tool-use trace as `query_site` runs. |
| S2.C.4 | "It's streaming. Server-sent events. The agent shows me each batch as it streams in — one or two operations at a time, each batch is its own Accept card." `// ACT 2 →` *Gemini 2.5 Pro behind this, with tool parsers that validate every argument before the apply layer sees it.* | First Accept card appears in the chat thread: "rewriteText on `wf-header-brand`: 'Apogee' → 'Briar'." Hovering it highlights the affected text element in the canvas. |
| S2.C.5 | "Each card has Accept and Reject. She accepts each batch as it arrives." | Click Accept on the first card. Canvas updates — header now says Briar. |
| S2.C.6 | "Next batch streams in. Hero heading and hero kicker." | Second Accept card appears: "rewriteText on `wf-hero-heading` + `wf-hero-kicker`." Accept. Hero updates. |
| S2.C.7 | "And it keeps going — pricing page, customer cards, footer. One batch at a time." | Third, fourth, fifth batches stream in as the agent walks the site. Maya accepts each as it arrives. Cards visibly stack in the chat history above. |
| S2.C.8 | "Applied. Header says Briar. Hero says Briar. The pricing page — Briar. The footer — Briar." | Pan through each page in the film reel — each formerly-Apogee text element now reads Briar. |
| S2.C.9 | "And it's all in the undo stack — Ctrl+Z walks back through the batches." | Press Ctrl+Z a couple of times — the last accepted batches revert. Press Ctrl+Y to reapply. |

### 2.D — AI Chat hero refinement (3:00)

> Same chat panel as 2.C — Maya doesn't close it. The narrative just shifts from one-shot rebrand batches to multi-turn iterative refinement on the hero copy.

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S2.D.1 | "Bulk rebrand done. Now she wants to iterate on the hero copy — get the tone right. Same chat panel, just a different mode of using it: ask, accept, ask again." | Chat panel still open from 2.C. Maya scrolls the thread back to the top input. |
| S2.D.2 | "She wants the hero copy to feel calmer. Right now it reads like enterprise SaaS — 'The web platform for modern businesses.' That's Apogee's voice, not Briar's." | Maya selects the hero heading text element first. Then types in the chat input: `The hero heading right now is "The web platform for modern businesses." Briar is a focus app — small, calm, personal. Rewrite the heading.` Send. |
| S2.D.3 | "It reads the current site state — `query_site` again — and proposes a rewrite." `// ACT 2 →` *`query_site` returns a token-capped summary by default so the chat doesn't burn context.* | Chat shows the "Looking at your site..." trace. Then a single preview card: `updateElement on wf-hero-heading: content → "A quiet place to do your work."` |
| S2.D.4 | "She likes it but wants to compare. Accept this one, then ask for an alternative tone." | Click Accept on the first card. The hero heading on the canvas updates to "A quiet place to do your work." Then Maya types a second prompt: `Now give me an alternative tone — punchier, more direct.` Send. A second preview card returns: `updateElement on wf-hero-heading: content → "Time for one thing at a time."` Maya compares the two on-screen by toggling Accept on the second card to swap, then Ctrl+Z to revert back to the first. She keeps the first. |
| S2.D.5 | "Wants the hero body shorter. Just types it." | In the chat: `Shorter on the body — one sentence max.` Chat returns a single proposal preview. Accept. Body updates on canvas. |
| S2.D.6 | "This whole conversation gets persisted to the database — she can close the chat, come back tomorrow, and pick it up." | Close the chat slide-out. Re-open it. History is still there. |

### 2.E — Rich text marks (3:00)

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| S2.E.1 | "She also wants to bold one word in the hero body. So she edits inline." | Double-click the hero body text. The text becomes contenteditable. A floating toolbar appears above the selection. |
| S2.E.2 | "Seven inline marks — bold, italic, underline, strike-through, code, highlight, link. Toolbar buttons or keyboard shortcuts." | Select the word "quiet" by double-click. Floating toolbar near the selection. Press Ctrl+B. The word boldens. |
| S2.E.3 | "Click the bold button again to remove it without re-selecting. That's the mark toggle-off — used to require a fresh selection, now it doesn't." | Click the Bold button (selection still active from previous beat). The bold lifts off. Click again — bold returns. |
| S2.E.4 | "Italic shortcut. Underline. Strike. Code." | Select the phrase "do your work." Press Ctrl+I — italics. Press Ctrl+U — underline. Click Strike from toolbar. Click Code from toolbar. Each mark stacks visually. Press Ctrl+Z to remove the last three for cleanliness, leaving italics. |
| S2.E.5 | "Link — Ctrl+K opens the link modal. She points it at her about page." | Select "your work." Press Ctrl+K. The link modal opens (styled JSX modal — not the browser `prompt`). Type `/about` in the URL field. Validation passes (internal-path is allowed). Click Insert. The selection is now an underlined link. |
| S2.E.6 | "And she can click an existing link to inspect it." | Hover the new link — a popover appears with three buttons: Open, Edit, Unlink. Plus a small "Visitor preview" pill showing what the link will look like on the published site (underlined accent color). |
| S2.E.7 | "Paste-handling preserves bold and italic and links from whatever she copies. If she pastes from a Google Doc, the marks survive; anything Google-Docs-specific gets stripped." | Show a quick paste demo: paste a small snippet from outside the editor with rich formatting. Marks survive, junk styles stripped. |
| S2.E.8 | "And she can switch the semantic role from heading to body to label in the inspector. Heading h-tags get derived from font size — the a11y check uses the same mapping. Act 2." | Select the hero kicker text above the heading. In the inspector, click the role dropdown: heading → body → label. The font and color update per the kit's bodyScale/labelScale tokens. |
| S2.E.9 | "Click Save. Yjs autosaves anyway, but force-save commits the snapshot to the autosave queue." | Click Save in the header. "Saved" indicator pulses. End of session 2. |

---

## Session 3 — Style kit + assets + custom font

> **Runtime:** 6:00 · **Features driven:** §3 Style Kits (4 built-in + Custom + tweaked accent), §1 element visual style controls, pinned styles, page background override, §12 Owner Assets, §12 AI image generation (Replicate, 8 aspect ratios), §39 Slot history MRU, §13 Custom fonts (WOFF2 upload + delete UX), Theme panel mount · **Pre-record state:** end of session 2. Apogee Showcase loaded in editor with Briar text everywhere. Style kit is Custom (Apogee's bundled custom kit). Replicate API key configured. A test WOFF2 font file on disk for upload. · **Outcome:** Style kit is still Custom but with Maya's tweaked accent color. Hero media element has been swapped to a Maya-generated image (slot history shows previous asset). One custom WOFF2 font has been uploaded and a stale one deleted.

**Beats to draft:** 3.A theme panel mount + cycle 4 built-in kits + back to Custom; 3.B tweak custom accent; 3.C element visual-style inspector (border, radius, opacity, shadow); 3.D pinned style on the hero brand; 3.E page background override on /blog; 3.F Owner Assets upload from disk; 3.G AI image-gen via Replicate (16:9 aspect, prompt-driven, four-option preview); 3.H slot history MRU pop-out; 3.I custom font upload + delete stale.

*(Draft full table in the next pass.)*

---

## Session 4 — Multi-page deep dive

> **Runtime:** 6:00 · **Features driven:** §6 Multi-page (add/delete/reorder pages, slug validation, default page), §22 Page-level SEO (title 60-char, description 160-char, canonical, noIndex, OG image, locale picker per page), §1 Custom 404 toggle + `_404` rename protection, §8 agent `deletePage` + `addPage` + section recipe catalog · **Pre-record state:** end of session 3. Six pages currently. Theme panel closed. · **Outcome:** Enterprise page deleted via agent. A new "Manifesto" page added via agent (using a recipe). One page's `_404` toggle visible. Slug rename to `_404` attempted on a normal page and blocked.

**Beats:** 4.A page list tour; 4.B delete `enterprise` via AI agent `deletePage`; 4.C add `manifesto` via agent (chooses a section recipe — hero-split); 4.D page SEO panel (60/160 counters, ogImage picker, locale picker, canonical override, noIndex toggle); 4.E custom 404 toggle on the `_404` page (already set); 4.F attempt to rename `blog` to `_404` — rename protection blocks it with a styled-modal error.

*(Draft full table in the next pass.)*

---

## Session 5 — Element-by-element exercise

> **Runtime:** 18:00 · **Features driven:** §2 every element type (text, media, action×7 variants, shape×6, container×7 surfaces, form 5 field kinds, embed across 4 providers + named mentions of remaining 5, code 11 langs cycled, chart 5 kinds, table + phone collapse, accordion, carousel, nav, collection manual + page-bound + add button + inspector + nested child selection), §40 all 16 motion presets visible, §1 section roles + film reel + element rotation/opacity, all 6 backgroundEffects + section background video + 3 popup triggers, §28 interactives, §29 embeds + CSP allowlist (mentioned), undo/redo via topbar · **Pre-record state:** end of session 4. Five pages now (index, blog, pricing, customers, manifesto, `_404`). Hero on index has the Maya-generated image. · **Outcome:** Every element type has been touched, inspected, or modified at least once. Every variant axis has been visibly demonstrated. The undo stack is deep.

**Beats:** 5.A text inspector (AI rewrite + semantic role + size + weight + align); 5.B media inspector (alt text + fit mode + video autoplay/muted/loop/controls + slot history pop); 5.C action — cycle all 7 variants on one button; 5.D shape — cycle all 6 variants; 5.E container — cycle all 7 surfaces; 5.F form inspector — add a field of each of the 5 kinds, set required, success message; 5.G embed — paste a YouTube URL, then Vimeo, then Loom, then Figma, then Google Maps; mention the rest exist; 5.H code — cycle 11 languages on one snippet; line-numbers toggle; 5.I table — column editor, alignment per column, zebra toggle, phone-collapse preview; 5.J accordion — add item, multi-open toggle; 5.K carousel — add slide, arrow toggle, dot toggle; 5.L nav — switch layout, sticky toggle, logo asset picker, link kinds (internal page / external URL / anchor); 5.M collection — toggle manual → page-bound; add button for a new entry; inspector for the collection itself; click into the entry template + select a nested child element; field binding setup; 5.N chart — cycle all 5 kinds on the pricing donut; multi-series via data grid; legend toggle; 5.O element rotation slider on a shape; element opacity; 5.P section inspector — cycle backgroundEffect through all 6 effects on one section, plus backgroundVideo; 5.Q section roles — show header (pinned top) + footer (pinned bottom) + body roles in the film reel; 5.R popup live-add via section inspector — Maya selects a body section, opens the section inspector, picks each value in the popupTrigger dropdown in turn (exit-intent, delay, scroll-depth) so all three trigger modes are seen; skip the popup-content editing; 5.S 16 motion presets — apply each entrance to a different section while scrolling; 5.T undo all + redo all via topbar buttons.

*(Draft full table in the next pass — this is the densest session.)*

---

## Session 6 — Responsive + library save + custom template save

> **Runtime:** 5:00 · **Features driven:** §7 Responsive (desktop / tablet 1023 / phone 375 breakpoints, per-element overrides, table phone collapse), §15 Library Sections (save scope private / global, asset manifest), §16 Custom Templates (save as Personal scope), responsive scaling factors mentioned · **Pre-record state:** end of session 5. · **Outcome:** Maya has switched the canvas through tablet and phone breakpoints, applied one phone-only override, and saved both a hero section to her library and the whole site as a personal template.

**Beats:** 6.A breakpoint switcher in header; 6.B tablet preview at 1023px; 6.C phone preview at 375px; 6.D per-element override on the hero CTA — phone-only width adjustment; 6.E table phone-collapse confirmation on the pricing page; 6.F "Save section to library" on the index hero (Personal scope); 6.G "Save site as custom template" via the header "Save as template" button (Personal scope).

*(Draft full table in the next pass.)*

---

## Interlude 1 — Sam joins as collaborator

> **Runtime:** 1:30 · **Features driven:** §11 Collaborator invites (HMAC JWT 7-day, editor role), §38 Email (Resend), §35 edit-token cookie, §10 Yjs CRDT + presence + autosave + element-style projection, §11 role removal · **Pre-record state:** end of session 6. Maya's editor still open on briar. Sam's email inbox queued and visible in a second browser window/profile. · **Outcome:** Sam has joined, made a small edit (changed one button label), and Maya has demoted/removed him after the demo.

**Beats:** I1.A cut to Maya — Settings panel → Collaborators tab → invite by email; I1.B cut to Sam's inbox — Resend HTML invite renders with branding, role, expiration; click accept; I1.C invite acceptance page → editor opens for Sam at briar.opencanvas.aayushman.dev (edit-token cookie issued); I1.D split-screen: Sam edits the CTA button label "Get started" → "Start your space" on the canvas; I1.E cut to Maya — presence indicator (Sam's avatar appears in status line + a cursor floats on her canvas); the label change appears in her view live; I1.F Maya goes back to Collaborators tab and removes Sam — Sam's editor view loses access on next refresh; I1.G cut back to Maya.

*(Draft full table in the next pass.)*

---

## Session 7 — A11y audit + first publish

> **Runtime:** 7:00 · **Features driven:** §26 A11y audit (6 checks, severity badges, element-level remediation, ARIA emission, crash isolation mention), §5 Publish (one-click, version counter, OG image pre-render, search index rebuild, auto snapshot), §17 Auto snapshot at publish, §23 OG image (Satori → resvg → R2 cache, the rendered PNG visible) · **Pre-record state:** end of Interlude 1. Briar has been edited but never published. Hero media missing alt text (intentionally — to surface a blocking a11y issue). · **Outcome:** A11y green, first publish succeeded, OG image rendered + visible, version counter at 1, "Open published site" link active.

**Beats:** 7.A click A11y in dashboard sidebar; 7.B audit report — list of 6 categories with badges; alt-text on hero media flagged blocking + element link; 7.C click the element link — editor jumps to the element + opens inspector; Maya types alt text; 7.D re-run audit; all green; 7.E click Publish; 7.F publish flow shows OG pre-render progress + search rebuild + snapshot saved; 7.G version badge in header updates from "draft" to "v1"; 7.H OG image preview pill shows the rendered PNG.

*(Draft full table in the next pass.)*

---

## Interlude 2 — Visitor first visit

> **Runtime:** 2:00 · **Features driven:** §5 Visit published address, §27 Light/dark visitor toggle (anti-flash inline script), §19 Form submission (Turnstile invisible challenge + success message), §5 scroll entrance animations, §24 Sitemap + robots, §25 Site search, §1 Custom 404 page on bad URL · **Pre-record state:** end of session 7. Briar is live at `briar.opencanvas.aayushman.dev/`. A different browser profile (clean, no edit-token cookie) ready. · **Outcome:** A form submission has been recorded. Light/dark toggled. /_404 visited. Search returned results.

**Beats:** I2.A new browser profile → open `briar.opencanvas.aayushman.dev`; I2.B published site renders; I2.C scroll the index — entrance animations fire per section as elements come into view; I2.D click the visitor light/dark toggle in the corner — site repaints in dark variant; click back; I2.E navigate to the contact form section; fill it in; submit (Turnstile invisible — no challenge UI visible); success message renders; I2.F navigate `/sitemap.xml` — XML renders with all pages, lastmod, noIndex excluded; I2.G `/robots.txt` — references the sitemap; I2.H `/__rev01/search?q=focus` — JSON response with snippet; I2.I `/some-bad-url` — custom 404 page renders.

*(Draft full table in the next pass.)*

---

## Session 8 — Forms inbox + owner notification

> **Runtime:** 3:00 · **Features driven:** §19 Forms inbox + paginated list + CSV export + owner notification (Resend, fire-and-forget), webhook URL config (HMAC `X-Rev01-Signature` mentioned) · **Pre-record state:** end of Interlude 2. One form submission in the DB. Maya's email inbox visible in a second window. · **Outcome:** Maya has seen the submission in her inbox panel, exported it as CSV, and configured a webhook URL.

**Beats:** 8.A Maya's editor → Forms in sidebar → submissions list with the one Visitor entry; 8.B CSV export click → file downloads; 8.C webhook URL field in form inspector (back in editor); paste a URL; voiceover mentions HMAC signing; 8.D Maya's email — show the owner notification email Resend delivered (form ID + timestamp + inbox link).

*(Draft full table in the next pass.)*

---

## Interlude 3 — Site Import gloss

> **Runtime:** 0:30 · **Features driven:** §18 Site Import (gloss only — public POC disabled) · **Pre-record state:** dashboard visible. · **Outcome:** Viewer knows the feature exists.

| # | VOICEOVER | ON-SCREEN ACTION |
|---|---|---|
| I3.1 | "Quick aside. rev01 ships with a Site Import — you paste a URL, a headless-browser scraper service brings the site over as an EditableSite with the elements mapped, the colors extracted, the fonts imported. We're not going to demo it here." | Pan to dashboard. Hover the "Import site" button — it's disabled in this public POC build. Tooltip reads "Available on self-hosted." |
| I3.2 | "// ASIDE: we'll cover the architecture of the scraper in Act 2. The short version is: ADR 0008, Playwright service, OKLCH theme algebra to derive a Style Kit from a single seed color." | Hold on the disabled button for a beat. Cut. |

---

## Interlude 4 — Doha pop-up — RTL/i18n

> **Runtime:** 1:00 · **Features driven:** §22 page-level locale picker, RTL direction auto-detect from Arabic, BCP-47 locale resolution, coordinate mirroring for positioned elements, `<html lang dir>` emission · **Pre-record state:** end of session 8. Briar has 5 pages (after session 4's deletions/additions). · **Outcome:** A new `ar` Arabic page exists; RTL preview shows mirrored layout; published meta tags updated.

**Beats:** I4.A "Briar is doing a Doha pop-up event" framing; I4.B add new page from dashboard or editor → locale picker dropdown → select `ar` Arabic; I4.C page is created with RTL direction; I4.D Maya types Arabic copy into the hero (or pastes); positioned elements mirror x-coordinates automatically; I4.E published preview shows `<html lang="ar" dir="rtl">`; I4.F voiceover mentions BCP-47 fallback chain.

*(Draft full table in the next pass.)*

---

## Session 9 — Custom domain + on-site editing

> **Runtime:** 5:00 · **Features driven:** §21 Custom domains (register hostname, CNAME DCV, status pending→verifying→active, cron poll, SSL, stuck-row detection mentioned), §1 on-site editing via edit-token cookie, §35 edit-token origin binding · **Pre-record state:** end of Interlude 4. Briar published at subdomain. Maya bought `briar.app` (off-screen). Cloudflare for SaaS configured. · **Outcome:** `briar.app` resolves to Briar; Maya made one edit from the custom domain.

**Beats:** 9.A Domains panel in dashboard sidebar; 9.B "Register hostname" → type `briar.app`; 9.C status `pending` with CNAME instructions; 9.D cut "later that day" — status `verifying`; cut "a few minutes later" — status `active`; SSL cert column shows issued; 9.E open `https://briar.app/` in new tab — site loads; 9.F click the small "Edit this site" pill in the corner (visible to Owners only when their edit-token cookie validates against origin); 9.G editor opens on the custom-domain origin; make one edit; save.

*(Draft full table in the next pass.)*

---

## Session 10 — Addon Shop + per-site config

> **Runtime:** 5:00 · **Features driven:** §33 Addon Shop + acquire Addon Entitlement (account-level) + Site Addon configuration (per-site), GA4 measurement ID validation, Custom Scripts head + body injection, addon takes effect on next publish · **Pre-record state:** end of session 9. Briar at `briar.app`. No addons yet. · **Outcome:** GA4 and Custom Scripts both enabled, configured, and visible in the published HTML.

**Beats:** 10.A Addon Shop panel — browse Google Analytics + Custom Scripts cards; 10.B acquire GA4 — entitlement created (voiceover: account-level, not site-level); 10.C cut to Site Addons panel for briar — enable GA4 → measurement ID field; 10.D type a deliberately invalid ID like `UA-123` → validation error inline (server-side); 10.E fix to `G-XXXXXXXXXX`; 10.F acquire Custom Scripts entitlement; 10.G configure briar's Custom Scripts — add a head injection (a Hotjar-shaped script tag) and a body injection (something inline); 10.H publish briar v2; 10.I view-source on the published site — head injection visible, GA4 gtag visible.

*(Draft full table in the next pass.)*

---

## Session 11 — Dashboard tour megabeat

> **Runtime:** 8:00 · **Features driven:** §36 Site Settings (hosting summary, password protection toggle [activated], search indexing toggle, visitor dark mode default, favicon upload, clickable detail rows, settings anchors), site-level locale picker, §36 Nav Editor panel (bar layout, logo, sticky toggle, per-page suppression), §36 Account Settings panel (Free/Pro/Team plans, usage meters, invoices), §36 Dashboard Chat panel (distinct from editor slide-out, session persistence) · **Pre-record state:** end of session 10. · **Outcome:** Briar has password protection enabled on `/preview` page only; visitor dark mode default is on; favicon set; nav has one page suppressed; account is on a paid plan (mocked).

**Beats:** 11.A Site Settings — hosting summary panel; 11.B password protection toggle — switch on, set password, scope to `/preview` page; 11.C search indexing toggle (on/off); 11.D visitor dark mode default toggle; 11.E favicon upload (uses Owner Asset); 11.F site-level locale picker (sets defaultLocale); 11.G clickable detail rows demo — click "Hosting" → jumps to #hosting; 11.H Nav Editor panel — switch nav layout left-right ↔ left-center-right; sticky toggle; logo asset swap; suppress nav on `/preview` page; 11.I Account Settings panel — show Free/Pro/Team plan tiles; current plan, usage meters (sites: 1/3, storage: X MB / Y GB, AI generations); invoices placeholder; 11.J Dashboard Chat panel — distinct route `/dashboard/sites/briar/chat`; ask a site-wide question; chat persists across reload (close panel, reopen, history present).

*(Draft full table in the next pass.)*

---

## Interlude 5 — Visitor hits password gate

> **Runtime:** 0:45 · **Features driven:** §20 Password gate (no-JS HTML form), failed attempt → 5/60s rate limit, success → HS256 unlock cookie 7-day, redirect sanitization (rejects `//` and control chars) · **Pre-record state:** end of session 11. `/preview` page is gated. Fresh browser profile. · **Outcome:** Visitor unlocks, sees the preview page, cookie set.

**Beats:** I5.A new profile → visit `briar.app/preview`; I5.B gate page renders (plain HTML, no JS); I5.C type wrong password → "Incorrect"; type 5 times → rate-limit message; I5.D type correct password → unlock cookie set, redirect to `/preview`; I5.E preview page renders.

*(Draft full table in the next pass.)*

---

## Interlude 6 — Lead inflow montage

> **Runtime:** 1:00 · **Features driven:** §19 form pipeline at scale, owner notification stack, inbox auto-refresh, §38 Resend volume · **Pre-record state:** end of Interlude 5. Briar live. Multiple visitor sessions seeded or simulated. · **Outcome:** Maya has 3+ new leads in the inbox; her email inbox shows the stack of owner notifications.

**Beats:** I6.A quick-cut montage of 3 different visitor sessions filling the form (different browsers / personas — a designer, a student, an indie hacker); I6.B cut to Maya's editor Forms inbox → 3 new entries roll in; I6.C cut to Maya's email — 3 owner notifications stacked; one expanded showing form ID + timestamp + inbox deep-link.

*(Draft full table in the next pass.)*

---

## Session 12 — Regret + version restore

> **Runtime:** 5:00 · **Features driven:** §1 Undo via topbar (Yjs history), §17 Version Timeline (manual + auto snapshots, publish vs manual filter, preview iframe, restore, pre-restore safety snapshot, Yjs binary storage mentioned) · **Pre-record state:** end of Interlude 6. Briar has multiple snapshots: auto from publishes + Maya can take manual. · **Outcome:** Maya has restored the hero from an earlier snapshot via the timeline.

**Beats:** 12.A Maya makes a deliberately bad edit — deletes the hero heading element + drags the CTA to the wrong corner; canvas looks broken; 12.B undo via topbar — multiple presses to walk back; 12.C "actually, I want last week's hero copy — before the rebrand"; 12.D Version Timeline panel in dashboard sidebar; 12.E timeline shows chronological snapshots; filter publish/manual; 12.F preview an old snapshot in a sandboxed iframe; 12.G restore → safety snapshot taken automatically (voiceover mentions it); 12.H site state reverts to the chosen snapshot.

*(Draft full table in the next pass.)*

---

## Session 13 — v2 publish + closing

> **Runtime:** 4:00 · **Features driven:** §5 Publish v2 + live broadcast fan-out, §17 manual snapshot with label, §16 save site as community template + Personal template delete UX, bridge to Act 2 · **Pre-record state:** end of session 12. Briar restored. · **Outcome:** v2 published. Live visitor tab updated without refresh. Saved as community template. Old "draft v0" personal template deleted.

**Beats:** 13.A final polish on hero copy; 13.B manual snapshot with label "v2 launch ready"; 13.C Publish — version counter goes to 2; 13.D split-screen: Maya's editor + a Visitor tab open at briar.app; publish broadcasts; Visitor tab updates without refresh (DO fan-out — voiceover mentions Act 2); 13.E Save as Community template — fills name, description, visibility; 13.F template gallery now shows Briar as a Community entry; 13.G Personal tab — earlier "draft v0" template Maya saved at session 6 is still there; she deletes it via the trash icon; 13.H closing montage: forms inbox at 12 leads, briar.app stats, account meters showing AI generation usage; 13.I host voiceover: "That's the product. Now let me show you how it works." Cut to black. End of Act 1.

> **Recording Operator note:** leave ~5 seconds between the v1 publish (end of session 7) and the v2 publish in 13.C so the deferred OG warmup finishes before the v2 attempt — otherwise the broadcast race produces a "no change visible to visitor" gap on the split-screen Visitor tab.

*(Draft full table in the next pass.)*
