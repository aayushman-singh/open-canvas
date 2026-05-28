# E2E Feature List — rev01 (Playwright)

Exhaustive inventory of testable features for end-to-end coverage.

**Status key:** PASS = automated and green, FAIL = automated/observed failure, `—` = not yet automated.

---

## Gaps & Failures Found via MCP Browser Exploration

| # | Area | Finding | Severity |
|---|------|---------|----------|
| G1 | Editor console | Clerk publishableKey missing on public-site editor | **fixed** |
| G2 | Editor console | 500 on legacy asset bridge — unhandled readOwnerAsset throw | **fixed** |
| G3 | Sidebar Add panel | No "Chart" button in sidebar | **fixed** |
| G4 | Section toolbar | No "Sym" (convert to symbol) button | **fixed** |
| G5 | Templates page | 5 templates — spec said 3 seed names | outdated-spec |
| G6 | Dashboard card | Expanded card backdrop intercepts all clicks until Escape | minor |
| G7 | Editor header | No "Translate" button | **fixed** |
| G8 | Sidebar overlap | Sidebar covers leftmost canvas elements at 100% zoom | **fixed** |
| G9 | Editor boot | `state.symbols` not iterable on pre-symbol sites | **fixed** |
| G10 | Template previews | Iframe thumbnails garbled at preview scale | cosmetic |
| G11 | Clerk handshake | Style kit switch during session refresh → 401 → empty canvas | session-race |

---

## 1. Landing Page

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 1.1 | Page load + title | Landing page renders at `/` with correct `<title>` and meta description | PASS |
| 1.2 | Hero panels | 3-panel mockup (editor, preview, agent) renders correctly | PASS |
| 1.3 | Tagline heading | h1 contains "multiplayer site builder with an agent at the cursor." | PASS |
| 1.4 | Differentiator cards | 3 feature cards with nums 01/02/03 and correct headings | PASS |
| 1.5 | Feature card headings | Exact heading text for all 3 cards matches spec | PASS |
| 1.6 | Stat line counters | Runtime section shows LOC, demo edit ops, demo agent ops, published sites | PASS |
| 1.7 | Footer rendering | Footer has links, license: MIT, "Ready to build?" CTA | PASS |
| 1.8 | Status bar | Brand name "rev01", docs link, github link render in header | PASS |
| 1.9 | Start building CTA | Links to /dashboard | PASS |
| 1.10 | Launch dashboard nav | Header button links to /dashboard | PASS |
| 1.11 | View source button | Links to GitHub repo | PASS |
| 1.12 | No console errors | Zero console errors on full page load | PASS |
| 1.13 | Dark color scheme | Meta color-scheme is "dark" | PASS |
| 1.14 | Footer CTA | Footer "Launch dashboard" links to /dashboard | PASS |
| 1.15 | Responsive layout | Landing page is mobile-responsive | — |

## 1b. Health & Favicon Endpoints

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 1b.1 | Health endpoint | `GET /health` returns `{ok: true, ts: <number>}` | PASS |
| 1b.2 | Favicon SVG | `GET /favicon.ico` returns SVG with "r1" text | PASS |
| 1b.3 | Favicon cache | Cache-Control header is `public, max-age=86400` | PASS |

---

## 2. Authentication & Authorization

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 2.1 | Clerk sign-up | New user can sign up via Clerk OAuth | — |
| 2.2 | Clerk sign-in | Existing user can sign in | — |
| 2.3 | Session persistence | Authenticated session persists across page reload | — |
| 2.4 | Auth redirect (dashboard) | Unauthenticated `/dashboard` access redirects to Clerk sign-in | PASS |
| 2.5 | Auth redirect (editor) | Unauthenticated editor page redirects to sign-in | PASS |
| 2.6 | Auth redirect (templates) | Unauthenticated templates page redirects to sign-in | PASS |
| 2.7 | API 401 (sites) | Unauthenticated `GET /api/sites` returns 401 JSON | PASS |
| 2.8 | API 401 (canvas) | Unauthenticated canvas API returns 401 | PASS |
| 2.9 | API 401 (publish) | Unauthenticated publish API returns 401 | PASS |
| 2.10 | API 401 (owner assets) | Unauthenticated owner assets API returns 401 | PASS |
| 2.11 | API 401 (custom templates) | Unauthenticated template creation returns 401 | PASS |
| 2.12 | API 401 (collaborators) | Unauthenticated collaborators API returns 401 | PASS |
| 2.13 | API 401 (version history) | Unauthenticated snapshots API returns 401 | PASS |
| 2.14 | API 401 (custom domains) | Unauthenticated domains API returns 401 | PASS |
| 2.15 | API 401 (password admin) | Unauthenticated password admin API returns 401 | PASS |
| 2.16 | API 401 (chat) | Unauthenticated chat API returns 401 | PASS |
| 2.17 | API 401 (symbols) | Unauthenticated symbols API returns 401 | PASS |
| 2.18 | API 401 (fonts) | Unauthenticated fonts API returns 401 | PASS |
| 2.19 | API 401 (import) | Unauthenticated import API returns 401 | PASS |
| 2.20 | API 401 (library sections) | Unauthenticated library sections API returns 401 | PASS |
| 2.21 | API 401 (on-site-edit) | Unauthenticated on-site-edit API returns 401 | PASS |
| 2.22 | Edit token missing | `/__api/*` without edit token cookie returns 401 | PASS |
| 2.23a | API 401 (addon shop page) | Unauthenticated `/dashboard/shop` redirects to sign-in | PASS |
| 2.23b | API 401 (addon acquire) | Unauthenticated `POST /api/addons/:id/acquire` returns 401 | PASS |
| 2.23c | API 401 (site addons) | Unauthenticated `GET /api/addons/sites/:id` returns 401 | PASS |
| 2.23d | API 401 (addon config) | Unauthenticated `PUT /api/addons/sites/:id/:addonId` returns 401 | PASS |
| 2.23e | API 401 (translate) | Unauthenticated `POST /api/sites/:id/translate` returns 401 | PASS |
| 2.23 | Edit token expiry | Expired edit token (4hr TTL) forces re-auth | — |
| 2.24 | Session expiration | 401 response locks editor UI and reloads | — |
| 2.25 | Admin gate | Non-admin users blocked from admin endpoints | — |
| 2.26 | Collaborator invite token | Valid invite token allows acceptance | — |
| 2.27 | Invalid invite token | Invalid/expired invite token rejected | — |

---

## 3. Dashboard — Site Management

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 3.1 | Dashboard load | `/dashboard` shows site list with thumbnails | PASS (MCP) |
| 3.2 | Empty state | New user sees empty state with create CTA | — |
| 3.3 | Create site from template | Pick template seed → new site appears in list | — |
| 3.4 | Template picker grid | `/dashboard/templates` shows all available templates | PASS (MCP) |
| 3.5 | Site card actions | Rename, delete from site card context menu | — |
| 3.6 | Delete site | Confirm dialog → site removed from list | — |
| 3.7 | Navigate to editor | Click site card → opens canvas editor | — |
| 3.8 | Site thumbnails | Thumbnail previews render for each site | PASS (MCP) |
| 3.9 | Multiple sites | User can create and manage multiple sites | — |
| 3.10 | Subdomain uniqueness | Duplicate subdomain rejected on create | — |

