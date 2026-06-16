# Competitive Capability Gap Catalog

**Status:** Investigation
**Date:** 2026-06-16

## User-Visible Done State

The owner wants Open Canvas to compete with Figma, Webflow, Framer, and adjacent
site-builder platforms. "Done" for this investigation means we can name, in
plain product language, the visible capabilities those products offer today,
what Open Canvas already covers, what it lacks, and which missing capabilities
are worth considering next.

Success looks like:

- A product decision-maker can see where Open Canvas is already differentiated.
- A product decision-maker can see which missing capabilities are table stakes
  for professional site building.
- A product decision-maker can separate strategic additions from attractive
  distractions.
- A future ADR or implementation plan can point to this document for competitor
  context without re-running the whole market scan.

Non-goals:

- Implementing any of the additions.
- Copying competitor UI, source code, proprietary assets, or protected designs.
- Treating arbitrary owner-authored scripts as the answer for core builder
  behaviours. Unsupported behaviours must be modeled explicitly or rejected
  loudly.
- Claiming feature parity where the repo only has a partial or disabled path.

Hard constraints:

- Open Canvas remains a validated document-model product: additions must become
  schema-owned concepts when they affect edit, preview, publish, collaboration,
  import, versioning, or the agent.
- No silent degradation. If a competitor-style import, generated component, or
  optimization path cannot preserve semantics, the owner should see an explicit
  unsupported finding.
- Current project language from `CONTEXT.md` applies: Owner, Visitor, Editable
  Site, Published Site, Section Library, Design Primitive, Agent, Addon, and
  Published Address.

## Sources Checked

Primary sources were preferred.

- Figma Config 2025 recap: https://www.figma.com/blog/config-2025-recap/
- Figma release notes, including June 2026 webpage capture: https://www.figma.com/release-notes/
- Figma Sites: https://www.figma.com/sites/
- Figma Make: https://www.figma.com/make/
- Figma Buzz: https://www.figma.com/buzz/
- Webflow AI: https://webflow.com/ai
- Webflow AI Site Builder: https://webflow.com/ai-site-builder
- Webflow updates: https://webflow.com/updates
- Webflow Optimize: https://webflow.com/feature/optimize
- Webflow Localization overview: https://help.webflow.com/hc/en-us/articles/33961240752147-Localization-overview
- Webflow Analyze introduction: https://university.webflow.com/videos/introduction-to-webflow-analyze
- Framer updates: https://www.framer.com/updates
- Framer product page: https://www.framer.com/
- Framer Workshop: https://www.framer.com/workshop/
- Framer On-Page Editing: https://www.framer.com/help/articles/on-page-editing/
- Framer A/B testing: https://www.framer.com/help/articles/how-to-run-an-a-b-test-on-your-framer-site/
- Framer plugins: https://www.framer.com/plugins/
- Wix Studio: https://www.wix.com/studio
- Wix developer changelog: https://dev.wix.com/docs/changelog
- Wix features: https://www.wix.com/features/main
- Squarespace Blueprint AI: https://www.squarespace.com/websites/ai-website-builder
- Squarespace Design Intelligence: https://www.squarespace.com/design-intelligence
- Squarespace AI help: https://support.squarespace.com/hc/en-us/articles/16282290976013-Using-Squarespace-AI
- Shopify Winter 2026 Editions: https://www.shopify.com/editions/winter2026
- Shopify Magic theme blocks: https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/shopify-magic/generate-blocks
- Shopify changelog: https://changelog.shopify.com/
- Canva AI 2.0: https://www.canva.com/newsroom/news/canva-create-2026-ai/
- Canva website builder: https://www.canva.com/website-builder/
- Canva Code: https://www.canva.com/ai-code-generator/

Local Open Canvas references:

- `README.md`
- `FEATURES.md`
- `CONTEXT.md`
- `docs/key-architecture.md`
- `docs/specs/designer-template-fidelity-gaps.md`
- `docs/adr/0067-component-style-objects-for-interactive-components-and-collections.md`

## Current Open Canvas Strengths

Open Canvas is not starting from zero. Its strongest present capabilities are:

- Free-form desktop canvas editing with positioned design primitives.
- Fifteen document-model element atoms: text, media, action, shape, container,
  form, embed, chart, accordion, carousel, table, code, nav, collection, and
  tabs.
- Rich text editing with inline marks, link editing, and paste normalization.
- Deterministic Style Kits, custom fonts, visitor light/dark mode, and custom
  per-element visual styles.
- Section Library, Template Seeds, Custom Templates, section lineage, and
  cross-template section import.
- Multi-page sites, pinned header/footer, custom 404, page metadata, sitemap,
  robots, canonical URLs, and OG image generation.
- Responsive rendering with desktop/tablet/phone overrides.
- Agent and chat surfaces that preview canvas changes before owner acceptance.
- AI image generation with preview-before-persist.
- Real-time co-editing with Yjs, presence cursors, collaborator invitations,
  and live visitor update broadcasts on publish.
- Version snapshots, preview, restore, and pre-restore safety capture.
- Forms with Turnstile, rate limiting, webhook signing, CSV export, AJAX
  submission, and no-JS submission.
- Password protection, custom domains, custom-domain on-site edit tokens, and
  security hardening around assets, embeds, redirects, and CSP.
- A11y audit/reporting, remediation hints, site search, localization routing,
  RTL mirroring, embeds, charts, code snippets, notifications, and a small
  Addon system.

The strongest differentiated claim is still: one live canvas document shared by
owner, collaborators, agent, and published visitors, with explicit validation and
preview-before-commit gates.

## Competitor Capability Scan

### Figma

Figma has moved from design collaboration into a broader production ecosystem:

- Figma Sites publishes responsive websites from Figma-shaped design work, with
  responsive components, auto layout, prebuilt blocks, preset interactions,
  custom cursors, hover effects, Sites CMS, and code/AI interaction authoring.
- Figma Make turns designs and prompts into functional prototypes or apps,
  supports direct visual editing of AI output, and advertises Supabase-backed
  app data/auth/API integration.
- Figma Buzz targets brand-controlled asset production: templates with locked
  editable regions, simplified non-designer editing, bulk/multi-edit, grid view,
  image/text AI operations, image generation, video trimming/export, and plugin
  integration with DAM/TMS workflows.
- Figma Draw expands native vector illustration.
- Grid adds a richer auto-layout mode closer to CSS Grid: spans, track sizing,
  responsive resizing, overlapping/layer controls, and "ignore auto layout"
  escape hatches.
- Release notes show continued browser/web capture into editable layers, which
  overlaps Open Canvas Site Import but from a design-reference angle.

Open Canvas coverage:

- Stronger on live publishing semantics, visitor live updates, explicit
  validation, and website-hosting ownership than classic Figma Design.
- Partial overlap with Figma Sites through responsive pages, CMS-like
  Collections, prebuilt sections, interactions, and publish.
- Partial overlap with Figma Make through the Agent and AI image generation.
- Little overlap with Buzz, Draw, Dev Mode, mature design-system libraries, or
  Figma's plugin/community ecosystem.

### Webflow

Webflow is positioning as an AI-native web platform for building, managing,
optimizing, and ranking marketing sites:

- AI Site Builder generates a multi-page site foundation with layout, images,
  copy, and a reusable design system.
- Webflow AI extends into page generation, CMS item generation, code, SEO/AEO,
  localization, and in-editor assistance.
- Optimize provides A/B/n testing, rules-based personalization, and AI
  personalization that shifts delivery toward converting variants.
- Analyze is built-in analytics that works with Optimize.
- Localization supports static page, CMS, SEO, machine translation, locale-aware
  component prop defaults, and localized page-name ergonomics.
- Updates in June 2026 include AI code components, Webflow AEO, Webflow Cloud
  app deployment, role-aware quick access, pan/zoom for pages, and activity-log
  attribution for human, Webflow AI, and MCP-connected changes.
- Platform surface includes CMS, hosting, security, apps, shared libraries,
  interactions, GSAP, ecommerce, DevLink, Figma-to-Webflow, Webflow Cloud, and
  enterprise collaboration.

Open Canvas coverage:

- Strong on clean publish/runtime model, custom domains, forms, a11y, SEO
  basics, and co-edit.
- Partial on CMS, localization, interactions, apps/addons, and AI editing.
- Missing growth loop: native analytics, A/B tests, personalization, event
  goals, AI/AEO visibility, and conversion optimization.
- Missing mature visual-development primitives: classes, component props,
  conditional visibility, shared libraries, responsive flow layout, and code
  component authoring.

### Framer

Framer is converging design, premium interactive websites, CMS, analytics,
growth testing, and AI code components:

- Product page emphasizes AI-generated layouts/components, responsive visual
  design, smooth effects, interactions, animations, CMS, collaboration,
  analytics, A/B testing, SEO, performance, and hosting.
- Updates in 2026 include AI form antispam, Logo Shaders, CMS plugin
  improvements, CMS 3.0, Holo/Logo shader surfaces, and Auto Translate.
- Workshop generates advanced components from prompts inside Framer, including
  visual effects, cookie banners, tabs, and 3D tilt-style components, with
  property controls.
- On-Page Editing lets permitted editors update text, rich text, images, and
  component properties directly from the live site; add CMS pages; edit hidden
  fields; notify publishers for review; and sync changes back into the project.
- Built-in A/B testing runs experiments without code, updates results in real
  time, and can run across locales.
- Plugin marketplace spans AI, assets, CMS, design workflow, developers,
  ecommerce, forms, integrations, localization, SEO, UI kits, and utilities.

Open Canvas coverage:

- Stronger on explicit site document validation and publish/live visitor update
  mechanics.
- Partial on forms, CMS, localization, component variants, interactions, and
  AI-assisted canvas edits.
- Missing on-page editing as a safe content-editor workflow.
- Missing native analytics/A/B testing.
- Missing marketplace/plugin depth and prompt-to-code component generation.
- Missing high-end shader/visual-effect primitives beyond the motion gaps
  already catalogued in `designer-template-fidelity-gaps.md`.

### Wix Studio and Wix

Wix competes less as a pure designer tool and more as a business platform:

- Wix Studio has AI-assisted responsive behaviours and a Blocks workspace for
  widgets/interactive components that can be monetized in the app market.
- Wix developer changelog shows June 2026 additions: Editor React Components
  that integrate with Wix Harmony auto panels/controls, AI app builder that
  creates Wix CLI app projects, GitHub-synced version control, native hosting,
  and prompt-to-deployed headless Wix sites.
- Wix feature set spans templates, mobile editor, entrance animations, video
  masking, text masks, shape dividers, custom interactions, app market, code
  development, collaborators/roles, multilingual, accessibility wizard, CMS,
  backups, branded app builder, AI website builder, AI marketing agent,
  workflow agent, AI visibility overview, booking, custom forms, automations,
  CRM, invoices, memberships, loyalty, chat, file share, forum, email marketing,
  SEO tools, analytics, and event tracking.

Open Canvas coverage:

- Strong on design-document ownership and live publish.
- Partial on collaborators, multilingual basics, custom domains, site search,
  a11y, forms, SEO, custom scripts, and addons.
- Missing the broad business operating suite: CRM, booking, scheduling,
  invoicing, memberships, loyalty, live chat, forums, marketing campaigns,
  business automations, and mobile/native app surfaces.
- Missing developer marketplace and component monetization.
- Missing AI visibility and AI marketing agents.

### Squarespace

Squarespace competes on curated design and entrepreneurial business workflows:

- Blueprint AI generates personalized site drafts with copy, images, layout,
  and design suggestions.
- Design Intelligence includes AI templates, chat-based Blueprint AI,
  Squarespace GPT handoff, Site Themes, Layout Switcher, AI Writer, Brand
  Identity, SEO scanner, AI/AIO copy suggestions, AI Product Composer,
  recommended discounts, proposals, course descriptions, email campaigns, and
  brand-tailored generation.
- Refresh 2024 highlights Layout Switcher, Site Themes, Brand Identity
  Management, cookie/compliance updates, pinning effects, client invoicing,
  proposals/contracts, scheduling, monetization, payments, and marketing tools.

Open Canvas coverage:

- Stronger on free-form canvas and explicit technical architecture.
- Partial on templates, style kits, AI writing via Agent, SEO basics, forms, and
  site settings.
- Missing curated AI onboarding that produces a coherent first complete site.
- Missing one-click layout switcher for existing content.
- Missing business primitives for entrepreneurs: invoices, proposals,
  scheduling, services, courses, payments, memberships, email campaigns, and
  discounting.

### Shopify

Shopify is not a general website builder, but it defines the commerce bar:

- Winter 2026 includes Sidekick multi-step task completion, voice chat, target
  selection, memory, app discovery, app generation, money management, block
  generation for all Theme Store themes, Agentic Storefronts for AI shopping
  surfaces, Rollouts for scheduled theme changes and A/B tests, SimGym AI
  shopper simulations, theme-editor management of products/collections/markets/
  metafields, mobile theme generation, WordPress selling, Horizon improvements,
  larger product variant limits, smarter collections, B2B in Horizon themes,
  and discount/catalog improvements.
- Shopify Magic can generate Liquid theme blocks from prompts inside the theme
  editor, preview them on desktop/mobile, keep or iterate, and add self-contained
  theme files.

Open Canvas coverage:

- Open Canvas has no commerce engine.
- Current forms and Addons can capture leads, but they cannot sell products,
  manage inventory, model checkout, handle tax/shipping, or run commerce
  personalization.
- Any serious ecommerce direction requires a separate product decision; a
  shallow "buy button" primitive would not compete with Shopify.

### Canva

Canva is relevant because it owns non-designer brand production:

- Canva AI 2.0 is a conversational, agentic creative platform that generates
  layered editable outputs, keeps memory, uses brand intelligence, and spans
  complete published work.
- It includes connectors to tools like Slack, Gmail, Drive, Calendar, Notion,
  Zoom, HubSpot, Microsoft, Atlassian, and Linear.
- It adds scheduling, web research, Brand Intelligence, Sheets AI, and Canva
  Code 2.0.
- Canva Code 2.0 generates responsive interactive experiences from prompts,
  supports HTML import, forms that write to Canva Sheets, presentation embeds,
  publishing to a domain, and SSO protection.
- Canva Websites remains a fast one-page website publishing surface with a large
  template ecosystem.

Open Canvas coverage:

- Stronger on proper website structure, custom domains, validation, and editor
  ownership.
- Missing brand campaign production, bulk asset editing, team brand controls,
  creative memory, cross-tool connectors, scheduled generation, and spreadsheet-
  backed lightweight apps/forms.

## Gap Catalog

Priority codes:

- **P0:** Required to be credible against professional website builders.
- **P1:** Strong differentiator or needed soon after P0.
- **P2:** Strategic adjacency; valuable but not core enough to build first.
- **Reject for now:** Tempting, but would add too many nodes/relations before
  the user-visible behaviour is justified.

### P0: Native Analytics, Experiments, and Personalization

Competitor signal:

- Webflow Analyze/Optimize, Framer analytics and A/B testing, Shopify Rollouts,
  Wix Analytics, and Squarespace dashboards all move beyond "publish a site" to
  "improve the site."

Current Open Canvas state:

- Google Analytics exists as an Addon.
- There is no native event model, goal model, conversion dashboard, experiment
  assignment, personalization rule, or AI optimization loop.

Potential addition:

- A first-party Growth Loop: events, goals, page/section/element variants,
  experiment assignment, result dashboard, and explicit publish/version linkage.

Why it matters to the owner:

- Owners do not just want a beautiful site; they want to know whether it works
  and improve it without leaving the builder.

Pushback:

- Do not start with AI personalization. Start with event truth and experiment
  truth. AI on top of bad measurement will create confident noise.

### P0: On-Page Editing and Content Editor Role

Competitor signal:

- Framer On-Page Editing lets non-designers edit live-site content safely and
  syncs changes back into the project.
- Webflow and Wix both have role-aware editing workflows.

Current Open Canvas state:

- Open Canvas has custom-domain on-site editing for owners, edit tokens, and
  collaborator access.
