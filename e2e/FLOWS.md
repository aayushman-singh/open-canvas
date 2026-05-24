# Production E2E Test Flows

Target: `https://rev01.aayushman.dev` (main) + `*.rev01.aayushman.dev` (published)

## Flow 1 — Landing Page

1. Navigate to `/`
2. Verify hero section renders: editor pane, live preview pane, agent ops log
3. Verify tagline heading: "multiplayer site builder with an agent at the cursor."
4. Verify 3 differentiator cards (01, 02, 03) with headings and body text
5. Verify demo counters section (LOC, edit ops, agent ops, published sites)
6. Verify footer with source link, license, date
7. Verify nav links: docs/, github/, launch ->
8. Click "launch ->" → should navigate to `/dashboard`
9. Check console for errors (expect 0 besides favicon)
10. Measure TTFB and load time

## Flow 2 — Auth + Dashboard

1. Navigate to `/dashboard`
2. Verify Clerk auth redirects or loads signed-in state
3. Verify "Your sites" heading, "+ New site" link, sign-out link
4. Verify each site card shows: iframe preview, name, subdomain link, style kit badge, status badge, updated date
5. Verify published sites show "Edit" + "Live" buttons
6. Verify draft sites show "Edit" + "Publish" buttons
7. Click "+ New site" → navigates to `/dashboard/templates`
8. Verify 5 template seeds with live iframe previews: Starter Canvas, Launch Page, Enterprise Scale, Studio Portfolio, Local Business
9. Verify each template card shows description and style kit badge
10. Verify site creation form: site name input, subdomain input with `.rev01.aayushman.dev` suffix, validation hint
11. Create a site: fill name + subdomain, select template, click "Create site" → redirects to editor
12. Check console for errors

## Flow 3 — Canvas Editor

### Layout
1. Navigate to `/dashboard/sites/:siteId/edit`
2. Verify top bar: breadcrumb (rev01 / dashboard / {name}), subdomain display, Save, Translate, Publish, Save as template
3. Verify left sidebar: Add / Sections / Symbols tabs
4. Verify Add panel: Blank section, Components (Text/Image/Video/Button/Shape/Container), Style Kit buttons
5. Verify canvas renders all sections with positioned elements
6. Verify bottom toolbar: Select mode, Pan mode, Fit, 100%, -/+, zoom percentage
7. Verify status bar shows "Ready"

### Element selection
8. Single-click element → shows resize handles, right inspector panel, section toolbar
9. Right inspector shows: element type, id, kit info, reading order with up/down, z-order (front/back/forward/backward)
10. Text elements show: AI rewrite, Role, Font size, Font weight, Align, Motion preset, Motion delay
11. Action elements show: Variant dropdown (solid/outline/ghost/pill/glass/brutalist/underline), Label, Href, Motion preset

### Inline text editing
12. Double-click text element → enters inline editing mode
13. Verify formatting toolbar appears: B, I, U, S, </>, HL, Link
14. Select text, press Ctrl+B → toggles bold
15. Press Ctrl+I → toggles italic
16. Press Ctrl+U → toggles underline
17. Press Ctrl+K → opens link dialog
18. Press Escape → exits inline editing

### Style Kit switching
19. Click each style kit button (charcoal, orange-editorial, blue-saas, green-organic)
20. Verify canvas updates visually (background, typography, accent colors, shapes)
21. Verify status bar shows "Style kit: {name}" briefly

### Section management
22. Click Sections tab → shows section recipe list with search + filter (All/Built-in/Library)
23. Verify recipes include: hero-split, feature-grid, gallery-strip, cta-band, logo-strip, testimonial-row, video-hero
24. Click "Use" on a recipe → section added to canvas

### Element controls
25. Section toolbar shows: +T, +Img, +Vid, +Btn, +Shape, +Container, +Chart, Dup, Up, Down, Save, Del, Sym, AI section
26. Click "+T" → adds text element to section
27. Click "Dup" → duplicates section
28. Click "Del" → deletes section (verify confirmation if needed)

### Zoom
29. Click "Fit" → canvas fits viewport
30. Click "100%" → resets to 100%
31. Click "-" → decrements zoom (e.g. 100% → 90%)
32. Click "+" → increments zoom
33. Ctrl+scroll → zooms

### Variant controls
34. Select action element → change Variant dropdown → verify button style updates live
35. Select shape element → verify shape variant controls
36. Select surface/container → verify surface variant controls

### Z-order and reading order
37. Select element → click "Bring to front" / "Send to back" / "Forward" / "Backward"
38. Select element → click reading order up/down arrows → verify DOM order changes

### Save
39. Click Save → verify status shows saving state → returns to "Ready"
40. Reload page → verify saved state persists

## Flow 4 — AI Agent

1. Select a text element → click "AI rewrite" in right panel
2. Verify dialog: "AI rewrite" heading, prompt input, Cancel/OK
3. Type a prompt (e.g. "Make it punchier") → click OK
4. Verify preview appears with proposed text change
5. Accept → text updates on canvas
6. Discard → original text preserved

7. Click "AI section" in section toolbar
8. Verify dialog with Recipe dropdown (hero-split, feature-grid, gallery-strip, cta-band, logo-strip, testimonial-row, video-hero)
9. Select recipe → click OK
10. Verify preview section appears
11. Accept → section added to canvas
12. Discard → section removed

## Flow 5 — Publish + Live Visitor Update

1. In editor, click "Publish"
2. Verify publish completes (status feedback)
3. Navigate to `{subdomain}.rev01.aayushman.dev`
4. Verify published site renders all sections matching editor state
5. Verify style kit applied correctly
6. Verify images/media load
7. Verify action button links work

### Live update (WebSocket)
8. Open published site in Tab A
9. Open editor in Tab B
10. Make a change in editor (e.g. edit text)
11. Save + Publish
12. Verify Tab A updates without manual refresh (WebSocket via SiteRoom DO)

## Flow 6 — Site Assets

1. In editor, select a media element (image/video)
2. Click replace/upload → file picker opens
3. Upload a new image → verify it replaces the element
4. Verify the image loads via asset endpoint (`/api/canvas/sites/{id}/assets/{key}`)
5. Publish → verify the image appears on the published site (`/{subdomain}/assets/{key}`)
6. Upload a video → verify poster frame
7. Replace media again → verify previous asset still accessible (persists across changes)