---

## 4. Dashboard — Site Settings

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 4.1 | Site name edit | Change site name persists | — |
| 4.2 | Subdomain edit | Change subdomain persists and validates uniqueness | — |
| 4.3 | Password protection enable | Toggle password gate on, set password | — |
| 4.4 | Password protection disable | Disable password gate removes protection | — |
| 4.5 | Password update | Update existing password | — |
| 4.6 | Style kit selection | Choose between charcoal, orange-editorial, blue-saas, green-organic | — |
| 4.7 | Custom theme | Create custom theme from seed color | — |

---

## 5. Dashboard — Page Settings (SEO)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 5.1 | Page title edit | Set/update page title | — |
| 5.2 | Meta description edit | Set/update meta description | — |
| 5.3 | OG image selection | Set/update Open Graph image | — |
| 5.4 | Canonical URL | Set canonical URL | — |
| 5.5 | Page slug edit | Change page slug | — |

---

## 6. Dashboard — Navigation Editor

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 6.1 | Nav editor load | Navigation editor page renders | — |
| 6.2 | Layout selection | Switch between left-center-right, left-right | — |
| 6.3 | Sticky toggle | Enable/disable sticky navigation | — |
| 6.4 | Add internal link | Add link with label pointing to internal page slug | — |
| 6.5 | Add external link | Add link with label pointing to external URL | — |
| 6.6 | Reorder links | Drag/reorder navigation links | — |
| 6.7 | Remove link | Delete a navigation link | — |
| 6.8 | Logo assignment | Set/change logo asset for nav | — |
| 6.9 | Save navigation | Persist navigation changes | — |

---

## 7. Dashboard — Forms Inbox

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 7.1 | Inbox load | Forms inbox renders with submission table | — |
| 7.2 | Submission list | All form submissions display with payload data | — |
| 7.3 | CSV export | Download submissions as CSV file | — |
| 7.4 | Delete submission | Remove individual form submission | — |
| 7.5 | Empty state | No submissions shows appropriate message | — |

---

## 8. Dashboard — Custom Domains

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 8.1 | Domain list | Show registered custom domains with status | — |
| 8.2 | Register domain | Add new custom hostname | — |
| 8.3 | Domain status badges | Pending/verifying/active/failed status display | — |
| 8.4 | Delete domain | Remove custom domain | — |
| 8.5 | DNS instructions | Show required DNS records for verification | — |

---

## 9. Dashboard — Version History

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 9.1 | Version timeline | List of published snapshots with timestamps | — |
| 9.2 | Snapshot preview | Preview a historical version | — |
| 9.3 | Restore snapshot | Restore site to previous version | — |
| 9.4 | Version labels | Snapshots show reason (publish/manual) | — |

---

## 10. Dashboard — Accessibility Report

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 10.1 | A11y report load | Report page renders with severity-grouped issues | — |
| 10.2 | Issue categories | Contrast, alt text, form labels, heading order | — |
| 10.3 | Severity levels | Critical/warning/info grouping | — |
| 10.4 | Run audit | Trigger new accessibility audit | — |

---

## 11. Dashboard — Collaborators

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 11.1 | Collaborator list | Show invited/accepted collaborators | — |
| 11.2 | Invite by email | Send collaborator invitation | — |
| 11.3 | Role assignment | Assign editor or viewer role | — |
| 11.4 | Remove collaborator | Revoke access | — |
| 11.5 | Accept invitation | Invited user accepts and gains access | — |
| 11.6 | Duplicate invite | Re-inviting same email handled gracefully | — |

---

## 12. Dashboard — AI Chat Panel

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 12.1 | Chat panel open | Chat panel UI renders | — |
| 12.2 | Send message | User types and sends a message | — |
| 12.3 | AI response | AI response streams and displays | — |
| 12.4 | Multi-turn conversation | Context maintained across messages | — |
| 12.5 | Preview cards | AI suggestions show preview cards | — |
| 12.6 | Chat session persistence | Chat history survives page reload | — |

---

## 13. Canvas Editor — Core Layout

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 13.1 | Editor load | Canvas editor renders with header, sidebar, canvas, inspector, status | PASS (MCP) |
| 13.2 | Site state load | Editable state fetched and rendered on canvas | PASS (MCP) |
| 13.3 | Editor header buttons | Save, Publish, Save-as-Template buttons visible | PASS (MCP) |
| 13.4 | Sidebar tabs | Add tab and Sections tab functional | PASS (MCP) |
| 13.5 | Inspector panel | Right panel updates based on selection | PASS (MCP) |
| 13.6 | Status line | Footer shows ready/saving/error status | — |
| 13.7 | Presence badge | Live collaborator count in editor header | — |

---

## 14. Canvas Editor — Viewport & Zoom

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 14.1 | Zoom in | Ctrl+Wheel up increases zoom | — |
| 14.2 | Zoom out | Ctrl+Wheel down decreases zoom | — |
| 14.3 | Zoom to fit | Fit button scales canvas to viewport | PASS (MCP) |
| 14.4 | Zoom 100% | 100% button resets to actual size | — |
| 14.5 | Zoom limits | Zoom clamped between 25% and 200% | — |
| 14.6 | Zoom readout | Current zoom percentage displayed | PASS (MCP) |
| 14.7 | Pan mode | Space key activates pan (click+drag to scroll) | — |
| 14.8 | Select mode | V key returns to select mode | — |
| 14.9 | Temporary pan | Hold Space in select mode → release returns | — |

---

## 15. Canvas Editor — Element Creation

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 15.1 | Add text (sidebar) | Click Text in Add panel → text element appears | PASS (MCP) |
| 15.2 | Add image (sidebar) | Click Image → media element (image) appears | PASS (MCP) |
| 15.3 | Add video (sidebar) | Click Video → media element (video) appears | PASS (MCP) |
| 15.4 | Add button (sidebar) | Click Button → action element appears | PASS (MCP) |
| 15.5 | Add shape (sidebar) | Click Shape → shape element appears | PASS (MCP) |
| 15.6 | Add container (sidebar) | Click Container → container element appears | PASS (MCP) |
| 15.7 | Add chart (sidebar) | Click Chart → chart element appears | PASS (code audit) |
| 15.8 | Add text (section toolbar) | +T button on section → text in that section | PASS (MCP) |
| 15.9 | Add image (section toolbar) | +Img button on section → image in that section | PASS (MCP) |
| 15.10 | Add video (section toolbar) | +Vid button on section → video in that section | PASS (MCP) |
| 15.11 | Add button (section toolbar) | +Btn button on section → action in that section | PASS (MCP) |
| 15.12 | Add shape (section toolbar) | +◇ button on section → shape in that section | PASS (MCP) |
| 15.13 | Add container (section toolbar) | +▢ button on section → container in that section | PASS (MCP) |
| 15.14 | Add chart (section toolbar) | +📊 button on section → chart in that section | PASS (MCP) |
| 15.15 | Add blank section | "Blank section" from sidebar Add panel | PASS (MCP) |
| 15.16 | Add form (sidebar) | Click Form in Add panel → form element appears | — |
| 15.17 | Add embed (sidebar) | Click Embed in Add panel → embed element appears | — |
| 15.18 | Add code (sidebar) | Click Code in Add panel → code element appears | — |
| 15.19 | Add accordion (sidebar) | Click Accordion in Add panel → accordion element appears | — |
| 15.20 | Add carousel (sidebar) | Click Carousel in Add panel → carousel element appears | — |
| 15.21 | Add table (sidebar) | Click Table in Add panel → table element appears | — |
| 15.22 | Add nav (sidebar) | Click Nav in Add panel → nav element appears | — |