- It does not have a constrained content-editor workflow that lets non-designers
  edit only allowed text/images/component fields with review before publish.

Potential addition:

- Content Editor mode: field-level editability, locked layout, draft changes,
  review notification, publisher approval, and audit trail.

Why it matters:

- A team can keep marketing content fresh without giving layout-breaking canvas
  access to everyone.

Pushback:

- Do not call generic collaborator access "content editing." The whole value is
  that layout and design integrity remain locked.

### P0: Mature CMS and Collection Rendering

Competitor signal:

- Webflow CMS, Framer CMS 3.0, Wix CMS/dynamic pages, Squarespace blog/store/
  course content, and Figma Sites CMS all treat content operations as first
  class.

Current Open Canvas state:

- Collections exist with entries, field binding, folders, and per-entry OG.
- `designer-template-fidelity-gaps.md` and ADR 0067 note that published
  Collection rendering and premium card templates still need work.

Potential addition:

- Collection renderer for card/image/custom modes; collection detail/list/index
  page workflow; editorial states; drafts; scheduling; preview; field schemas;
  search/filter/sort UI; import/export; API/webhook surface.

Why it matters:

- Sites with blogs, case studies, docs, job posts, events, resources, or
  product catalogs cannot depend on manual canvas page edits.

Pushback:

- Do not style collection cards before there is a real render target and
  editor/public parity. ADR 0067 is right to tie style work to rendering.

### P0: Responsive Flow Layout and Components With Props

Competitor signal:

- Figma Grid, Webflow layout/classes/components, Wix Studio responsive AI, and
  Framer auto sizing make responsive behaviour a core authoring surface.

Current Open Canvas state:

- Open Canvas has positioned boxes and breakpoint overrides.
- There is a pure layout engine for AI section generation, but normal owner
  authoring is still mostly absolute canvas placement.
- Components are emerging through variants/component styles, but not reusable
  prop-driven components.

Potential addition:

- Flow containers, grid/stack/split primitives as owner-editable layout nodes,
  component instances with typed props, component part targeting, and
  constraints that survive responsive changes.

Why it matters:

- Professional sites need fluid layout behaviour, not just adjusted absolute
  coordinates at three breakpoints.

Pushback:

- The current "free-form canvas" identity is valuable. Do not replace it with a
  generic Webflow clone. Add directed relations: a positioned element may be
  free-form, or it may be governed by a layout parent.

### P0: Extension and Custom Component Platform

Competitor signal:

- Webflow Apps, Framer plugins/Workshop/code components, Wix Blocks/Editor React
  Components/app market, Shopify theme blocks/apps, and Canva apps/connectors
  all make extension a platform primitive.

Current Open Canvas state:

- Addons exist, but only as a code-curated entitlement/config surface.
- There is no plugin SDK, marketplace, custom component model, component
  manifest, property controls, or safe third-party runtime boundary.

Potential addition:

- Open Canvas Addon SDK v2: custom component manifest, property controls,
  schema validation, editor preview contract, public runtime contract,
  permissions, review/install flow, and version pinning.

Why it matters:

- The builder cannot internally ship every widget, integration, and vertical
  workflow fast enough.

Pushback:

- Do not let arbitrary plugin code mutate the Editable Site outside the validate
  gate. Component extensions need typed boundaries or they will bypass the core
  system that makes Open Canvas coherent.

### P1: AI Site Builder and Blank-Canvas Onboarding

Competitor signal:

- Webflow AI Site Builder, Squarespace Blueprint AI, Wix Harmony, Shopify AI
  theme generation, Elementor Site Planner, and Canva AI 2.0 all reduce blank
  page friction.

Current Open Canvas state:

- Owners start from Template Seeds or Site Import.
- The Agent can change pages/sections/elements, and chat can inspect state.
- There is not a guided business/site brief that produces a coherent multi-page
  site with copy, sections, imagery, CMS schema, SEO, and style direction.

Potential addition:

- Brief-to-site flow: user problem, audience, offer, brand tone, pages,
  sections, content model, style kit, assets, forms, SEO, and launch checklist.

Why it matters:

- Competing builders sell "from intent to publish." Open Canvas currently sells
  "from template to edit."