---

## 16. Canvas Editor — Element Selection & Manipulation

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 16.1 | Click to select | Click element → selected state (border highlight) | — |
| 16.2 | Section selection | Click section grip → section selected | — |
| 16.3 | Deselect | Click empty canvas area → nothing selected | — |
| 16.4 | Drag element | Select + drag → repositions (updates box.x, box.y) | — |
| 16.5 | Resize N handle | Drag north handle → changes height | — |
| 16.6 | Resize S handle | Drag south handle → changes height | — |
| 16.7 | Resize E handle | Drag east handle → changes width | — |
| 16.8 | Resize W handle | Drag west handle → changes width | — |
| 16.9 | Resize corner | Drag corner handle → changes both dimensions | — |
| 16.10 | Bring to front | Context menu → element z-index becomes max | PASS (MCP) |
| 16.11 | Send to back | Context menu → element z-index becomes min | PASS (MCP) |
| 16.12 | Move forward | Context menu → z-index incremented | PASS (MCP) |
| 16.13 | Move backward | Context menu → z-index decremented | PASS (MCP) |
| 16.14 | Duplicate element | Context menu → clone offset +20px | — |
| 16.15 | Delete element | Context menu → element removed | — |
| 16.16 | Reading order up | Inspector → element moves up in array | PASS (MCP) |
| 16.17 | Reading order down | Inspector → element moves down in array | PASS (MCP) |

---

## 17. Canvas Editor — Inline Text Editing

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 17.1 | Enter edit mode | Single click on text element → contenteditable | — |
| 17.2 | Exit edit (Escape) | Escape key → exits edit, restores snapshot if unchanged | — |
| 17.3 | Type text | Keyboard input appears in element | — |
| 17.4 | Bold (Ctrl+B) | Select text → Ctrl+B → bold applied | — |
| 17.5 | Italic (Ctrl+I) | Select text → Ctrl+I → italic applied | — |
| 17.6 | Underline (Ctrl+U) | Select text → Ctrl+U → underline applied | — |
| 17.7 | Strikethrough (Ctrl+Shift+X) | Select text → strikethrough applied | — |
| 17.8 | Code mark | Mark toolbar → code button toggles inline code | — |
| 17.9 | Highlight mark | Mark toolbar → highlight button toggles highlight | — |
| 17.10 | Add link (Ctrl+K) | Opens link modal → sets href on selection | — |
| 17.11 | Mark toolbar appears | Floating toolbar visible when text selected in edit mode | — |
| 17.12 | Link hover popover | Hover inline link → shows Open/Edit/Unlink | — |
| 17.13 | Unlink | Popover Unlink button removes link mark | — |
| 17.14 | Edit link | Popover Edit button opens link modal | — |
| 17.15 | Link validation | javascript: URLs rejected | — |
| 17.16 | Empty text rejection | Submitting empty text shows error | — |
| 17.17 | Serialization round-trip | Edited text → InlineRun[] → re-render matches | — |

---

## 18. Canvas Editor — Inspector (Element Properties)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 18.1 | Text: role | Change heading/body/label role | PASS (MCP) |
| 18.2 | Text: font size | Adjust font size (12-96px) | PASS (MCP) |
| 18.3 | Text: font weight | Select weight (400-700) | PASS (MCP) |
| 18.4 | Text: alignment | Toggle left/center/right | PASS (MCP) |
| 18.5 | Text: color pin | Set hex color override | — |
| 18.6 | Text: AI rewrite | Trigger AI text rewrite prompt | — |
| 18.7 | Media: upload image | Upload new image via file picker | — |
| 18.8 | Media: upload video | Upload new video via file picker | — |
| 18.9 | Media: alt text | Set/edit alt text | — |
| 18.10 | Media: object fit | Toggle cover/contain | — |
| 18.11 | Media: video autoplay | Toggle autoplay (forces muted) | — |
| 18.12 | Media: video loop | Toggle loop | — |
| 18.13 | Media: video controls | Toggle player controls | — |
| 18.14 | Media: AI generate | Prompt-based image generation | — |
| 18.15 | Media: slot history | Recent-in-slot picker shows MRU | — |
| 18.16 | Media: gallery picker | Owner asset gallery for selection | — |
| 18.17 | Action: label edit | Change button label text | — |
| 18.18 | Action: href edit | Change button link target | — |
| 18.19 | Action: variant | Switch solid/outline/ghost/pill/glass/brutalist/underline | — |
| 18.20 | Shape: variant | Switch rect/pill/circle/line/badge/blob | — |
| 18.21 | Container: variant | Switch flat/raised/glass/outlined/sticker/editorial-frame/soft-panel | — |
| 18.22 | Chart: kind | Switch bar/line/pie/donut/area | — |
| 18.23 | Chart: axis titles | Set X/Y axis labels | — |
| 18.24 | Chart: legend toggle | Show/hide legend | — |
| 18.25 | Chart: data grid | Edit values in spreadsheet UI | — |
| 18.26 | Chart: add series | Add new data series | — |
| 18.27 | Chart: remove series | Remove data series | — |
| 18.28 | Chart: add category | Add new category | — |
| 18.29 | Chart: remove category | Remove category | — |
| 18.30 | Motion: preset | Select animation preset (fade-up, slide-left, etc.) | PASS (MCP) |
| 18.31 | Motion: delay | Set animation delay (0-2000ms) | PASS (MCP) |

---

## 19. Canvas Editor — Sections

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 19.1 | Section toolbar visible | Toolbar at bottom of each section | — |
| 19.2 | Duplicate section | Dup button → section cloned | PASS (MCP) |
| 19.3 | Move section up | ↑ button → section moves up in page | PASS (MCP) |
| 19.4 | Move section down | ↓ button → section moves down in page | PASS (MCP) |
| 19.5 | Delete section | Del button (with confirmation) → removed | PASS (MCP) |
| 19.6 | Save section to library | Save button → section stored in library | PASS (MCP) |
| 19.7 | AI section creation | AI button → recipe picker → prompt → new section | PASS (MCP) |
| 19.8 | Section grip handle | Left grip visible on hover | — |
| 19.9 | Drag section (canvas) | Drag grip to reorder in canvas | — |
| 19.10 | Drag section (film reel) | Drag within film reel to reorder | — |

---

## 20. Canvas Editor — Film Reel

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 20.1 | Toggle reel | Section grip click opens/closes film reel | — |
| 20.2 | Tile view | Thumbnail view with section labels | — |
| 20.3 | List view | Compact list with mini thumbnails | — |
| 20.4 | View mode toggle | Switch between tile and list | — |
| 20.5 | Insert button | "+" between sections inserts at index | — |
| 20.6 | Drag reorder | Drag tiles/items to reorder | — |
| 20.7 | Cross-zone drag | Drag from reel to canvas (and vice versa) | — |
| 20.8 | Drop indicator | Visual line shows insertion point during drag | — |

---

## 21. Canvas Editor — Asset Management

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 21.1 | Image upload | File picker → Cropper.js modal → upload | — |
| 21.2 | Image crop | Pan + zoom in crop modal → confirm | — |
| 21.3 | Video upload | File picker → extract poster → upload both | — |
| 21.4 | AI image generation | Prompt → Replicate flux-schnell → preview → apply | — |
| 21.5 | Asset gallery | Grid of owner's assets in media picker | — |
| 21.6 | Asset selection | Click gallery thumbnail → applied to element | — |
| 21.7 | Asset deletion | Delete from gallery (check references first) | — |
| 21.8 | Deletion blocked | 412 if asset in use (shows reference list) | — |
| 21.9 | Content-hash dedup | Re-uploading same file reuses existing asset | — |
| 21.10 | Slot history | MRU per element shows recent 4 assets | — |

---

## 22. Canvas Editor — Save & Publish

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 22.1 | Autosave (debounced) | Changes auto-saved after 500ms idle | — |
| 22.2 | Manual save (Ctrl+S) | Keyboard shortcut flushes pending save | — |
| 22.3 | Save button | Editor header Save button triggers save | — |
| 22.4 | Save status feedback | "Saving..." → "Saved" in status line | — |
| 22.5 | Save error feedback | Failed save shows error in status line | — |
| 22.6 | Publish | Publish button → site available at subdomain | — |
| 22.7 | Publish flushes save | Pending saves completed before publish | — |
| 22.8 | Publish creates snapshot | Version history updated after publish | — |
| 22.9 | Publish triggers OG image | OG image regenerated on publish | — |
| 22.10 | Publish rebuilds search index | Full-text index updated | — |
| 22.11 | Save as template | Editor header button saves current state as template | — |

---

## 23. Canvas Editor — AI Agent (Preview/Apply)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 23.1 | AI text rewrite | Inspector button → prompt → preview ops | — |
| 23.2 | AI media replacement | Inspector button → prompt → asset suggestion | — |
| 23.3 | AI section generation | Section toolbar → recipe + prompt → new section | — |
| 23.4 | Preview panel | AI ops shown in side panel before apply | — |
| 23.5 | Accept preview | Accept button applies ops to state | — |
| 23.6 | Dismiss preview | Dismiss button cancels, state unchanged | — |
| 23.7 | AI busy lock | All AI buttons disabled while preview open | — |
| 23.8 | Save flush before AI | Pending saves completed before AI request | — |

---

## 24. Canvas Editor — Symbols

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 24.1 | Convert section to symbol | "Sym" button → name prompt → symbol created | — |
| 24.2 | Symbol master stored | state.symbols[] contains new master | — |
| 24.3 | Symbol instance replaces | Original section replaced with instance | — |
| 24.4 | Nested symbol rejected | Section with existing instance can't convert | — |
| 24.5 | Symbol placeholder | Editor shows master name + counts | — |
| 24.6 | Symbol in published | Published site inlines symbol content | — |

---

## 25. Canvas Editor — Real-Time Collaboration

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 25.1 | WebSocket connect | Editor connects to SiteRoom DO | — |
| 25.2 | Presence indicator | Collaborator count badge updates | — |
| 25.3 | Cursor awareness | Remote cursor positions visible | — |
| 25.4 | Live sync | Edits from one user appear in another's canvas | — |
| 25.5 | Conflict resolution | Concurrent edits merge via CRDT | — |
| 25.6 | Presence timeout | Stale presence (30s) auto-cleaned | — |
| 25.7 | Disconnect/reconnect | WebSocket reconnects gracefully | — |

---

## 26. Canvas Editor — Modals

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 26.1 | Text modal | Single-line input with submit/cancel | — |
| 26.2 | Multiline text modal | Textarea with Ctrl+Enter submit | — |
| 26.3 | Select modal | Dropdown selection with confirm | — |
| 26.4 | Escape closes modal | Escape key dismisses without action | — |
| 26.5 | Backdrop closes modal | Click outside dismisses without action | — |
| 26.6 | Autofocus | Modal input focused and selected on open | — |
| 26.7 | Link modal | Text preview + href input + target toggle | — |

---

## 27. Published Site — Rendering

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 27.1 | Subdomain access | `subdomain.rev01.aayushman.dev` serves published HTML | — |
| 27.2 | Custom domain access | Custom domain resolves to published site | — |
| 27.3 | Text rendering | Text elements render with correct styles/marks | — |
| 27.4 | Image rendering | Images load from R2 with correct dimensions | — |
| 27.5 | Video rendering | Videos render with correct playback attributes | — |
| 27.6 | Button rendering | Action elements render as clickable links | — |
| 27.7 | Shape rendering | SVG shapes render correctly | — |
| 27.8 | Container rendering | Layout containers render with children | — |
| 27.9 | Chart rendering | Charts render with data visualization | — |
| 27.10 | Code snippet rendering | Syntax-highlighted code snippets | — |
| 27.11 | Symbol instance rendering | Symbol instances resolve to inlined content | — |
| 27.12 | Navigation rendering | Site-wide nav renders on all pages | — |
| 27.13 | Custom fonts | @font-face declarations load custom WOFF2 | — |
| 27.14 | Style kit applied | Correct color/typography theme | — |
| 27.15 | Responsive layout | Mobile viewport renders correctly | — |
| 27.16 | Motion animations | Entrance animations trigger on scroll | — |

---

## 28. Published Site — Interactive Elements

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 28.1 | Accordion expand/collapse | Click header toggles content visibility | — |
| 28.2 | Carousel navigation | Next/prev buttons cycle slides | — |
| 28.3 | Carousel autoplay | Auto-advances if configured | — |
| 28.4 | Form submission | Fill fields + submit → stored in DB | — |
| 28.5 | Form Turnstile | Bot protection challenge appears | — |
| 28.6 | Form validation | Required fields enforced | — |
| 28.7 | Form success redirect | After submit, redirects to configured URL | — |
| 28.8 | Embed iframe | Embedded content loads in iframe | — |

---

## 29. Published Site — Password Protection

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 29.1 | Password gate | Protected site shows unlock form | — |
| 29.2 | Correct password | Valid password → cookie set → content visible | — |
| 29.3 | Wrong password | Invalid password → error message | — |
| 29.4 | Unlock cookie persistence | Subsequent visits skip gate (cookie valid) | — |
| 29.5 | Gate on all pages | All pages of protected site gated | — |

---