Pushback:

- Do not generate arbitrary one-off JSON that bypasses the Section Library and
  validation. Site generation should compose Section Library entries, create
  owner-owned sections, or fail with explicit unsupported asks.

### P1: AI Component and Interaction Generation

Competitor signal:

- Figma Make, Framer Workshop, Shopify Magic theme blocks, Webflow AI code
  components, Wix AI app builder, and Canva Code all generate interactive
  components or app-like surfaces from prompts.

Current Open Canvas state:

- The Agent can create sections and mutate supported element types.
- Custom scripts exist as an owner-code Addon.
- There is no prompt-to-component path with property controls, preview parity,
  validation, and versioned reuse.

Potential addition:

- Prompt-to-Component: generate a component manifest, editor controls, public
  runtime, reduced-motion/a11y metadata, and tests before making it reusable.

Why it matters:

- This is where competitors are moving fastest. It also fits Open Canvas's
  Agent + validate-gate strength if constrained correctly.

Pushback:

- Do not make raw JS snippets the core component model. Generated components
  need schema-owned props and loud validation errors.

### P1: Motion, Overlay, and Premium Interaction Model

Competitor signal:

- Framer shaders/interactions, Figma Sites interactions plus Make, Webflow
  GSAP/interactions, Wix custom interactions, and high-end designer templates
  all compete on motion quality.

Current Open Canvas state:

- Existing motion is preset/delay based, with popups, pointer-fx, carousel
  variants, and section/page entrances.
- `designer-template-fidelity-gaps.md` already catalogs missing motion graph,
  scroll scenes, preloaders, route transitions, designer-grade overlays,
  pointer/hover breadth, layout transitions, text animation, rich media/3D, and
  runtime parity.

Potential addition:

- Canonical interaction model: Trigger, Target, Motion Sequence, Scroll Scene,
  Overlay, Route Transition, Interaction State, and one runtime hydrator shared
  by editor and visitor.

Why it matters:

- Premium templates and launch sites are judged by choreography, not only by
  layout.

Pushback:

- Avoid adding another isolated runtime per effect. Reduce existing motion,
  popup, pointer, carousel, and route behaviours into one conceptual model.

### P1: Brand System and Governance

Competitor signal:

- Figma Buzz, Canva Enterprise/AI 2.0, Squarespace Brand Identity, and Webflow
  shared libraries all emphasize brand consistency at scale.

Current Open Canvas state:

- Style Kits and custom fonts exist.
- Templates and sections can be saved/reused.
- There is no team brand kit, locked brand template, editable-region policy,
  brand asset DAM, campaign kit, or bulk asset generation.

Potential addition:

- Brand Kit: logos, colors, type, tone, approved assets, locked template
  regions, editable fields, multi-format campaign export, and agent brand
  memory.

Why it matters:

- Teams need repeatable brand production, not only one website.

Pushback:

- This is adjacent to website building. It should not outrank CMS, analytics,
  responsive layout, and safe content editing unless Open Canvas intentionally
  pivots toward Canva/Figma Buzz.

### P1: Enterprise Collaboration, Review, and Audit

Competitor signal:

- Figma collaboration, Webflow role-aware access and activity logs, Framer
  review notifications, Wix roles/permissions, and Shopify admin logs all make
  team governance visible.

Current Open Canvas state:

- Collaborators can edit, presence exists, notifications exist, and access is
  checked per endpoint.
- Missing comments, mentions, tasks, page/section review, approval flows,
  branch/diff, granular roles, SSO/SAML, org policies, and human/agent/action
  attribution logs.

Potential addition:

- Review System: comments anchored to page/section/element, mentions,
  assignments, content edit approvals, version diffs, activity log, and actor
  attribution for owner/collaborator/agent/import/MCP.

Why it matters:

- Professional teams need to know who changed what, why, and whether it is ready
  to publish.

Pushback:

- Do not add comments without durable anchors and version semantics. Comments
  that detach from elements after edits create worse trust than no comments.

### P1: AI/AEO Visibility and SEO Operations

Competitor signal:

- Webflow AEO, Wix AI Visibility Overview, Squarespace SEO Scanner/AI copy, and
  Shopify Agentic Storefronts all respond to AI-mediated discovery.

Current Open Canvas state:

- SEO metadata, sitemap, robots, canonical URLs, OG images, and search exist.
- There is no AI visibility scanner, structured answer/readiness report, LLM
  traffic tracking, schema coverage dashboard, or content recommendations.

Potential addition:

- Visibility Report: search metadata, structured data, sitemap status, AI answer
  readiness, content gaps, LLM referral tracking, and agent-suggested fixes.

Why it matters:

- Builders are shifting from "rank in search" to "appear correctly in AI
  answers and chats."

Pushback:

- Keep this evidence-backed. Do not invent an "AI score" unless it maps to
  observable checks and traffic signals.

### P2: Business Suite

Competitor signal:

- Wix and Squarespace bundle bookings, scheduling, invoices, CRM, memberships,
  email marketing, loyalty, forums, file sharing, courses, and business agents.

Current Open Canvas state:

- Forms, notifications, email, Addons, and custom scripts exist.
- There is no CRM, booking, membership, course, invoice, quote, loyalty,
  calendar, live chat, forum, or email campaign system.

Potential addition:

- Vertical business packs: lead CRM, booking/scheduling, member-only content,
  email campaigns, simple invoices, and course/content monetization.

Why it matters:

- Small businesses pick builders based on operational outcomes, not editor
  elegance.

Pushback:

- Do not build a generic business suite before deciding target segment. A
  portfolio designer, SaaS marketer, restaurant owner, and course creator need
  different nodes and relations.

### P2: Commerce

Competitor signal:

- Shopify sets the commerce standard; Wix and Squarespace cover lighter
  ecommerce.

Current Open Canvas state:

- No commerce model.

Potential addition:

- Either integrate with Shopify/Stripe as explicit Addons for lightweight
  commerce, or build a real commerce domain: product catalog, variants,
  inventory, checkout, tax, shipping, payments, refunds, discounts, orders,
  customer accounts, and fulfillment.

Why it matters:

- Website builders become storefront builders quickly for many owners.

Pushback:

- A shallow product-card element is not commerce. If Open Canvas wants commerce,
  it should first choose "commerce integration" or "commerce engine."

### P2: Developer Handoff, Code Export, and Repo Sync

Competitor signal:

- Figma Dev Mode, Webflow DevLink/Cloud/apps, Wix CLI/GitHub app builder,
  Shopify Liquid/theme code, Elementor/WordPress openness, and Framer developer
  APIs all serve developer workflows.

Current Open Canvas state:

- Published output is pure HTML with scoped runtimes.
- There is no Dev Mode, code export, framework export, repo sync, design-token
  export, component spec, or developer handoff workflow.

Potential addition:

- Developer Mode: inspect generated HTML/CSS, export tokens/sections, publish
  webhooks, component manifests, API access, repo sync, and diffable generated
  artifacts.

Why it matters:

- Larger teams need to integrate the builder with existing engineering systems.

Pushback:

- Export should not become a second source of truth unless Open Canvas
  deliberately supports round-trip import. One-way export is simpler and should
  be named as such.

### P2: Import Fidelity and Web Capture

Competitor signal:

- Figma release notes show webpage capture as editable layers; Webflow has
  Figma-to-Webflow; Open Canvas already has Site Import architecture.

Current Open Canvas state:

- Site Import exists locally but is disabled in the hosted public POC.
- Import maps source animation to nearest Motion Preset and supports only a
  subset of element types.

Potential addition:

- Production Site Import: hosted scraper availability, unsupported-behaviour
  inventory, animation inventory, asset/font mapping report, confidence report,
  and explicit owner review before persistence.

Why it matters:

- Owners often start from an existing site or inspiration page, not a blank
  canvas.

Pushback:

- Do not silently approximate premium behaviours. If source motion, layout, or
  scripts cannot be represented, report them as unsupported.

### P2: Media Editing, Rich Assets, and 3D

Competitor signal:

- Figma Draw, Framer shaders, Wix video masks/text masks, Canva AI visuals/video,
  Squarespace AI imagery, and Shopify image generation all make asset creation
  part of the builder.