## 30. Published Site — Search

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 30.1 | Search query | `GET /__rev01/search?q=term` returns results | — |
| 30.2 | Result relevance | Results match published text content | — |
| 30.3 | Result metadata | Results include page slug + element ID | — |
| 30.4 | Empty query | Empty/short query handled gracefully | — |
| 30.5 | No results | Non-matching query returns empty set | — |

---

## 31. Published Site — SEO & Social

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 31.1 | Meta title | `<title>` matches page settings | — |
| 31.2 | Meta description | `<meta name="description">` present | — |
| 31.3 | OG image | `<meta property="og:image">` with valid URL | — |
| 31.4 | OG image render | `/og` endpoint returns PNG image | — |
| 31.5 | Canonical URL | `<link rel="canonical">` present | — |
| 31.6 | Sitemap | `/sitemap.xml` lists published pages | PASS |
| 31.7 | Robots.txt | `/robots.txt` references sitemap | PASS |

---

## 32. Published Site — Live Updates

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 32.1 | WebSocket connect | Visitor page connects to `/__live` | — |
| 32.2 | Publish broadcast | Publish triggers update to open visitor tabs | — |
| 32.3 | Live content refresh | Visitor sees updated content without reload | — |

---

## 33. Templates & Library

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 33.1 | Template seeds | Starter Canvas, Launch Page, Enterprise Scale, Studio Portfolio, Local Business available | — |
| 33.2 | Create from template | Site created with template's sections/elements | — |
| 33.3 | Custom template save | Save site as reusable template | — |
| 33.4 | Custom template list | Owner's saved templates appear in picker | — |
| 33.5 | Custom template delete | Remove saved template | — |
| 33.6 | Global templates | Admin-created templates visible to all | — |
| 33.7 | Library section save | Save section to library | — |
| 33.8 | Library section import | Import library section into site | — |
| 33.9 | Library section delete | Remove from library | — |
| 33.10 | Section recipes | hero-split, feature-grid, gallery-strip, cta-band, etc. | — |

---

## 34. Owner Assets (Media Library)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 34.1 | List assets | `GET /api/owner/assets` returns all owner media | — |
| 34.2 | Upload image | POST multipart → stored in R2, record in DB | — |
| 34.3 | Upload video | POST multipart → stored in R2 | — |
| 34.4 | Content-hash dedup | Same file uploaded twice → single record | — |
| 34.5 | Delete asset | Remove asset (check references) | — |
| 34.6 | Delete blocked if in-use | 412 response with reference list | — |
| 34.7 | Cross-site usage | Asset usable across multiple owner sites | — |
| 34.8 | Image dimensions | Width/height probed and stored | — |
| 34.9 | MIME type detection | Correct media type stored | — |

---

## 35. Custom Fonts

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 35.1 | Upload WOFF2 | POST font file → stored in R2 | — |
| 35.2 | List site fonts | GET returns uploaded fonts | — |
| 35.3 | Delete font | Remove custom font | — |
| 35.4 | @font-face emission | Published CSS includes font declarations | — |
| 35.5 | Font delivery | `/fonts/:contentHash` serves WOFF2 | — |
| 35.6 | Font in style kit | Custom font usable in typography settings | — |

---

## 36. Site Import

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 36.1 | Import from URL | Provide URL → scraper extracts content | — |
| 36.2 | Sections mapped | Scraped DOM converted to CanvasSections | — |
| 36.3 | Assets materialized | Imported images saved as OwnerAssets | — |
| 36.4 | Seed color extracted | Dominant color used for custom theme | — |
| 36.5 | Fonts mapped | Imported fonts mapped to tokens | — |
| 36.6 | Import warnings | Scraper warnings surfaced to user | — |

---

## 37. Internationalization (i18n)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 37.1 | Auto-translate | Gemini-powered translation of site content | — |
| 37.2 | Language selection | Choose target language | — |
| 37.3 | Translation applied | Translated content replaces/augments original | — |

---

## 38. Themes & Style Kits

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 38.1 | Kit switcher | Switch between 4 built-in style kits | PASS (MCP) |
| 38.2 | Immediate UI update | Canvas reflects kit change instantly | — |
| 38.3 | Custom theme editor | Color, typography, surface customization panel | — |
| 38.4 | Type pair selector | 7 curated font stacks available | — |
| 38.5 | Preset switcher | Quick-switch between kit presets | — |
| 38.6 | Dark/light mode | Dual-palette CSS for visitor mode toggle | — |
| 38.7 | Theme persistence | Custom theme saved via API | — |

---

## 39. Forms System (End-to-End)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 39.1 | Form element in editor | Add form element with field configuration | — |
| 39.2 | Form fields setup | Add/remove/configure form fields | — |
| 39.3 | Form published render | Form renders with all fields on published site | — |
| 39.4 | Visitor submission | Fill + submit → stored in DB | — |
| 39.5 | Turnstile verification | Bot check passes for legitimate users | — |
| 39.6 | Rate limiting | Rapid submissions throttled | — |
| 39.7 | Webhook fire | Submission triggers outbound POST webhook | — |
| 39.8 | Webhook signature | `X-Rev01-Signature` HMAC header present | — |
| 39.9 | Owner views submissions | Forms inbox shows all entries | — |
| 39.10 | CSV download | Export submissions as CSV | — |

---

## 40. Collaborators (End-to-End)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 40.1 | Invite flow | Owner invites → email sent → user accepts | — |
| 40.2 | Editor role access | Editor collaborator can edit site | — |
| 40.3 | Viewer role access | Viewer collaborator has read-only access | — |
| 40.4 | Revoke access | Owner removes collaborator → access lost | — |
| 40.5 | Email delivery | Resend API sends invitation email | — |

---

## 41. On-Site Editing

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 41.1 | Edit token generation | `POST /api/on-site-edit` signs JWT | — |
| 41.2 | Cookie scoped | Cookie set for `.rev01.aayushman.dev` | — |
| 41.3 | Subdomain editor | Published site opens in edit mode with token | — |
| 41.4 | API access via token | `/__api/*` routes work with edit token auth | — |
| 41.5 | Token expiry | 4-hour TTL enforced | — |

---

## 42. Error Handling & Edge Cases

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 42.1 | 404 published site | Non-existent subdomain → appropriate error | PASS |
| 42.1b | Search without site | `/__rev01/search` without valid site host returns error | PASS |
| 42.1c | Form submit without site | `/__rev01/forms` without valid site context returns error | PASS |
| 42.1d | Unlock without site | `/__rev01/unlock` without valid site context returns error | PASS |
| 42.2 | Invalid site ID | API requests with bad ID → 404/400 | — |
| 42.3 | Unauthorized access | Accessing other user's site → 403 | — |
| 42.4 | Network failure recovery | Offline → reconnect → state syncs | — |
| 42.5 | Concurrent edit conflict | Two users edit same element → CRDT resolves | — |
| 42.6 | Large file upload | Oversized upload → appropriate error | — |
| 42.7 | Invalid file type | Non-image/video upload rejected | — |
| 42.8 | Rate limit hit | Form rate limiter returns 429 | — |
| 42.9 | CSP enforcement | Embeds respect allowlist | — |

---

## 43. Performance & Loading

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 43.1 | Editor cold start | Canvas loads within acceptable time | — |
| 43.2 | Published page load | Visitor page renders quickly | — |
| 43.3 | Image optimization | CF Image Resizing delivers optimized assets | — |
| 43.4 | Font caching | WOFF2 served with cache headers | — |
| 43.5 | WebSocket stability | Connection maintained during long sessions | — |

---

## 44. Addon System

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 44.1 | Addon shop page | `/dashboard/shop` lists all available addons with name, tagline, price | — |
| 44.2 | Acquire addon | Click "Get addon" → `POST /api/addons/:addonId/acquire` grants entitlement | — |
| 44.3 | Owned badge | Acquired addons show "Owned" badge in shop | — |
| 44.4 | Revoke addon | `DELETE /api/addons/:addonId/acquire` removes entitlement | — |
| 44.5 | Site addons page | `/dashboard/sites/:siteId/addons` shows per-site addon config | — |
| 44.6 | Enable addon on site | Toggle enable → `PUT /api/addons/sites/:siteId/:addonId` | — |
| 44.7 | Configure addon | Fill config fields (API keys, URLs) and save | — |
| 44.8 | Config validation | Invalid config values rejected by pattern | — |
| 44.9 | List site addons | `GET /api/addons/sites/:siteId` returns addon configs | — |
| 44.10 | Unauthenticated shop returns 401 | Auth guard on `/api/addons/*` | PASS |
| 44.11 | Unauthenticated addon acquire returns 401 | Auth guard on `POST /api/addons/:id/acquire` | PASS |

---

## 45. Site-Level Sidebar Navigation

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 45.1 | Sidebar renders on site pages | Any `/dashboard/sites/:id/*` page shows left sidebar with 9 links | — |
| 45.2 | Active page highlighted | Current page link has `aria-current="page"` and visual highlight | — |
| 45.3 | All 9 links present | Editor, Settings, Navigation, Forms, Versions, Domains, Addons, Accessibility, Chat | — |
| 45.4 | "All sites" back link | Clicking "← All sites" navigates to `/dashboard` | — |
| 45.5 | No sidebar on global pages | Dashboard, Templates, Shop, Settings, Profile have NO sidebar | — |
| 45.6 | Site name in sidebar header | Sidebar shows site name in uppercase label | — |

---

## 46. Rich Text Editing

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 46.1 | contenteditable activation | Clicking a text element makes it editable | — |
| 46.2 | Bold shortcut | Ctrl+B toggles bold on selected text | — |
| 46.3 | Italic shortcut | Ctrl+I toggles italic on selected text | — |
| 46.4 | Underline shortcut | Ctrl+U toggles underline on selected text | — |
| 46.5 | Link shortcut | Ctrl+K opens link insertion modal | — |
| 46.6 | Floating mark toolbar | Selecting text shows toolbar with 7 mark buttons | — |
| 46.7 | Mark persistence | Bold/italic marks survive save + reload | — |
| 46.8 | Paste handling | Pasting formatted text preserves bold/italic/link marks | — |
| 46.9 | Adjacent run merging | Typing "abc" then bolding "b" produces 3 runs, not more | — |
| 46.10 | Semantic role select | Inspector shows heading/body/label role dropdown | — |
| 46.11 | DOM parser round-trip | Edit text → blur → re-select → content matches what was typed | — |

---

## 47. AI Chat Panel (Editor)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 47.1 | Chat button in editor header | Editor header shows "Chat" button | — |
| 47.2 | Panel toggle | Clicking Chat opens 360px slide-out panel on right | — |
| 47.3 | Panel close | Clicking × or Chat again closes the panel | — |
| 47.4 | Input field | Panel has text input with "Ask the agent..." placeholder | — |
| 47.5 | Send button | Panel has Send button that submits the message | — |
| 47.6 | User message display | Sent message appears as user bubble (right-aligned) | — |
| 47.7 | SSE streaming tokens | Assistant response streams in token by token | — |
| 47.8 | Session persistence | Session ID returned on first message, reused on subsequent | — |
| 47.9 | op-preview Accept | Tool preview shows "Accept" button; clicking calls /apply | — |
| 47.10 | Canvas update on accept | Accepting an op-preview updates the canvas in real-time | — |
| 47.11 | Error display | API errors shown as error-styled message bubble | — |
| 47.12 | Busy state | Send button disabled while waiting for response | — |

---

## 48. AI Agent Prompt (Editor)

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 48.1 | AI button in editor header | Editor header shows cyan "AI" button | — |
| 48.2 | Prompt modal | Clicking AI opens text modal with "Describe the change..." | — |
| 48.3 | Preview flow | Submitting prompt calls /canvas-agent/preview and shows result panel | — |
| 48.4 | Accept/dismiss | Preview panel has Accept and Dismiss buttons | — |
| 48.5 | Canvas update on accept | Accepting applies ops and updates canvas state | — |
| 48.6 | AI section button | Each section toolbar has "AI section" button | — |
| 48.7 | AI rewrite on text | Text inspector shows "AI rewrite" button | — |
| 48.8 | Busy state | All AI buttons disabled while one AI operation is in progress | — |

---

## 49. AI Image Generation

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 49.1 | Generate from media inspector | Media inspector has AI generation button | — |
| 49.2 | Aspect ratio presets | 8 options: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 | — |
| 49.3 | Replicate integration | POST to Replicate Flux Schnell model | — |
| 49.4 | Generated image replaces element | Result uploaded as ownerAsset and set on element | — |
| 49.5 | Missing API key error | Clear error when REPLICATE_API_TOKEN not configured | — |

---

## 50. Scroll Entrance Animations

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 50.1 | Observer injected | Published site HTML contains IntersectionObserver script | — |
| 50.2 | Elements start hidden | `[data-entrance]` elements have `opacity: 0` initially | — |
| 50.3 | Scroll triggers animation | Scrolling element into viewport adds `data-visible` attribute | — |
| 50.4 | Animate once | Observer unobserves after triggering (no re-animation on scroll back) | — |
| 50.5 | Kit-derived timing | Transition uses `--motion-duration` and `--motion-easing` CSS vars | — |
| 50.6 | No script when no animations | If no elements have `data-entrance`, observer script still present but no-ops | — |
| 50.7 | Not in editor | Editor does NOT have the entrance observer (animations are publish-only) | — |

---

## 51. Form Email Notifications

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 51.1 | Email sent on submission | Successful form submission triggers Resend email to site owner | — |
| 51.2 | Non-blocking | Form response returns before email sends (fire-and-forget) | — |
| 51.3 | Email content | Contains form ID, timestamp, link to forms inbox | — |
| 51.4 | Email failure non-fatal | Failed email send does not break form submission success | — |
| 51.5 | Owner email resolution | Resolves email via site → customer → email join | — |

---

## 52. Section Background Video

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 52.1 | Video element emitted | Section with `backgroundVideo` renders `<video>` as first child | — |
| 52.2 | Autoplay + muted | Video has `autoplay loop muted playsinline` attributes | — |
| 52.3 | Full cover | Video styled `position:absolute; inset:0; object-fit:cover` | — |
| 52.4 | aria-hidden | Background video has `aria-hidden="true"` | — |
| 52.5 | No video when absent | Sections without `backgroundVideo` emit no `<video>` tag | — |