Current Open Canvas state:

- Asset upload, dedupe, image probing, custom fonts, video backgrounds, embeds,
  and AI image generation exist.
- Missing image crop/edit UI, background removal, vector drawing, video trim,
  Lottie/Rive, Spline/3D-first media, shader surfaces, DAM integration, and
  brand-approved asset workflows.

Potential addition:

- Asset Studio: crop, focal point, background removal, basic retouch, video
  trim/poster, vector/icon library, animation-file support, DAM import, and
  per-asset usage tracking.

Why it matters:

- Site quality depends on media quality. Owners should not leave the product for
  basic asset preparation.

Pushback:

- Rich media must define asset type, CSP, reduced-motion behaviour, editor
  preview, publish failure behaviour, and performance budgets before shipping.

### P2: Mobile Authoring and Mobile Operations

Competitor signal:

- Shopify mobile theme generation, Wix Owner App, mobile site editors, and
  business apps make mobile management normal.

Current Open Canvas state:

- POC constraints say desktop editing and desktop visitor viewing only.
- Responsive render exists, but mobile authoring is not a first-class surface.

Potential addition:

- Mobile preview/editor for content edits, publish controls, form inbox,
  notifications, and lightweight site operations.

Why it matters:

- Owners increasingly manage sites away from a desktop.

Pushback:

- Full mobile canvas editing is probably not the first mobile win. Start with
  content edits, publish status, inbox, and notifications.

### Reject For Now: Full Figma Replacement

Competitor signal:

- Figma includes interface design, design systems, prototyping, Dev Mode,
  FigJam, Slides, Draw, Buzz, Sites, Make, plugins, and enterprise governance.

Why not now:

- "Compete with Figma" is too broad to be one product roadmap. Replacing Figma
  would require a full design-tool ecosystem, not only a site builder.

Better framing:

- Compete with Figma Sites and Framer for published marketing websites, then
  selectively adopt Figma-like design-system and collaboration primitives that
  directly improve website production.

### Reject For Now: Arbitrary Custom Code as Core Behaviour

Competitor signal:

- Shopify Magic, Webflow AI code components, Elementor AI code, Framer Workshop,
  Canva Code, and Wix Editor React Components all expose code generation.

Why not as a shortcut:

- Arbitrary code cannot be inspected by the validator, edited by the Agent,
  previewed reliably in the editor, localized structurally, versioned
  semantically, or imported into the Section Library.

Better framing:

- Generated code is acceptable only behind component manifests, property
  controls, explicit permissions, preview parity, runtime boundaries, and loud
  validation.

## Recommended Sequencing

1. Native analytics/events/goals, then A/B tests and personalization.
2. On-page content editing with a locked layout and review flow.
3. Collection rendering and CMS workflow maturity.
4. Flow layout primitives plus component props.
5. Extension/custom component platform with validated manifests.
6. Brief-to-site AI onboarding.
7. Prompt-to-component generation on top of the extension model.
8. Canonical motion/interaction model from `designer-template-fidelity-gaps.md`.
9. Brand Kit and locked brand templates.
10. Enterprise review/audit/comment workflow.
11. AI/AEO visibility report.
12. Business-suite or commerce work only after choosing a target segment.

## Sharp Product Pushback

The stated ambition names four different product categories:

- Figma: design-collaboration ecosystem.
- Webflow: professional visual web development and optimization platform.
- Framer: high-end interactive marketing-site builder.
- Wix/Squarespace: business operating system for small businesses.
- Shopify: commerce operating system.
- Canva: brand content production system.

Open Canvas should not try to absorb all of these at once. The minimally
complex competitive system is:

1. **Website creation:** AI-assisted canvas, responsive layout, CMS, templates,
   sections, components, and interactions.
2. **Website operation:** publish, domains, forms, analytics, SEO/AEO,
   experiments, content editing, and review.
3. **Website extension:** validated components, Addons, integrations, and
   developer hooks.

Everything else should be admitted only when it directly strengthens one of
those three behaviours. That keeps Open Canvas from becoming a loose pile of
competitor-shaped features.