---

## 53. Popup/Modal Sections

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 53.1 | Section marked as popup | `data-rev01-popup="true"` + trigger type/value attributes emitted | — |
| 53.2 | Initially hidden | Popup sections have `display: none` initially | — |
| 53.3 | Exit-intent trigger | Popup shows when mouse leaves viewport top (`clientY <= 0`) | — |
| 53.4 | Delay trigger | Popup shows after N milliseconds | — |
| 53.5 | Scroll trigger | Popup shows when scroll percentage >= value | — |
| 53.6 | Dismissal persistence | Dismissed popup stays dismissed (localStorage per section ID) | — |
| 53.7 | Close button | Popup has close/dismiss mechanism | — |

---

## 54. Background Effects

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 54.1 | data-bg-effect attribute | Sections emit `data-bg-effect="grain"` (or grid/soft-light/paper/glass) | — |
| 54.2 | Validator accepts effects | `backgroundEffect` values validated against allowed set | — |
| 54.3 | Agent can set effects | `designSection` tool accepts `backgroundEffect` parameter | — |
| 54.4 | Effects preserved in Yjs | Round-trip through Y.Doc projection maintains backgroundEffect | — |

---

## 55. i18n & RTL Support

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 55.1 | RTL detection | Arabic/Farsi/Hebrew/Urdu locales trigger RTL | — |
| 55.2 | HTML dir attribute | `<html lang="ar" dir="rtl">` emitted for RTL locales | — |
| 55.3 | Coordinate mirroring | RTL layouts mirror element x-coordinates | — |
| 55.4 | BCP-47 resolution | Full locale code resolved with fallback chain | — |
| 55.5 | Per-page locale routing | `/<locale>/<slug>` URL structure served correctly | — |

---

## 56. Visitor Light/Dark Mode

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 56.1 | Dual palette CSS | Published site has both light and dark `:root` rules | — |
| 56.2 | Early script | Inline script sets mode before first paint (no flash) | — |
| 56.3 | prefers-color-scheme | Respects system preference when no localStorage value | — |
| 56.4 | localStorage persistence | Toggle choice persisted across visits | — |
| 56.5 | Toggle element | Visitor-facing toggle button switches modes | — |
| 56.6 | Pre-computed dark palettes | Built-in kits have calculated dark variants (not just inverted) | — |

---

## 57. Plan Limits & Gating

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 57.1 | Dashboard shows limit | "3 of 3 on Free" in stat card | PASS |
| 57.2 | Dashboard button gated | "+ New site" becomes "Upgrade to add sites" at limit | PASS |
| 57.3 | Templates page gated | "Create site" replaced with "Upgrade" message at limit | — |
| 57.4 | API enforces limit | `POST /api/sites` returns 403 at limit | — |
| 57.5 | Usage meters | Settings page shows sites/storage/AI generations with progress bars | PASS |

---

## 58. Element Inspector Panels

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 58.1 | Text inspector | Semantic role, font size, font weight, alignment, AI rewrite button | — |
| 58.2 | Action inspector | 7 variants, label input, link type (external/page), destination picker | — |
| 58.3 | Shape inspector | 6 shape variants via dropdown | — |
| 58.4 | Container inspector | 7 surface variants via dropdown | — |
| 58.5 | Media inspector | Upload/history/gallery, alt text, fit mode, AI generate, video controls | — |
| 58.6 | Chart inspector | Kind picker (5 types), data grid, axis titles, legend toggle | — |
| 58.7 | Motion controls (all) | Motion preset dropdown (16 presets), delay input (0-2000ms) | — |
| 58.8 | Z-order controls (all) | Bring forward / send backward buttons | — |
| 58.9 | Reading-order controls (all) | Reorder in DOM for assistive tech | — |

---

## 59. Section Toolbar

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 59.1 | Section actions | Duplicate, delete, move up, move down | — |
| 59.2 | Save to library | Section toolbar has "Save to library" button | — |
| 59.3 | Convert to symbol | Section toolbar has "Sym" button to create SymbolMaster | — |
| 59.4 | AI section | Section toolbar has "AI section" button for agent-driven design | — |
| 59.5 | Element add buttons | Per-section quick-add buttons: +T(text), +▷(media), +◇(shape), +□(container), +📊(chart) | — |

---

## 60. Page SEO Settings

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 60.1 | SEO link in Pages tab | Each page in editor Pages tab has "SEO" link | — |
| 60.2 | Title field | Title input with 60-character counter | — |
| 60.3 | Description field | Description textarea with 160-character counter | — |
| 60.4 | noIndex toggle | Checkbox to exclude page from search engines | — |
| 60.5 | Canonical URL | Optional canonical URL input | — |
| 60.6 | Locale field | BCP-47 locale input | — |
| 60.7 | Character count warnings | Counter turns warning color near limit | — |

---

## 61. JSON-LD Structured Data

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 61.1 | Script tag emitted | Published pages have `<script type="application/ld+json">` | — |
| 61.2 | Valid JSON | JSON-LD parses correctly | — |
| 61.3 | Required fields | Contains @context, @type, name | — |
| 61.4 | Description included | Pages with description include it in JSON-LD | — |
| 61.5 | URL included | Canonical URL present as `url` field | — |
| 61.6 | Image included | OG image present as `image` field when available | — |
| 61.7 | Safe encoding | Special characters don't produce raw `</script>` in output | — |

---

## 62. Canvas Validation

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 62.1 | Page width bounds | Width outside 960-1920px rejected | — |
| 62.2 | Section height bounds | Height outside 240-1400px rejected | — |
| 62.3 | Element type validation | Unknown element types rejected | — |
| 62.4 | Href scheme validation | Only http, https, mailto, tel, internal paths, anchors allowed | — |
| 62.5 | Inline mark validation | Only 7 recognized mark types accepted | — |
| 62.6 | All errors collected | Validator collects ALL errors, never fails fast | — |
| 62.7 | Background effect validation | Only grain/grid/soft-light/paper/glass/none accepted | — |

---

## 63. Asset Deduplication & Integrity

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 63.1 | Content-hash dedup | Uploading same bytes twice → same R2 key, two ownerAsset rows | — |
| 63.2 | Image dimension probing | PNG/JPEG/GIF/WebP dimensions detected from magic bytes | — |
| 63.3 | Cross-owner dedup | Two owners uploading same file share R2 object, separate rows | — |
| 63.4 | Cascade delete | Deleting ownerAsset cleans up R2 only when no siblings remain | — |
| 63.5 | Reference report | Delete flow reports which elements reference the asset before confirming | — |

---

## 64. Embed CSP & Provider Resolution

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 64.1 | YouTube resolution | youtube.com and youtu.be URLs → YouTube embed | — |
| 64.2 | Vimeo resolution | vimeo.com URLs → Vimeo embed | — |
| 64.3 | Figma resolution | figma.com URLs → Figma embed | — |
| 64.4 | Google Maps resolution | maps.google.com, goo.gl/maps → Maps embed | — |
| 64.5 | Generic iframe fallback | Unknown URLs → sandboxed iframe | — |
| 64.6 | CSP frame-src | Content-Security-Policy includes only used providers | — |
| 64.7 | Sandbox attributes | All embeds have `allow-scripts allow-same-origin allow-popups allow-forms` | — |
| 64.8 | Lazy loading | Embeds have `loading="lazy"` | — |
| 64.9 | Invalid URL placeholder | Invalid embed URL shows placeholder instead of broken iframe | — |

---

## 65. Editor Link Popover & Canvas Link Handling

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 65.1 | Inline link hover popover | Hover rich-text link → floating popover shows URL and actions | — |
| 65.2 | Inline link selection pin | Selecting/caret-inside link pins popover until dismissed | — |
| 65.3 | Open inline link | Popover Open button opens link in a new tab | — |
| 65.4 | Edit inline link | Popover Edit opens the link edit modal with current URL | — |
| 65.5 | Unlink inline link | Popover Unlink removes link mark but preserves text | — |
| 65.6 | Action link popover | Selecting an action element auto-pins link popover for its destination | — |
| 65.7 | Nav link popover | Hover/click nav links exposes link popover without navigating away from editor | — |
| 65.8 | Visitor-view preview | Popover shows a small preview styled like the published visitor link | — |
| 65.9 | Editor click safety | Canvas links remain inspectable/clickable without breaking text caret editing | — |

---

## 66. Dashboard Site Cards & Redesigned Settings

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 66.1 | Site card click expands | Clicking a non-button/card area opens expanded site details | — |
| 66.2 | Expanded card dismissal | Backdrop click or Escape closes expanded card | — |
| 66.3 | Details button ARIA | 3-dot details button toggles `aria-expanded` correctly | — |
| 66.4 | Detail row navigation | Hosting/password/search/dark-mode rows deep-link to settings anchors | — |
| 66.5 | Domain detail navigation | Custom domain row links to Domains page | — |
| 66.6 | Analytics detail navigation | Analytics row links to site Addons page | — |
| 66.7 | Settings hosting summary | Settings page shows plan, CDN, style kit, publish status, and address | — |
| 66.8 | Password card | Enable/update/disable password protection from redesigned settings | — |
| 66.9 | Search indexing toggle | Toggle `siteNoIndex` from settings and revert on failed save | — |
| 66.10 | Visitor dark mode toggle | Toggle `darkModeEnabled` from settings and persist via canvas config API | — |
| 66.11 | Collaborator list | Settings page lists collaborator email, role, active/pending status | — |
| 66.12 | Collaborator removal | Remove button confirms then deletes collaborator row | — |

---

## 67. Template Gallery & Apogee Showcase

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 67.1 | Apogee listed | Template gallery includes "Apogee Showcase" | — |
| 67.2 | Apogee preview renders | Apogee iframe preview renders without "Preview unavailable" tombstone | — |
| 67.3 | All element types covered | Apogee fixture includes all 15 canonical element types including `symbol-instance` | PASS (code audit) |
| 67.4 | Community tab | Community tab shows built-in templates plus global custom templates | — |
| 67.5 | Personal tab | Personal tab shows private owner templates | — |
| 67.6 | Personal empty state | Empty Personal tab explains how to save a private template | — |
| 67.7 | Preview scale | Template iframes use dashboard-aligned thumbnail scale across viewport widths | — |

---

## 68. AI Tool Surface & Apply Flow

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 68.1 | 15 mutating tools exposed | Canvas/chat agent tool list includes all mutating operation names | PASS (code audit) |
| 68.2 | query_site tool | Chat model can request token-capped site summary/full listing | — |
| 68.3 | query_assets tool | Chat model can request uploaded asset metadata before media ops | — |
| 68.4 | Tool preview stream | Mutating tool calls stream as op-preview cards | — |
| 68.5 | Accept applies op | Clicking Accept applies previewed op through canvas-agent apply route | — |
| 68.6 | Parser rejects bad args | Invalid tool args return explicit parse errors | — |
| 68.7 | Element type mismatch rejected | `updateElement` with wrong `elementType` fails loudly | — |
| 68.8 | Page ops | Agent can add/update/delete pages via preview/apply | — |
| 68.9 | Site config ops | Agent can set style kit, dark mode, locale/noindex config via preview/apply | — |

---

## 69. Security Hardening Regression Checks

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 69.1 | Editor link XSS | Link mark URLs/text cannot inject script/HTML into editor or published output | — |
| 69.2 | Theme panel attr escaping | Theme panel owner-controlled attributes are escaped | — |
| 69.3 | Version timeline XSS | Snapshot/version labels do not reach unsafe `innerHTML` | — |
| 69.4 | SMTP header injection | Form email values cannot inject mail headers | — |
| 69.5 | GA ID validation | Invalid GA measurement ID rejected server-side | — |
| 69.6 | Chart SVG attribute escaping | Legend/label values cannot break out of SVG attributes | — |
| 69.7 | CSS selector escaping | User-controlled element IDs are escaped before selector construction | — |
| 69.8 | Timing-safe compare | Password/signature comparisons do not short-circuit by prefix | — |
| 69.9 | Admin auth null-safety | Missing auth context returns explicit unauthorized/admin failure | — |
| 69.10 | System-message leak guard | Agent throws when a system message would leak into persisted chat history | — |

---

## 70. Published/Public Runtime Changes

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 70.1 | Live payload validation | Visitor live script rejects malformed WebSocket payloads with console error | — |
| 70.2 | Current-path live update | Publish broadcast updates the currently viewed slug only when HTML exists | — |
| 70.3 | Visitor count UI removed | Published pages do not render a viewer-count presence pill | PASS (code audit) |
| 70.4 | Responsive CSS memoized | Re-rendering same snapshot identity does not recompute responsive CSS | — |
| 70.5 | Published favicon | Snapshot `faviconAssetId` emits `<link rel="icon">` | — |
| 70.6 | Custom-domain on-site editing | Custom-domain public site can enter editor mode with origin-bound edit token | — |

---

## 71. E2E Infrastructure

| # | Feature | Test Description | Status |
|---|---------|-----------------|--------|
| 71.1 | User-flow suite shape | Playwright suite is organized around auth experience, infrastructure, published site, and visitor journey | PASS (code audit) |
| 71.2 | Production targeting | Playwright config can target deployed production URL rather than only local dev | — |
| 71.3 | Browser-level checks | Tests exercise clicks/navigation/visitor flows instead of only API calls | — |

---

## Test Environment Notes

- **Auth**: Tests will need Clerk test mode or mock auth tokens
- **Database**: Neon branch per test suite recommended
- **AI**: Gemini calls should be stubbed in most tests (test integration separately)
- **R2 Storage**: Use Miniflare/local R2 emulation
- **WebSocket**: Playwright supports WebSocket interception
- **Turnstile**: Use Cloudflare's test keys for always-pass
- **Email**: Mock Resend API or use test mode
- **Scraper**: Mock scraper service for import tests
